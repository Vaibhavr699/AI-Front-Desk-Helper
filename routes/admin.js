"use strict";

const express = require("express");
const db = require("../lib/db");
const { getPlan, listPlans } = require("../lib/plans");

const router = express.Router();

// -------------------- Platform Stats --------------------

router.get("/stats", async (req, res) => {
  try {
    const [totals, mrr, planBreakdown] = await Promise.all([
      db.query(
        `SELECT
          COUNT(*) as total_tenants,
          COUNT(*) FILTER (WHERE subscription_status = 'active') as active_subs,
          COUNT(*) FILTER (WHERE subscription_status = 'canceled') as churned,
          COUNT(*) FILTER (WHERE price_override_monthly IS NOT NULL) as with_overrides
         FROM tenants`
      ),
      db.query(
        `SELECT
          COALESCE(SUM(
            CASE
              WHEN price_override_monthly IS NOT NULL
                AND (promo_expires_at IS NULL OR promo_expires_at > now())
              THEN price_override_monthly
              ELSE
                CASE plan
                  WHEN 'elite' THEN 99700
                  WHEN 'pro' THEN 49700
                  ELSE 29700
                END
            END
          ), 0) as mrr_cents
         FROM tenants
         WHERE subscription_status = 'active'`
      ),
      db.query(
        `SELECT
          COALESCE(plan, 'basic') as plan,
          COUNT(*) as count
         FROM tenants
         GROUP BY COALESCE(plan, 'basic')
         ORDER BY count DESC`
      ),
    ]);

    res.json({
      total_tenants: parseInt(totals.rows[0].total_tenants, 10),
      active_subs: parseInt(totals.rows[0].active_subs, 10),
      churned: parseInt(totals.rows[0].churned, 10),
      with_overrides: parseInt(totals.rows[0].with_overrides, 10),
      mrr_cents: parseInt(mrr.rows[0].mrr_cents, 10),
      plan_breakdown: planBreakdown.rows.map((r) => ({
        plan: r.plan,
        count: parseInt(r.count, 10),
      })),
    });
  } catch (e) {
    console.error("[Admin] Stats error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- List All Tenants (Admin View) --------------------

router.get("/tenants", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT
        t.id, t.name, t.slug, t.company_name, t.plan,
        t.subscription_status, t.stripe_customer_id, t.stripe_subscription_id,
        t.plan_overrides,
        t.promo_label, t.promo_expires_at, t.promo_notes,
        t.is_suspended, t.suspended_reason,
        t.created_at,
        (SELECT COUNT(*) FROM calls WHERE tenant_id = t.id) as total_calls,
        (SELECT COUNT(*) FROM bookings WHERE tenant_id = t.id) as total_bookings,
        (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary))
         FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones
       FROM tenants t
       ORDER BY t.created_at DESC`
    );

    const tenants = r.rows.map((t) => {
      const currentPlanId = t.plan || "basic";
      const plan = getPlan(currentPlanId);
      
      const overrides = t.plan_overrides || {};
      const planOverride = overrides[currentPlanId] || {};
      
      const isOverrideActive =
        planOverride.monthly != null &&
        (!t.promo_expires_at || new Date(t.promo_expires_at) > new Date());
        
      return {
        ...t,
        total_calls: parseInt(t.total_calls, 10),
        total_bookings: parseInt(t.total_bookings, 10),
        default_monthly: plan.priceMonthly,
        default_setup: plan.setupFee,
        effective_monthly: isOverrideActive
          ? planOverride.monthly
          : plan.priceMonthly,
        effective_setup:
          planOverride.setup != null ? planOverride.setup : plan.setupFee,
        override_active: isOverrideActive,
      };
    });

    res.json({ tenants });
  } catch (e) {
    console.error("[Admin] Tenants list error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Get Single Tenant (Admin Detail) --------------------

router.get("/tenants/:id", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT
        t.*,
        (SELECT COUNT(*) FROM calls WHERE tenant_id = t.id) as total_calls,
        (SELECT COUNT(*) FROM bookings WHERE tenant_id = t.id) as total_bookings,
        (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary))
         FROM phone_numbers pn WHERE pn.tenant_id = t.id) as phones,
        (SELECT json_build_object('email', du.email, 'role', du.role)
         FROM dashboard_users du WHERE du.tenant_id = t.id LIMIT 1) as owner
       FROM tenants t
       WHERE t.id = $1`,
      [req.params.id]
    );

    if (!r.rows[0]) return res.status(404).json({ error: "Tenant not found" });

    const t = r.rows[0];
    const plan = getPlan(t.plan);

    // Mask sensitive fields
    delete t.twilio_account_sid;
    delete t.twilio_auth_token;
    delete t.facebook_page_access_token;
    delete t.api_key;
    delete t.crm_api_key;

    res.json({
      ...t,
      total_calls: parseInt(t.total_calls, 10),
      total_bookings: parseInt(t.total_bookings, 10),
      default_monthly: plan.priceMonthly,
      default_setup: plan.setupFee,
    });
  } catch (e) {
    console.error("[Admin] Tenant detail error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Suspend Tenant --------------------
router.patch("/tenants/:id/suspend", async (req, res) => {
  try {
    const id = req.params.id;
    const { is_suspended, suspended_reason } = req.body || {};

    await db.query(
      `UPDATE tenants SET
        is_suspended = $1,
        suspended_reason = $2,
        updated_at = now()
       WHERE id = $3`,
      [is_suspended === true, suspended_reason || null, id]
    );

    console.log(
      "[Admin] Tenant suspension updated tenantId=%s suspended=%s by=%s",
      id,
      is_suspended,
      req.user.email
    );

    res.json({ success: true });
  } catch (e) {
    console.error("[Admin] Suspend update error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Update Tenant Pricing --------------------

router.patch("/tenants/:id/pricing", async (req, res) => {
  try {
    const id = req.params.id;
    const {
      plan_overrides,
      promo_label,
      promo_expires_at,
      promo_notes,
      plan,
    } = req.body || {};

    const updates = [];
    const values = [];
    let idx = 1;

    if (plan_overrides !== undefined) {
      updates.push(`plan_overrides = $${idx++}`);
      values.push(plan_overrides);
    }
    if (promo_label !== undefined) {
      updates.push(`promo_label = $${idx++}`);
      values.push(promo_label || null);
    }
    if (promo_expires_at !== undefined) {
      updates.push(`promo_expires_at = $${idx++}`);
      values.push(promo_expires_at || null);
    }
    if (promo_notes !== undefined) {
      updates.push(`promo_notes = $${idx++}`);
      values.push(promo_notes || null);
    }
    if (plan !== undefined) {
      if (!["basic", "pro", "elite"].includes(plan)) {
        return res.status(400).json({ error: "plan must be basic, pro, or elite" });
      }
      updates.push(`plan = $${idx++}`);
      values.push(plan);
    }

    // Track who applied the promo
    updates.push(`promo_applied_by = $${idx++}`);
    values.push(req.user.sub);

    if (updates.length <= 1) {
      return res.status(400).json({ error: "No pricing fields provided" });
    }

    updates.push("updated_at = now()");
    values.push(id);

    await db.query(
      `UPDATE tenants SET ${updates.join(", ")} WHERE id = $${idx}`,
      values
    );

    console.log(
      "[Admin] Pricing updated tenantId=%s by=%s overrides=%j",
      id,
      req.user.email,
      { plan_overrides, promo_label }
    );

    res.json({ success: true });
  } catch (e) {
    console.error("[Admin] Pricing update error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Remove Pricing Overrides --------------------

router.delete("/tenants/:id/pricing", async (req, res) => {
  try {
    const id = req.params.id;

    await db.query(
      `UPDATE tenants SET
        plan_overrides = '{}'::jsonb,
        promo_label = NULL,
        promo_expires_at = NULL,
        promo_applied_by = NULL,
        promo_notes = NULL,
        updated_at = now()
       WHERE id = $1`,
      [id]
    );

    console.log("[Admin] Pricing overrides removed tenantId=%s by=%s", id, req.user.email);
    res.json({ success: true });
  } catch (e) {
    console.error("[Admin] Remove overrides error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Plans Reference --------------------

router.get("/plans", async (req, res) => {
  res.json({ plans: listPlans() });
});

module.exports = router;

"use strict";

const express = require("express");
const db = require("../lib/db");
const auth = require("../lib/auth");
const emailService = require("../services/email");
const stripeService = require("../lib/stripe");
const { getPlan, listPlans, ADMIN_PLAN_IDS } = require("../lib/plans");
const crypto = require("crypto");
const { generateUniqueResellerCode } = require("../lib/resellerBilling");
const { getResellerTier } = require("../lib/resellerPlans");
const { buildTenantInsert } = require("../lib/tenantInsert");

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
    // brand_mode added Apr 19, 2026 so the admin console can show each
    // tenant's current branding state (AFDH vs White Label) at a glance.
    const r = await db.query(
      `SELECT
        t.id, t.name, t.slug, t.company_name, t.plan, t.logo_url,
        t.subscription_status, t.stripe_customer_id, t.stripe_subscription_id,
        t.plan_overrides,
        t.promo_label, t.promo_expires_at, t.promo_notes,
        t.is_suspended, t.suspended_reason,
        t.brand_mode,
        t.parent_mode,
        t.created_at,
        (SELECT COUNT(*) FROM calls WHERE tenant_id = t.id) as total_calls,
        (SELECT COUNT(*) FROM bookings WHERE tenant_id = t.id) as total_bookings,
        (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary, 'lead_source', pn.lead_source))
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
        (SELECT json_agg(json_build_object('phone', pn.phone, 'is_primary', pn.is_primary, 'lead_source', pn.lead_source))
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

// -------------------- Update Tenant Branding Mode --------------------
//
// Added Apr 19, 2026. Dedicated endpoint for flipping a tenant between
// ai_branded (sees AI Front Desk Helper chrome) and white_label (sees
// their own logo/colors). Kept separate from /pricing on purpose — this
// is a feature flag, not a billing action, and shouldn't be coupled to
// pricing drawer behavior (e.g. Stripe sync).
//
// Gated at the router level by requireSuperAdmin (see server.js mount of
// /api/admin), so only platform admins can flip this. Tenants cannot
// self-upgrade to white_label.
router.patch("/tenants/:id/branding", async (req, res) => {
  try {
    const id = req.params.id;
    const { brand_mode } = req.body || {};

    // Whitelist matches the DB CHECK constraint added Apr 19.
    if (!["ai_branded", "white_label"].includes(brand_mode)) {
      return res.status(400).json({ error: "brand_mode must be ai_branded or white_label" });
    }

    const result = await db.query(
      `UPDATE tenants SET
        brand_mode = $1,
        updated_at = now()
       WHERE id = $2
       RETURNING id, brand_mode`,
      [brand_mode, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    console.log(
      "[Admin] Tenant brand_mode updated tenantId=%s brand_mode=%s by=%s",
      id,
      brand_mode,
      req.user.email
    );

    res.json({ success: true, tenant: result.rows[0] });
  } catch (e) {
    console.error("[Admin] Branding update error:", e.message);
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
      // Apr 29, 2026 — switched from hardcoded ["basic","pro","elite"] to
      // ADMIN_PLAN_IDS so admin endpoints can assign hidden tiers (franchise,
      // hq_*, etc). Public /api/plans still filters via listPlans().
      if (!ADMIN_PLAN_IDS.includes(plan)) {
        return res.status(400).json({ error: `Invalid plan: ${plan}` });
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

    // 2. Sync to Stripe if they have an active subscription
    await stripeService.syncStripeSubscription(id).catch(err => {
      console.error("[Admin] Stripe pricing sync failed:", err.message);
    });

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
    
    // Sync to Stripe (remove custom pricing)
    await stripeService.syncStripeSubscription(id).catch(err => {
      console.error("[Admin] Stripe pricing sync failed (on removal):", err.message);
    });

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

// -------------------- Platform Admin Management --------------------

router.get("/admins", async (req, res) => {
  try {
    const r = await db.query(
      "SELECT id, email, role, created_at FROM dashboard_users WHERE is_super_admin = true ORDER BY created_at ASC"
    );
    res.json({ admins: r.rows });
  } catch (e) {
    console.error("[Admin] List admins error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/invite", async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: "Email required" });

    const normalized = email.trim().toLowerCase();
    
    // Check if user already exists
    const existing = await auth.findUserByEmail(normalized);
    if (existing) {
      if (existing.is_super_admin) {
        return res.status(400).json({ error: "User is already an admin" });
      }
      // If they exist but aren't super admin, we could upgrade them, 
      // but for "Invite" let's stick to new users or explicit upgrade later.
      // For now, let's just say they exist.
      return res.status(400).json({ error: "A user with this email already exists" });
    }

    // Create a "pending" admin user with a random password hash (they'll set it via reset link)
    const tempPass = require("crypto").randomBytes(16).toString("hex");
    const hash = await auth.hashPassword(tempPass);
    
    const r = await db.query(
      "INSERT INTO dashboard_users (email, password_hash, is_super_admin, role) VALUES ($1, $2, true, 'admin') RETURNING id, email",
      [normalized, hash]
    );
    const user = r.rows[0];

    // Generate reset token
    const token = auth.generateResetToken();
    const expires = new Date(Date.now() + 48 * 3600000); // 48 hours for invitation
    await auth.saveResetToken(user.email, token, expires);

    // Send invitation email
    const base = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
    const inviteLink = `${base}/reset-password?token=${token}`;
    
    await emailService.sendAdminInvitationEmail(user.email, inviteLink);

    res.json({ success: true, user });
  } catch (e) {
    console.error("[Admin] Invite error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

router.delete("/admins/:id", async (req, res) => {
  try {
    const targetId = req.params.id;
    
    // Prevent self-deletion
    if (targetId === req.user.sub) {
      return res.status(400).json({ error: "You cannot remove yourself" });
    }

    const r = await db.query("DELETE FROM dashboard_users WHERE id = $1 AND is_super_admin = true RETURNING id", [targetId]);
    if (r.rows.length === 0) return res.status(404).json({ error: "Admin not found" });

    res.json({ success: true });
  } catch (e) {
    console.error("[Admin] Delete admin error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Create Reseller Tenant --------------------
//
// Apr 20, 2026 — Phase 2 WL Reseller Account Type.
// Superadmin-only provisioning flow. Creates a reseller tenant + owner
// dashboard_user + sends a password-set invite email (reuses the admin
// invite template for v1 — dedicated reseller welcome email comes in
// Step 9 alongside churn-handler emails).
//
// On success, the returned signup_link is what the reseller will share
// with their own prospects: /reseller/{code}/signup.
router.post("/tenants/reseller", async (req, res) => {
  try {
    const { name, owner_email, tier } = req.body || {};

    // Validation
    if (!name || !owner_email || !tier) {
      return res.status(400).json({
        error: "name, owner_email, and tier are required",
      });
    }
    if (!["starter", "growth", "scale"].includes(tier)) {
      return res.status(400).json({
        error: "tier must be starter, growth, or scale",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner_email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const normalizedEmail = owner_email.trim().toLowerCase();
    const trimmedName = String(name).trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return res.status(400).json({ error: "name must be 2-100 characters" });
    }

    // Collision check — dashboard_users email must be unique
    const existingUser = await auth.findUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({
        error: "A user with this email already exists",
      });
    }

    // Generate unique reseller_code (URL-safe 8-char, unambiguous alphabet)
    const resellerCode = await generateUniqueResellerCode(db);
    const tierDef = getResellerTier(tier);

    // Create tenant row.
    // - account_type='reseller' triggers migration 037 consistency constraints
    // - plan='basic' is a harmless placeholder (resellers don't use HQ plans;
    //   their billing comes from reseller-specific Stripe prices)
    // - subscription_status left NULL — flips to 'active' via Stripe webhook
    //   when reseller completes checkout
  // Generate URL-safe slug from name, with collision suffix if needed
function toSlug(s) {
  return String(s)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50) || "reseller";
}
let slug = toSlug(trimmedName);
for (let i = 0; i < 5; i++) {
  const { rows } = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
  if (rows.length === 0) break;
  // Collision — append short random suffix and retry
  slug = `${toSlug(trimmedName)}-${crypto.randomBytes(2).toString("hex")}`;
}

const resellerTenantInsert = buildTenantInsert(
  {
    name: trimmedName,
    company_name: trimmedName,
    slug,
    account_type: "reseller",
    reseller_tier: tier,
    reseller_code: resellerCode,
    reseller_customer_limit: tierDef.customer_limit,
    reseller_wholesale_rate_cents: tierDef.wholesale_rate_cents,
    billing_owner: "direct",
    brand_mode: "ai_branded",
    plan: "basic",
  },
  "id, name, slug, reseller_code, reseller_tier, created_at"
);
const tenantResult = await db.query(resellerTenantInsert.sql, resellerTenantInsert.values);
    const tenant = tenantResult.rows[0];

    // Create owner dashboard_user (random password, gets set via reset link)
    const tempPass = crypto.randomBytes(16).toString("hex");
    const hash = await auth.hashPassword(tempPass);
    const userResult = await db.query(
      `INSERT INTO dashboard_users (email, password_hash, tenant_id, role)
       VALUES ($1, $2, $3, 'owner')
       RETURNING id, email`,
      [normalizedEmail, hash, tenant.id]
    );
    const user = userResult.rows[0];

    // Generate password-set token (48h expiry — matches admin invite flow)
    const token = auth.generateResetToken();
    const expires = new Date(Date.now() + 48 * 3600000);
    await auth.saveResetToken(user.email, token, expires);

    // Send invite email (non-blocking — token still valid if email fails)
    const base = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
    const inviteLink = `${base}/reset-password?token=${token}`;
    try {
      await emailService.sendAdminInvitationEmail(user.email, inviteLink);
    } catch (emailErr) {
      console.error("[Admin] Reseller invite email failed:", emailErr.message);
    }

    const signupLink = `${base}/reseller/${tenant.reseller_code}/signup`;

    console.log(
      "[Admin] Created reseller tenantId=%s tier=%s owner=%s code=%s by=%s",
      tenant.id,
      tier,
      user.email,
      tenant.reseller_code,
      req.user.email
    );

    res.status(201).json({
      success: true,
      tenant,
      signup_link: signupLink,
      invite_link: inviteLink, // surfaced to admin UI for manual copy if email fails
    });
  } catch (e) {
    console.error("[Admin] Create reseller error:", e.message);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// -------------------- Create Franchise Zee --------------------
//
// Apr 29, 2026 — Phase 6 Franchise Account Type.
// Superadmin-only provisioning flow for creating a zee tenant under an
// existing HQ. Mirrors the reseller create pattern but scoped to the
// franchise plan tier (hidden from public /api/plans, admin-only).
//
// Defaults outbound gates OFF in plan_overrides.addons — HQ admin can
// flip them per-zee via PATCH /pricing later. brand_mode defaults to
// white_label since franchise zees inherit HQ branding.
//
// Stripe subscription creation is intentionally NOT done here — the zee
// will hit a paywall on first dashboard visit and self-subscribe via
// POST /api/stripe/franchise-checkout. Until they pay, subscription_status
// stays NULL and the paywall middleware blocks dashboard access.
//
// primary_email is written so lib/stripe.js getOrCreateCustomer can find
// the email directly without falling back to dashboard_users lookup.
router.post("/tenants/franchise-zee", async (req, res) => {
  try {
    const {
      hq_tenant_id,
      company_name,
      owner_email,
      monthly_override_cents,
    } = req.body || {};

    // Validation
    if (!hq_tenant_id || !company_name || !owner_email) {
      return res.status(400).json({
        error: "hq_tenant_id, company_name, and owner_email are required",
      });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(owner_email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }
    const trimmedName = String(company_name).trim();
    if (trimmedName.length < 2 || trimmedName.length > 100) {
      return res.status(400).json({ error: "company_name must be 2-100 characters" });
    }
    let overrideCents = null;
    if (monthly_override_cents !== undefined && monthly_override_cents !== null) {
      overrideCents = parseInt(monthly_override_cents, 10);
      if (!Number.isFinite(overrideCents) || overrideCents < 0) {
        return res.status(400).json({
          error: "monthly_override_cents must be a non-negative integer",
        });
      }
    }

    // Verify HQ exists and is a valid parent.
    // Apr 29, 2026 — switched from parent_mode check to HQ plan tier check.
    // parent_mode defaults to 'operating_hq' on every tenant row, so it's
    // not a reliable signal. An HQ is defined by paying for an HQ-tier plan.
    const HQ_PLAN_IDS = ["hq_starter", "hq_growth", "hq_enterprise"];
    const hqResult = await db.query(
      `SELECT id, name, plan, brand_mode FROM tenants WHERE id = $1`,
      [hq_tenant_id]
    );
    if (hqResult.rows.length === 0) {
      return res.status(404).json({ error: "HQ tenant not found" });
    }
    const hq = hqResult.rows[0];
    if (!HQ_PLAN_IDS.includes(hq.plan)) {
      return res.status(400).json({
        error: `hq_tenant_id is not a valid HQ — tenant must be on an HQ tier plan (hq_starter, hq_growth, or hq_enterprise). Current plan: ${hq.plan}`,
      });
    }

    const normalizedEmail = owner_email.trim().toLowerCase();

    // Email collision check
    const existingUser = await auth.findUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({
        error: "A user with this email already exists",
      });
    }

    // Slug generation with collision suffix
    function toSlug(s) {
      return (
        String(s)
          .toLowerCase()
          .trim()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 50) || "zee"
      );
    }
    let slug = toSlug(trimmedName);
    for (let i = 0; i < 5; i++) {
      const { rows } = await db.query("SELECT id FROM tenants WHERE slug = $1", [slug]);
      if (rows.length === 0) break;
      slug = `${toSlug(trimmedName)}-${crypto.randomBytes(2).toString("hex")}`;
    }

    // Build plan_overrides:
    // - addons.* gates outbound features OFF by default
    // - franchise.monthly is the per-zee negotiated rate (e.g. 22500 for Groovy Hues)
    // - billing_mode defaults to 'stripe' (omitted; absence means stripe)
    //   superadmin can flip to 'manual' via PATCH /pricing for exceptions
    const planOverrides = {
      addons: {
        outbound_followup: false,
        outbound_lists: false,
        outbound_daily_max: 0,
      },
    };
    if (overrideCents != null) {
      planOverrides.franchise = { monthly: overrideCents };
    }

    // Create tenant row.
    // - plan='franchise' identifies as a zee (hidden tier, admin-only)
    // - parent_id links to HQ
    // - brand_mode='white_label' — zees inherit HQ chrome by default
    // - subscription_status left NULL until zee completes Stripe checkout
    // - primary_email set so getOrCreateCustomer finds it directly
    const franchiseTenantInsert = buildTenantInsert(
      {
        name: trimmedName,
        company_name: trimmedName,
        slug,
        plan: "franchise",
        parent_id: hq_tenant_id,
        business_type: "location",
        brand_mode: "white_label",
        plan_overrides: planOverrides,
        billing_owner: "direct",
        primary_email: normalizedEmail,
      },
      "id, name, slug, plan, parent_id, brand_mode, plan_overrides, created_at"
    );
    const tenantResult = await db.query(franchiseTenantInsert.sql, franchiseTenantInsert.values);
    const tenant = tenantResult.rows[0];

    // Create owner dashboard_user (random password, set via reset link)
    const tempPass = crypto.randomBytes(16).toString("hex");
    const hash = await auth.hashPassword(tempPass);
    const userResult = await db.query(
      `INSERT INTO dashboard_users (email, password_hash, tenant_id, role)
       VALUES ($1, $2, $3, 'owner')
       RETURNING id, email`,
      [normalizedEmail, hash, tenant.id]
    );
    const user = userResult.rows[0];

    // Password-set token (48h expiry — matches admin/reseller invite flow)
    const token = auth.generateResetToken();
    const expires = new Date(Date.now() + 48 * 3600000);
    await auth.saveResetToken(user.email, token, expires);

    // Send invite (non-blocking)
    const base = (process.env.DASHBOARD_URL || process.env.BASE_URL || "").replace(/\/$/, "");
    const inviteLink = `${base}/reset-password?token=${token}`;
    try {
      await emailService.sendAdminInvitationEmail(user.email, inviteLink);
    } catch (emailErr) {
      console.error("[Admin] Franchise zee invite email failed:", emailErr.message);
    }

    console.log(
      "[Admin] Created franchise zee tenantId=%s hq=%s owner=%s override=%s by=%s",
      tenant.id,
      hq_tenant_id,
      user.email,
      overrideCents != null ? `${overrideCents}c` : "none",
      req.user.email
    );

    res.status(201).json({
      success: true,
      tenant,
      hq: { id: hq.id, name: hq.name },
      invite_link: inviteLink,
    });
  } catch (e) {
    console.error("[Admin] Create franchise zee error:", e.message);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// -------------------- Update Zee Outbound Gates --------------------
//
// Apr 29, 2026 — Phase 6 Franchise.
// Powers per-zee toggles in the HQ Locations management page. HQ admins
// can enable/disable outbound followup, outbound lists, and adjust the
// daily call cap without superadmin involvement.
//
// Body: { outbound_followup?, outbound_lists?, outbound_daily_max? }
// Each field is optional. Only provided fields get updated. Writes into
// tenants.plan_overrides.addons JSONB. Reads in services/outboundEngine.js
// pick up immediately on next call (no cache to invalidate).
//
// Validation: zee must be plan='franchise' (admin endpoint, but defense
// in depth — prevents accidentally toggling addons on non-franchise tenants).
router.patch("/tenants/:id/outbound-gates", async (req, res) => {
  try {
    const id = req.params.id;
    const { outbound_followup, outbound_lists, outbound_daily_max } = req.body || {};

    // At least one field must be provided
    if (
      outbound_followup === undefined &&
      outbound_lists === undefined &&
      outbound_daily_max === undefined
    ) {
      return res.status(400).json({
        error: "At least one of outbound_followup, outbound_lists, outbound_daily_max required",
      });
    }

    // Type validation
    if (outbound_followup !== undefined && typeof outbound_followup !== "boolean") {
      return res.status(400).json({ error: "outbound_followup must be boolean" });
    }
    if (outbound_lists !== undefined && typeof outbound_lists !== "boolean") {
      return res.status(400).json({ error: "outbound_lists must be boolean" });
    }
    if (outbound_daily_max !== undefined) {
      const max = parseInt(outbound_daily_max, 10);
      if (!Number.isFinite(max) || max < 0 || max > 1000) {
        return res.status(400).json({
          error: "outbound_daily_max must be an integer between 0 and 1000",
        });
      }
    }

    // Load tenant + verify it's a franchise zee
    const existing = await db.query(
      "SELECT id, plan, plan_overrides FROM tenants WHERE id = $1",
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    const tenant = existing.rows[0];
    if (tenant.plan !== "franchise") {
      return res.status(400).json({
        error: "Outbound gates can only be set on franchise-tier tenants",
      });
    }

    // Merge into plan_overrides.addons (preserve other addons fields)
    const overrides = tenant.plan_overrides || {};
    const addons = { ...(overrides.addons || {}) };
    if (outbound_followup !== undefined) addons.outbound_followup = outbound_followup;
    if (outbound_lists !== undefined) addons.outbound_lists = outbound_lists;
    if (outbound_daily_max !== undefined) {
      addons.outbound_daily_max = parseInt(outbound_daily_max, 10);
    }

    const newOverrides = { ...overrides, addons };

    await db.query(
      `UPDATE tenants
          SET plan_overrides = $1,
              updated_at = now()
        WHERE id = $2`,
      [newOverrides, id]
    );

    console.log(
      "[Admin] Outbound gates updated tenantId=%s gates=%j by=%s",
      id,
      addons,
      req.user.email
    );

    res.json({
      success: true,
      addons: {
        outbound_followup: !!addons.outbound_followup,
        outbound_lists: !!addons.outbound_lists,
        outbound_daily_max: addons.outbound_daily_max || 0,
      },
    });
  } catch (e) {
    console.error("[Admin] Outbound gates update error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- List Franchise Zees Under HQ --------------------
//
// Apr 29, 2026 — Phase 6 Franchise.
// Powers the HQ Locations management page (HqLocations.jsx).
// Returns all franchise zees under a given HQ tenant with billing,
// activity, and outbound gate state for the management UI.
//
// Performance notes:
// - Single query with subqueries instead of N+1 per zee
// - parent_id has idx_tenants_parent_id (verified Apr 29, 2026 — 1ms scan)
// - Activity counts use simple COUNT(*) — fine for tenants under ~1000 calls
// - effective_monthly computed in JS, not SQL (matches /tenants list pattern)
//
// Auth: requireSuperAdmin (gated at router mount in server.js)
router.get("/tenants/:hqId/zees", async (req, res) => {
  try {
    const hqId = req.params.hqId;

    // Verify HQ exists and is on an HQ-tier plan (defense in depth — the
    // frontend already gates this, but other admin tools could call us).
    const HQ_PLAN_IDS = ["hq_starter", "hq_growth", "hq_enterprise"];
    const hqResult = await db.query(
      `SELECT id, name, plan FROM tenants WHERE id = $1`,
      [hqId]
    );
    if (hqResult.rows.length === 0) {
      return res.status(404).json({ error: "HQ tenant not found" });
    }
    const hq = hqResult.rows[0];
    if (!HQ_PLAN_IDS.includes(hq.plan)) {
      return res.status(400).json({
        error: `Tenant ${hqId} is not an HQ — plan must be hq_starter, hq_growth, or hq_enterprise. Current: ${hq.plan}`,
      });
    }

    // Single query: zees + per-zee aggregates. parent_id is indexed.
    const zeesResult = await db.query(
      `SELECT
         t.id, t.name, t.slug, t.company_name, t.plan,
         t.subscription_status, t.is_suspended,
         t.plan_overrides, t.brand_mode,
         t.created_at,
         (SELECT COUNT(*) FROM calls    WHERE tenant_id = t.id) AS total_calls,
         (SELECT COUNT(*) FROM bookings WHERE tenant_id = t.id) AS total_bookings
       FROM tenants t
       WHERE t.parent_id = $1
         AND t.plan = 'franchise'
       ORDER BY t.created_at DESC`,
      [hqId]
    );

    // Compute effective_monthly + addon flags per zee in JS (matches
    // /tenants list pattern — keeps SQL simple).
    const FRANCHISE_DEFAULT_MONTHLY_CENTS = 19700; // $197 default; HQ can override per-zee
    const zees = zeesResult.rows.map((z) => {
      const overrides = z.plan_overrides || {};
      const franchiseOverride = overrides.franchise || {};
      const addons = overrides.addons || {};

      const overrideCents = franchiseOverride.monthly;
      const overrideActive = overrideCents != null;
      const effectiveMonthly = overrideActive
        ? overrideCents
        : FRANCHISE_DEFAULT_MONTHLY_CENTS;

      return {
        id: z.id,
        name: z.name,
        slug: z.slug,
        company_name: z.company_name,
        plan: z.plan,
        subscription_status: z.subscription_status,
        is_suspended: !!z.is_suspended,
        brand_mode: z.brand_mode,
        billing_mode: overrides.billing_mode || "stripe",
        effective_monthly: effectiveMonthly,
        override_active: overrideActive,
        outbound_followup_enabled: !!addons.outbound_followup,
        outbound_lists_enabled: !!addons.outbound_lists,
        outbound_daily_max: addons.outbound_daily_max || 0,
        total_calls: parseInt(z.total_calls, 10),
        total_bookings: parseInt(z.total_bookings, 10),
        created_at: z.created_at,
      };
    });

    res.json({ zees, hq: { id: hq.id, name: hq.name, plan: hq.plan } });
  } catch (e) {
    console.error("[Admin] List zees error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- Update Franchisor Shared-Number Routing --------------------
//
// Jun 9, 2026 — Phase 6 Franchise (shared-number routing).
// Powers the FranchiseSharedNumberCard on HqLocations.jsx. Lets a
// superadmin (on behalf of a franchisor) flip the master shared-number
// toggle and set the neutral ZIP-capture opener.
//
// Writes two columns on the FRANCHISOR PARENT tenant row:
//   - franchise_shared_number_enabled (bool) — the on/off master switch
//   - franchise_neutral_opener (text, nullable) — the greeting the AI
//     speaks before it knows which location serves the caller
//
// Default-false means existing tenants are unaffected until explicitly
// enabled. When enabled with a blank opener, lib/franchiseRouter
// buildNeutralOpener falls back to a default greeting (the UI warns about
// this so the franchisor isn't surprised by generic wording).
//
// Validation: target must be a parent (has ≥1 child via parent_id) so we
// never arm shared-number routing on a tenant with no locations to route
// to — that would strand every caller on the neutral opener with nowhere
// to go.
//
// Auth: requireSuperAdmin (gated at router mount in server.js), matching
// the other franchise/HQ controls on this page (outbound-gates, branding).
router.patch("/tenants/:id/franchise-shared-number", async (req, res) => {
  try {
    const id = req.params.id;
    const { enabled, neutral_opener } = req.body || {};

    // At least one field must be provided
    if (enabled === undefined && neutral_opener === undefined) {
      return res.status(400).json({
        error: "At least one of enabled, neutral_opener required",
      });
    }

    // Type validation
    if (enabled !== undefined && typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be boolean" });
    }
    if (
      neutral_opener !== undefined &&
      neutral_opener !== null &&
      typeof neutral_opener !== "string"
    ) {
      return res.status(400).json({ error: "neutral_opener must be a string or null" });
    }

    // Load the target tenant + its child count.
    const existing = await db.query(
      `SELECT t.id, t.parent_mode,
              (SELECT COUNT(*) FROM tenants c WHERE c.parent_id = t.id) AS child_count
         FROM tenants t WHERE t.id = $1`,
      [id]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    const tenant = existing.rows[0];
    const childCount = parseInt(tenant.child_count, 10) || 0;

    // Guard: never arm shared-number routing on a tenant with no children.
    // A franchisor with zero locations would strand every caller on the
    // neutral opener. Only enforced when turning it ON.
    if (enabled === true && childCount === 0) {
      return res.status(400).json({
        error:
          "Cannot enable shared-number routing — this tenant has no franchise locations to route to. Add at least one location first.",
      });
    }

    // Build the update from only the provided fields.
    const updates = [];
    const values = [];
    let idx = 1;

    if (enabled !== undefined) {
      updates.push(`franchise_shared_number_enabled = $${idx++}`);
      values.push(enabled);
    }
    if (neutral_opener !== undefined) {
      // Trim, and treat blank as NULL so buildNeutralOpener's default
      // fallback kicks in rather than speaking an empty string.
      const trimmed =
        neutral_opener === null ? null : String(neutral_opener).trim() || null;
      updates.push(`franchise_neutral_opener = $${idx++}`);
      values.push(trimmed);
    }

    updates.push("updated_at = now()");
    values.push(id);

    const result = await db.query(
      `UPDATE tenants SET ${updates.join(", ")} WHERE id = $${idx}
       RETURNING id, franchise_shared_number_enabled, franchise_neutral_opener`,
      values
    );

    console.log(
      "[Admin] Franchise shared-number updated tenantId=%s enabled=%s hasOpener=%s by=%s",
      id,
      result.rows[0].franchise_shared_number_enabled,
      !!result.rows[0].franchise_neutral_opener,
      req.user.email
    );

    res.json({ success: true, tenant: result.rows[0] });
  } catch (e) {
    console.error("[Admin] Franchise shared-number update error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

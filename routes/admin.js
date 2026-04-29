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

const tenantResult = await db.query(
  `INSERT INTO tenants (
     name, company_name, slug,
     account_type, reseller_tier, reseller_code,
     reseller_customer_limit, reseller_wholesale_rate_cents,
     billing_owner, brand_mode, plan
   )
   VALUES ($1, $1, $2, 'reseller', $3, $4, $5, $6, 'direct', 'ai_branded', 'basic')
   RETURNING id, name, slug, reseller_code, reseller_tier, created_at`,
  [
    trimmedName,
    slug,
    tier,
    resellerCode,
    tierDef.customer_limit,
    tierDef.wholesale_rate_cents,
  ]
);
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
// Stripe subscription creation is intentionally NOT done here — it
// happens via the existing PATCH /pricing sync path once
// STRIPE_PRICE_FRANCHISE is wired. This keeps demo zee creation possible
// without a real Stripe price configured.
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

    // Verify HQ exists and is a valid parent
    const hqResult = await db.query(
      `SELECT id, name, parent_mode, brand_mode FROM tenants WHERE id = $1`,
      [hq_tenant_id]
    );
    if (hqResult.rows.length === 0) {
      return res.status(404).json({ error: "HQ tenant not found" });
    }
    const hq = hqResult.rows[0];
    if (!["operating_hq", "rollup_only"].includes(hq.parent_mode)) {
      return res.status(400).json({
        error: "hq_tenant_id is not a valid HQ parent (parent_mode must be operating_hq or rollup_only)",
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
    // - parent_tenant_id links to HQ
    // - brand_mode='white_label' — zees inherit HQ chrome by default
    // - subscription_status left NULL until Stripe sync runs
    const tenantResult = await db.query(
      `INSERT INTO tenants (
         name, company_name, slug,
         plan, parent_tenant_id, brand_mode,
         plan_overrides, billing_owner
       )
       VALUES ($1, $1, $2, 'franchise', $3, 'white_label', $4, 'direct')
       RETURNING id, name, slug, plan, parent_tenant_id, brand_mode, plan_overrides, created_at`,
      [trimmedName, slug, hq_tenant_id, planOverrides]
    );
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

// -------------------- List Franchise Zees Under HQ --------------------
//
// Apr 29, 2026 — Powers the HQ Locations tab in the dashboard.
// Returns child tenants with plan='franchise' under the given HQ, plus
// computed effective_monthly and per-zee outbound gate state for the
// HQ Locations table UI.
router.get("/tenants/:hqId/zees", async (req, res) => {
  try {
    const r = await db.query(
      `SELECT
         t.id, t.name, t.slug, t.company_name, t.plan,
         t.subscription_status, t.brand_mode,
         t.plan_overrides, t.parent_tenant_id,
         t.is_suspended, t.suspended_reason,
         t.stripe_customer_id, t.stripe_subscription_id,
         t.created_at,
         (SELECT COUNT(*) FROM calls WHERE tenant_id = t.id) as total_calls,
         (SELECT COUNT(*) FROM bookings WHERE tenant_id = t.id) as total_bookings
       FROM tenants t
       WHERE t.parent_tenant_id = $1 AND t.plan = 'franchise'
       ORDER BY t.created_at DESC`,
      [req.params.hqId]
    );

    const zees = r.rows.map((t) => {
      const plan = getPlan(t.plan);
      const overrides = t.plan_overrides || {};
      const planOverride = overrides[t.plan] || {};
      const addons = overrides.addons || {};

      return {
        ...t,
        total_calls: parseInt(t.total_calls, 10),
        total_bookings: parseInt(t.total_bookings, 10),
        default_monthly: plan.priceMonthly,
        effective_monthly:
          planOverride.monthly != null ? planOverride.monthly : plan.priceMonthly,
        override_active: planOverride.monthly != null,
        outbound_followup_enabled: !!addons.outbound_followup,
        outbound_lists_enabled: !!addons.outbound_lists,
        outbound_daily_max: addons.outbound_daily_max || 0,
      };
    });

    res.json({ zees });
  } catch (e) {
    console.error("[Admin] List franchise zees error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

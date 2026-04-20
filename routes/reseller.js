"use strict";

// ============================================================================
// routes/reseller.js
// Apr 20, 2026 — Phase 2 WL Reseller Account Type
// ============================================================================
// Authenticated reseller dashboard + subscription management endpoints.
// Uses pg Pool (lib/db.js) with raw SQL — matches existing routes pattern.
//
// Mount in server.js:
//   app.use('/reseller', require('./routes/reseller'));
//
// All routes require:
//   - Auth via authMiddleware from lib/auth.js
//   - req.user.tenant.account_type === 'reseller' (requireReseller below)
// ============================================================================

const express = require('express');
const router = express.Router();

const db = require('../lib/db');
const { authMiddleware } = require('../lib/auth');
const { auditLog } = require('../lib/auditLogger');

const {
  validateCanAddCustomer,
  getResellerTierInfo,
} = require('../lib/resellerBilling');
const {
  listResellerTiers,
} = require('../lib/resellerPlans');
const {
  createResellerCheckoutSession,
  createResellerBillingPortalSession,
} = require('../lib/resellerStripe');

// ---------------------------------------------------------------------------
// Middleware: requireReseller
// ---------------------------------------------------------------------------
function requireReseller(req, res, next) {
  if (!req.user || !req.user.tenant) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  if (req.user.tenant.account_type !== 'reseller') {
    return res.status(403).json({
      error: 'Reseller access required',
      account_type: req.user.tenant.account_type,
    });
  }
  next();
}

router.use(authMiddleware);
router.use(requireReseller);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function fetchCustomerForReseller(customerId, resellerId, columns = '*') {
  const { rows } = await db.query(
    `SELECT ${columns}
       FROM tenants
      WHERE id = $1 AND reseller_id = $2 AND deleted_at IS NULL
      LIMIT 1`,
    [customerId, resellerId]
  );
  return rows[0] || null;
}

async function safeAuditLog(payload) {
  try {
    if (typeof auditLog === 'function') {
      await auditLog(db, payload);
    }
  } catch (err) {
    console.error('[reseller] audit log failed:', err.message);
  }
}

function thirtyDaysAgoISO() {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
}

// ===========================================================================
// GET /reseller/overview
// Hero: tier info + aggregated 30-day metrics across all customers
// ===========================================================================
router.get('/overview', async (req, res) => {
  try {
    const tierInfo = await getResellerTierInfo(db, req.user.tenant);

    const { rows: customerRows } = await db.query(
      `SELECT id FROM tenants
        WHERE reseller_id = $1 AND deleted_at IS NULL`,
      [req.user.tenant.id]
    );
    const customerIds = customerRows.map((r) => r.id);

    const since = thirtyDaysAgoISO();
    let totalCalls = 0;
    let totalBookings = 0;
    let totalOpenLeads = 0;
    let totalRevenueCents = 0;

    if (customerIds.length > 0) {
      const [callsRes, bookingsRes, leadsRes, revenueRes] = await Promise.all([
        db.query(
          `SELECT COUNT(*)::int AS count FROM calls
             WHERE tenant_id = ANY($1::uuid[]) AND created_at >= $2`,
          [customerIds, since]
        ),
        db.query(
          `SELECT COUNT(*)::int AS count FROM bookings
             WHERE tenant_id = ANY($1::uuid[]) AND created_at >= $2`,
          [customerIds, since]
        ),
        db.query(
          `SELECT COUNT(*)::int AS count FROM leads
             WHERE tenant_id = ANY($1::uuid[]) AND status = 'open'`,
          [customerIds]
        ),
        db.query(
          `SELECT COALESCE(SUM(revenue_cents), 0)::bigint AS total
             FROM bookings
            WHERE tenant_id = ANY($1::uuid[])
              AND created_at >= $2
              AND revenue_cents IS NOT NULL`,
          [customerIds, since]
        ),
      ]);

      totalCalls = callsRes.rows[0]?.count || 0;
      totalBookings = bookingsRes.rows[0]?.count || 0;
      totalOpenLeads = leadsRes.rows[0]?.count || 0;
      totalRevenueCents = Number(revenueRes.rows[0]?.total || 0);
    }

    return res.json({
      reseller: {
        id: req.user.tenant.id,
        name: req.user.tenant.name,
        reseller_code: req.user.tenant.reseller_code,
        brand_mode: req.user.tenant.brand_mode,
        primary_email: req.user.tenant.primary_email,
      },
      tier: tierInfo,
      aggregated_30d: {
        calls: totalCalls,
        bookings: totalBookings,
        open_leads: totalOpenLeads,
        revenue_cents: totalRevenueCents,
      },
    });
  } catch (err) {
    console.error('[reseller/overview]', err);
    return res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// ===========================================================================
// GET /reseller/customers
// List customers with per-customer 30d metrics (single grouped SQL query)
// ===========================================================================
router.get('/customers', async (req, res) => {
  try {
    const { rows: customers } = await db.query(
      `SELECT id, name, plan, primary_email, phone, brand_mode,
              created_at, stripe_sync_status
         FROM tenants
        WHERE reseller_id = $1 AND deleted_at IS NULL
        ORDER BY created_at DESC`,
      [req.user.tenant.id]
    );

    if (customers.length === 0) {
      return res.json({ customers: [] });
    }

    const customerIds = customers.map((c) => c.id);
    const since = thirtyDaysAgoISO();

    // Single grouped query per metric instead of N parallel queries
    const [callRes, bookRes] = await Promise.all([
      db.query(
        `SELECT tenant_id, COUNT(*)::int AS count
           FROM calls
          WHERE tenant_id = ANY($1::uuid[]) AND created_at >= $2
          GROUP BY tenant_id`,
        [customerIds, since]
      ),
      db.query(
        `SELECT tenant_id, COUNT(*)::int AS count
           FROM bookings
          WHERE tenant_id = ANY($1::uuid[]) AND created_at >= $2
          GROUP BY tenant_id`,
        [customerIds, since]
      ),
    ]);

    const callsByTenant = Object.fromEntries(
      callRes.rows.map((r) => [r.tenant_id, r.count])
    );
    const bookingsByTenant = Object.fromEntries(
      bookRes.rows.map((r) => [r.tenant_id, r.count])
    );

    const enriched = customers.map((c) => ({
      ...c,
      metrics_30d: {
        calls: callsByTenant[c.id] || 0,
        bookings: bookingsByTenant[c.id] || 0,
      },
    }));

    return res.json({ customers: enriched });
  } catch (err) {
    console.error('[reseller/customers:list]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// POST /reseller/customers/preview
// Dry-run cap check for AddCustomerSheet step 1
// ===========================================================================
router.post('/customers/preview', async (req, res) => {
  try {
    await validateCanAddCustomer(db, req.user.tenant);
    const info = await getResellerTierInfo(db, req.user.tenant);
    return res.json({
      can_add: true,
      tier: info.tier,
      tier_name: info.tier_name,
      customer_count: info.customer_count,
      customer_limit: info.customer_limit,
      slots_remaining: info.slots_remaining,
    });
  } catch (err) {
    if (err.code === 'RESELLER_AT_CAP') {
      return res.status(402).json({
        can_add: false,
        code: 'RESELLER_AT_CAP',
        message: err.message,
        current: err.current,
        limit: err.limit,
        tier: err.tier,
        next_tier: err.next_tier,
      });
    }
    console.error('[reseller/customers:preview]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// POST /reseller/customers
// Add a new customer tenant under this reseller
// ===========================================================================
router.post('/customers', async (req, res) => {
  const {
    name,
    primary_email,
    phone,
    plan = 'growth',
    brand_mode_inherit = true,
  } = req.body || {};

  if (!name || !primary_email) {
    return res.status(400).json({ error: 'name and primary_email are required' });
  }

  try {
    await validateCanAddCustomer(db, req.user.tenant);

    const brandMode = brand_mode_inherit
      ? req.user.tenant.brand_mode || 'default'
      : 'default';

    const { rows } = await db.query(
      `INSERT INTO tenants (
         name, primary_email, phone, plan,
         account_type, reseller_id, billing_owner, brand_mode,
         stripe_customer_id, stripe_subscription_id
       )
       VALUES ($1, $2, $3, $4, 'customer', $5, 'reseller', $6, NULL, NULL)
       RETURNING *`,
      [
        name,
        primary_email,
        phone || null,
        plan,
        req.user.tenant.id,
        brandMode,
      ]
    );
    const created = rows[0];

    await safeAuditLog({
      action: 'reseller.customer.created',
      actor_id: req.user.id,
      tenant_id: req.user.tenant.id,
      target_type: 'tenant',
      target_id: created.id,
      details: { customer_name: name, plan, brand_mode_inherit },
    });

    // TODO Step 6: sendResellerCustomerWelcomeEmail (needs set-password URL)
    console.log(
      `[reseller/customers:create] TODO email: welcome ${primary_email} from ${req.user.tenant.name}`
    );

    return res.status(201).json({ customer: created });
  } catch (err) {
    if (err.code === 'RESELLER_AT_CAP') {
      return res.status(402).json({
        error: err.message,
        code: 'RESELLER_AT_CAP',
        current: err.current,
        limit: err.limit,
        tier: err.tier,
        next_tier: err.next_tier,
      });
    }
    console.error('[reseller/customers:create]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// GET /reseller/customers/:customerId
// ===========================================================================
router.get('/customers/:customerId', async (req, res) => {
  try {
    const customer = await fetchCustomerForReseller(
      req.params.customerId,
      req.user.tenant.id
    );
    if (!customer) return res.status(404).json({ error: 'Customer not found' });
    return res.json({ customer });
  } catch (err) {
    console.error('[reseller/customers:get]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// PATCH /reseller/customers/:customerId
// ===========================================================================
router.patch('/customers/:customerId', async (req, res) => {
  const ALLOWED = ['name', 'primary_email', 'phone', 'plan', 'brand_mode'];
  const setClauses = [];
  const values = [];

  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) {
      values.push(req.body[key]);
      setClauses.push(`${key} = $${values.length}`); // key from whitelist, safe
    }
  }

  if (setClauses.length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }

  try {
    const existing = await fetchCustomerForReseller(
      req.params.customerId,
      req.user.tenant.id,
      'id, reseller_id'
    );
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    values.push(req.params.customerId); // $N for WHERE
    const { rows } = await db.query(
      `UPDATE tenants
          SET ${setClauses.join(', ')}, updated_at = now()
        WHERE id = $${values.length}
        RETURNING *`,
      values
    );
    const updated = rows[0];

    await safeAuditLog({
      action: 'reseller.customer.updated',
      actor_id: req.user.id,
      tenant_id: req.user.tenant.id,
      target_type: 'tenant',
      target_id: req.params.customerId,
      details: { fields: ALLOWED.filter((k) => req.body[k] !== undefined) },
    });

    return res.json({ customer: updated });
  } catch (err) {
    console.error('[reseller/customers:patch]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// DELETE /reseller/customers/:customerId
// Soft-delete: customer loses service. (Reseller-level churn = Step 6.)
// ===========================================================================
router.delete('/customers/:customerId', async (req, res) => {
  try {
    const existing = await fetchCustomerForReseller(
      req.params.customerId,
      req.user.tenant.id,
      'id, reseller_id, name, primary_email'
    );
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    await db.query(
      `UPDATE tenants
          SET deleted_at = now(), updated_at = now()
        WHERE id = $1`,
      [req.params.customerId]
    );

    await safeAuditLog({
      action: 'reseller.customer.deleted',
      actor_id: req.user.id,
      tenant_id: req.user.tenant.id,
      target_type: 'tenant',
      target_id: req.params.customerId,
      details: { customer_name: existing.name },
    });

    // TODO Step 6: sendResellerCustomerRemovedEmail
    console.log(
      `[reseller/customers:delete] TODO email: removal ${existing.primary_email} from ${req.user.tenant.name}`
    );

    return res.json({ success: true });
  } catch (err) {
    console.error('[reseller/customers:delete]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// POST /reseller/customers/:customerId/resend-invite
// ===========================================================================
router.post('/customers/:customerId/resend-invite', async (req, res) => {
  try {
    const customer = await fetchCustomerForReseller(
      req.params.customerId,
      req.user.tenant.id,
      'id, name, primary_email'
    );
    if (!customer) return res.status(404).json({ error: 'Customer not found' });

    // TODO Step 6: sendResellerCustomerWelcomeEmail (needs set-password URL)
    console.log(
      `[reseller/customers:resend] TODO email: welcome resend ${customer.primary_email}`
    );

    await safeAuditLog({
      action: 'reseller.customer.invite_resent',
      actor_id: req.user.id,
      tenant_id: req.user.tenant.id,
      target_type: 'tenant',
      target_id: req.params.customerId,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error('[reseller/customers:resend-invite]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// GET /reseller/tier
// ===========================================================================
router.get('/tier', async (req, res) => {
  try {
    const current = await getResellerTierInfo(db, req.user.tenant);
    const available = listResellerTiers().map((t) => ({
      id: t.id,
      name: t.name,
      monthly_price_cents: t.monthly_price_cents,
      annual_price_cents: t.annual_price_cents,
      customer_limit: t.customer_limit,
      description: t.description,
      tagline: t.tagline,
    }));
    return res.json({ current, available });
  } catch (err) {
    console.error('[reseller/tier]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// POST /reseller/checkout
// Stripe Checkout for initial subscription OR tier change
// ===========================================================================
router.post('/checkout', async (req, res) => {
  const { tier, interval = 'monthly' } = req.body || {};

  if (!tier || !['starter', 'growth', 'scale'].includes(tier)) {
    return res.status(400).json({ error: 'tier must be starter, growth, or scale' });
  }
  if (!['monthly', 'annual'].includes(interval)) {
    return res.status(400).json({ error: 'interval must be monthly or annual' });
  }

  try {
    const appUrl = process.env.APP_URL || 'https://aifrontdeskhelper.com';
    const session = await createResellerCheckoutSession({
      reseller: req.user.tenant,
      tier,
      interval,
      successUrl: `${appUrl}/reseller/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${appUrl}/reseller/plans`,
    });

    await safeAuditLog({
      action: 'reseller.checkout.initiated',
      actor_id: req.user.id,
      tenant_id: req.user.tenant.id,
      target_type: 'tenant',
      target_id: req.user.tenant.id,
      details: { tier, interval, session_id: session.id },
    });

    return res.json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[reseller/checkout]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// POST /reseller/billing-portal
// Stripe Billing Portal (cancel, update payment, change tier)
// ===========================================================================
router.post('/billing-portal', async (req, res) => {
  try {
    if (!req.user.tenant.stripe_customer_id) {
      return res.status(400).json({
        error: 'No subscription yet — complete checkout first',
        code: 'NO_SUBSCRIPTION',
      });
    }

    const appUrl = process.env.APP_URL || 'https://aifrontdeskhelper.com';
    const session = await createResellerBillingPortalSession({
      reseller: req.user.tenant,
      returnUrl: `${appUrl}/reseller/tier`,
    });

    return res.json({ portal_url: session.url });
  } catch (err) {
    console.error('[reseller/billing-portal]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

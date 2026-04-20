"use strict";

// ============================================================================
// routes/reseller.js
// Apr 20, 2026 — Phase 2 WL Reseller Account Type (authenticated dashboard)
// ============================================================================
// Mount in server.js:
//   app.use('/reseller', require('./routes/reseller'));
//
// All routes require:
//   - Auth via authMiddleware from lib/auth.js
//   - req.user.tenant.account_type === 'reseller' (requireReseller below)
//
// Depends on: migration 037, lib/resellerPlans.js, lib/resellerBilling.js
//
// TODO Step 5: wire sendResellerCustomerWelcomeEmail + sendResellerCustomerRemovedEmail
//              into services/email.js, replace the console.log placeholders below.
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
// Helper: fetch customer row scoped to this reseller
// ---------------------------------------------------------------------------
async function fetchCustomerForReseller(customerId, resellerId, columns = '*') {
  const { data, error } = await db
    .from('tenants')
    .select(columns)
    .eq('id', customerId)
    .eq('reseller_id', resellerId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ---------------------------------------------------------------------------
// Helper: safe audit log (never blocks the main request)
// ---------------------------------------------------------------------------
async function safeAuditLog(payload) {
  try {
    if (typeof auditLog === 'function') {
      await auditLog(db, payload);
    }
  } catch (err) {
    console.error('[reseller] audit log failed:', err.message);
  }
}

// ===========================================================================
// GET /reseller/overview
// Hero card: tier info + aggregated 30-day metrics across all customers
// ===========================================================================
router.get('/overview', async (req, res) => {
  try {
    const tierInfo = await getResellerTierInfo(db, req.user.tenant);

    const { data: customers, error: fetchErr } = await db
      .from('tenants')
      .select('id')
      .eq('reseller_id', req.user.tenant.id)
      .is('deleted_at', null);
    if (fetchErr) throw fetchErr;

    const customerIds = (customers || []).map((c) => c.id);

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const since = thirtyDaysAgo.toISOString();

    let totalCalls = 0;
    let totalBookings = 0;
    let totalOpenLeads = 0;
    let totalRevenueCents = 0;

    if (customerIds.length > 0) {
      const [callsRes, bookingsRes, leadsRes, revenueRes] = await Promise.all([
        db
          .from('calls')
          .select('*', { count: 'exact', head: true })
          .in('tenant_id', customerIds)
          .gte('created_at', since),
        db
          .from('bookings')
          .select('*', { count: 'exact', head: true })
          .in('tenant_id', customerIds)
          .gte('created_at', since),
        db
          .from('leads')
          .select('*', { count: 'exact', head: true })
          .in('tenant_id', customerIds)
          .eq('status', 'open'),
        db
          .from('bookings')
          .select('revenue_cents')
          .in('tenant_id', customerIds)
          .gte('created_at', since)
          .not('revenue_cents', 'is', null),
      ]);

      totalCalls = callsRes.count || 0;
      totalBookings = bookingsRes.count || 0;
      totalOpenLeads = leadsRes.count || 0;
      totalRevenueCents = (revenueRes.data || []).reduce(
        (sum, b) => sum + (b.revenue_cents || 0),
        0
      );
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
// List all customers under this reseller with per-customer 30d metrics
// ===========================================================================
router.get('/customers', async (req, res) => {
  try {
    const { data: customers, error } = await db
      .from('tenants')
      .select(
        'id, name, plan, primary_email, phone, brand_mode, created_at, stripe_sync_status'
      )
      .eq('reseller_id', req.user.tenant.id)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const since = thirtyDaysAgo.toISOString();

    // Parallel per-customer metric fetch. At 50+ customers this is ~100 parallel
    // queries — acceptable for v1, swap to RPC aggregation if P99 > 800ms.
    const enriched = await Promise.all(
      (customers || []).map(async (c) => {
        const [callsRes, bookingsRes] = await Promise.all([
          db
            .from('calls')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', c.id)
            .gte('created_at', since),
          db
            .from('bookings')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_id', c.id)
            .gte('created_at', since),
        ]);
        return {
          ...c,
          metrics_30d: {
            calls: callsRes.count || 0,
            bookings: bookingsRes.count || 0,
          },
        };
      })
    );

    return res.json({ customers: enriched });
  } catch (err) {
    console.error('[reseller/customers:list]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// POST /reseller/customers/preview
// Dry-run preflight for AddCustomerSheet step 1 — checks cap without creating
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

    const newTenant = {
      name,
      primary_email,
      phone: phone || null,
      plan,
      account_type: 'customer',
      reseller_id: req.user.tenant.id,
      billing_owner: 'reseller',
      brand_mode: brand_mode_inherit
        ? req.user.tenant.brand_mode || 'default'
        : 'default',
      stripe_customer_id: null,
      stripe_subscription_id: null,
    };

    const { data: created, error: insertErr } = await db
      .from('tenants')
      .insert(newTenant)
      .select()
      .single();
    if (insertErr) throw insertErr;

    await safeAuditLog({
      action: 'reseller.customer.created',
      actor_id: req.user.id,
      tenant_id: req.user.tenant.id,
      target_type: 'tenant',
      target_id: created.id,
      details: { customer_name: name, plan, brand_mode_inherit },
    });

    // TODO Step 5: sendResellerCustomerWelcomeEmail (add to services/email.js)
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
  const updates = {};
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update' });
  }
  updates.updated_at = new Date().toISOString();

  try {
    const existing = await fetchCustomerForReseller(
      req.params.customerId,
      req.user.tenant.id,
      'id, reseller_id'
    );
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    const { data: updated, error: updateErr } = await db
      .from('tenants')
      .update(updates)
      .eq('id', req.params.customerId)
      .select()
      .single();
    if (updateErr) throw updateErr;

    await safeAuditLog({
      action: 'reseller.customer.updated',
      actor_id: req.user.id,
      tenant_id: req.user.tenant.id,
      target_type: 'tenant',
      target_id: req.params.customerId,
      details: { fields: Object.keys(updates).filter((k) => k !== 'updated_at') },
    });

    return res.json({ customer: updated });
  } catch (err) {
    console.error('[reseller/customers:patch]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// DELETE /reseller/customers/:customerId
// Soft-delete: sets deleted_at, customer loses service.
// (Reseller-level churn with auto-transfer to direct billing = Step 6.)
// ===========================================================================
router.delete('/customers/:customerId', async (req, res) => {
  try {
    const existing = await fetchCustomerForReseller(
      req.params.customerId,
      req.user.tenant.id,
      'id, reseller_id, name, primary_email'
    );
    if (!existing) return res.status(404).json({ error: 'Customer not found' });

    const { error: updateErr } = await db
      .from('tenants')
      .update({
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.customerId);
    if (updateErr) throw updateErr;

    await safeAuditLog({
      action: 'reseller.customer.deleted',
      actor_id: req.user.id,
      tenant_id: req.user.tenant.id,
      target_type: 'tenant',
      target_id: req.params.customerId,
      details: { customer_name: existing.name },
    });

    // TODO Step 5: sendResellerCustomerRemovedEmail (add to services/email.js)
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

    // TODO Step 5: sendResellerCustomerWelcomeEmail (add to services/email.js)
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
// Current tier + all tier options (for upgrade UI)
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

module.exports = router;

"use strict";

// ============================================================================
// lib/resellerBilling.js
// Apr 20, 2026 — Phase 2 WL Reseller Account Type
// ============================================================================
// Reseller billing helpers using pg Pool (lib/db.js → { query, getClient, pool }).
// All DB calls use db.query(sql, params) with parameterized raw SQL.
//
// Depends on: migration 037, lib/resellerPlans.js
// ============================================================================

const { getResellerTier, getNextResellerTier } = require('./resellerPlans');

/**
 * Count active (non-deleted) customer tenants under a reseller.
 */
async function getResellerCustomerCount(db, resellerId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM tenants
      WHERE reseller_id = $1 AND deleted_at IS NULL`,
    [resellerId]
  );
  return rows[0]?.count || 0;
}

/**
 * Throws RESELLER_AT_CAP if reseller cannot add another customer.
 */
async function validateCanAddCustomer(db, resellerRow) {
  if (!resellerRow || resellerRow.account_type !== 'reseller') {
    const err = new Error('Tenant is not a reseller');
    err.code = 'NOT_A_RESELLER';
    throw err;
  }

  const tier = getResellerTier(resellerRow.reseller_tier);

  if (tier.customer_limit === null) return; // scale = unlimited

  const currentCount = await getResellerCustomerCount(db, resellerRow.id);

  if (currentCount >= tier.customer_limit) {
    const nextTier = getNextResellerTier(tier.id);
    const err = new Error(
      `Reseller at customer cap (${currentCount}/${tier.customer_limit} on ${tier.name}). ` +
      (nextTier
        ? `Upgrade to ${nextTier.name} to add more customers.`
        : 'Contact support — you are on the highest tier.')
    );
    err.code = 'RESELLER_AT_CAP';
    err.statusCode = 402;
    err.current = currentCount;
    err.limit = tier.customer_limit;
    err.tier = tier.id;
    err.next_tier = nextTier ? nextTier.id : null;
    throw err;
  }
}

/**
 * Full tier/usage summary for a reseller's dashboard header.
 */
async function getResellerTierInfo(db, resellerRow) {
  if (!resellerRow || resellerRow.account_type !== 'reseller') {
    throw new Error('Tenant is not a reseller');
  }

  const tier = getResellerTier(resellerRow.reseller_tier);
  const customerCount = await getResellerCustomerCount(db, resellerRow.id);
  const limit = tier.customer_limit;
  const slotsRemaining = limit === null ? null : Math.max(0, limit - customerCount);
  const atCap = limit !== null && customerCount >= limit;
  const utilization = limit === null ? 0 : customerCount / limit;

  return {
    tier: tier.id,
    tier_name: tier.name,
    tier_tagline: tier.tagline,
    monthly_price_cents: tier.monthly_price_cents,
    annual_price_cents: tier.annual_price_cents,
    customer_count: customerCount,
    customer_limit: limit,
    slots_remaining: slotsRemaining,
    at_cap: atCap,
    utilization_pct: Math.round(utilization * 100),
    wholesale_rate_cents: tier.wholesale_rate_cents,
    next_tier: getNextResellerTier(tier.id),
  };
}

/**
 * Transfer all customers of a reseller to direct billing.
 * Returns list of transferred customer rows.
 *
 * Caller is responsible for:
 *   1. Creating direct Stripe subscriptions for each transferred customer
 *   2. Sending transfer-notification emails
 *   3. Logging audit entries
 */
async function transferCustomersToDirect(db, resellerId) {
  // Snapshot customers BEFORE update (so caller can iterate)
  const { rows: customers } = await db.query(
    `SELECT id, name, primary_email, brand_mode, plan
       FROM tenants
      WHERE reseller_id = $1 AND deleted_at IS NULL`,
    [resellerId]
  );

  if (customers.length === 0) return [];

  // Atomic flip: reseller_id=NULL + billing_owner='direct'
  // DB constraint tenants_reseller_billing_consistency enforces pairing.
  await db.query(
    `UPDATE tenants
        SET reseller_id = NULL,
            billing_owner = 'direct',
            updated_at = now()
      WHERE reseller_id = $1 AND deleted_at IS NULL`,
    [resellerId]
  );

  return customers;
}

/**
 * Generate a URL-safe, human-readable reseller code (8 chars, unambiguous).
 */
function generateResellerCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Generate a unique reseller code, checking DB for collisions. Retries 5x.
 */
async function generateUniqueResellerCode(db) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateResellerCode();
    const { rows } = await db.query(
      `SELECT id FROM tenants WHERE reseller_code = $1 LIMIT 1`,
      [code]
    );
    if (rows.length === 0) return code;
  }
  throw new Error('Failed to generate unique reseller code after 5 attempts');
}

module.exports = {
  getResellerCustomerCount,
  validateCanAddCustomer,
  getResellerTierInfo,
  transferCustomersToDirect,
  generateResellerCode,
  generateUniqueResellerCode,
};

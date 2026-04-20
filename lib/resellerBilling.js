// ============================================================================
// lib/resellerBilling.js
// ============================================================================
// Reseller billing helpers — Phase 2 WL Reseller Account Type.
//
// Depends on:
//   - migration 037 (account_type, reseller_id, billing_owner, reseller_tier,
//     reseller_customer_limit, reseller_wholesale_rate_cents, reseller_code)
//   - lib/resellerPlans.js
//
// Functions:
//   - getResellerCustomerCount(db, resellerId) → number
//   - validateCanAddCustomer(db, resellerRow) → throws RESELLER_AT_CAP if over
//   - getResellerTierInfo(db, resellerRow) → dashboard summary
//   - transferCustomersToDirect(db, resellerId) → churn handler (DB flip only)
//   - generateResellerCode() → URL-safe 8-char code for public signup URL
// ============================================================================

const { getResellerTier, getNextResellerTier } = require('./resellerPlans');

/**
 * Count active (non-deleted) customer tenants under a reseller.
 * @param {Object} db - Supabase client
 * @param {string} resellerId - tenant UUID
 * @returns {Promise<number>}
 */
async function getResellerCustomerCount(db, resellerId) {
  const { count, error } = await db
    .from('tenants')
    .select('*', { count: 'exact', head: true })
    .eq('reseller_id', resellerId)
    .is('deleted_at', null);

  if (error) {
    throw new Error(`Failed to count reseller customers: ${error.message}`);
  }
  return count || 0;
}

/**
 * Throws RESELLER_AT_CAP if the reseller cannot add another customer.
 * MUST be called before creating a customer tenant under this reseller
 * (in routes/reseller.js POST /reseller/customers and public signup).
 *
 * @param {Object} db - Supabase client
 * @param {Object} resellerRow - full tenants row for the reseller
 */
async function validateCanAddCustomer(db, resellerRow) {
  if (!resellerRow || resellerRow.account_type !== 'reseller') {
    const err = new Error('Tenant is not a reseller');
    err.code = 'NOT_A_RESELLER';
    throw err;
  }

  const tier = getResellerTier(resellerRow.reseller_tier);

  // Scale tier: unlimited, always allowed
  if (tier.customer_limit === null) return;

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
    err.statusCode = 402; // Payment Required
    err.current = currentCount;
    err.limit = tier.customer_limit;
    err.tier = tier.id;
    err.next_tier = nextTier ? nextTier.id : null;
    throw err;
  }
}

/**
 * Full tier/usage summary for a reseller's dashboard header.
 * Used by GET /reseller/overview.
 *
 * @param {Object} db - Supabase client
 * @param {Object} resellerRow - full tenants row
 * @returns {Promise<Object>}
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
  const utilization = limit === null ? 0 : (customerCount / limit);

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
    wholesale_rate_cents: tier.wholesale_rate_cents, // internal, not shown to reseller UI
    next_tier: getNextResellerTier(tier.id),
  };
}

/**
 * Transfer all customers of a reseller to direct billing.
 *
 * Triggers:
 *   - Reseller voluntarily closes account
 *   - Delinquency grace period expires (Stripe sub canceled)
 *   - Superadmin force-removes reseller
 *
 * This function ONLY flips the DB fields. Caller (routes/reseller.js churn
 * handler) is responsible for:
 *   1. Creating a direct Stripe subscription for each transferred customer
 *   2. Sending transfer-notification email to each customer
 *   3. Logging audit_logs entries
 *   4. Invalidating any reseller-branded assets if customer brand_mode was inherited
 *
 * DB constraint tenants_reseller_billing_consistency guarantees reseller_id
 * and billing_owner flip atomically — no intermediate inconsistent state.
 *
 * @param {Object} db - Supabase client
 * @param {string} resellerId - tenant UUID of the reseller being dissolved
 * @returns {Promise<Array>} list of transferred customer rows (id, name, primary_email, brand_mode)
 */
async function transferCustomersToDirect(db, resellerId) {
  // 1. Snapshot customers BEFORE update so caller can iterate
  const { data: customers, error: fetchErr } = await db
    .from('tenants')
    .select('id, name, primary_email, brand_mode, plan')
    .eq('reseller_id', resellerId)
    .is('deleted_at', null);

  if (fetchErr) {
    throw new Error(`Failed to fetch reseller customers for transfer: ${fetchErr.message}`);
  }

  if (!customers || customers.length === 0) {
    return [];
  }

  // 2. Flip reseller_id=NULL and billing_owner='direct' atomically
  //    DB constraint enforces pairing — either both flip or neither does.
  const { error: updateErr } = await db
    .from('tenants')
    .update({
      reseller_id: null,
      billing_owner: 'direct',
      updated_at: new Date().toISOString(),
    })
    .eq('reseller_id', resellerId)
    .is('deleted_at', null);

  if (updateErr) {
    throw new Error(`Failed to transfer customers to direct billing: ${updateErr.message}`);
  }

  return customers;
}

/**
 * Generate a URL-safe, human-readable reseller code.
 * Used for public signup path: /reseller/:code/signup
 *
 * 8 chars from an unambiguous alphabet (no 0/O/1/l/I) — easy to read aloud
 * and type. Collision probability is ~1 in 8.5 billion per pair, but caller
 * should still check uniqueness and regenerate on conflict.
 *
 * @returns {string}
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
 * Generate a unique reseller code, checking DB for collisions.
 * Retries up to 5 times. Throws if all attempts collide (shouldn't happen
 * in practice — 8.5B namespace).
 *
 * @param {Object} db - Supabase client
 * @returns {Promise<string>}
 */
async function generateUniqueResellerCode(db) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateResellerCode();
    const { data, error } = await db
      .from('tenants')
      .select('id')
      .eq('reseller_code', code)
      .maybeSingle();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Reseller code uniqueness check failed: ${error.message}`);
    }
    if (!data) return code;
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

// ============================================================================
// lib/resellerPlans.js
// ============================================================================
// Reseller tier definitions — Phase 2 WL Reseller Account Type.
//
// Billing model: Model A (flat tier fee, hard customer cap).
//   - Reseller pays flat monthly/annual fee per tier.
//   - Hard cap on customer tenants (upgrade tier to add more).
//   - wholesale_rate_cents is Drew's internal cost basis (NOT billed to reseller).
//     Used for profit reporting and optional future overage billing.
//
// Required Render env vars (add 6 new Stripe price IDs before Step 5):
//   STRIPE_RESELLER_STARTER_MONTHLY  STRIPE_RESELLER_STARTER_ANNUAL
//   STRIPE_RESELLER_GROWTH_MONTHLY   STRIPE_RESELLER_GROWTH_ANNUAL
//   STRIPE_RESELLER_SCALE_MONTHLY    STRIPE_RESELLER_SCALE_ANNUAL
// ============================================================================

const RESELLER_TIERS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    monthly_price_cents: 49700,        // $497/mo
    annual_price_cents: 477120,        // $4,771.20/yr (~20% savings)
    customer_limit: 10,
    wholesale_rate_cents: 9900,        // $99 — internal cost basis only
    stripe_price_id_monthly: process.env.STRIPE_RESELLER_STARTER_MONTHLY,
    stripe_price_id_annual: process.env.STRIPE_RESELLER_STARTER_ANNUAL,
    description: 'For agencies starting their white-label book.',
    tagline: '$497/mo · up to 10 customer tenants',
    next_tier: 'growth',
  },
  growth: {
    id: 'growth',
    name: 'Growth',
    monthly_price_cents: 149700,       // $1,497/mo
    annual_price_cents: 1437120,       // $14,371.20/yr
    customer_limit: 50,
    wholesale_rate_cents: 7900,        // $79
    stripe_price_id_monthly: process.env.STRIPE_RESELLER_GROWTH_MONTHLY,
    stripe_price_id_annual: process.env.STRIPE_RESELLER_GROWTH_ANNUAL,
    description: 'For scaling agencies with a growing customer base.',
    tagline: '$1,497/mo · up to 50 customer tenants',
    next_tier: 'scale',
  },
  scale: {
    id: 'scale',
    name: 'Scale',
    monthly_price_cents: 399700,       // $3,997/mo
    annual_price_cents: 3837120,       // $38,371.20/yr
    customer_limit: null,              // unlimited
    wholesale_rate_cents: 5900,        // $59
    stripe_price_id_monthly: process.env.STRIPE_RESELLER_SCALE_MONTHLY,
    stripe_price_id_annual: process.env.STRIPE_RESELLER_SCALE_ANNUAL,
    description: 'For established agencies with unlimited growth.',
    tagline: '$3,997/mo · unlimited customer tenants',
    next_tier: null,
  },
};

/**
 * Look up a tier by id. Throws on unknown.
 */
function getResellerTier(tierId) {
  const tier = RESELLER_TIERS[tierId];
  if (!tier) throw new Error(`Unknown reseller tier: ${tierId}`);
  return tier;
}

/**
 * All tiers as an array (for Plans page rendering).
 */
function listResellerTiers() {
  return Object.values(RESELLER_TIERS);
}

/**
 * Resolve Stripe price ID for a given tier + interval.
 * @param {string} tierId - 'starter' | 'growth' | 'scale'
 * @param {string} interval - 'monthly' | 'annual' | 'month' | 'year'
 */
function getResellerStripePriceId(tierId, interval) {
  const tier = getResellerTier(tierId);
  const isAnnual = interval === 'annual' || interval === 'year' || interval === 'yearly';
  const priceId = isAnnual ? tier.stripe_price_id_annual : tier.stripe_price_id_monthly;
  if (!priceId) {
    throw new Error(
      `Missing Stripe price ID for reseller tier=${tierId} interval=${interval}. ` +
      `Check Render env vars: STRIPE_RESELLER_${tierId.toUpperCase()}_${isAnnual ? 'ANNUAL' : 'MONTHLY'}`
    );
  }
  return priceId;
}

/**
 * Given a tier id, return the next-higher tier (for upgrade CTAs).
 * Returns null if already at top tier.
 */
function getNextResellerTier(tierId) {
  const tier = getResellerTier(tierId);
  return tier.next_tier ? getResellerTier(tier.next_tier) : null;
}

module.exports = {
  RESELLER_TIERS,
  getResellerTier,
  listResellerTiers,
  getResellerStripePriceId,
  getNextResellerTier,
};

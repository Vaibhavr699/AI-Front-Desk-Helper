// ============================================================================
// lib/resellerPlans.js
// ============================================================================
// Reseller tier definitions — Phase 2 WL Reseller Account Type.
//
// Apr 27, 2026 — MERGED PRICING REBUILD
//   • Pricing increased: $497/$1,497/$3,997 → $997/$2,997/$7,997
//   • Annual prices: monthly × 12 × 0.80 (20% off, "2 months free")
//   • Added per-tier voice + SMS caps, overage rates, metered Stripe price IDs
//   • Absorbed duplicate file lib/resellerTiers.js (deleted post-merge)
//   • All cap/overage values verified Apr 24 at 70% margins on full utilization
//
// Billing model: Hybrid — flat tier fee + metered overages.
//   - Reseller pays flat monthly/annual fee per tier (the "base" subscription)
//   - Each tier includes a monthly cap on voice minutes + SMS messages
//   - Usage above cap is billed via Stripe metered prices (per-unit overage)
//   - Hard customer cap remains (upgrade tier to add more child tenants)
//   - wholesale_rate_cents is Drew's internal cost basis (NOT billed to anyone).
//     Used for profit reporting only.
//
// Annual subscribers receive the SAME monthly cap as monthly subscribers.
// Caps reset every billing month — they do NOT accumulate across the year.
// ----------------------------------------------------------------------------
//
// Required Render env vars (12 total — set on backend service):
//   STRIPE_RESELLER_STARTER_MONTHLY   STRIPE_RESELLER_STARTER_ANNUAL
//   STRIPE_RESELLER_STARTER_VOICE     STRIPE_RESELLER_STARTER_SMS
//   STRIPE_RESELLER_GROWTH_MONTHLY    STRIPE_RESELLER_GROWTH_ANNUAL
//   STRIPE_RESELLER_GROWTH_VOICE      STRIPE_RESELLER_GROWTH_SMS
//   STRIPE_RESELLER_SCALE_MONTHLY     STRIPE_RESELLER_SCALE_ANNUAL
//   STRIPE_RESELLER_SCALE_VOICE       STRIPE_RESELLER_SCALE_SMS
//
// IMPORTANT — METER EVENT NAMES (case-sensitive, do not modify):
//   Voice meter event_name: "reseller_voice_minutes"   (underscores)
//   SMS   meter event_name: "reseller.sms.messages"    (dots)
// The two formats are intentional — both meters were created in Stripe with
// these exact names and reusing them avoids meter recreation. Cron uses
// METER_EVENT_NAMES below.
// ============================================================================

// ── Meter event names ────────────────────────────────────────────────────
// These map 1:1 to the meters configured in Stripe dashboard. When
// cron/reportResellerUsage.js POSTs to /v1/billing/meter_events, these
// strings are sent as the event_name parameter. Stripe routes the event
// to the matching meter, which aggregates usage for the customer's price.
const METER_EVENT_NAMES = {
  voice: 'reseller_voice_minutes',
  sms:   'reseller.sms.messages',
};

const RESELLER_TIERS = {
  starter: {
    id: 'starter',
    name: 'Starter',

    // Flat tier pricing
    monthly_price_cents: 99700,        // $997.00
    annual_price_cents:  957120,       // $9,571.20 (= 997 × 12 × 0.80)

    // Usage caps (per billing month)
    cap_voice_minutes: 3000,
    cap_sms:           2000,

    // Overage rates (cents per unit, billed via metered Stripe prices)
    overage_voice_cents: 15,           // $0.15/min
    overage_sms_cents:   5,            // $0.05/sms

    // Customer tenant limits
    customer_limit:        10,
    wholesale_rate_cents:  9900,       // $99 — internal cost basis only

    // Stripe price IDs — flat subscription
    stripe_price_id_monthly: process.env.STRIPE_RESELLER_STARTER_MONTHLY,
    stripe_price_id_annual:  process.env.STRIPE_RESELLER_STARTER_ANNUAL,

    // Stripe price IDs — metered overages
    stripe_voice_metered_id: process.env.STRIPE_RESELLER_STARTER_VOICE,
    stripe_sms_metered_id:   process.env.STRIPE_RESELLER_STARTER_SMS,

    // UI strings
    description: 'For agencies starting their white-label book.',
    tagline: '$997/mo · 3,000 min + 2,000 SMS · up to 10 customer tenants',
    next_tier: 'growth',
  },
  growth: {
    id: 'growth',
    name: 'Growth',

    monthly_price_cents: 299700,       // $2,997.00
    annual_price_cents:  2877120,      // $28,771.20 (= 2997 × 12 × 0.80)

    cap_voice_minutes: 15000,
    cap_sms:           10000,

    overage_voice_cents: 12,           // $0.12/min
    overage_sms_cents:   4,            // $0.04/sms

    customer_limit:        50,
    wholesale_rate_cents:  7900,       // $79

    stripe_price_id_monthly: process.env.STRIPE_RESELLER_GROWTH_MONTHLY,
    stripe_price_id_annual:  process.env.STRIPE_RESELLER_GROWTH_ANNUAL,
    stripe_voice_metered_id: process.env.STRIPE_RESELLER_GROWTH_VOICE,
    stripe_sms_metered_id:   process.env.STRIPE_RESELLER_GROWTH_SMS,

    description: 'For scaling agencies with a growing customer base.',
    tagline: '$2,997/mo · 15,000 min + 10,000 SMS · up to 50 customer tenants',
    next_tier: 'scale',
  },
  scale: {
    id: 'scale',
    name: 'Scale',

    monthly_price_cents: 799700,       // $7,997.00
    annual_price_cents:  7677120,      // $76,771.20 (= 7997 × 12 × 0.80)

    cap_voice_minutes: 40000,
    cap_sms:           30000,

    overage_voice_cents: 10,           // $0.10/min
    overage_sms_cents:   3,            // $0.03/sms

    customer_limit:        null,       // unlimited
    wholesale_rate_cents:  5900,       // $59

    stripe_price_id_monthly: process.env.STRIPE_RESELLER_SCALE_MONTHLY,
    stripe_price_id_annual:  process.env.STRIPE_RESELLER_SCALE_ANNUAL,
    stripe_voice_metered_id: process.env.STRIPE_RESELLER_SCALE_VOICE,
    stripe_sms_metered_id:   process.env.STRIPE_RESELLER_SCALE_SMS,

    description: 'For established agencies with unlimited growth.',
    tagline: '$7,997/mo · 40,000 min + 30,000 SMS · unlimited customer tenants',
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
 * Resolve Stripe FLAT price ID for a given tier + interval.
 * Used by checkout flow.
 *
 * @param {string} tierId   - 'starter' | 'growth' | 'scale'
 * @param {string} interval - 'monthly' | 'annual' | 'month' | 'year' | 'yearly'
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
 * Resolve the Stripe METERED price ID for a tier + metric.
 * Used by cron/reportResellerUsage.js when subscribing new resellers
 * to overage prices (the metered prices are added to the same subscription
 * alongside the flat price).
 *
 * @param {string} tierId - 'starter' | 'growth' | 'scale'
 * @param {string} metric - 'voice' | 'sms'
 */
function getResellerMeteredPriceId(tierId, metric) {
  const tier = getResellerTier(tierId);
  let priceId;
  if (metric === 'voice') priceId = tier.stripe_voice_metered_id;
  else if (metric === 'sms') priceId = tier.stripe_sms_metered_id;
  else throw new Error(`Unknown metered metric: ${metric} (expected 'voice' or 'sms')`);

  if (!priceId) {
    throw new Error(
      `Missing Stripe metered price ID for tier=${tierId} metric=${metric}. ` +
      `Check Render env var: STRIPE_RESELLER_${tierId.toUpperCase()}_${metric.toUpperCase()}`
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

// ── Backward-compat shim for routes/resellerUsage.js ─────────────────────
// resellerUsage.js was written against the deleted lib/resellerTiers.js
// and imports `getTier`. Re-export getResellerTier under that name so the
// route file works without modification.
const getTier = getResellerTier;

module.exports = {
  RESELLER_TIERS,
  METER_EVENT_NAMES,
  getResellerTier,
  getTier,                          // alias for resellerUsage.js
  listResellerTiers,
  getResellerStripePriceId,
  getResellerMeteredPriceId,        // NEW — used by cron
  getNextResellerTier,
};

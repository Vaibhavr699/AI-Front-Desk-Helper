"use strict";

/**
 * Reseller tier configuration.
 *
 * Pricing VERIFIED Apr 24 late: 70% margins confirmed at full cap utilization
 * across all 3 tiers. Cost-of-goods baseline locked, no further adjustment
 * needed unless OpenAI/Twilio change rate cards.
 *
 * Each tier has 4 Stripe price IDs:
 *   • Flat monthly subscription (the cap-included base, billed monthly)
 *   • Flat annual subscription  (12 months upfront at 20% discount)
 *   • Voice metered (per-minute overage)
 *   • SMS metered   (per-message overage)
 *
 * Annual pricing formula: monthly × 12 × 0.80 (20% off all 12 months,
 * marketed as "2 months free"). Annual subscribers receive the same
 * monthly cap (it does NOT accumulate to a yearly bucket — caps reset
 * each billing month, just like the monthly subscribers).
 *
 * Stripe price IDs populate via env vars set on Render. Created Apr 27 2026
 * in LIVE mode (12 total prices across 3 reseller products):
 *   AI Front Desk Reseller Starter   (prod_UN5Q0x2dnXPcu3)
 *   AI Front Desk Reseller - Growth  (prod_UN6EBCJAB89H18)
 *   AI Front Desk Reseller - Scale   (prod_UN6FTqe...)
 *
 * See cron/reportResellerUsage.js for daily usage-reporting logic.
 *
 * IMPORTANT — METER EVENT NAMES:
 * The two Stripe meters were created with DIFFERENT naming conventions
 * (intentional, kept as-is to avoid recreating meters):
 *   Voice meter event_name: "reseller_voice_minutes"   (underscores)
 *   SMS   meter event_name: "reseller.sms.messages"    (dots)
 * Cron MUST use these exact strings — see METER_EVENT_NAMES below.
 */

// ── Meter event names (case-sensitive, do not modify) ────────────────────
// These map 1:1 to the meters configured in Stripe dashboard.
// When cron/reportResellerUsage.js POSTs to /v1/billing/meter_events, these
// strings are sent as the `event_name` parameter. Stripe routes the event
// to the matching meter, which aggregates usage for the customer's price.
const METER_EVENT_NAMES = {
  voice: "reseller_voice_minutes",
  sms:   "reseller.sms.messages",
};

const RESELLER_TIERS = {
  starter: {
    name: "Starter",
    monthly_flat_cents:           99700,    // $997.00
    annual_flat_cents:            957120,   // $9,571.20 (= 997 * 12 * 0.80)
    cap_voice_minutes:            3000,
    cap_sms:                      2000,
    overage_voice_cents:          15,       // $0.15/min
    overage_sms_cents:            5,        // $0.05/sms
    customer_limit:               10,
    stripe_flat_monthly_price_id: process.env.STRIPE_RESELLER_STARTER_FLAT_MONTHLY,
    stripe_flat_annual_price_id:  process.env.STRIPE_RESELLER_STARTER_FLAT_ANNUAL,
    stripe_voice_metered_id:      process.env.STRIPE_RESELLER_STARTER_VOICE,
    stripe_sms_metered_id:        process.env.STRIPE_RESELLER_STARTER_SMS,
  },
  growth: {
    name: "Growth",
    monthly_flat_cents:           299700,   // $2,997.00
    annual_flat_cents:            2877120,  // $28,771.20 (= 2997 * 12 * 0.80)
    cap_voice_minutes:            15000,
    cap_sms:                      10000,
    overage_voice_cents:          12,       // $0.12/min
    overage_sms_cents:            4,        // $0.04/sms
    customer_limit:               50,
    stripe_flat_monthly_price_id: process.env.STRIPE_RESELLER_GROWTH_FLAT_MONTHLY,
    stripe_flat_annual_price_id:  process.env.STRIPE_RESELLER_GROWTH_FLAT_ANNUAL,
    stripe_voice_metered_id:      process.env.STRIPE_RESELLER_GROWTH_VOICE,
    stripe_sms_metered_id:        process.env.STRIPE_RESELLER_GROWTH_SMS,
  },
  scale: {
    name: "Scale",
    monthly_flat_cents:           799700,   // $7,997.00
    annual_flat_cents:            7677120,  // $76,771.20 (= 7997 * 12 * 0.80)
    cap_voice_minutes:            40000,
    cap_sms:                      30000,
    overage_voice_cents:          10,       // $0.10/min
    overage_sms_cents:            3,        // $0.03/sms
    customer_limit:               null,     // unlimited
    stripe_flat_monthly_price_id: process.env.STRIPE_RESELLER_SCALE_FLAT_MONTHLY,
    stripe_flat_annual_price_id:  process.env.STRIPE_RESELLER_SCALE_FLAT_ANNUAL,
    stripe_voice_metered_id:      process.env.STRIPE_RESELLER_SCALE_VOICE,
    stripe_sms_metered_id:        process.env.STRIPE_RESELLER_SCALE_SMS,
  },
};

function getTier(tierName) {
  const tier = RESELLER_TIERS[String(tierName || "").toLowerCase()];
  if (!tier) return null;
  return { ...tier, key: String(tierName).toLowerCase() };
}

function getAllTiers() {
  return Object.entries(RESELLER_TIERS).map(([key, tier]) => ({
    ...tier,
    key,
  }));
}

module.exports = {
  RESELLER_TIERS,
  METER_EVENT_NAMES,
  getTier,
  getAllTiers,
};

"use strict";

/**
 * Reseller tier configuration.
 *
 * IMPORTANT: These pricing values are PLACEHOLDERS pending Apr 25 cost
 * validation against actual OpenAI Realtime + Twilio 30-day spend.
 *
 * Cost assumptions used here:
 *   - Voice: ~$0.31/min fully loaded (OpenAI Realtime $0.30 + Twilio $0.01)
 *   - SMS:   ~$0.01/msg fully loaded (Twilio $0.008 + OpenAI $0.002)
 *
 * Once Drew pulls actuals, update these constants. Stripe price IDs are
 * created from these values, so changing requires creating new Stripe
 * prices (old subscriptions remain on old prices until manually migrated).
 */

const RESELLER_TIERS = {
  starter: {
    name: "Starter",
    monthly_flat_cents:        99700,    // $997.00
    cap_voice_minutes:         3000,
    cap_sms:                   2000,
    overage_voice_cents:       15,       // $0.15/min
    overage_sms_cents:         5,        // $0.05/sms
    customer_limit:            10,
    stripe_flat_price_id:      process.env.STRIPE_RESELLER_STARTER_FLAT,
    stripe_voice_metered_id:   process.env.STRIPE_RESELLER_STARTER_VOICE,
    stripe_sms_metered_id:     process.env.STRIPE_RESELLER_STARTER_SMS,
  },
  growth: {
    name: "Growth",
    monthly_flat_cents:        299700,   // $2,997.00
    cap_voice_minutes:         15000,
    cap_sms:                   10000,
    overage_voice_cents:       12,       // $0.12/min
    overage_sms_cents:         4,        // $0.04/sms
    customer_limit:            50,
    stripe_flat_price_id:      process.env.STRIPE_RESELLER_GROWTH_FLAT,
    stripe_voice_metered_id:   process.env.STRIPE_RESELLER_GROWTH_VOICE,
    stripe_sms_metered_id:     process.env.STRIPE_RESELLER_GROWTH_SMS,
  },
  scale: {
    name: "Scale",
    monthly_flat_cents:        799700,   // $7,997.00
    cap_voice_minutes:         40000,
    cap_sms:                   30000,
    overage_voice_cents:       10,       // $0.10/min
    overage_sms_cents:         3,        // $0.03/sms
    customer_limit:            null,     // unlimited
    stripe_flat_price_id:      process.env.STRIPE_RESELLER_SCALE_FLAT,
    stripe_voice_metered_id:   process.env.STRIPE_RESELLER_SCALE_VOICE,
    stripe_sms_metered_id:     process.env.STRIPE_RESELLER_SCALE_SMS,
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
  getTier,
  getAllTiers,
};

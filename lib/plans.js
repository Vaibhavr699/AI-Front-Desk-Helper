"use strict";

/**
 * Plan definitions for AI Front Desk. No payment logic — used for limits and feature gating.
 *
 * STANDARD PLANS (operating tenants — Gladiators-style)
 * Plan          | Voice Minutes | SMS   | Who it's for  | Monthly Price | Annual Price (2 months free)
 * --------------|---------------|-------|----------------|---------------|-----------------------------
 * Basic         | 500           | 500   | Small ops      | $297/mo       | $248/mo ($2,976/yr)
 * Pro           | 1,200         | 1,500 | Growing teams  | $497/mo       | $414/mo ($4,968/yr)
 * Elite         | 3,000         | 4,000 | Scaling cos    | $997/mo       | $831/mo ($9,972/yr)
 *
 * HQ TIERS (rollup_only parents — franchise brand corporate)
 * Plan          | Locations | Who it's for                | Monthly  | Annual
 * --------------|-----------|------------------------------|----------|------------
 * HQ Starter    | up to 10  | Emerging franchise brands    | $297/mo  | $2,476/yr ($206/mo)
 * HQ Growth     | up to 25  | Established multi-loc brands | $597/mo  | $4,976/yr ($415/mo)
 * HQ Enterprise | unlimited | Major franchise systems      | $1,497/mo| $12,476/yr ($1,040/mo)
 *
 * NOTE: All child business branches (locations) on operating_hq parents
 * pay a standardized $197 setup fee regardless of the plan level selected.
 * HQ/Parent accounts pay the plan default.
 *
 * WHITE LABEL (Apr 19 pivot):
 *   - Elite-only as a plan benefit (features.whiteLabel: true)
 *   - Also granted to Resellers + Franchise Brands via superadmin tenants.brand_mode override
 *   - All HQ tiers include white label (rollup_only parents are inherently WL)
 *   - NOT available as a Pro add-on (killed)
 *   - Basic/Pro tenants show WL as excluded in pricing cards to drive Elite upgrade
 */

const PLANS = {
  basic: {
    id: "basic",
    name: "Basic",
    tagline: "AI Front Desk Starter",
    whoItIsFor: "Small ops",
    positioning: "Never miss a call again.",
    voiceMinutes: 500,
    smsLimit: 500,
    numberLimit: 1,
    priceMonthly: 297,
    priceAnnual: 248,        // per month, billed $2,976/yr (2 months free)
    priceAnnualTotal: 2976,  // total billed annually
    setupFee: 197,
    priceLabel: "/month",
    stripePriceId: process.env.STRIPE_PRICE_BASIC,               // Basic $297/mo
    stripePriceIdAnnual: process.env.STRIPE_PRICE_BASIC_ANNUAL,  // Basic $2,976/yr
    stripeSetupFeeId: process.env.STRIPE_SETUP_BASIC,            // Basic $197 setup
    features: {
      aiCallAnswering: true,
      missedCallTextBack: true,
      leadCaptureCrmForwarding: true,
      basicQualificationScript: true,
      googleCalendarBooking: false,
      websiteChat: false,
      facebookMessaging: false,
      followUpAutomation: false,
      googleCalendarIntegration: false,
      websiteAiChatWidget: false,
      facebookMessagingIntegration: false,
      appointmentReminders: false,
      aiFollowUpCalls: false,
      softRelationshipSmsSequences: false,
      noShowRecovery: false,
      statusTrackingPipeline: false,
      revenueRecoverySystem: false,
      customerNurturingReferral: false,
      whiteLabel: false,
      multiLocation: false,
    },
    includes: [
      "24/7 AI Call Answering — answers inbound calls, captures name, phone, job type, sends instant SMS follow-up",
      "Missed Call Text Back — if they don't answer, AI texts automatically",
      "Lead Capture + CRM Forwarding — sends lead info to email or Zapier",
      "Basic Qualification Script — qualifying questions to understand the job scope",
    ],
    excludes: [
      "Google Calendar booking",
      "Website chat",
      "Facebook messaging",
      "Follow-up automation",
      "White Label Branding",
      "Multi-location support",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "AI Booking Assistant",
    whoItIsFor: "Growing teams",
    positioning: "AI receptionist + automated scheduling. Replaces office admin time, manual booking, back-and-forth texting.",
    voiceMinutes: 1200,
    smsLimit: 1500,
    numberLimit: 3,
    priceMonthly: 497,
    priceAnnual: 414,        // per month, billed $4,968/yr (2 months free)
    priceAnnualTotal: 4968,  // total billed annually
    setupFee: 297,
    priceLabel: "/month",
    stripePriceId: process.env.STRIPE_PRICE_PRO,               // Pro $497/mo
    stripePriceIdAnnual: process.env.STRIPE_PRICE_PRO_ANNUAL,  // Pro $4,968/yr
    stripeSetupFeeId: process.env.STRIPE_SETUP_PRO,            // Pro $297 setup
    features: {
      aiCallAnswering: true,
      missedCallTextBack: true,
      leadCaptureCrmForwarding: true,
      basicQualificationScript: true,
      googleCalendarBooking: false,
      websiteChat: false,
      facebookMessaging: false,
      followUpAutomation: false,
      googleCalendarIntegration: true,
      websiteAiChatWidget: true,
      facebookMessagingIntegration: true,
      appointmentReminders: true,
      aiFollowUpCalls: false,
      softRelationshipSmsSequences: false,
      noShowRecovery: false,
      statusTrackingPipeline: false,
      revenueRecoverySystem: false,
      customerNurturingReferral: false,
      whiteLabel: false,
      multiLocation: true,
    },
    includes: [
      "Everything in Basic",
      "Google Calendar Integration (if needed, depends on CRM) — checks availability, books estimates, blocks calendar slots",
      "Website AI Chat Widget — chat bubble on website, same AI brain as phone",
      "Facebook Messaging Integration — messages feed into same system",
      "Automated Appointment Reminders — 24-hour reminder SMS, 2-hour reminder SMS, optional confirmation flow",
      "Multi-location support — add child locations at 50% of your plan rate",
    ],
    excludes: [
      "White Label Branding",
    ],
  },
  elite: {
    id: "elite",
    name: "Elite",
    tagline: "AI Sales, Follow-Up & White Label Engine",
    whoItIsFor: "Scaling companies",
    positioning: "Revenue recovery: increases booking rate, close rate; reduces no-shows; follows up automatically. Full white-label branding included.",
    voiceMinutes: 3000,
    smsLimit: 4000,
    numberLimit: 5,
    priceMonthly: 997,
    priceAnnual: 831,        // per month, billed $9,972/yr (2 months free)
    priceAnnualTotal: 9972,  // total billed annually
    setupFee: 497,
    priceLabel: "/month",
    stripePriceId: process.env.STRIPE_PRICE_ELITE,               // Elite $997/mo
    stripePriceIdAnnual: process.env.STRIPE_PRICE_ELITE_ANNUAL,  // Elite $9,972/yr
    stripeSetupFeeId: process.env.STRIPE_SETUP_ELITE,            // Elite $497 setup
    features: {
      aiCallAnswering: true,
      missedCallTextBack: true,
      leadCaptureCrmForwarding: true,
      basicQualificationScript: true,
      googleCalendarBooking: true,
      websiteChat: true,
      facebookMessaging: true,
      followUpAutomation: true,
      googleCalendarIntegration: true,
      websiteAiChatWidget: true,
      facebookMessagingIntegration: true,
      appointmentReminders: true,
      aiFollowUpCalls: true,
      softRelationshipSmsSequences: true,
      noShowRecovery: true,
      statusTrackingPipeline: true,
      revenueRecoverySystem: true,
      customerNurturingReferral: true,
      whiteLabel: true,
      multiLocation: true,
    },
    includes: [
      "Everything in Pro",
      "AI Follow-Up Calls (Call First Strategy) — for leads who didn't book, estimates not closed; AI calls automatically with relationship tone",
      "Soft Relationship SMS Sequences — 4-hour follow-up, next-day SMS, 3–5 day check-in, estimate closing sequence",
      "No-Show Recovery Automation — AI calls unconfirmed appointments, reschedules automatically",
      "Status Tracking Pipeline — new → not_booked → warm → booked → estimate_done → closed → cold",
      "Revenue Recovery System — increases booking rate, close rate; reduces no-shows; follows up automatically",
      "AI Customer Nurturing + Referral — post-service follow-ups, referral requests, seasonal campaigns, maintenance reminders, re-engagement, AI follow-up calls",
      "White Label Branding — your logo, your colors, your domain; hide all AI Front Desk branding from tenant-facing surfaces",
    ],
    excludes: [],
  },
  nurturing_addon: {
    id: "nurturing_addon",
    name: "Nurturing Add-on",
    tagline: "Customer Nurturing & Referral",
    priceMonthly: 99,
    priceLabel: "/month",
    stripePriceId: process.env.STRIPE_PRICE_NURTURING,
    features: {
      customerNurturingReferral: true,
    },
  },

  // ═══════════════════════════════════════════════════════════════════════
  // FRANCHISE TIER — for child tenants under franchise HQ accounts
  // Apr 29, 2026 — Built for Groovy Hues onboarding (22 painting locations).
  //
  // $225/mo per location. Basic-plan-style usage caps (500 voice / 500 SMS)
  // but Elite-tier features (chat widget, Facebook, multi-number, white-label,
  // follow-up automation, revenue recovery, customer nurturing, etc.).
  //
  // Hidden from public /api/plans — admin-only provisioning via Create Zee
  // flow in /admin. Each franchise customer gets zees on this tier; HQ pays
  // for itself separately via hq_starter / hq_growth / hq_enterprise.
  //
  // Default outbound gates: estimate follow-up enabled, bulk lists disabled,
  // 50/day soft throttle. HQ can override per-zee via plan_overrides.addons.
  // ═══════════════════════════════════════════════════════════════════════
  franchise: {
    id: "franchise",
    name: "Franchise",
    tagline: "Multi-Location Franchise Tier",
    whoItIsFor: "Franchise locations under an HQ account",
    positioning: "Elite features at controlled usage caps. Designed for franchise systems where each location handles steady volume.",
    voiceMinutes: 500,
    smsLimit: 500,
    numberLimit: 5,
    priceMonthly: 225,
    priceAnnual: null,
    priceAnnualTotal: null,
    setupFee: 0,
    priceLabel: "/month",
    isFranchise: true,
    hidden: true,
    stripePriceId: process.env.STRIPE_PRICE_FRANCHISE,
    stripePriceIdAnnual: null,
    stripeSetupFeeId: null,
    features: {
      aiCallAnswering: true,
      missedCallTextBack: true,
      leadCaptureCrmForwarding: true,
      basicQualificationScript: true,
      googleCalendarBooking: true,
      websiteChat: true,
      facebookMessaging: true,
      followUpAutomation: true,
      googleCalendarIntegration: true,
      websiteAiChatWidget: true,
      facebookMessagingIntegration: true,
      appointmentReminders: true,
      aiFollowUpCalls: true,
      softRelationshipSmsSequences: true,
      noShowRecovery: true,
      statusTrackingPipeline: true,
      revenueRecoverySystem: true,
      customerNurturingReferral: true,
      whiteLabel: true,
      multiLocation: true,
    },
    includes: [
      "AI Call Answering with full conversation handling",
      "Website AI Chat Widget + Facebook Messaging",
      "Google Calendar booking and integration",
      "Automated appointment reminders + no-show recovery",
      "AI follow-up calls + relationship SMS sequences",
      "Revenue recovery + status tracking pipeline",
      "Customer Nurturing & Referral campaigns",
      "White Label Branding (inherited from HQ)",
      "5 phone numbers per location",
    ],
    excludes: [],
  },
  
  // ═══════════════════════════════════════════════════════════════════════
  // HQ TIERS — for rollup_only parents (franchise brand corporate)
  // These parents do NOT run jobs themselves. They pay a flat HQ fee for
  // admin + rollup dashboard. Each franchisee underneath has their own plan.
  // ═══════════════════════════════════════════════════════════════════════
  hq_starter: {
    id: "hq_starter",
    name: "HQ Starter",
    tagline: "Franchise Brand Rollup",
    whoItIsFor: "Emerging franchise brands (up to 10 locations)",
    positioning: "Single-pane-of-glass rollup for emerging franchise systems. Centralized brand controls, basic analytics across all locations.",
    voiceMinutes: 0,        // HQ doesn't take calls itself
    smsLimit: 0,            // HQ doesn't send SMS itself
    numberLimit: 0,         // HQ doesn't have a phone line
    locationLimit: 10,      // up to 10 child locations
    priceMonthly: 297,
    priceAnnual: 206,        // per month, billed $2,476/yr (~17% off)
    priceAnnualTotal: 2476,
    setupFee: 0,             // no setup fee for HQ tiers
    priceLabel: "/month",
    isHQTier: true,
    stripePriceId: process.env.STRIPE_PRICE_HQ_STARTER,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_HQ_STARTER_ANNUAL,
    stripeSetupFeeId: null,
    features: {
      multiLocationRollup: true,
      brandControls: false,
      advancedAnalytics: false,
      whiteLabel: true,         // all HQ tiers include WL by default
      apiAccess: false,
      dedicatedAccountManager: false,
    },
    includes: [
      "Up to 10 franchise locations rolled up under one dashboard",
      "Per-location and consolidated metrics",
      "White Label Branding — your franchise brand, hidden AI Front Desk",
      "Basic centralized AI personality template",
    ],
    excludes: [
      "Advanced location-level analytics",
      "Brand-locked franchisee controls",
      "API access",
      "Dedicated account manager",
    ],
  },
  hq_growth: {
    id: "hq_growth",
    name: "HQ Growth",
    tagline: "Established Multi-Location Brand",
    whoItIsFor: "Established franchise brands (up to 25 locations)",
    positioning: "Centralized brand controls + advanced analytics for franchise systems with consistent operations across 10–25 locations.",
    voiceMinutes: 0,
    smsLimit: 0,
    numberLimit: 0,
    locationLimit: 25,
    priceMonthly: 597,
    priceAnnual: 415,        // per month, billed $4,976/yr (~17% off)
    priceAnnualTotal: 4976,
    setupFee: 0,
    priceLabel: "/month",
    isHQTier: true,
    stripePriceId: process.env.STRIPE_PRICE_HQ_GROWTH,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_HQ_GROWTH_ANNUAL,
    stripeSetupFeeId: null,
    features: {
      multiLocationRollup: true,
      brandControls: true,
      advancedAnalytics: true,
      whiteLabel: true,
      apiAccess: false,
      dedicatedAccountManager: false,
    },
    includes: [
      "Up to 25 franchise locations rolled up under one dashboard",
      "Per-location and consolidated metrics with deep analytics",
      "White Label Branding — your franchise brand, hidden AI Front Desk",
      "Brand-locked AI personality (franchisees can't deviate from corporate voice)",
      "Centralized objection handling + FAQ libraries pushed to all locations",
    ],
    excludes: [
      "Unlimited locations",
      "API access",
      "Dedicated account manager",
    ],
  },
  hq_enterprise: {
    id: "hq_enterprise",
    name: "HQ Enterprise",
    tagline: "Major Franchise System",
    whoItIsFor: "Major franchise systems (unlimited locations)",
    positioning: "Unlimited locations, full API access, dedicated account manager, white-glove onboarding for major franchise systems.",
    voiceMinutes: 0,
    smsLimit: 0,
    numberLimit: 0,
    locationLimit: null,     // unlimited
    priceMonthly: 1497,
    priceAnnual: 1040,        // per month, billed $12,476/yr (~17% off)
    priceAnnualTotal: 12476,
    setupFee: 0,
    priceLabel: "/month",
    isHQTier: true,
    stripePriceId: process.env.STRIPE_PRICE_HQ_ENTERPRISE,
    stripePriceIdAnnual: process.env.STRIPE_PRICE_HQ_ENTERPRISE_ANNUAL,
    stripeSetupFeeId: null,
    features: {
      multiLocationRollup: true,
      brandControls: true,
      advancedAnalytics: true,
      whiteLabel: true,
      apiAccess: true,
      dedicatedAccountManager: true,
    },
    includes: [
      "Unlimited franchise locations rolled up under one dashboard",
      "Everything in HQ Growth",
      "API access for custom integrations",
      "Dedicated account manager + white-glove onboarding",
      "Custom domain + branded login portal (Phase 2)",
      "Quarterly business reviews",
    ],
    excludes: [],
  },
};

const PLAN_IDS = ["basic", "pro", "elite"];
const ADMIN_PLAN_IDS = ["basic", "pro", "elite", "franchise"];
const HQ_PLAN_IDS = ["hq_starter", "hq_growth", "hq_enterprise"];
const ALL_PLAN_IDS = [...PLAN_IDS, ...HQ_PLAN_IDS];

function getPlan(planId) {
  const id = (planId || "basic").toLowerCase();
  return PLANS[id] || PLANS.basic;
}

function getPlanLimits(planId) {
  const plan = getPlan(planId);
  return {
    voiceMinutes: plan.voiceMinutes,
    smsLimit: plan.smsLimit,
  };
}

function hasFeature(planId, featureKey) {
  const plan = getPlan(planId);
  return plan.features?.[featureKey] === true;
}

/**
 * Get the effective monthly or annual rate (in CENTS) that this tenant is
 * actually billed. Resolution priority:
 *   1. Tenant-level override column (plan_monthly_override_cents /
 *      plan_annual_override_cents) — set by superadmin for negotiated deals
 *   2. Existing plan_overrides jsonb column (legacy, per-plan-id)
 *   3. Plan default rate (plan.priceMonthly or plan.priceAnnualTotal/12)
 *
 * Always returns INTEGER CENTS to avoid floating-point drift in Stripe math.
 *
 * @param {object} tenant - Tenant row with plan, plan_overrides,
 *                          plan_monthly_override_cents, plan_annual_override_cents
 * @param {string} interval - 'monthly' (default) | 'annual'
 *                            For 'annual', returns the per-month equivalent
 *                            (annual total / 12) so caller can compare
 *                            interval-agnostic.
 * @returns {number} cents
 */
function getEffectivePlanRateCents(tenant, interval = "monthly") {
  if (!tenant) return 0;
  const planId = (tenant.plan || "basic").toLowerCase();
  const plan = getPlan(planId);
  const isAnnual = interval === "annual";

  // Priority 1: tenant-level override columns (Apr 19 spec)
  if (isAnnual && tenant.plan_annual_override_cents != null) {
    // Annual override stored as TOTAL annual cents → return per-month equivalent
    return Math.round(tenant.plan_annual_override_cents / 12);
  }
  if (!isAnnual && tenant.plan_monthly_override_cents != null) {
    return tenant.plan_monthly_override_cents;
  }

  // Priority 2: legacy plan_overrides jsonb (preserve existing behavior)
  const promoActive =
    !tenant.promo_expires_at ||
    new Date(tenant.promo_expires_at) > new Date();
  const overrides = tenant.plan_overrides || {};
  const planOverride = overrides[planId] || {};
  if (promoActive && planOverride.monthly != null) {
    // legacy plan_overrides.monthly is already in CENTS (per existing
    // lib/stripe.js usage). Annual is not stored in legacy overrides, so
    // fall through to plan default for annual interval.
    if (!isAnnual) return planOverride.monthly;
  }

  // Priority 3: plan default
  if (isAnnual) {
    // priceAnnualTotal is dollars/year → cents/month
    const annualTotalDollars = plan.priceAnnualTotal || 0;
    return Math.round((annualTotalDollars * 100) / 12);
  }
  // priceMonthly is dollars/month → cents/month
  return Math.round((plan.priceMonthly || 0) * 100);
}

/**
 * Whether the tenant has access to the Customer Nurturing + Referral feature (Elite or add-on).
 */
function hasNurturingReferralAccess(tenant) {
  if (!tenant) return false;
  const planId = (tenant.plan || "basic").toLowerCase();
  if (hasFeature(planId, "customerNurturingReferral")) return true;
  if (tenant.nurturing_enabled) return true;
  const addons = tenant.addons || tenant.plan_overrides?.addons;
  return !!(addons && addons.customerNurturingReferral);
}

/**
 * Whether the tenant is in white-label mode.
 * Source of truth is tenants.brand_mode — which is either auto-flipped to
 * 'white_label' on Elite plan upgrade (see lib/stripe.js) or manually
 * granted by superadmin for resellers / franchise brands on non-Elite
 * plans. All HQ tier plans imply white_label by default.
 */
function isWhiteLabel(tenant) {
  if (!tenant) return false;
  if (tenant.brand_mode === "white_label") return true;
  if (tenant.brand_mode === "ai_branded") return false;
  // Fallback for tenants without brand_mode set yet
  const planId = (tenant.plan || "basic").toLowerCase();
  return hasFeature(planId, "whiteLabel");
}

/**
 * Whether the tenant can add child locations under itself.
 * Requires multi-location feature on plan AND parent_mode set appropriately.
 */
function canAddLocations(tenant) {
  if (!tenant) return false;
  // HQ tier parents always can (they exist for this purpose)
  if (tenant.parent_mode === "rollup_only") return true;
  // Operating HQ: requires multiLocation feature (Pro+)
  return hasFeature(tenant.plan, "multiLocation");
}

/**
 * Get the location limit for a parent. Returns Infinity for unlimited.
 * For HQ tiers, this is the plan's locationLimit. For operating_hq,
 * there's no hard limit (subject to Stripe + business sense).
 */
function getLocationLimit(tenant) {
  if (!tenant) return 0;
  if (tenant.parent_mode === "rollup_only") {
    const plan = getPlan(tenant.plan);
    return plan.locationLimit == null ? Infinity : plan.locationLimit;
  }
  // operating_hq: no hard cap
  return Infinity;
}

/**
 * Get the correct Stripe price ID for a plan + billing interval.
 * @param {string} planId - "basic" | "pro" | "elite" | "hq_starter" | etc.
 * @param {string} interval - "monthly" | "annual"
 * @returns {string|undefined} Stripe price ID
 */
function getStripePriceId(planId, interval) {
  const plan = getPlan(planId);
  if (interval === "annual") return plan.stripePriceIdAnnual;
  return plan.stripePriceId;
}

// ═══════════════════════════════════════════════════════════════════════
// OUTBOUND GATES (Apr 29, 2026)
//
// Three-level gating system stored in tenants.plan_overrides.addons.
// Reads default false → true based on plan tier and explicit overrides.
//
// Use these instead of checking outbound capability inline. Centralizing
// here lets us change defaults per-tier without touching call sites.
// ═══════════════════════════════════════════════════════════════════════

/**
 * Whether AI can run automatic estimate/lead follow-up outbound calls.
 * Default: true for all tenants (it's revenue-generating).
 * Override: tenant.plan_overrides.addons.outbound_followup_enabled = false
 */
function canRunOutboundFollowup(tenant) {
  if (!tenant) return false;
  const addons = tenant.plan_overrides?.addons || {};
  if (typeof addons.outbound_followup_enabled === "boolean") {
    return addons.outbound_followup_enabled;
  }
  return true; // Default on
}

/**
 * Whether tenant can run bulk outbound dialing from uploaded lists.
 * Default: false for franchise tier (margin protection), true for non-franchise.
 * Override: tenant.plan_overrides.addons.outbound_lists_enabled = true/false
 */
function canRunOutboundLists(tenant) {
  if (!tenant) return false;
  const addons = tenant.plan_overrides?.addons || {};
  if (typeof addons.outbound_lists_enabled === "boolean") {
    return addons.outbound_lists_enabled;
  }
  // Default off for franchise, on for everyone else
  return tenant.plan !== "franchise";
}

/**
 * Maximum outbound calls per day for this tenant.
 * Default: 50 for franchise, Infinity for non-franchise.
 * Override: tenant.plan_overrides.addons.outbound_max_per_day = <number>
 */
function getOutboundDailyMax(tenant) {
  if (!tenant) return 0;
  const addons = tenant.plan_overrides?.addons || {};
  if (typeof addons.outbound_max_per_day === "number") {
    return addons.outbound_max_per_day;
  }
  return tenant.plan === "franchise" ? 50 : Infinity;
}
function listPlans() {
  // Public listing excludes hidden tiers (franchise, addon-style entries)
  return PLAN_IDS.filter((id) => !PLANS[id]?.hidden).map((id) => {
    const p = PLANS[id];
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      whoItIsFor: p.whoItIsFor,
      positioning: p.positioning,
      voiceMinutes: p.voiceMinutes,
      smsLimit: p.smsLimit,
      priceMonthly: p.priceMonthly,
      priceAnnual: p.priceAnnual,
      priceAnnualTotal: p.priceAnnualTotal,
      setupFee: p.setupFee,
      priceLabel: p.priceLabel,
      stripePriceId: p.stripePriceId,
      stripePriceIdAnnual: p.stripePriceIdAnnual,
      stripeSetupFeeId: p.stripeSetupFeeId,
      includes: p.includes,
      excludes: p.excludes,
      features: p.features,
    };
  });
}

/**
 * List the HQ tier plans separately (for franchise brand onboarding flow).
 * Not surfaced in the standard /api/plans response.
 */
function listHQPlans() {
  return HQ_PLAN_IDS.map((id) => {
    const p = PLANS[id];
    return {
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      whoItIsFor: p.whoItIsFor,
      positioning: p.positioning,
      locationLimit: p.locationLimit,
      priceMonthly: p.priceMonthly,
      priceAnnual: p.priceAnnual,
      priceAnnualTotal: p.priceAnnualTotal,
      priceLabel: p.priceLabel,
      stripePriceId: p.stripePriceId,
      stripePriceIdAnnual: p.stripePriceIdAnnual,
      includes: p.includes,
      excludes: p.excludes,
      features: p.features,
      isHQTier: true,
    };
  });
}

module.exports = {
  PLANS,
  PLAN_IDS,
  ADMIN_PLAN_IDS,
  HQ_PLAN_IDS,
  ALL_PLAN_IDS,
  getPlan,
  getPlanLimits,
  hasFeature,
  getEffectivePlanRateCents,
  hasNurturingReferralAccess,
  isWhiteLabel,
  canAddLocations,
  getLocationLimit,
  getStripePriceId,
  listPlans,
  listHQPlans,
};

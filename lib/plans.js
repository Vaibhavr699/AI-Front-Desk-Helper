"use strict";

/**
 * Plan definitions for AI Front Desk. No payment logic — used for limits and feature gating.
 *
 * Plan          | Voice Minutes | SMS   | Who it's for  | Monthly Price | Annual Price (2 months free)
 * --------------|---------------|-------|----------------|---------------|-----------------------------
 * Basic         | 500           | 500   | Small ops      | $297/mo       | $248/mo ($2,976/yr)
 * Pro           | 1,200         | 1,500 | Growing teams  | $497/mo       | $414/mo ($4,968/yr)
 * Elite         | 3,000         | 4,000 | Scaling cos    | $997/mo       | $831/mo ($9,972/yr)
 *
 * NOTE: All child business branches (locations) pay a standardized $197 setup fee
 * regardless of the plan level selected. HQ/Parent accounts pay the plan default.
 *
 * WHITE LABEL (Apr 19 pivot):
 *   - Elite-only as a plan benefit (features.whiteLabel: true)
 *   - Also granted to Resellers + Franchise Brands via superadmin tenants.brand_mode override
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
    },
    includes: [
      "Everything in Basic",
      "Google Calendar Integration (if needed, depends on CRM) — checks availability, books estimates, blocks calendar slots",
      "Website AI Chat Widget — chat bubble on website, same AI brain as phone",
      "Facebook Messaging Integration — messages feed into same system",
      "Automated Appointment Reminders — 24-hour reminder SMS, 2-hour reminder SMS, optional confirmation flow",
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
};

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
 * Source of truth is tenants.brand_mode — which is either auto-flipped to 'white_label'
 * on Elite plan upgrade (see lib/stripe.js) or manually granted by superadmin for
 * resellers / franchise brands on non-Elite plans.
 *
 * Returns true when brand_mode === 'white_label'. Falls back to the Elite plan
 * feature flag if brand_mode is missing (pre-migration safety net).
 */
function isWhiteLabel(tenant) {
  if (!tenant) return false;
  if (tenant.brand_mode === "white_label") return true;
  if (tenant.brand_mode === "ai_branded") return false;
  // Fallback for tenants without brand_mode set yet: Elite plan implies white_label
  const planId = (tenant.plan || "basic").toLowerCase();
  return hasFeature(planId, "whiteLabel");
}

/**
 * Get the correct Stripe price ID for a plan + billing interval.
 * @param {string} planId - "basic" | "pro" | "elite"
 * @param {string} interval - "monthly" | "annual"
 * @returns {string|undefined} Stripe price ID
 */
function getStripePriceId(planId, interval) {
  const plan = getPlan(planId);
  if (interval === "annual") return plan.stripePriceIdAnnual;
  return plan.stripePriceId;
}

const PLAN_IDS = ["basic", "pro", "elite"];

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
  return plan.features[featureKey] === true;
}

function listPlans() {
  return PLAN_IDS.map((id) => {
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

module.exports = {
  PLANS,
  PLAN_IDS,
  getPlan,
  getPlanLimits,
  hasFeature,
  hasNurturingReferralAccess,
  isWhiteLabel,
  getStripePriceId,
  listPlans,
};

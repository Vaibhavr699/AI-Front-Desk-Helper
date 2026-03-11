"use strict";

/**
 * Plan definitions for AI Front Desk. No payment logic — used for limits and feature gating.
 *
 * Plan          | Voice Minutes | SMS   | Who it's for  | Price (placeholder; Stripe later)
 * --------------|---------------|-------|----------------|----------------------------------
 * Basic         | 300           | 500   | Small ops      | $29/mo
 * Pro           | 800           | 1,500 | Growing teams  | $79/mo
 * Elite         | 2,000         | 4,000 | Scaling cos    | $199/mo
 */

const PLANS = {
  basic: {
    id: "basic",
    name: "Basic",
    tagline: "AI Front Desk Starter",
    whoItIsFor: "Small ops",
    positioning: "Never miss a call again.",
    voiceMinutes: 300,
    smsLimit: 500,
    priceMonthly: 297,
    setupFee: 400,
    priceLabel: "/month",
    stripePriceId: "price_1T9PMMG4V3F53niEjJgiHf9H", // Basic $297/mo
    stripeSetupFeeId: "price_1T9PL4G4V3F53niETsVTW4hG", // Basic $400 setup
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
    },
    includes: [
      "24/7 AI Call Answering — answers inbound calls, captures name, phone, job type, sends instant SMS follow-up",
      "Missed Call Text Back — if they don't answer, AI texts automatically",
      "Lead Capture + CRM Forwarding — sends lead info to email or Zapier",
      "Basic Qualification Script — e.g. “Interior or exterior?”, “When are you looking to start?”",
    ],
    excludes: [
      "Google Calendar booking",
      "Website chat",
      "Facebook messaging",
      "Follow-up automation",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "AI Booking Assistant",
    whoItIsFor: "Growing teams",
    positioning: "AI receptionist + automated scheduling. Replaces office admin time, manual booking, back-and-forth texting.",
    voiceMinutes: 800,
    smsLimit: 1500,
    priceMonthly: 497,
    setupFee: 600,
    priceLabel: "/month",
    stripePriceId: "price_1T9PI6G4V3F53niEbRrubZw6", // Pro $497/mo
    stripeSetupFeeId: "price_1T9PISG4V3F53niENJUiauRJ", // Pro $600 setup
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
    },
    includes: [
      "Everything in Basic",
      "Google Calendar Integration (if needed, depends on CRM) — checks availability, books estimates, blocks calendar slots",
      "Website AI Chat Widget — chat bubble on website, same AI brain as phone",
      "Facebook Messaging Integration — messages feed into same system",
      "Automated Appointment Reminders — 24-hour reminder SMS, 2-hour reminder SMS, optional confirmation flow",
    ],
    excludes: [],
  },
  elite: {
    id: "elite",
    name: "Elite",
    tagline: "AI Sales & Follow-Up Engine",
    whoItIsFor: "Scaling companies",
    positioning: "Revenue recovery: increases booking rate, close rate; reduces no-shows; follows up automatically.",
    voiceMinutes: 2000,
    smsLimit: 4000,
    priceMonthly: 997,
    setupFee: 900,
    priceLabel: "/month",
    stripePriceId: "price_1T9POYG4V3F53niEpYUMRXWV", // Elite $997/mo
    stripeSetupFeeId: "price_1T9PPFG4V3F53niErKhAWvho", // Elite $900 setup
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
    },
    includes: [
      "Everything in Pro",
      "AI Follow-Up Calls (Call First Strategy) — for leads who didn't book, estimates not closed; AI calls automatically with relationship tone",
      "Soft Relationship SMS Sequences — 4-hour follow-up, next-day SMS, 3–5 day check-in, estimate closing sequence",
      "No-Show Recovery Automation — AI calls unconfirmed appointments, reschedules automatically",
      "Status Tracking Pipeline — new → not_booked → warm → booked → estimate_done → closed → cold",
      "Revenue Recovery System — increases booking rate, close rate; reduces no-shows; follows up automatically",
    ],
    excludes: [],
  },
};

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
      setupFee: p.setupFee,
      priceLabel: p.priceLabel,
      stripePriceId: p.stripePriceId,
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
  listPlans,
};

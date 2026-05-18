"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// services/estimatorAddon.js
//
// Phase 7 E (May 18, 2026) — Estimator $20/mo Add-On entitlement engine.
//
// SINGLE SOURCE OF TRUTH for "can this tenant use the estimator widget?"
//
// Every place that gates the estimator (tenant-config endpoint, settings
// paywall UI, webhook handlers, scheduled crons) MUST consult
// resolveEntitlement() rather than reading individual flags. Centralizing
// this prevents drift between the gate logic and the paywall display.
//
// Entitlement rules (in priority order):
//   1. GRANDFATHERED — tenants with estimator_enabled=true at mig 079 time.
//      Includes Gladiators + Paragon. Permanent. Even if plan downgrades.
//   2. ELITE PLAN — estimator included in Elite plan ($X/mo).
//   3. WHITE-LABEL — brand_mode='white_label' includes estimator (per
//      May 12 policy line, Settings.jsx estimator tab access).
//   4. RESELLER CUSTOMER — reseller_tier IS NOT NULL → bundled in reseller
//      pricing (no extra fee, like voice/SMS).
//   5. FRANCHISE HQ — hq_starter / hq_growth / hq_enterprise plans get it.
//   6. FRANCHISE ZEE — parent_pays billing_responsibility means HQ covers
//      estimator for the location.
//   7. ADD-ON SUBSCRIPTION — Basic/Pro tier paying $20/mo via Stripe.
//
// On cancellation: 7-day grace. We set estimator_addon_cancelled_at +
// estimator_addon_period_end but keep estimator_addon_active=true until
// the period ends. A daily cron flips active=false at period end.
//
// Public API:
//   resolveEntitlement(tenant)
//     Sync. Pure function. Pass full tenant row → returns { entitled, source, reason }
//
//   canPurchaseAddon(tenant)
//     Sync. Pure. Returns true ONLY if tenant is on Basic/Pro AND not already
//     entitled some other way. Used to gate the "Subscribe" button on the
//     paywall UI so Elite/WL/reseller tenants don't see a purchase CTA.
//
//   getDisplayState(tenant)
//     Sync. Pure. Returns rich object for Settings UI:
//     { entitled, source, can_purchase, status_label, cta_label, cancelled_until }
// ═══════════════════════════════════════════════════════════════════════════

// Plans that include estimator at no additional cost
const ELITE_PLANS = ["elite"];
const HQ_PLANS = ["hq_starter", "hq_growth", "hq_enterprise"];

// Plans eligible to PURCHASE the add-on (everything else either gets it
// free or doesn't make sense)
const ADDON_ELIGIBLE_PLANS = ["basic", "pro"];

/**
 * Resolve whether a tenant is entitled to use the estimator widget.
 *
 * Returns:
 *   {
 *     entitled: boolean,
 *     source: 'grandfathered' | 'elite' | 'white_label' | 'reseller' |
 *             'franchise_hq' | 'franchise_zee' | 'addon' | 'none',
 *     reason: human-readable string,
 *   }
 *
 * Pure function. No DB calls, no async. Pass the full tenant row.
 */
function resolveEntitlement(tenant) {
  if (!tenant || typeof tenant !== "object") {
    return { entitled: false, source: "none", reason: "no tenant" };
  }

  // 1. Grandfathered (overrides everything else)
  if (tenant.estimator_grandfathered === true) {
    return {
      entitled: true,
      source: "grandfathered",
      reason: "Early adopter — estimator included for life",
    };
  }

  // 2. Elite plan
  if (typeof tenant.plan === "string" && ELITE_PLANS.includes(tenant.plan.toLowerCase())) {
    return {
      entitled: true,
      source: "elite",
      reason: "Included in Elite plan",
    };
  }

  // 3. White-label tenant
  if (tenant.brand_mode === "white_label") {
    return {
      entitled: true,
      source: "white_label",
      reason: "Included for white-label tenants",
    };
  }

  // 4. Reseller customer (any reseller tier indicates a reseller-managed tenant)
  if (tenant.reseller_tier != null && tenant.reseller_tier !== "") {
    return {
      entitled: true,
      source: "reseller",
      reason: "Included in reseller bundled pricing",
    };
  }
  // Also catch tenants that have a reseller_id pointing to a reseller parent
  if (tenant.reseller_id != null && tenant.reseller_id !== "") {
    return {
      entitled: true,
      source: "reseller",
      reason: "Included via reseller parent",
    };
  }

  // 5. Franchise HQ plan
  if (typeof tenant.plan === "string" && HQ_PLANS.includes(tenant.plan.toLowerCase())) {
    return {
      entitled: true,
      source: "franchise_hq",
      reason: "Included in franchise HQ plan",
    };
  }

  // 6. Franchise zee on parent_pays billing
  if (tenant.billing_responsibility === "parent_pays" && tenant.parent_id) {
    return {
      entitled: true,
      source: "franchise_zee",
      reason: "Covered by parent HQ billing",
    };
  }

  // 7. Active add-on subscription
  if (tenant.estimator_addon_active === true) {
    return {
      entitled: true,
      source: "addon",
      reason: "$20/mo add-on active",
    };
  }

  return {
    entitled: false,
    source: "none",
    reason: "No estimator entitlement — upgrade or purchase add-on",
  };
}

/**
 * Can this tenant purchase the $20 add-on?
 *
 * Only Basic + Pro tier tenants. Everyone else is either already entitled
 * (Elite/WL/reseller/franchise) or doesn't qualify. Used by the paywall
 * UI to decide whether to show the "Subscribe for $20/mo" CTA.
 */
function canPurchaseAddon(tenant) {
  if (!tenant || typeof tenant !== "object") return false;

  // Already entitled some other way? No need to purchase.
  const entitlement = resolveEntitlement(tenant);
  if (entitlement.entitled && entitlement.source !== "addon") {
    return false;
  }

  // Already paying for the add-on? No purchase needed.
  if (tenant.estimator_addon_active === true) {
    return false;
  }

  // Must be on Basic or Pro plan to purchase the add-on.
  const plan = typeof tenant.plan === "string" ? tenant.plan.toLowerCase() : "";
  return ADDON_ELIGIBLE_PLANS.includes(plan);
}

/**
 * Build the rich display state for Settings.jsx Estimator tab paywall.
 *
 * Returns:
 *   {
 *     entitled: boolean,
 *     source: string,
 *     can_purchase: boolean,
 *     status_label: short string for UI badge
 *       ('Included', 'Add-On Active', 'Cancelled — Access Until X',
 *        'Upgrade Required', 'Not Eligible'),
 *     cta_label: string for primary action button (or null if no action),
 *     cta_action: 'subscribe' | 'cancel' | 'upgrade_plan' | null,
 *     cancelled_until: ISO string or null,
 *     reason: human-readable explanation,
 *   }
 */
function getDisplayState(tenant) {
  const entitlement = resolveEntitlement(tenant);
  const canPurchase = canPurchaseAddon(tenant);

  // Active subscription (paying, not cancelled)
  if (entitlement.source === "addon" && !tenant.estimator_addon_cancelled_at) {
    return {
      entitled: true,
      source: "addon",
      can_purchase: false,
      status_label: "Add-On Active",
      cta_label: "Cancel Subscription",
      cta_action: "cancel",
      cancelled_until: null,
      reason: "Estimator add-on subscription is active. Billed $20/mo.",
    };
  }

  // Cancelled subscription in grace period
  if (entitlement.source === "addon" && tenant.estimator_addon_cancelled_at) {
    return {
      entitled: true,
      source: "addon",
      can_purchase: false,
      status_label: "Cancelled — Grace Period",
      cta_label: "Resubscribe",
      cta_action: "subscribe",
      cancelled_until: tenant.estimator_addon_period_end || null,
      reason: tenant.estimator_addon_period_end
        ? `Access continues until ${new Date(tenant.estimator_addon_period_end).toLocaleDateString()}.`
        : "Add-on cancelled. Access continues until end of billing period.",
    };
  }

  // Entitled some other way (grandfathered / elite / WL / reseller / franchise)
  if (entitlement.entitled) {
    return {
      entitled: true,
      source: entitlement.source,
      can_purchase: false,
      status_label: "Included",
      cta_label: null,
      cta_action: null,
      cancelled_until: null,
      reason: entitlement.reason,
    };
  }

  // Not entitled — can they purchase?
  if (canPurchase) {
    return {
      entitled: false,
      source: "none",
      can_purchase: true,
      status_label: "Upgrade Required",
      cta_label: "Subscribe — $20/mo",
      cta_action: "subscribe",
      cancelled_until: null,
      reason: "Add the estimator widget to your website for $20/mo. Capture more leads with instant ballpark pricing.",
    };
  }

  // Not entitled and can't purchase — likely on a plan that doesn't support it
  return {
    entitled: false,
    source: "none",
    can_purchase: false,
    status_label: "Not Eligible",
    cta_label: "Upgrade Plan",
    cta_action: "upgrade_plan",
    cancelled_until: null,
    reason: "Estimator requires Basic, Pro, or Elite plan. Upgrade to enable.",
  };
}

/**
 * Should the estimator_enabled flag be ON for this tenant right now?
 *
 * This is what the daily cron uses to flip the master enabled flag after
 * an add-on subscription ends + grace period expires. Returns true if the
 * tenant has entitlement from ANY source.
 *
 * Note: estimator_enabled is the OWNER's preference (turn the widget on/off).
 * Entitlement is whether they CAN turn it on. The cron only flips OFF when
 * entitlement is lost; it doesn't flip ON automatically (owner choice).
 */
function isEntitled(tenant) {
  return resolveEntitlement(tenant).entitled;
}

module.exports = {
  resolveEntitlement,
  canPurchaseAddon,
  getDisplayState,
  isEntitled,
  // Constants exposed for testing
  ELITE_PLANS,
  HQ_PLANS,
  ADDON_ELIGIBLE_PLANS,
};

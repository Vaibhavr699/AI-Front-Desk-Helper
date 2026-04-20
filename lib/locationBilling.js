"use strict";

/**
 * lib/locationBilling.js
 * Apr 19, 2026 — Multi-location billing math + Stripe sync
 *
 * This module is the SINGLE SOURCE OF TRUTH for:
 *   1. How much a parent pays per child location (rate calculation)
 *   2. How many active locations a parent has
 *   3. Whether a parent can add another location (plan/HQ tier limits)
 *   4. Prorated preview math for the "Add Location" modal
 *   5. Stripe subscription sync (parent_pays children only)
 *
 * Self-pays children (rollup_only + self_pays) do NOT touch parent's
 * subscription. Their own subscription is created via the franchisee
 * invite flow in routes/franchisee.js (Deploy 7).
 *
 * See conversation Apr 19 for full design rationale.
 */

const Stripe = require("stripe");
const db = require("./db");
const {
  getPlan,
  getEffectivePlanRateCents,
  getLocationLimit,
  canAddLocations,
} = require("./plans");

const secretKey = process.env.STRIPE_SECRET_KEY;
const stripe = secretKey ? new Stripe(secretKey) : null;

// ═════════════════════════════════════════════════════════════════════════
// RATE CALCULATION
// ═════════════════════════════════════════════════════════════════════════

/**
 * What does the PARENT pay per month/year for hosting THIS specific child?
 *
 * Resolution priority (per Apr 19 spec):
 *   1. Per-location override on the child row (locations_monthly_rate_cents
 *      / locations_annual_rate_cents) — superadmin-set, always wins
 *   2. self_pays children = 0 (parent doesn't pay for them)
 *   3. rollup_only + parent_pays = full child plan rate (no discount;
 *      franchisor is paying franchisee's plan, not sharing their own)
 *   4. operating_hq + parent_pays = 50% of parent's effective rate
 *
 * Returns INTEGER CENTS for the requested interval. Annual returns the
 * per-month equivalent (annual total / 12) for interval-agnostic math.
 *
 * @param {object} parent - Parent tenant row
 * @param {object} child - Child tenant row (the location)
 * @param {string} interval - 'monthly' (default) | 'annual'
 * @returns {number} cents per month
 */
function getChildLocationCostCents(parent, child, interval = "monthly") {
  if (!parent || !child) return 0;

  // 1. Per-location override always wins
  if (interval === "annual" && child.locations_annual_rate_cents != null) {
    // Annual override stored as TOTAL annual cents → return per-month
    return Math.round(child.locations_annual_rate_cents / 12);
  }
  if (interval === "monthly" && child.locations_monthly_rate_cents != null) {
    return child.locations_monthly_rate_cents;
  }

  // 2. self_pays: child has its own subscription, parent pays nothing
  if (child.billing_responsibility === "self_pays") {
    return 0;
  }

  // 3. rollup_only + parent_pays = full child plan rate
  if (parent.parent_mode === "rollup_only") {
    return getEffectivePlanRateCents(child, interval);
  }

  // 4. operating_hq + parent_pays = 50% of parent's effective rate
  return Math.round(getEffectivePlanRateCents(parent, interval) * 0.5);
}

/**
 * Get the FULL annual cost in cents (for the "Add Location" modal preview
 * when interval=annual). Returns the actual yearly total, not per-month.
 */
function getChildLocationCostCentsAnnualTotal(parent, child) {
  if (!parent || !child) return 0;

  // Per-location annual override is the total annual cents
  if (child.locations_annual_rate_cents != null) {
    return child.locations_annual_rate_cents;
  }

  // Otherwise multiply per-month by 12
  return getChildLocationCostCents(parent, child, "annual") * 12;
}

// ═════════════════════════════════════════════════════════════════════════
// LOCATION QUERIES
// ═════════════════════════════════════════════════════════════════════════

/**
 * Count active (non-removed) locations under a parent.
 * Used to enforce HQ tier location limits.
 */
async function countActiveLocations(parentTenantId) {
  const r = await db.query(
    `SELECT COUNT(*) AS count
       FROM tenants
      WHERE parent_id = $1
        AND location_removed_at IS NULL`,
    [parentTenantId]
  );
  return parseInt(r.rows[0].count, 10) || 0;
}

/**
 * List all active children under a parent.
 * Returns full tenant rows.
 */
async function listActiveLocations(parentTenantId) {
  const r = await db.query(
    `SELECT *
       FROM tenants
      WHERE parent_id = $1
        AND location_removed_at IS NULL
      ORDER BY created_at ASC`,
    [parentTenantId]
  );
  return r.rows;
}

// ═════════════════════════════════════════════════════════════════════════
// ENFORCEMENT (called from routes before creating a location)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Validate that this parent CAN add another location right now.
 * Throws an error with a user-facing message if not. Returns true if OK.
 *
 * Checks (in order):
 *   1. Parent must be allowed to add locations (Pro+ for operating_hq, any
 *      HQ tier for rollup_only — see canAddLocations in lib/plans.js)
 *   2. Parent must not be at its HQ tier location limit
 *   3. Parent must have an active subscription (paying or trialing)
 *
 * @param {object} parentTenant - Full tenant row
 * @throws {Error} with .statusCode property (400/402/403) for clean route handling
 */
async function enforceCanAddLocation(parentTenant) {
  if (!parentTenant) {
    const err = new Error("Parent tenant not found");
    err.statusCode = 404;
    throw err;
  }

  // 1. Plan-level gate
  if (!canAddLocations(parentTenant)) {
    const err = new Error(
      parentTenant.parent_mode === "rollup_only"
        ? "This account is not on an HQ plan. Contact support to enable franchise rollup."
        : "Multi-location support requires a Pro or Elite plan. Upgrade your plan to add locations."
    );
    err.statusCode = 403;
    throw err;
  }

  // 2. Location limit (relevant for HQ tiers)
  const limit = getLocationLimit(parentTenant);
  if (Number.isFinite(limit)) {
    const current = await countActiveLocations(parentTenant.id);
    if (current >= limit) {
      const err = new Error(
        `Your ${getPlan(parentTenant.plan).name} plan supports up to ${limit} locations. ` +
        `You currently have ${current}. Upgrade your HQ plan to add more.`
      );
      err.statusCode = 403;
      throw err;
    }
  }

  // 3. Subscription must be active
  const status = parentTenant.subscription_status;
  if (!["active", "trialing"].includes(status)) {
    const err = new Error(
      "Your subscription must be active to add locations. Update billing first."
    );
    err.statusCode = 402;
    throw err;
  }

  return true;
}

// ═════════════════════════════════════════════════════════════════════════
// PRORATED PREVIEW (powers the "Add Location" modal)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Calculate what adding ONE more parent_pays location will cost the parent.
 *
 * Returns:
 *   - locationRateCents: monthly recurring cost for this location
 *   - locationRateAnnualCents: annual equivalent (for display)
 *   - proratedTodayCents: charged immediately on Stripe (today through
 *     end of current period, prorated)
 *   - newRecurringMonthlyCents: parent's NEW total monthly recurring after
 *     this location is added (base plan + ALL location line items)
 *   - nextChargeDate: ISO string when the next FULL charge happens
 *   - nextChargeAmountCents: that next charge amount
 *   - currentPeriodEnd: ISO string of current period end
 *   - interval: 'monthly' | 'annual' (matches parent's subscription)
 *
 * If self_pays is being added, all parent-side costs are 0 (franchisee
 * owns the bill). Caller should still show the franchisee what they'll pay
 * via a separate preview using the child plan rate.
 *
 * @param {object} parentTenant
 * @param {string} childBillingResponsibility - 'parent_pays' | 'self_pays'
 * @param {string} childPlan - relevant only for rollup_only + parent_pays;
 *                             for operating_hq this is ignored (50% of parent)
 * @returns {Promise<object>}
 */
async function calculateProratedPreview(
  parentTenant,
  childBillingResponsibility = "parent_pays",
  childPlan = null
) {
  // Build a hypothetical "child" object just for rate calc
  const hypotheticalChild = {
    billing_responsibility: childBillingResponsibility,
    plan: childPlan || "pro",
    locations_monthly_rate_cents: null,
    locations_annual_rate_cents: null,
    plan_monthly_override_cents: null,
    plan_annual_override_cents: null,
  };

  const interval = parentTenant.billing_interval || "monthly";

  // Self-pays: parent pays nothing. Return zeros.
  if (childBillingResponsibility === "self_pays") {
    return {
      locationRateCents: 0,
      locationRateAnnualCents: 0,
      proratedTodayCents: 0,
      newRecurringMonthlyCents: getEffectivePlanRateCents(parentTenant, "monthly"),
      newRecurringIntervalCents: getEffectivePlanRateCents(parentTenant, interval),
      nextChargeDate: null,
      nextChargeAmountCents: 0,
      currentPeriodEnd: null,
      interval,
      childPays: true,
      childPaysAmountMonthlyCents: getEffectivePlanRateCents(hypotheticalChild, "monthly"),
      childPaysAmountIntervalCents: getEffectivePlanRateCents(hypotheticalChild, interval),
    };
  }

  // Parent-pays branch
  const locationRateMonthly = getChildLocationCostCents(parentTenant, hypotheticalChild, "monthly");
  const locationRateAnnualPerMonth = getChildLocationCostCents(parentTenant, hypotheticalChild, "annual");
  const locationRateAnnualTotal = locationRateAnnualPerMonth * 12;

  // Parent's existing monthly recurring (base plan + existing location line items)
  const existingLocations = await listActiveLocations(parentTenant.id);
  const existingLocationCostMonthly = existingLocations.reduce((sum, child) => {
    return sum + getChildLocationCostCents(parentTenant, child, "monthly");
  }, 0);
  const baseRateMonthly = getEffectivePlanRateCents(parentTenant, "monthly");
  const newRecurringMonthlyCents = baseRateMonthly + existingLocationCostMonthly + locationRateMonthly;

  // Same calc but at the parent's actual billing interval (for the "next charge" display)
  const baseRateInterval = getEffectivePlanRateCents(parentTenant, interval);
  const existingLocationCostInterval = existingLocations.reduce((sum, child) => {
    return sum + getChildLocationCostCents(parentTenant, child, interval);
  }, 0);
  const locationRateInterval = getChildLocationCostCents(parentTenant, hypotheticalChild, interval);
  const newRecurringIntervalCents = baseRateInterval + existingLocationCostInterval + locationRateInterval;

  // Get prorated charge from Stripe's upcoming invoice API (most accurate)
  // Falls back to manual calc if Stripe is unavailable or parent has no sub.
  let proratedTodayCents = 0;
  let nextChargeDate = null;
  let nextChargeAmountCents = newRecurringIntervalCents;
  let currentPeriodEnd = null;

  if (stripe && parentTenant.stripe_subscription_id) {
    try {
      const subscription = await stripe.subscriptions.retrieve(parentTenant.stripe_subscription_id);
      currentPeriodEnd = new Date(subscription.current_period_end * 1000).toISOString();
      nextChargeDate = currentPeriodEnd;

      // Manual proration calculation (we don't actually create the price yet,
      // so we can't ask Stripe for a definitive upcoming invoice). Use the
      // same formula Stripe uses: rate * (seconds_remaining / period_seconds).
      const now = Math.floor(Date.now() / 1000);
      const periodStart = subscription.current_period_start;
      const periodEnd = subscription.current_period_end;
      const periodSeconds = periodEnd - periodStart;
      const remainingSeconds = Math.max(0, periodEnd - now);
      const prorationRatio = periodSeconds > 0 ? remainingSeconds / periodSeconds : 0;

      // For monthly interval, prorate the monthly rate.
      // For annual interval, prorate the annual rate (much bigger number).
      const rateToProrate = interval === "annual"
        ? locationRateAnnualTotal
        : locationRateMonthly;
      proratedTodayCents = Math.round(rateToProrate * prorationRatio);
    } catch (err) {
      console.error("[locationBilling] Stripe preview error, falling back to manual:", err.message);
      // Fall through to manual fallback
    }
  }

  // Manual fallback if no Stripe sub or Stripe call failed
  if (!nextChargeDate) {
    // Assume next charge is 30 days out (rough)
    const next = new Date();
    next.setDate(next.getDate() + 30);
    nextChargeDate = next.toISOString();
    proratedTodayCents = locationRateMonthly; // charge full month if we can't prorate
  }

  return {
    locationRateCents: locationRateMonthly,
    locationRateAnnualCents: locationRateAnnualTotal,
    proratedTodayCents,
    newRecurringMonthlyCents,
    newRecurringIntervalCents,
    nextChargeDate,
    nextChargeAmountCents,
    currentPeriodEnd,
    interval,
    childPays: false,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// STRIPE SYNC (parent_pays children only)
// ═════════════════════════════════════════════════════════════════════════

/**
 * Create or update the Stripe subscription line item for a parent_pays child.
 *
 * For each parent_pays child, we maintain a dedicated subscription item on
 * the parent's subscription with quantity=1 and a per-tenant ad-hoc price.
 * (One line item per child, not one item with quantity=N, because each
 * child can have a different override rate.)
 *
 * Why per-tenant prices: each parent's 50% rate is different (Basic parent
 * = $148.50/mo per location, Pro parent = $248.50/mo per location, plus
 * override variations). Single shared price IDs would not work.
 *
 * Stores the resulting subscription item ID + price ID on the CHILD's row
 * so future syncs can update or cancel without recreating.
 *
 * @param {object} parentTenant - Full parent row
 * @param {object} childTenant - Full child row (must have id, billing_responsibility,
 *                               and any rate override columns set)
 * @returns {Promise<{ ok: boolean, subscriptionItemId?: string, priceId?: string }>}
 */
async function addChildToParentSubscription(parentTenant, childTenant) {
  if (!stripe) {
    return { ok: false, reason: "stripe_not_configured" };
  }
  if (!parentTenant.stripe_subscription_id) {
    return { ok: false, reason: "parent_no_subscription" };
  }
  if (childTenant.billing_responsibility === "self_pays") {
    return { ok: false, reason: "child_self_pays_skip_parent_sub" };
  }

  const interval = parentTenant.billing_interval || "monthly";

  // Calculate the recurring price (in cents per BILLING period)
  let unitAmount;
  let recurringInterval;
  if (interval === "annual") {
    unitAmount = getChildLocationCostCentsAnnualTotal(parentTenant, childTenant);
    recurringInterval = "year";
  } else {
    unitAmount = getChildLocationCostCents(parentTenant, childTenant, "monthly");
    recurringInterval = "month";
  }

  if (unitAmount <= 0) {
    return { ok: false, reason: "invalid_rate_calculated" };
  }

  try {
    // Create a per-child ad-hoc price under a per-parent product
    // Product is named after the parent for clean billing statements
    const parentName = parentTenant.company_name || parentTenant.name || "Parent";
    const childName = childTenant.company_name || childTenant.name || "Location";

    const price = await stripe.prices.create({
      unit_amount: unitAmount,
      currency: "usd",
      recurring: { interval: recurringInterval },
      product_data: {
        name: `${parentName} — Location: ${childName}`,
        metadata: {
          parent_tenant_id: parentTenant.id,
          child_tenant_id: childTenant.id,
          type: "location_billing",
        },
      },
    });

    // Add as a new subscription item (quantity=1, prorated to current period)
    const subscriptionItem = await stripe.subscriptionItems.create({
      subscription: parentTenant.stripe_subscription_id,
      price: price.id,
      quantity: 1,
      proration_behavior: "create_prorations",
      metadata: {
        parent_tenant_id: parentTenant.id,
        child_tenant_id: childTenant.id,
        type: "location_billing",
      },
    });

    // Persist the IDs on the child row for future updates/removal
    await db.query(
      `UPDATE tenants
          SET parent_location_stripe_item_id = $1,
              parent_location_stripe_price_id = $2,
              updated_at = now()
        WHERE id = $3`,
      [subscriptionItem.id, price.id, childTenant.id]
    );

    console.log(
      "[locationBilling] Added child %s to parent %s subscription. itemId=%s priceId=%s amount=%d cents/%s",
      childTenant.id,
      parentTenant.id,
      subscriptionItem.id,
      price.id,
      unitAmount,
      recurringInterval
    );

    return {
      ok: true,
      subscriptionItemId: subscriptionItem.id,
      priceId: price.id,
      unitAmount,
      interval: recurringInterval,
    };
  } catch (err) {
    console.error(
      "[locationBilling] addChildToParentSubscription failed parent=%s child=%s error=%s",
      parentTenant.id,
      childTenant.id,
      err.message
    );
    return { ok: false, reason: "stripe_error", error: err.message };
  }
}

/**
 * Remove a parent_pays child's line item from the parent's Stripe subscription.
 *
 * Per Apr 19 spec: NO refund, NO proration credit. Item is deleted with
 * proration_behavior='none' so the parent doesn't get any money back for
 * the remainder of the current period (already paid).
 *
 * The CHILD tenant is NOT deleted here — that's the route's job (set
 * location_removed_at + retention timestamp). This function only handles
 * Stripe cleanup.
 *
 * @param {object} childTenant - Must have parent_location_stripe_item_id set
 * @returns {Promise<{ ok: boolean }>}
 */
async function removeChildFromParentSubscription(childTenant) {
  if (!stripe) return { ok: false, reason: "stripe_not_configured" };
  if (!childTenant.parent_location_stripe_item_id) {
    // Child was never on parent's sub (self_pays or sync never ran)
    return { ok: true, skipped: true, reason: "no_parent_item" };
  }

  try {
    await stripe.subscriptionItems.del(childTenant.parent_location_stripe_item_id, {
      proration_behavior: "none", // No refund — active till period end
    });

    // Clear the IDs on the child row
    await db.query(
      `UPDATE tenants
          SET parent_location_stripe_item_id = NULL,
              parent_location_stripe_price_id = NULL,
              updated_at = now()
        WHERE id = $1`,
      [childTenant.id]
    );

    console.log(
      "[locationBilling] Removed child %s from parent subscription. itemId=%s",
      childTenant.id,
      childTenant.parent_location_stripe_item_id
    );

    return { ok: true };
  } catch (err) {
    // If item already deleted in Stripe (404), still clear our DB pointers
    if (err.statusCode === 404 || /No such subscription_item/i.test(err.message)) {
      await db.query(
        `UPDATE tenants
            SET parent_location_stripe_item_id = NULL,
                parent_location_stripe_price_id = NULL,
                updated_at = now()
          WHERE id = $1`,
        [childTenant.id]
      );
      console.warn(
        "[locationBilling] Child %s sub item already gone in Stripe. Cleared local pointers.",
        childTenant.id
      );
      return { ok: true, alreadyGone: true };
    }
    console.error(
      "[locationBilling] removeChildFromParentSubscription failed child=%s error=%s",
      childTenant.id,
      err.message
    );
    return { ok: false, reason: "stripe_error", error: err.message };
  }
}

/**
 * Update the price on an existing parent_pays child's subscription item.
 * Called when superadmin changes a per-location override rate.
 *
 * Stripe doesn't let you change the unit_amount on an existing price, so
 * we create a NEW price and swap the subscription item to point at it.
 * The OLD price stays in Stripe (orphaned) for billing history. The NEW
 * price's ID gets stored on the child row.
 *
 * Proration behavior: 'create_prorations' so the parent gets billed/credited
 * fairly for the rate change mid-period. (Different from removal, which is
 * 'none' per spec.)
 */
/**
 * Record the outcome of a Stripe sync attempt on the child tenant row.
 * Single source of truth for the stripe_sync_status column so the rollup
 * endpoint + UI retry button share the same truth.
 *
 * @param {string} childTenantId
 * @param {{ ok: boolean, error?: string, reason?: string }} syncResult
 *        The return value from addChildToParentSubscription,
 *        updateChildSubscriptionRate, or removeChildFromParentSubscription.
 * @param {object} [opts]
 * @param {boolean} [opts.clearOnSuccess=true] - On ok=true, null out the
 *        error message. Set false if you want to preserve history (rare).
 */
async function recordSyncStatus(childTenantId, syncResult, opts = {}) {
  const { clearOnSuccess = true } = opts;
  const status = syncResult?.ok ? "synced" : "failed";
  const errorMsg = syncResult?.ok
    ? (clearOnSuccess ? null : undefined)
    : (syncResult?.error || syncResult?.reason || "Unknown Stripe error");

  if (errorMsg === undefined) {
    await db.query(
      `UPDATE tenants
          SET stripe_sync_status = $1,
              stripe_sync_last_attempted_at = now(),
              updated_at = now()
        WHERE id = $2`,
      [status, childTenantId]
    );
  } else {
    await db.query(
      `UPDATE tenants
          SET stripe_sync_status = $1,
              stripe_sync_error = $2,
              stripe_sync_last_attempted_at = now(),
              updated_at = now()
        WHERE id = $3`,
      [status, errorMsg, childTenantId]
    );
  }

  // Notification side-effect (Apr 20, 2026): ping parent's bell on fresh
  // failure. Helper handles its own 24h dedup so retries/page loads don't
  // spam. Wrapped + non-blocking — notifications must NEVER break sync.
  if (!syncResult?.ok) {
    try {
      const childRow = await db.query(
        "SELECT parent_id, name, company_name FROM tenants WHERE id = $1",
        [childTenantId]
      );
      const child = childRow.rows[0];
      if (child?.parent_id) {
        const notificationService = require("../services/notifications");
        notificationService.notifyStripeSyncFailed(child.parent_id, {
          child_tenant_id: childTenantId,
          child_name:      child.company_name || child.name,
          error_message:   errorMsg,
        }).catch((e) =>
          console.error("[locationBilling] notifyStripeSyncFailed failed:", e.message)
        );
      }
    } catch (err) {
      console.error("[locationBilling] notification lookup failed:", err.message);
    }
  }
}
async function updateChildSubscriptionRate(parentTenant, childTenant) {
  if (!stripe) return { ok: false, reason: "stripe_not_configured" };
  if (!childTenant.parent_location_stripe_item_id) {
    // No existing item — create one fresh
    return addChildToParentSubscription(parentTenant, childTenant);
  }
  if (childTenant.billing_responsibility === "self_pays") {
    return { ok: false, reason: "child_self_pays_skip_parent_sub" };
  }

  const interval = parentTenant.billing_interval || "monthly";
  let unitAmount;
  let recurringInterval;
  if (interval === "annual") {
    unitAmount = getChildLocationCostCentsAnnualTotal(parentTenant, childTenant);
    recurringInterval = "year";
  } else {
    unitAmount = getChildLocationCostCents(parentTenant, childTenant, "monthly");
    recurringInterval = "month";
  }

  if (unitAmount <= 0) {
    return { ok: false, reason: "invalid_rate_calculated" };
  }

  try {
    const parentName = parentTenant.company_name || parentTenant.name || "Parent";
    const childName = childTenant.company_name || childTenant.name || "Location";

    const newPrice = await stripe.prices.create({
      unit_amount: unitAmount,
      currency: "usd",
      recurring: { interval: recurringInterval },
      product_data: {
        name: `${parentName} — Location: ${childName} (Updated)`,
        metadata: {
          parent_tenant_id: parentTenant.id,
          child_tenant_id: childTenant.id,
          type: "location_billing",
        },
      },
    });

    await stripe.subscriptionItems.update(childTenant.parent_location_stripe_item_id, {
      price: newPrice.id,
      proration_behavior: "create_prorations",
    });

    await db.query(
      `UPDATE tenants
          SET parent_location_stripe_price_id = $1,
              updated_at = now()
        WHERE id = $2`,
      [newPrice.id, childTenant.id]
    );

    console.log(
      "[locationBilling] Updated child %s rate. newPriceId=%s amount=%d cents/%s",
      childTenant.id,
      newPrice.id,
      unitAmount,
      recurringInterval
    );

    return { ok: true, priceId: newPrice.id, unitAmount, interval: recurringInterval };
  } catch (err) {
    console.error(
      "[locationBilling] updateChildSubscriptionRate failed child=%s error=%s",
      childTenant.id,
      err.message
    );
    return { ok: false, reason: "stripe_error", error: err.message };
  }
}

module.exports = {
  // Rate calculation
  getChildLocationCostCents,
  getChildLocationCostCentsAnnualTotal,

  // Queries
  countActiveLocations,
  listActiveLocations,

  // Enforcement
  enforceCanAddLocation,

  // Preview
  calculateProratedPreview,

  // Stripe sync
  addChildToParentSubscription,
  removeChildFromParentSubscription,
  updateChildSubscriptionRate,
   recordSyncStatus,
};

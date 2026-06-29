"use strict";

/**
 * lib/addonAccess.js
 *
 * Single source of truth for the Reviews / GBP add-on access gate.
 *
 * The $29/mo "Reviews" add-on unlocks the full Google Business Profile suite:
 *   - Review reply drafting (routes/reviews.js)
 *   - GBP gap audit, AI posting, and performance (routes/gbp.js)
 *
 * Both route files import hasReviewsAccess() from here so the gate can never
 * drift between them. If you later split into a higher "Full GBP Suite" tier,
 * change ONLY this file (add a gbp_suite override key) — no route edits.
 *
 * Access is granted when EITHER:
 *   - tenant.plan === "elite"  (Elite plan bundles all add-ons), OR
 *   - plan_overrides.reviews_addon / plan_overrides.reviews is truthy
 */

function hasReviewsAccess(tenant) {
  if (!tenant) return false;
  if (tenant.plan === "elite") return true;
  const overrides = tenant.plan_overrides || {};
  return !!(overrides.reviews_addon || overrides.reviews);
}

module.exports = { hasReviewsAccess };

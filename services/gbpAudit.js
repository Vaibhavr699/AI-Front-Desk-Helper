"use strict";

/**
 * services/gbpAudit.js
 *
 * GBP Traction — G1: Gap Audit (read-only).
 *
 * Reads a tenant's connected Google Business Profile via the Business
 * Information API, scores completeness/health, and writes a prioritized
 * gap snapshot into the gbp_audit table (mig 107).
 *
 * ── Auth model ─────────────────────────────────────────────────────────────
 * Reuses the EXACT auth path the Reviews integration already uses. We do not
 * write any new token-refresh logic — lib/reviewsHelper.js owns that. We pull
 * its internal authedRequest via a thin re-export (see getAuthedRequest()).
 *
 * Tokens + resource names live on the tenants row, written by the Reviews
 * OAuth flow under the SAME scope (business.manage), which already authorizes
 * everything below — no new consent required:
 *   google_access_token / google_refresh_token / google_token_expiry
 *   google_account_id   (full "accounts/12345" string)
 *   google_location_id  (full "locations/67890" string)
 *
 * ── APIs used ──────────────────────────────────────────────────────────────
 * Business Information (read profile):
 *   GET mybusinessbusinessinformation.googleapis.com/v1/{location}?readMask=...
 * Media (photo count):
 *   GET mybusiness.googleapis.com/v4/{account}/{location}/media
 *
 * Read-only: this service NEVER writes to Google. Zero risk to the live
 * profile. Verifiable against the real Gladiators profile immediately.
 */

const db = require("../lib/db");
const reviewsHelper = require("../lib/reviewsHelper");

const BIZ_INFO_BASE  = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LEGACY_V4_BASE = "https://mybusiness.googleapis.com/v4";

// readMask for the location fields we score. Keep this explicit — the
// Business Information API REQUIRES a readMask and rejects unknown fields,
// so every field here must be a real GBP location field.
const LOCATION_READ_MASK = [
  "name",
  "title",
  "storefrontAddress",
  "phoneNumbers",
  "categories",
  "websiteUri",
  "regularHours",
  "specialHours",
  "profile",            // the business description
  "serviceArea",
  "labels",
  "latlng",
  "openInfo",
  "serviceItems",
].join(",");

/**
 * Pull the tenant row with the Google credential + resource-name columns.
 * Mirrors routes/reviews.js getTenantWithGoogle so behavior is identical.
 */
async function getTenantWithGoogle(tenantId) {
  const res = await db.query(
    `SELECT id, name, company_name, city, state,
            google_access_token, google_refresh_token, google_token_expiry,
            google_location_id, google_account_id
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

/**
 * Thin accessor for reviewsHelper's authed request path.
 *
 * reviewsHelper does not export authedRequest directly (it's internal), so
 * we reconstruct the SAME behavior by leaning on its public surface where we
 * can. To avoid duplicating token logic, we expose authedRequest by calling
 * through a tiny shim: reviewsHelper must export `authedRequest`. If it does
 * not yet, add it to module.exports there (one-line change) — see NOTE below.
 *
 * NOTE FOR DEPLOY: add `authedRequest` to lib/reviewsHelper.js exports:
 *     module.exports = { ...existing, authedRequest };
 * This is the only edit required to lib/reviewsHelper.js. It exposes the
 * already-written helper without changing any behavior.
 */
function getAuthedRequest() {
  if (typeof reviewsHelper.authedRequest !== "function") {
    throw new Error(
      "[GBP Audit] reviewsHelper.authedRequest is not exported. Add `authedRequest` " +
      "to module.exports in lib/reviewsHelper.js (one-line change, no behavior change)."
    );
  }
  return reviewsHelper.authedRequest;
}

/**
 * Fetch the raw GBP location profile + photo count for a connected tenant.
 * Returns { profile, photoCount } or throws on hard failure.
 */
async function fetchProfile(tenant) {
  const authedRequest = getAuthedRequest();

  if (!tenant.google_location_id) {
    throw new Error("[GBP Audit] tenant " + tenant.id + " has no google_location_id");
  }

  // 1. Location detail (Business Information API). google_location_id is the
  //    full "locations/67890" string, so the path is BASE/{location}.
  const locUrl = `${BIZ_INFO_BASE}/${tenant.google_location_id}`;
  const locRes = await authedRequest(tenant, "GET", locUrl, {
    params: { readMask: LOCATION_READ_MASK },
  });
  const profile = locRes.data || {};

  // 2. Photo count via legacy v4 media list (best-effort — never fail the
  //    whole audit if media can't be read; just report photoCount = null).
  let photoCount = null;
  if (tenant.google_account_id && tenant.google_location_id) {
    try {
      const mediaUrl = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/media`;
      const mediaRes = await authedRequest(tenant, "GET", mediaUrl, {
        params: { pageSize: 100 },
      });
      const items = mediaRes.data?.mediaItems || [];
      photoCount = items.length;
    } catch (e) {
      console.warn("[GBP Audit] media list failed tenant=%s: %s", tenant.id, e.message);
      photoCount = null;
    }
  }

  return { profile, photoCount };
}

/**
 * Score the profile into a 0-100 health score + a prioritized gap list.
 *
 * Each gap: { key, severity ('high'|'medium'|'low'), label, advice, weight }.
 * Score = 100 - sum(weight of present gaps), floored at 0. Weights are tuned
 * so the ranking signals (posts, photos, completeness) dominate.
 */
function scoreProfile({ profile, photoCount }) {
  const gaps = [];
  const add = (key, severity, weight, label, advice) =>
    gaps.push({ key, severity, weight, label, advice });

  // --- Categories ---
  const categories = profile.categories || {};
  const primary = categories.primaryCategory;
  const additional = categories.additionalCategories || [];
  if (!primary) {
    add("primary_category", "high", 15,
      "No primary category set",
      "Set a primary category that matches your core service — it's one of the strongest ranking signals.");
  }
  if (additional.length === 0) {
    add("additional_categories", "low", 4,
      "No additional categories",
      "Add 2-3 secondary categories for the services you offer to surface in more searches.");
  }

  // --- Description (profile.description) ---
  const description = (profile.profile && profile.profile.description) || "";
  if (!description.trim()) {
    add("description", "medium", 10,
      "Business description is empty",
      "Write a 500-750 character description covering your services, service area, and what sets you apart.");
  } else if (description.trim().length < 250) {
    add("description_thin", "low", 5,
      "Business description is thin",
      "Expand the description toward 500-750 characters — fuller profiles rank better and convert more.");
  }

  // --- Hours ---
  const regularHours = profile.regularHours;
  const hasHours = regularHours && Array.isArray(regularHours.periods) && regularHours.periods.length > 0;
  if (!hasHours) {
    add("hours", "high", 12,
      "Business hours not set",
      "Add regular hours. Missing hours suppresses ranking and erodes customer trust.");
  }

  // --- Phone ---
  const phones = profile.phoneNumbers || {};
  if (!phones.primaryPhone) {
    add("phone", "high", 10,
      "No primary phone number",
      "Add a primary phone — without it, call-tracking and click-to-call are lost.");
  }

  // --- Website ---
  if (!profile.websiteUri) {
    add("website", "medium", 8,
      "No website URL",
      "Add your website (or a branded booking page) — website clicks are a tracked interaction that feeds ranking.");
  }

  // --- Photos ---
  if (photoCount === 0) {
    add("photos_none", "high", 12,
      "No photos on the profile",
      "Upload real job and team photos. Profiles with 10+ photos get materially more views and calls.");
  } else if (photoCount !== null && photoCount < 10) {
    add("photos_few", "medium", 7,
      `Only ${photoCount} photo${photoCount === 1 ? "" : "s"} on the profile`,
      "Add real job/team photos to reach 10+ — photo views are a 2026 ranking input.");
  }

  // --- Service area / service items ---
  const serviceItems = profile.serviceItems || [];
  if (serviceItems.length === 0) {
    add("services", "medium", 8,
      "No services listed",
      "List your specific services. Service listings help you match more searches and show pricing intent.");
  }

  // --- Open status ---
  const openInfo = profile.openInfo || {};
  if (openInfo.status && openInfo.status !== "OPEN") {
    add("open_status", "high", 10,
      `Profile open status is ${openInfo.status}`,
      "Your profile is not marked OPEN — this can hide you from search entirely. Resolve in the GBP dashboard.");
  }

  const totalWeight = gaps.reduce((s, g) => s + g.weight, 0);
  const healthScore = Math.max(0, 100 - totalWeight);

  // Sort gaps by severity then weight, so the UI shows the highest-impact first.
  const sevRank = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => (sevRank[a.severity] - sevRank[b.severity]) || (b.weight - a.weight));

  // Strip internal weight from the persisted gap objects (keep it out of the UI).
  const publicGaps = gaps.map(({ weight, ...rest }) => rest);

  const snapshot = {
    title: profile.title || null,
    primary_category: primary ? (primary.displayName || primary.name) : null,
    additional_category_count: additional.length,
    has_hours: hasHours,
    has_phone: !!phones.primaryPhone,
    has_website: !!profile.websiteUri,
    description_length: description.trim().length,
    photo_count: photoCount,
    service_item_count: serviceItems.length,
    open_status: openInfo.status || null,
  };

  return { healthScore, gaps: publicGaps, snapshot };
}

/**
 * Run the audit for one tenant: fetch → score → upsert gbp_audit.
 * Returns { ok, healthScore, gapCount } or { ok:false, reason }.
 * Never throws — returns a structured error so callers/routes can branch.
 */
async function runAuditForTenant(tenantId) {
  let tenant;
  try {
    tenant = await getTenantWithGoogle(tenantId);
  } catch (e) {
    return { ok: false, reason: "db_error", message: e.message };
  }
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const connected = !!(tenant.google_access_token && tenant.google_location_id);
  if (!connected) return { ok: false, reason: "not_connected" };

  let fetched;
  try {
    fetched = await fetchProfile(tenant);
  } catch (e) {
    console.error("[GBP Audit] fetchProfile failed tenant=%s: %s", tenantId, e.message);
    return { ok: false, reason: "fetch_failed", message: e.message };
  }

  const { healthScore, gaps, snapshot } = scoreProfile(fetched);

  try {
    await db.query(
      `INSERT INTO gbp_audit (tenant_id, health_score, gaps, profile_snapshot, generated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (tenant_id)
       DO UPDATE SET health_score     = EXCLUDED.health_score,
                     gaps             = EXCLUDED.gaps,
                     profile_snapshot = EXCLUDED.profile_snapshot,
                     generated_at     = now()`,
      [tenantId, healthScore, JSON.stringify(gaps), JSON.stringify(snapshot)]
    );
  } catch (e) {
    console.error("[GBP Audit] gbp_audit upsert failed tenant=%s: %s", tenantId, e.message);
    return { ok: false, reason: "persist_failed", message: e.message };
  }

  console.log("[GBP Audit] tenant=%s score=%d gaps=%d", tenantId, healthScore, gaps.length);
  return { ok: true, healthScore, gapCount: gaps.length, gaps, snapshot };
}

module.exports = {
  runAuditForTenant,
  // exported for unit testing / reuse
  scoreProfile,
  fetchProfile,
};

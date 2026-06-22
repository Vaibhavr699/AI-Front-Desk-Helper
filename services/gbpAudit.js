"use strict";

/**
 * services/gbpAudit.js
 *
 * GBP Traction — G1: read-only profile audit + health score.
 *
 * Reads the tenant's live Google Business Profile via the Business
 * Information API (profile fields), the legacy v4 media endpoint (photos),
 * and the legacy v4 localPosts + reviews endpoints (activity/freshness).
 * Computes a 0-100 health score and a prioritized list of gaps, then upserts
 * one row per tenant into gbp_audit (mig 107).
 *
 * ── Scoring philosophy (Path A, Jun 2026) ──────────────────────────────────
 * Presence alone is not health. A profile can have hours, phone, website,
 * a category, and a description and still rank poorly because it is STALE —
 * no recent posts, old photos, unanswered reviews. The 2026 local algorithm
 * (and the LLM answer engines that read the GBP feed) weight *activity and
 * freshness*, not just completeness. So the score blends:
 *
 *   Presence   (50 pts) — the static fields that must exist
 *   Freshness  (50 pts) — post recency, photo recency, review-response rate
 *
 * This is deliberate: it lets the audit look at an otherwise-perfect profile
 * (e.g. Gladiators, complete on every static field) and still say
 * "you haven't posted in 30 days" — which is exactly the gap the posting
 * feature (G2) closes. The audit is the on-ramp to posting.
 *
 * Auth/billing: callers (routes/gbp.js) gate on hasReviewsAccess BEFORE
 * calling. This service reuses reviewsHelper.authedRequest for token refresh
 * + 401 retry — the same path the Reviews integration uses.
 */

const db = require("../lib/db");
const reviewsHelper = require("../lib/reviewsHelper");

const BIZ_INFO_BASE  = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LEGACY_V4_BASE = "https://mybusiness.googleapis.com/v4";

// readMask for locations.get — only fields we actually score on. Keeping this
// tight avoids "invalid field mask" errors and unnecessary payload.
const LOCATION_READ_MASK = [
  "name",
  "title",
  "phoneNumbers",
  "categories",
  "websiteUri",
  "regularHours",
  "profile",            // description lives at profile.description
  "serviceItems",
  "storefrontAddress",
  "serviceArea",
].join(",");

// Freshness thresholds (days). Past these, the axis loses points.
const POST_STALE_DAYS  = 14;   // a post older than this = losing freshness
const POST_DEAD_DAYS   = 30;   // no post in 30 days = zero post-freshness
const PHOTO_STALE_DAYS = 90;   // newest photo older than this starts losing pts
const PHOTO_DEAD_DAYS  = 180;

function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

/**
 * Load the tenant with the Google columns authedRequest + the API calls need.
 */
async function loadTenant(tenantId) {
  const res = await db.query(
    `SELECT id, name, company_name,
            google_access_token, google_refresh_token, google_token_expiry,
            google_account_id, google_location_id
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

/**
 * Read the core profile (Business Information API). Returns the raw location
 * object, or throws (caller maps to fetch_failed).
 */
async function fetchLocation(tenant) {
  // google_location_id is the full "locations/12345" resource name.
  const url = `${BIZ_INFO_BASE}/${tenant.google_location_id}`;
  const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
    params: { readMask: LOCATION_READ_MASK },
  });
  return res.data || {};
}

/**
 * Photo inventory + recency via the legacy v4 media endpoint.
 * Returns { count, newestDays }. Best-effort: { count: 0, newestDays: Infinity }
 * on any failure so a media hiccup never sinks the whole audit.
 */
async function fetchPhotos(tenant) {
  try {
    const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/media`;
    const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
      params: { pageSize: 100 },
    });
    const items = res.data?.mediaItems || [];
    let newest = Infinity;
    for (const m of items) {
      // createTime is the upload time on MediaItem.
      const d = daysSince(m.createTime);
      if (d < newest) newest = d;
    }
    return { count: items.length, newestDays: newest };
  } catch (e) {
    console.warn("[GBP Audit] media fetch failed tenant=%s: %s", tenant.id, e.message);
    return { count: 0, newestDays: Infinity };
  }
}

/**
 * Most-recent localPost recency via legacy v4. Returns { count, newestDays }.
 * Best-effort. This is the single most important freshness signal.
 */
async function fetchPosts(tenant) {
  try {
    const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/localPosts`;
    const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
      params: { pageSize: 20 },
    });
    const items = res.data?.localPosts || [];
    let newest = Infinity;
    for (const p of items) {
      const d = daysSince(p.createTime || p.updateTime);
      if (d < newest) newest = d;
    }
    return { count: items.length, newestDays: newest };
  } catch (e) {
    console.warn("[GBP Audit] localPosts fetch failed tenant=%s: %s", tenant.id, e.message);
    return { count: 0, newestDays: Infinity };
  }
}

/**
 * Review-response rate via legacy v4 reviews. Returns
 * { total, replied, unanswered, rate } where rate is replied/total (1 if no
 * reviews — nothing to answer = no penalty). Best-effort.
 */
async function fetchReviewResponse(tenant) {
  try {
    const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/reviews`;
    const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
      params: { pageSize: 50 },
    });
    const reviews = res.data?.reviews || [];
    const total = reviews.length;
    if (total === 0) return { total: 0, replied: 0, unanswered: 0, rate: 1 };
    let replied = 0;
    for (const r of reviews) if (r.reviewReply) replied++;
    return { total, replied, unanswered: total - replied, rate: replied / total };
  } catch (e) {
    console.warn("[GBP Audit] reviews fetch failed tenant=%s: %s", tenant.id, e.message);
    // Unknown — treat as no penalty rather than punishing on an API error.
    return { total: 0, replied: 0, unanswered: 0, rate: 1 };
  }
}

/**
 * Build the snapshot + score + gaps from the raw reads.
 *
 * Score = Presence (50) + Freshness (50).
 *   Presence: phone(8) website(8) hours(8) description≥80(8)
 *             primaryCategory(10) ≥1 service item(8)  = 50
 *   Freshness: post recency(22) photo recency(14) review-response(14) = 50
 */
function buildAuditFromReads(location, photos, posts, reviewResp) {
  const gaps = [];

  // ── Presence axis ────────────────────────────────────────────────────────
  const phoneNumbers = location.phoneNumbers || {};
  const hasPhone = !!(phoneNumbers.primaryPhone && String(phoneNumbers.primaryPhone).trim());
  const hasWebsite = !!(location.websiteUri && String(location.websiteUri).trim());
  const regularHours = location.regularHours || null;
  const hasHours = !!(regularHours && Array.isArray(regularHours.periods) && regularHours.periods.length > 0);
  const description = (location.profile && location.profile.description) || "";
  const descriptionLength = description.length;
  const hasGoodDescription = descriptionLength >= 80;
  const categories = location.categories || {};
  const primaryCategory = categories.primaryCategory ? (categories.primaryCategory.displayName || categories.primaryCategory.name || null) : null;
  const additionalCategoryCount = Array.isArray(categories.additionalCategories) ? categories.additionalCategories.length : 0;
  const hasPrimaryCategory = !!primaryCategory;
  const serviceItems = Array.isArray(location.serviceItems) ? location.serviceItems : [];
  const serviceItemCount = serviceItems.length;
  const hasServiceItems = serviceItemCount >= 1;

  let presence = 0;
  if (hasPhone) presence += 8; else gaps.push({ key: "phone", severity: "high", label: "No phone number", advice: "Add a primary phone number — calls are a top conversion path from Search and Maps." });
  if (hasWebsite) presence += 8; else gaps.push({ key: "website", severity: "high", label: "No website link", advice: "Add your website (or booking page) so searchers can act." });
  if (hasHours) presence += 8; else gaps.push({ key: "hours", severity: "high", label: "No business hours set", advice: "Set regular hours — profiles without hours rank lower and lose 'open now' visibility." });
  if (hasGoodDescription) presence += 8; else gaps.push({ key: "description", severity: "medium", label: descriptionLength === 0 ? "No business description" : "Thin business description", advice: "Write a 150+ character description naturally mentioning your main services and city." });
  if (hasPrimaryCategory) presence += 10; else gaps.push({ key: "primary_category", severity: "high", label: "No primary category", advice: "Set the most specific primary category — it's the strongest ranking signal you control." });
  if (hasServiceItems) presence += 8; else gaps.push({ key: "service_items", severity: "medium", label: "No services listed", advice: "Add individual services — they create keyword-rich surface area for search and AI answer engines." });

  // ── Freshness axis ───────────────────────────────────────────────────────
  // Post recency (22). The single biggest lever, and the one G2 posting fixes.
  let postScore = 0;
  if (posts.newestDays <= POST_STALE_DAYS) {
    postScore = 22;
  } else if (posts.newestDays <= POST_DEAD_DAYS) {
    // Linear-ish decay between stale and dead.
    const span = POST_DEAD_DAYS - POST_STALE_DAYS;
    const over = posts.newestDays - POST_STALE_DAYS;
    postScore = Math.round(22 * (1 - over / span) * 0.6 + 22 * 0.4 * 0); // keep some signal but clearly reduced
    postScore = Math.max(6, Math.min(18, postScore));
  } else {
    postScore = 0;
  }
  if (posts.newestDays > POST_STALE_DAYS) {
    const label = posts.newestDays === Infinity
      ? "No Google posts found"
      : `Last post was ${Math.round(posts.newestDays)} days ago`;
    gaps.push({
      key: "post_recency",
      severity: posts.newestDays > POST_DEAD_DAYS ? "high" : "medium",
      label,
      advice: "Post to your profile 1-2x/week. Recent posts lift ranking and are read by AI search engines answering 'best [service] near me'. This is what auto-posting handles for you.",
      days_since_last_post: posts.newestDays === Infinity ? null : Math.round(posts.newestDays),
    });
  }

  // Photo recency (14).
  let photoScore = 0;
  if (photos.count === 0) {
    photoScore = 0;
    gaps.push({ key: "photos", severity: "high", label: "No photos on profile", advice: "Add real job photos — profiles with photos get significantly more clicks and direction requests." });
  } else if (photos.newestDays <= PHOTO_STALE_DAYS) {
    photoScore = 14;
  } else if (photos.newestDays <= PHOTO_DEAD_DAYS) {
    photoScore = 8;
    gaps.push({ key: "photo_recency", severity: "medium", label: `Newest photo is ${Math.round(photos.newestDays)} days old`, advice: "Upload fresh job photos monthly — recency signals an active, real business to both Google and AI answer engines." });
  } else {
    photoScore = 3;
    gaps.push({ key: "photo_recency", severity: "medium", label: `Newest photo is ${Math.round(photos.newestDays)} days old`, advice: "Your photos are stale. Add recent work — a profile that hasn't added a photo in 6+ months reads as dormant." });
  }

  // Review-response rate (14).
  let reviewScore = 0;
  if (reviewResp.total === 0) {
    reviewScore = 14; // nothing to answer — no penalty
  } else {
    reviewScore = Math.round(14 * reviewResp.rate);
    if (reviewResp.rate < 0.8) {
      gaps.push({
        key: "review_response",
        severity: reviewResp.rate < 0.5 ? "high" : "medium",
        label: `${reviewResp.unanswered} of ${reviewResp.total} recent reviews unanswered`,
        advice: "Reply to every review. Response rate is a visible ranking and trust signal — your AI review-reply feature drafts these for you.",
      });
    }
  }

  const freshness = postScore + photoScore + reviewScore;
  const healthScore = Math.max(0, Math.min(100, presence + freshness));

  // Order gaps by severity (high → medium → low) so the UI shows what matters first.
  const sev = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => (sev[a.severity] ?? 9) - (sev[b.severity] ?? 9));

  const snapshot = {
    title: location.title || null,
    primary_category: primaryCategory,
    additional_category_count: additionalCategoryCount,
    has_phone: hasPhone,
    has_website: hasWebsite,
    has_hours: hasHours,
    description_length: descriptionLength,
    service_item_count: serviceItemCount,
    photo_count: photos.count,
    newest_photo_days: Number.isFinite(photos.newestDays) ? Math.round(photos.newestDays) : null,
    post_count: posts.count,
    days_since_last_post: Number.isFinite(posts.newestDays) ? Math.round(posts.newestDays) : null,
    review_total: reviewResp.total,
    review_unanswered: reviewResp.unanswered,
    review_response_rate: Math.round(reviewResp.rate * 100),
    // sub-scores for transparency / debugging
    score_breakdown: { presence, post: postScore, photo: photoScore, review: reviewScore, freshness },
  };

  return { healthScore, gaps, snapshot };
}

/**
 * Run the full audit for a tenant: read Google, score, upsert gbp_audit,
 * return the result. Read-only against Google (no writes to the profile).
 */
async function runAuditForTenant(tenantId) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_access_token && tenant.google_location_id && tenant.google_account_id)) {
    return { ok: false, reason: "not_connected" };
  }

  let location, photos, posts, reviewResp;
  try {
    location = await fetchLocation(tenant);
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[GBP Audit] location fetch failed tenant=%s: %s", tenantId, detail);
    return { ok: false, reason: "fetch_failed", message: detail };
  }

  // The freshness reads are best-effort and never fail the audit.
  [photos, posts, reviewResp] = await Promise.all([
    fetchPhotos(tenant),
    fetchPosts(tenant),
    fetchReviewResponse(tenant),
  ]);

  const { healthScore, gaps, snapshot } = buildAuditFromReads(location, photos, posts, reviewResp);

  await db.query(
    `INSERT INTO gbp_audit (tenant_id, health_score, gaps, profile_snapshot, generated_at)
         VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (tenant_id) DO UPDATE
        SET health_score     = EXCLUDED.health_score,
            gaps             = EXCLUDED.gaps,
            profile_snapshot = EXCLUDED.profile_snapshot,
            generated_at     = now()`,
    [tenantId, healthScore, JSON.stringify(gaps), JSON.stringify(snapshot)]
  );

  console.log("[GBP Audit] tenant=%s score=%d gaps=%d (presence=%d freshness=%d)",
    tenantId, healthScore, gaps.length, snapshot.score_breakdown.presence, snapshot.score_breakdown.freshness);

  return { ok: true, healthScore, gaps, snapshot };
}

module.exports = {
  runAuditForTenant,
  // exported for testing
  buildAuditFromReads,
  daysSince,
};

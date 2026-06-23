"use strict";

/**
 * services/gbpAudit.js
 *
 * GBP Traction — G1 profile audit + health score, now feeding the
 * STRENGTH ENGINE (Jun 2026).
 *
 * Reads the tenant's live Google Business Profile via the Business
 * Information API (profile fields), the legacy v4 media endpoint (photos),
 * and the legacy v4 localPosts + reviews endpoints (activity/freshness).
 * Computes a 0-100 health score and a prioritized list of gaps, then upserts
 * one row per tenant into gbp_audit (mig 107).
 *
 * ── Scoring philosophy (Path A) ────────────────────────────────────────────
 * Presence alone is not health. A profile can have hours, phone, website,
 * a category, and a description and still rank poorly because it is STALE.
 * The score blends:
 *   Presence   (50 pts) — the static fields that must exist
 *   Freshness  (50 pts) — post recency, photo recency, review-response rate
 *
 * ── Strength Engine additions ──────────────────────────────────────────────
 * The audit already reads profile.description and serviceItems on the
 * location object. This version surfaces those into the snapshot AND the
 * description gap so the dashboard can offer two actionable fixes:
 *   - description gap carries `current_description` + `description_length`
 *     so the "Rewrite with AI" flow can show before/after.
 *   - service_items get summarized (count + names) into the snapshot so the
 *     "See suggested services" guide can diff current-vs-suggested without a
 *     second API call.
 * The description gap is also upgraded from a pure presence check to a
 * QUALITY check: a present-but-weak description (too short, or missing
 * city / service-area signals) still surfaces a medium gap so the rewrite
 * has a reason to exist even on an otherwise-complete profile.
 *
 * Auth/billing: callers (routes/gbp.js) gate on hasReviewsAccess BEFORE
 * calling. This service reuses reviewsHelper.authedRequest for token refresh
 * + 401 retry.
 */

const db = require("../lib/db");
const reviewsHelper = require("../lib/reviewsHelper");

const BIZ_INFO_BASE  = "https://mybusinessbusinessinformation.googleapis.com/v1";
const LEGACY_V4_BASE = "https://mybusiness.googleapis.com/v4";

// readMask for locations.get — only fields we actually score on.
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

// Freshness thresholds (days).
const POST_STALE_DAYS  = 14;
const POST_DEAD_DAYS   = 30;
const PHOTO_STALE_DAYS = 90;
const PHOTO_DEAD_DAYS  = 180;

// Description quality thresholds (chars). Google hard limit is 750.
const DESC_MIN_OK    = 80;    // below this = "thin", presence point lost
const DESC_STRONG    = 730;   // at/above this = using the full ~750 space well
const DESC_MAX       = 750;   // Google hard limit

function daysSince(iso) {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / (1000 * 60 * 60 * 24);
}

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

async function fetchLocation(tenant) {
  const url = `${BIZ_INFO_BASE}/${tenant.google_location_id}`;
  const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
    params: { readMask: LOCATION_READ_MASK },
  });
  return res.data || {};
}

async function fetchPhotos(tenant) {
  try {
    const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/media`;
    const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
      params: { pageSize: 100 },
    });
    const items = res.data?.mediaItems || [];
    let newest = Infinity;
    for (const m of items) {
      const d = daysSince(m.createTime);
      if (d < newest) newest = d;
    }
    return { count: items.length, newestDays: newest };
  } catch (e) {
    console.warn("[GBP Audit] media fetch failed tenant=%s: %s", tenant.id, e.message);
    return { count: 0, newestDays: Infinity };
  }
}

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

async function fetchReviewResponse(tenant) {
  try {
    const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/reviews`;
    const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
      params: { pageSize: 50 },
    });
    const reviews = res.data?.reviews || [];
    const total = reviews.length;
    if (total === 0) return { total: 0, replied: 0, unanswered: 0, rate: 1, avgRating: null };
    let replied = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    const STAR = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    for (const r of reviews) {
      if (r.reviewReply) replied++;
      const n = STAR[r.starRating];
      if (n) { ratingSum += n; ratingCount++; }
    }
    return {
      total,
      replied,
      unanswered: total - replied,
      rate: replied / total,
      avgRating: ratingCount ? +(ratingSum / ratingCount).toFixed(1) : null,
    };
  } catch (e) {
    console.warn("[GBP Audit] reviews fetch failed tenant=%s: %s", tenant.id, e.message);
    return { total: 0, replied: 0, unanswered: 0, rate: 1, avgRating: null };
  }
}

/**
 * Extract readable service-item names from the location.serviceItems array.
 * Google service items are either structured (structuredServiceItem with a
 * serviceTypeId) or free-text (freeFormServiceItem.label.displayName). We
 * pull whatever human-readable label exists, deduped, capped.
 */
function extractServiceNames(serviceItems) {
  const names = [];
  for (const item of serviceItems || []) {
    let label = null;
    if (item.freeFormServiceItem?.label?.displayName) {
      label = item.freeFormServiceItem.label.displayName;
    } else if (item.structuredServiceItem?.description) {
      label = item.structuredServiceItem.description;
    } else if (item.structuredServiceItem?.serviceTypeId) {
      // serviceTypeId is an opaque id like "job_type_id:paint_interior";
      // surface a cleaned tail so the UI shows *something* recognizable.
      const tail = String(item.structuredServiceItem.serviceTypeId).split(":").pop() || "";
      label = tail.replace(/_/g, " ").trim();
    }
    if (label && !names.includes(label)) names.push(label);
  }
  return names.slice(0, 40);
}

/**
 * Heuristic: does the description carry local-SEO signal? We look for any
 * service-area city name or the primary-category word inside the text. Used
 * only to decide whether to surface a "weak description" quality gap on an
 * otherwise-present description — NOT to score, to avoid false precision.
 */
function descriptionLooksLocal(description, location) {
  if (!description) return false;
  const lc = description.toLowerCase();

  // City from storefront address.
  const city = location.storefrontAddress?.locality;
  if (city && lc.includes(String(city).toLowerCase())) return true;

  // Any service-area place name.
  const places = location.serviceArea?.places?.placeInfos || [];
  for (const p of places) {
    const nm = p.placeName ? String(p.placeName).split(",")[0].toLowerCase().trim() : "";
    if (nm && lc.includes(nm)) return true;
  }
  return false;
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
  const hasGoodDescription = descriptionLength >= DESC_MIN_OK;

  const categories = location.categories || {};
  const primaryCategory = categories.primaryCategory ? (categories.primaryCategory.displayName || categories.primaryCategory.name || null) : null;
  const additionalCategoryCount = Array.isArray(categories.additionalCategories) ? categories.additionalCategories.length : 0;
  const hasPrimaryCategory = !!primaryCategory;

  const serviceItems = Array.isArray(location.serviceItems) ? location.serviceItems : [];
  const serviceItemCount = serviceItems.length;
  const serviceNames = extractServiceNames(serviceItems);
  const hasServiceItems = serviceItemCount >= 1;

  let presence = 0;
  if (hasPhone) presence += 8; else gaps.push({ key: "phone", severity: "high", label: "No phone number", advice: "Add a primary phone number — calls are a top conversion path from Search and Maps." });
  if (hasWebsite) presence += 8; else gaps.push({ key: "website", severity: "high", label: "No website link", advice: "Add your website (or booking page) so searchers can act." });
  if (hasHours) presence += 8; else gaps.push({ key: "hours", severity: "high", label: "No business hours set", advice: "Set regular hours — profiles without hours rank lower and lose 'open now' visibility." });

  // ── Description: presence + QUALITY (Strength Engine) ──────────────────────
  // Presence point: present and ≥80 chars.
  if (hasGoodDescription) {
    presence += 8;
    // Even when present, surface a QUALITY gap if it's short of strong OR
    // missing local signal — this is what gives "Rewrite with AI" a reason
    // to exist on an otherwise-complete profile.
    const isLocal = descriptionLooksLocal(description, location);
    const isStrong = descriptionLength >= DESC_STRONG;
    if (!isStrong || !isLocal) {
      const reasons = [];
      if (!isStrong) reasons.push(`it's using ${descriptionLength} of ${DESC_MAX} characters`);
      if (!isLocal)  reasons.push("it doesn't clearly name your city or service area");
      // Severity reflects HOW weak: a present, local description that's just
      // short of the full space is polish (low). Missing local signal is a
      // real ranking miss (medium). This keeps a strong-but-not-maxed profile
      // from showing a loud gap that sorts above genuine issues, while still
      // surfacing the "Rewrite with AI" action.
      const qualitySeverity = isLocal ? "low" : "medium";
      gaps.push({
        key: "description_quality",
        severity: qualitySeverity,
        label: isLocal ? "Description could use the full space" : "Description could rank harder",
        advice: `Your description is fine, but ${reasons.join(" and ")}. A rewrite that uses the full space with your services, service-area cities, and a booking call-to-action ranks better in local and AI search. Use “Rewrite with AI”.`,
        current_description: description,
        description_length: descriptionLength,
        actionable: "rewrite_description",
      });
    }
  } else {
    gaps.push({
      key: "description",
      severity: "medium",
      label: descriptionLength === 0 ? "No business description" : "Thin business description",
      advice: "Write a 150+ character description naturally mentioning your main services and city. “Rewrite with AI” drafts one for you.",
      current_description: description,
      description_length: descriptionLength,
      actionable: "rewrite_description",
    });
  }

  if (hasPrimaryCategory) presence += 10; else gaps.push({ key: "primary_category", severity: "high", label: "No primary category", advice: "Set the most specific primary category — it's the strongest ranking signal you control." });

  // ── Services: presence + completeness guide (Strength Engine) ──────────────
  if (hasServiceItems) {
    presence += 8;
    // Even when present, a sparse list is a soft gap: more services = more
    // keyword surface. Guide-only (no API write) — the gap routes to the
    // "See suggested services" flow.
    if (serviceItemCount < 4) {
      gaps.push({
        key: "services_sparse",
        severity: "low",
        label: `Only ${serviceItemCount} service${serviceItemCount === 1 ? "" : "s"} listed`,
        advice: "More listed services create more keyword surface for search and AI answer engines. See AI-suggested services to add for your trade, then add them in your Business Profile.",
        service_count: serviceItemCount,
        service_names: serviceNames,
        actionable: "suggest_services",
      });
    }
  } else {
    gaps.push({
      key: "service_items",
      severity: "medium",
      label: "No services listed",
      advice: "Add individual services — they create keyword-rich surface for search and AI answer engines. See AI-suggested services for your trade.",
      service_count: 0,
      service_names: [],
      actionable: "suggest_services",
    });
  }

  // ── Freshness axis ───────────────────────────────────────────────────────
  let postScore = 0;
  if (posts.newestDays <= POST_STALE_DAYS) {
    postScore = 22;
  } else if (posts.newestDays <= POST_DEAD_DAYS) {
    const span = POST_DEAD_DAYS - POST_STALE_DAYS;
    const over = posts.newestDays - POST_STALE_DAYS;
    postScore = Math.round(22 * (1 - over / span) * 0.6 + 22 * 0.4 * 0);
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

  let reviewScore = 0;
  if (reviewResp.total === 0) {
    reviewScore = 14;
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
    has_description: descriptionLength > 0,
    description_is_local: descriptionLooksLocal(description, location),
    service_item_count: serviceItemCount,
    service_names: serviceNames,
    photo_count: photos.count,
    newest_photo_days: Number.isFinite(photos.newestDays) ? Math.round(photos.newestDays) : null,
    post_count: posts.count,
    days_since_last_post: Number.isFinite(posts.newestDays) ? Math.round(posts.newestDays) : null,
    review_total: reviewResp.total,
    review_unanswered: reviewResp.unanswered,
    review_response_rate: Math.round(reviewResp.rate * 100),
    review_avg_rating: reviewResp.avgRating ?? null,
    score_breakdown: { presence, post: postScore, photo: photoScore, review: reviewScore, freshness },
  };

  return { healthScore, gaps, snapshot };
}

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
  buildAuditFromReads,
  extractServiceNames,
  descriptionLooksLocal,
  daysSince,
};

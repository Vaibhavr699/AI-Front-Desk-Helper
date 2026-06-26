"use strict";

// ============================================================================
// lib/competitorBenchmark.js — competitive standing scorer (Phase 3.3)
// Jun 26, 2026
// ============================================================================
//
// PURE function. Takes the tenant's own GBP numbers + the normalized competitor
// set (from lib/placesCompetitors) and computes where the tenant STANDS on the
// three signals Places can honestly return, then emits a severity-tagged GAP
// LIST — same shape as gbp_audit.gaps / website scorecard gaps / cross-ref gaps
// — each wired to the AIFDH feature that closes it.
//
// ── HONEST AXES ONLY (decided with Drew) ────────────────────────────────────
//   1. Reviews   — count + average rating vs the local field. #1 priority.
//   2. Freshness — newest-review age vs the field (are competitors more active?)
//   3. Photos    — photo presence bucket vs the field.
// Services / booking are NOT benchmarked competitively (Places doesn't expose
// them for businesses you don't own) — those stay a self-comparison handled by
// the GBP audit + cross-reference. We surface that boundary in the UI so it
// doesn't read as an omission.
//
// ── STANDING, not a vanity score ────────────────────────────────────────────
// For each axis we compute the tenant's PERCENTILE-ISH rank within the local
// field (how many competitors they beat), plus the field's median/average, so
// the advice is concrete: "the top painters near you average 142 reviews; you
// have 31 — that's the gap." A gap only fires when the tenant is materially
// BEHIND the field — being ahead is reported as a strength, not a gap.
//
// Never throws. Missing competitor data on an axis (e.g. legacy freshness that
// failed to backfill) simply skips that axis with a note, rather than guessing.
// ============================================================================

// ── helpers ──────────────────────────────────────────────────────────────────

function median(nums) {
  const a = nums.filter((n) => Number.isFinite(n)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function average(nums) {
  const a = nums.filter((n) => Number.isFinite(n));
  if (!a.length) return null;
  return a.reduce((s, n) => s + n, 0) / a.length;
}

// How many competitors the tenant beats on a higher-is-better metric, as a
// fraction of the field. 1.0 = ahead of everyone, 0.0 = behind everyone.
function rankFractionHigher(value, field) {
  const vals = field.filter((n) => Number.isFinite(n));
  if (!Number.isFinite(value) || !vals.length) return null;
  const beaten = vals.filter((n) => value > n).length;
  return beaten / vals.length;
}

// For lower-is-better (review age: smaller = fresher). 1.0 = fresher than all.
function rankFractionLower(value, field) {
  const vals = field.filter((n) => Number.isFinite(n));
  if (!Number.isFinite(value) || !vals.length) return null;
  const beaten = vals.filter((n) => value < n).length;
  return beaten / vals.length;
}

const PHOTO_RANK = { none: 0, sparse: 1, moderate: 2, healthy: 3 };

function round(n, d = 0) {
  if (!Number.isFinite(n)) return null;
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

// ── Main entry point ─────────────────────────────────────────────────────────
// buildBenchmark({ tenant, competitors }) where:
//   tenant = { review_total, review_avg_rating, photo_count,
//              newest_photo_days, photo_bucket? }  (from gbp_audit snapshot)
//   competitors = [ { name, rating, review_count, newest_review_days,
//                     photo_bucket }, ... ]
// Returns { ok, axes:{reviews,freshness,photos}, gaps:[...], strengths:[...],
//           field:{count}, in_sync }
function buildBenchmark({ tenant, competitors } = {}) {
  const comp = Array.isArray(competitors) ? competitors : [];
  const t = tenant || {};
  const gaps = [];
  const strengths = [];

  if (comp.length === 0) {
    return {
      ok: false,
      reason: "no_competitors",
      axes: {},
      gaps: [],
      strengths: [],
      field: { count: 0 },
      in_sync: false,
    };
  }

  // ── Axis 1: REVIEWS (count + rating) ───────────────────────────────────────
  const reviewCounts = comp.map((c) => c.review_count).filter(Number.isFinite);
  const ratings = comp.map((c) => c.rating).filter(Number.isFinite);

  const tReviews = Number.isFinite(t.review_total) ? t.review_total : null;
  const tRating = Number.isFinite(t.review_avg_rating) ? t.review_avg_rating : null;

  const fieldReviewMedian = median(reviewCounts);
  const fieldReviewAvg = average(reviewCounts);
  const fieldRatingAvg = average(ratings);
  const reviewRank = rankFractionHigher(tReviews, reviewCounts);
  const ratingRank = rankFractionHigher(tRating, ratings);

  const reviewsAxis = {
    tenant_reviews: tReviews,
    tenant_rating: tRating,
    field_median_reviews: round(fieldReviewMedian),
    field_avg_reviews: round(fieldReviewAvg),
    field_avg_rating: round(fieldRatingAvg, 1),
    review_rank: reviewRank,   // fraction of field beaten on count
    rating_rank: ratingRank,
  };

  // Gap fires when the tenant's review COUNT is materially behind the field
  // median (the count gap is the actionable one — it routes to the review drip).
  if (tReviews != null && fieldReviewMedian != null && tReviews < fieldReviewMedian) {
    const behind = Math.round(fieldReviewMedian - tReviews);
    // Severity by how far behind: below ~half the median is a high-priority gap.
    const severity = tReviews < fieldReviewMedian * 0.5 ? "high" : "medium";
    gaps.push({
      key: "bench_reviews",
      severity,
      label: `You have fewer reviews than most painters near you`,
      advice:
        `The painters in your area have a median of ${Math.round(fieldReviewMedian)} reviews` +
        (fieldReviewAvg != null ? ` (averaging ${Math.round(fieldReviewAvg)})` : "") +
        `; you have ${tReviews}. That's about ${behind} behind the middle of the pack. ` +
        `Review volume is one of the strongest local + AI-search ranking signals — your automated review-request drip is built to close exactly this gap.`,
      actionable: "review_drip",
      tenant_value: tReviews,
      field_median: Math.round(fieldReviewMedian),
    });
  } else if (tReviews != null && fieldReviewMedian != null) {
    strengths.push({
      key: "bench_reviews",
      label: `Your review count is at or above the local median`,
      detail: `${tReviews} reviews vs a field median of ${Math.round(fieldReviewMedian)}.`,
    });
  }

  // Rating is reported but only flags a gap if the tenant is BOTH below the
  // field average AND below a 4.5 floor — a 4.9 in a 4.95 field isn't a problem.
  if (tRating != null && fieldRatingAvg != null && tRating < fieldRatingAvg && tRating < 4.5) {
    gaps.push({
      key: "bench_rating",
      severity: "medium",
      label: `Your star rating trails nearby painters`,
      advice:
        `Nearby painters average ${round(fieldRatingAvg, 1)}★; you're at ${tRating}★. ` +
        `Replying to every review and steadily adding fresh ones lifts both the number and the average — your review tools handle both.`,
      actionable: "review_drip",
      tenant_value: tRating,
      field_avg: round(fieldRatingAvg, 1),
    });
  }

  // ── Axis 2: FRESHNESS (newest-review age) ──────────────────────────────────
  const freshAges = comp.map((c) => c.newest_review_days).filter(Number.isFinite);
  let freshnessAxis = { available: false };
  if (freshAges.length) {
    const fieldFreshMedian = median(freshAges);
    // Tenant freshness proxy: we don't have the tenant's newest-REVIEW age in
    // the GBP snapshot directly, but review activity correlates with the drip.
    // If the snapshot ever carries it, use it; else report the field only.
    const tFresh = Number.isFinite(t.newest_review_days) ? t.newest_review_days : null;
    const freshRank = tFresh != null ? rankFractionLower(tFresh, freshAges) : null;
    freshnessAxis = {
      available: true,
      tenant_newest_review_days: tFresh,
      field_median_newest_review_days: round(fieldFreshMedian),
      freshness_rank: freshRank,
    };
    if (tFresh != null && fieldFreshMedian != null && tFresh > fieldFreshMedian && tFresh > 30) {
      gaps.push({
        key: "bench_freshness",
        severity: "medium",
        label: `Competitors are getting reviews more recently than you`,
        advice:
          `The typical painter near you got a review about ${Math.round(fieldFreshMedian)} days ago; ` +
          `your most recent is ${Math.round(tFresh)} days ago. A steady trickle of fresh reviews signals an active business to Google and AI search — your review drip keeps them coming.`,
        actionable: "review_drip",
      });
    }
  }

  // ── Axis 3: PHOTOS ─────────────────────────────────────────────────────────
  const photoRanks = comp
    .map((c) => PHOTO_RANK[c.photo_bucket])
    .filter((n) => Number.isFinite(n));
  let photosAxis = { available: false };
  if (photoRanks.length) {
    const fieldPhotoMedian = median(photoRanks);
    // Tenant photo bucket: derive from snapshot photo_count if present.
    const tPhotoBucket = bucketFromCount(t.photo_count);
    const tPhotoRank = PHOTO_RANK[tPhotoBucket];
    photosAxis = {
      available: true,
      tenant_photo_bucket: tPhotoBucket,
      tenant_photo_count: Number.isFinite(t.photo_count) ? t.photo_count : null,
      field_median_photo_bucket: bucketLabelFromRank(fieldPhotoMedian),
    };
    if (Number.isFinite(tPhotoRank) && fieldPhotoMedian != null && tPhotoRank < fieldPhotoMedian) {
      gaps.push({
        key: "bench_photos",
        severity: "low",
        label: `Nearby painters show more photos than you`,
        advice:
          `Most painters near you have a ${bucketLabelFromRank(fieldPhotoMedian)} photo presence; yours reads as ${tPhotoBucket}. ` +
          `Profiles with more real job photos get more clicks and direction requests. Add recent work to your Google profile and keep your photo pool fresh.`,
        actionable: "gbp_photos",
      });
    }
  }

  // Order high → medium → low for the merged column.
  const sevRank = { high: 0, medium: 1, low: 2 };
  gaps.sort((a, b) => (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3));

  return {
    ok: true,
    axes: { reviews: reviewsAxis, freshness: freshnessAxis, photos: photosAxis },
    gaps,
    strengths,
    field: { count: comp.length },
    in_sync: gaps.length === 0,
  };
}

// Map a raw GBP photo_count to the same bucket vocabulary Places uses, so the
// tenant and competitors are compared on one scale.
function bucketFromCount(n) {
  if (!Number.isFinite(n) || n <= 0) return "none";
  if (n <= 3) return "sparse";
  if (n <= 8) return "moderate";
  return "healthy";
}

function bucketLabelFromRank(rank) {
  if (rank == null) return "unknown";
  const r = Math.round(rank);
  return ["none", "sparse", "moderate", "healthy"][Math.max(0, Math.min(3, r))];
}

module.exports = {
  buildBenchmark,
  // exported for testing
  median,
  average,
  rankFractionHigher,
  rankFractionLower,
  bucketFromCount,
};

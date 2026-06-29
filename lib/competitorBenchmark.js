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

// ── Ordinal rank from the fraction-beaten + field size ───────────────────────
// reviewRank is already "fraction of competitors beaten" (0..1). Turn it into a
// human position among (competitors + the tenant). Gladiators beating 0 of 10
// → #11 of 11. Mid-pack (beats half of 10) → ~#6 of 11.
function ordinalReviewRank(rankFraction, fieldCount) {
  if (rankFraction == null || !Number.isFinite(fieldCount) || fieldCount <= 0) return null;
  const beaten = Math.round(rankFraction * fieldCount);
  const total = fieldCount + 1; // competitors + tenant
  return { position: total - beaten, total };
}

// ── Momentum projection (honest, framed around the NEXT rung, not the median) ─
// Observed review-acquisition pace from the tenant's recent review dates, plus
// the nearest competitor count just above the tenant. We deliberately project
// against the NEXT painter ahead (an achievable, months-away target) rather than
// the field median (often years away — demoralizing and not the real takeaway).
// Pace degrades to null with thin/stalled/bursty history; we never extrapolate a
// monthly rate from <2 dated reviews, a <14-day window, or a stalled trickle.
function buildReviewMomentum({ tenantReviews, reviewDates, competitorCounts }) {
  if (!Number.isFinite(tenantReviews)) return null;

  // Observed pace (reviews/month) from recent review dates.
  const dates = (Array.isArray(reviewDates) ? reviewDates : [])
    .map((d) => new Date(d).getTime())
    .filter(Number.isFinite)
    .sort((a, b) => b - a); // newest first

  let perMonth = null;
  if (dates.length >= 2) {
    const spanDays = (dates[0] - dates[dates.length - 1]) / (1000 * 60 * 60 * 24);
    if (spanDays >= 14) {
      const rate = ((dates.length - 1) / spanDays) * 30;
      // Floor: < 1 review per 4 months reads as stalled — show the nudge, not a
      // multi-year ETA.
      if (Number.isFinite(rate) && rate >= 0.25) perMonth = round(rate, 1);
    }
  }

  // Nearest competitor strictly above the tenant — the next rung to pass.
  let nextRung = null;
  if (Array.isArray(competitorCounts)) {
    const above = competitorCounts
      .filter((c) => Number.isFinite(c) && c > tenantReviews)
      .sort((a, b) => a - b);
    if (above.length) nextRung = above[0];
  }

  const out = { has_pace: perMonth != null, per_month: perMonth };
  if (nextRung != null) {
    out.next_rung = nextRung;
    out.to_next_rung = Math.round(nextRung - tenantReviews) + 1; // +1 to pass, not tie
    if (perMonth != null) {
      out.months_to_next_rung = Math.ceil(out.to_next_rung / perMonth);
      // When the ETA at the current pace is discouragingly far (> ~2 years),
      // the slow pace itself is the argument for the drip — the advice drops
      // the month count and leads with the lever instead of a demoralizing
      // number like "83 months."
      out.eta_too_slow = out.months_to_next_rung > SLOW_ETA_MONTHS;
    }
  }
  return out;
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

  // Ordinal position + momentum projection. `comp.length` is the field size;
  // raw competitor counts feed the "next rung" target. Tenant review dates come
  // from the GBP snapshot (services/gbpAudit.js → recent_review_dates).
  const reviewRankOrdinal = ordinalReviewRank(reviewRank, comp.length);
  const reviewMomentum = buildReviewMomentum({
    tenantReviews: tReviews,
    reviewDates: t.recent_review_dates,
    competitorCounts: reviewCounts,
  });

  const reviewsAxis = {
    tenant_reviews: tReviews,
    tenant_rating: tRating,
    field_median_reviews: round(fieldReviewMedian),
    field_avg_reviews: round(fieldReviewAvg),
    field_avg_rating: round(fieldRatingAvg, 1),
    review_rank: reviewRank,   // fraction of field beaten on count (0..1)
    rating_rank: ratingRank,
    // Phase 3.4 additions:
    rank: reviewRankOrdinal,        // { position, total } e.g. #11 of 11
    momentum: reviewMomentum,       // { has_pace, per_month, next_rung, to_next_rung, months_to_next_rung }
  };

  // Gap fires when the tenant's review COUNT is materially behind the field
  // median (the count gap is the actionable one — it routes to the review drip).
  if (tReviews != null && fieldReviewMedian != null && tReviews < fieldReviewMedian) {
    const behind = Math.round(fieldReviewMedian - tReviews);
    // Severity by how far behind: below ~half the median is a high-priority gap.
    const severity = tReviews < fieldReviewMedian * 0.5 ? "high" : "medium";
    // Momentum line: prefer the achievable "next rung" framing over the distant
    // median. Falls back to an activation nudge when there's no measured pace.
   let momentumLine = "";
    if (reviewMomentum && reviewMomentum.to_next_rung != null) {
      if (reviewMomentum.has_pace && reviewMomentum.months_to_next_rung != null && !reviewMomentum.eta_too_slow) {
        // Real pace AND a believable ETA → quote the months.
        momentumLine =
          ` You're adding about ${reviewMomentum.per_month} review${reviewMomentum.per_month === 1 ? "" : "s"} a month — ` +
          `roughly ${reviewMomentum.to_next_rung} more puts you past the next painter ahead of you, ` +
          `about ${reviewMomentum.months_to_next_rung} month${reviewMomentum.months_to_next_rung === 1 ? "" : "s"} at this pace.`;
      } else if (reviewMomentum.has_pace && reviewMomentum.eta_too_slow) {
        // Real but very slow pace → the pace itself argues for the drip; lead
        // with the lever, not a discouraging multi-year number.
        momentumLine =
          ` At your current pace of about ${reviewMomentum.per_month} review${reviewMomentum.per_month === 1 ? "" : "s"} a month, ` +
          `this gap barely moves — turning on automated review requests is what closes it.`;
      } else {
        // No measured pace → activation nudge.
        momentumLine =
          ` About ${reviewMomentum.to_next_rung} more reviews puts you past the next painter ahead of you — ` +
          `turn on automated review requests to start moving.`;
      }
    }

    gaps.push({
      key: "bench_reviews",
      severity,
      label: `You have fewer reviews than most painters near you`,
      advice:
        `The painters in your area have a median of ${Math.round(fieldReviewMedian)} reviews` +
        (fieldReviewAvg != null ? ` (averaging ${Math.round(fieldReviewAvg)})` : "") +
        `; you have ${tReviews}. Review volume is one of the strongest local + AI-search ranking signals.` +
        momentumLine,
      actionable: "review_drip",
      tenant_value: tReviews,
      field_median: Math.round(fieldReviewMedian),
      rank: reviewRankOrdinal,
      momentum: reviewMomentum,
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
  ordinalReviewRank,
  buildReviewMomentum,
};

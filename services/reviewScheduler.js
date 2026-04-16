"use strict";

/**
 * services/reviewScheduler.js
 *
 * Nightly cron job — runs at 2:00 AM every day.
 * For every tenant with Google Reviews connected, fetches new reviews,
 * generates AI draft responses, and fires a dashboard notification
 * for any reviews needing approval.
 *
 * Also exports fetchReviewsForTenant() so routes/reviews.js can reuse
 * the same logic for the manual "Check for new reviews" button.
 */

const cron       = require("node-cron");
const db         = require("../lib/db");
const { createNotification } = require("./notifications");

// ── Lazy-require to avoid circular deps ───────────────────────────────────
function getReviewsHelper() {
  return require("../lib/reviewsHelper");
}

// ── Core: fetch + store + notify for one tenant ────────────────────────────
async function fetchReviewsForTenant(tenantId) {
  const helper = getReviewsHelper();

  // 1. Pull tenant's Google credentials from DB
  const tenantRes = await db.query(
    `SELECT id, name, company_name,
            google_access_token, google_refresh_token,
            google_location_id, google_account_id
     FROM tenants
     WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantRes.rows[0];
  if (!tenant) return { new_reviews: 0, error: "Tenant not found" };

  if (!tenant.google_access_token || !tenant.google_location_id) {
    return { new_reviews: 0, error: "Google not connected" };
  }

  // 2. Refresh token if needed + fetch reviews from Google API
  let reviews;
  try {
    reviews = await helper.fetchGoogleReviews(tenant);
  } catch (err) {
    console.error(`[ReviewScheduler] Google API error for tenant ${tenantId}:`, err.message);
    return { new_reviews: 0, error: err.message };
  }

  if (!reviews || reviews.length === 0) return { new_reviews: 0 };

  // 3. Upsert reviews — only insert ones we haven't seen before
  let newCount = 0;
  for (const review of reviews) {
    const existing = await db.query(
      "SELECT id FROM google_reviews WHERE tenant_id = $1 AND google_review_id = $2",
      [tenantId, review.reviewId]
    );
    if (existing.rows.length > 0) continue; // already stored

    // Generate AI draft response
    let aiDraft = null;
    try {
      aiDraft = await helper.generateAIDraft(tenant, review);
    } catch (err) {
      console.warn(`[ReviewScheduler] AI draft failed for review ${review.reviewId}:`, err.message);
    }

    await db.query(
      `INSERT INTO google_reviews
         (tenant_id, google_review_id, reviewer_name, reviewer_photo,
          rating, review_text, review_date, ai_draft, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', now())
       ON CONFLICT (tenant_id, google_review_id) DO NOTHING`,
      [
        tenantId,
        review.reviewId,
        review.reviewer?.displayName || "Anonymous",
        review.reviewer?.profilePhotoUrl || null,
        review.starRating ? starRatingToInt(review.starRating) : 5,
        review.comment || null,
        review.createTime || new Date().toISOString(),
        aiDraft,
      ]
    );
    newCount++;
  }

  // 4. Fire notification if any new reviews need approval
  if (newCount > 0) {
    try {
      await createNotification(tenantId, {
        type:  "new_reviews_pending",
        title: `${newCount} new Google review${newCount > 1 ? "s" : ""} need${newCount === 1 ? "s" : ""} a response`,
        body:  `You have ${newCount} new Google review${newCount > 1 ? "s" : ""} waiting for AI response approval. Review and post from the Reviews page.`,
        data:  { new_count: newCount, page: "/reviews" },
      });
    } catch (err) {
      console.warn(`[ReviewScheduler] Notification failed for tenant ${tenantId}:`, err.message);
    }
  }

  console.log(`[ReviewScheduler] tenant=${tenantId} new_reviews=${newCount}`);
  return { new_reviews: newCount };
}

// ── Helper: Google star rating string → integer ────────────────────────────
function starRatingToInt(starRating) {
  const map = {
    ONE:   1,
    TWO:   2,
    THREE: 3,
    FOUR:  4,
    FIVE:  5,
  };
  return map[starRating] || 5;
}

// ── Run scheduler for ALL connected tenants ────────────────────────────────
async function runScheduledFetch() {
  console.log("[ReviewScheduler] Starting nightly review fetch…");

  let tenants;
  try {
    const res = await db.query(
      `SELECT id FROM tenants
       WHERE google_access_token IS NOT NULL
         AND google_location_id  IS NOT NULL`
    );
    tenants = res.rows;
  } catch (err) {
    console.error("[ReviewScheduler] Failed to query tenants:", err.message);
    return;
  }

  if (!tenants.length) {
    console.log("[ReviewScheduler] No tenants with Google connected. Done.");
    return;
  }

  console.log(`[ReviewScheduler] Processing ${tenants.length} tenant(s)…`);
  let totalNew = 0;

  for (const { id } of tenants) {
    try {
      const result = await fetchReviewsForTenant(id);
      totalNew += result.new_reviews || 0;
    } catch (err) {
      console.error(`[ReviewScheduler] Unhandled error for tenant ${id}:`, err.message);
    }
  }

  console.log(`[ReviewScheduler] Done. Total new reviews across all tenants: ${totalNew}`);
}

// ── Register the cron job ──────────────────────────────────────────────────
function startReviewScheduler() {
  // Run at 2:00 AM every day (server local time)
  cron.schedule("0 2 * * *", async () => {
    try {
      await runScheduledFetch();
    } catch (err) {
      console.error("[ReviewScheduler] Cron job failed:", err.message);
    }
  });
  console.log("[ReviewScheduler] Nightly review scheduler registered — runs at 2:00 AM daily.");
}

module.exports = {
  startReviewScheduler,
  fetchReviewsForTenant,
  runScheduledFetch,
  starRatingToInt,
};

"use strict";

/**
 * routes/reviews.js
 *
 * Google Reviews endpoints. The manual "Check for new reviews" poll
 * and the nightly scheduler both use fetchReviewsForTenant() from
 * services/reviewScheduler.js — one shared function, zero duplication.
 */

const express  = require("express");
const router   = express.Router();
const db       = require("../lib/db");
const { getTenantIdFromQuery } = require("../lib/auth");
const { fetchReviewsForTenant } = require("../services/reviewScheduler");
const notificationsService = require("../services/notifications");

// Helper: pull tenant with Google credentials
async function getTenantWithGoogle(tenantId) {
  const res = await db.query(
    `SELECT id, name, company_name,
            google_access_token, google_refresh_token,
            google_location_id, google_account_id,
            plan, plan_overrides
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

// Helper: check if tenant has reviews add-on or Elite plan
function hasReviewsAccess(tenant) {
  if (!tenant) return false;
  if (tenant.plan === "elite") return true;
  const overrides = tenant.plan_overrides || {};
  return !!(overrides.reviews_addon || overrides.reviews);
}

// ── GET /api/reviews/status ────────────────────────────────────────────────
// Returns: { connected, addon_active, location_name, pending_count }
router.get("/status", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const tenant = await getTenantWithGoogle(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    const connected   = !!(tenant.google_access_token && tenant.google_location_id);
    const addonActive = hasReviewsAccess(tenant);

    let pendingCount = 0;
    if (connected && addonActive) {
      const pc = await db.query(
        "SELECT COUNT(*) FROM google_reviews WHERE tenant_id = $1 AND status = 'pending'",
        [tenantId]
      );
      pendingCount = parseInt(pc.rows[0].count, 10);
    }

    res.json({
      connected,
      addon_active: addonActive,
      pending_count: pendingCount,
      location_name: tenant.company_name || tenant.name || null,
    });
  } catch (err) {
    console.error("GET /api/reviews/status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/reviews ───────────────────────────────────────────────────────
// Returns reviews filtered by status (pending | posted | skipped)
router.get("/", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const tenant = await getTenantWithGoogle(tenantId);
    if (!tenant || !hasReviewsAccess(tenant)) {
      return res.status(403).json({ error: "Reviews add-on not active" });
    }

    const status = req.query.status || "pending";
    const validStatuses = ["pending", "posted", "skipped"];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ error: "Invalid status filter" });
    }

    const result = await db.query(
      `SELECT * FROM google_reviews
       WHERE tenant_id = $1 AND status = $2
       ORDER BY review_date DESC
       LIMIT 50`,
      [tenantId, status]
    );

    // Also return total pending count for badge
    const pc = await db.query(
      "SELECT COUNT(*) FROM google_reviews WHERE tenant_id = $1 AND status = 'pending'",
      [tenantId]
    );

    res.json({
      reviews:       result.rows,
      pending_count: parseInt(pc.rows[0].count, 10),
    });
  } catch (err) {
    console.error("GET /api/reviews error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/reviews/poll ─────────────────────────────────────────────────
// Manual "Check for new reviews" — reuses the same shared scheduler function
router.post("/poll", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const tenant = await getTenantWithGoogle(tenantId);
    if (!tenant || !hasReviewsAccess(tenant)) {
      return res.status(403).json({ error: "Reviews add-on not active" });
    }
    if (!tenant.google_access_token || !tenant.google_location_id) {
      return res.status(400).json({ error: "Google not connected" });
    }

    // Reuse the same function the nightly scheduler calls
    const result = await fetchReviewsForTenant(tenantId);

    res.json({
      new_reviews: result.new_reviews || 0,
      error:       result.error || null,
    });
  } catch (err) {
    console.error("POST /api/reviews/poll error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/reviews/:id/approve ─────────────────────────────────────────
// Approve and post response to Google
router.post("/:id/approve", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { id }   = req.params;
    const { custom_response } = req.body || {};

    const reviewRes = await db.query(
      "SELECT * FROM google_reviews WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    const review = reviewRes.rows[0];
    if (!review) return res.status(404).json({ error: "Review not found" });

    const tenant = await getTenantWithGoogle(tenantId);
    if (!tenant || !hasReviewsAccess(tenant)) {
      return res.status(403).json({ error: "Reviews add-on not active" });
    }

    const responseText = custom_response || review.ai_draft;
    if (!responseText) return res.status(400).json({ error: "No response text available" });

    // Post to Google via helper
    const helper = require("../lib/reviewsHelper");
    await helper.postReplyToGoogle(tenant, review.google_review_id, responseText);

    // Mark as posted
    await db.query(
      `UPDATE google_reviews
       SET status = 'posted', posted_at = now(), ai_draft = $1, updated_at = now()
       WHERE id = $2`,
      [responseText, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/reviews/:id/approve error:", err);
    res.status(500).json({ error: err.message || "Server error" });
  }
});

// ── POST /api/reviews/:id/skip ─────────────────────────────────────────────
router.post("/:id/skip", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { id }   = req.params;

    await db.query(
      "UPDATE google_reviews SET status = 'skipped', updated_at = now() WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/reviews/:id/skip error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/reviews/:id/regenerate ──────────────────────────────────────
// Regenerate AI draft for a specific review
router.post("/:id/regenerate", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { id }   = req.params;

    const reviewRes = await db.query(
      "SELECT * FROM google_reviews WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    const review = reviewRes.rows[0];
    if (!review) return res.status(404).json({ error: "Review not found" });

    const tenant = await getTenantWithGoogle(tenantId);
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    const helper   = require("../lib/reviewsHelper");
    const aiDraft  = await helper.generateAIDraft(tenant, {
      reviewId:   review.google_review_id,
      comment:    review.review_text,
      starRating: review.rating,
      reviewer:   { displayName: review.reviewer_name },
    });

    await db.query(
      "UPDATE google_reviews SET ai_draft = $1, updated_at = now() WHERE id = $2",
      [aiDraft, id]
    );

    res.json({ ai_draft: aiDraft });
  } catch (err) {
    console.error("POST /api/reviews/:id/regenerate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/reviews/oauth/url ─────────────────────────────────────────────
// Returns Google OAuth consent URL
router.get("/oauth/url", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const helper = require("../lib/reviewsHelper");
    const url    = helper.getOAuthUrl(tenantId);

    res.json({ url });
  } catch (err) {
    console.error("GET /api/reviews/oauth/url error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── GET /api/reviews/oauth/callback ───────────────────────────────────────
// Google redirects here after OAuth consent
router.get("/oauth/callback", async (req, res) => {
  try {
    const { code, state: tenantId } = req.query;
    if (!code || !tenantId) return res.status(400).send("Missing code or state");

    const helper = require("../lib/reviewsHelper");
    await helper.handleOAuthCallback(tenantId, code);

    // Trigger an immediate first fetch so reviews appear right away
    fetchReviewsForTenant(tenantId).catch(err =>
      console.warn("[Reviews] Initial fetch after OAuth failed:", err.message)
    );

    res.redirect(`${process.env.FRONTEND_URL || ""}/reviews?connected=true`);
  } catch (err) {
    console.error("GET /api/reviews/oauth/callback error:", err);
    res.redirect(`${process.env.FRONTEND_URL || ""}/reviews?error=oauth_failed`);
  }
});

// ── DELETE /api/reviews/disconnect ────────────────────────────────────────
router.delete("/disconnect", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    await db.query(
      `UPDATE tenants
       SET google_access_token  = NULL,
           google_refresh_token = NULL,
           google_location_id   = NULL,
           google_account_id    = NULL,
           updated_at           = now()
       WHERE id = $1`,
      [tenantId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/reviews/disconnect error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/reviews/subscribe ───────────────────────────────────────────
// Stripe checkout for the $29/mo add-on
router.post("/subscribe", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const stripe    = require("../lib/stripe");
    const returnUrl = `${process.env.FRONTEND_URL || ""}/reviews`;

    const session = await stripe.createAddonCheckout({
      tenantId,
      addonKey:  "reviews",
      priceId:   process.env.STRIPE_REVIEWS_ADDON_PRICE_ID,
      returnUrl: `${returnUrl}?subscribed=true`,
      cancelUrl: `${returnUrl}?cancelled=true`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/reviews/subscribe error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

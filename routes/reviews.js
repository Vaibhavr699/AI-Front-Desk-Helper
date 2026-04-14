"use strict";

const express = require("express");
const { google } = require("googleapis");
const OpenAI = require("openai");
const db = require("../lib/db");
const { authMiddleware, getTenantIdFromQuery } = require("../lib/auth");

const router = express.Router();
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── OAuth2 client factory ─────────────────────────────────────────────────────
function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_REVIEWS_CLIENT_ID,
    process.env.GOOGLE_REVIEWS_CLIENT_SECRET,
    process.env.GOOGLE_REVIEWS_REDIRECT_URI
  );
}

// ── Refresh token helper ──────────────────────────────────────────────────────
async function getAuthenticatedClient(tenantId) {
  const result = await db.query(
    "SELECT google_access_token, google_refresh_token, google_token_expiry, google_location_id FROM tenants WHERE id = $1",
    [tenantId]
  );
  const tenant = result.rows[0];
  if (!tenant?.google_refresh_token) throw new Error("Google not connected");

  const client = getOAuthClient();
  client.setCredentials({
    access_token: tenant.google_access_token,
    refresh_token: tenant.google_refresh_token,
    expiry_date: tenant.google_token_expiry ? new Date(tenant.google_token_expiry).getTime() : null,
  });

  // Auto-refresh if expired
  client.on("tokens", async (tokens) => {
    if (tokens.access_token) {
      await db.query(
        "UPDATE tenants SET google_access_token = $1, google_token_expiry = $2 WHERE id = $3",
        [tokens.access_token, tokens.expiry_date ? new Date(tokens.expiry_date) : null, tenantId]
      );
    }
  });

  return { client, locationId: tenant.google_location_id };
}

// ── STEP 1: Generate OAuth URL ────────────────────────────────────────────────
// GET /api/reviews/oauth/url?tenant_id=xxx
router.get("/oauth/url", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const client = getOAuthClient();

    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/business.manage",
      ],
      state: tenantId,
    });

    res.json({ url });
  } catch (err) {
    console.error("GET /api/reviews/oauth/url error:", err);
    res.status(500).json({ error: "Failed to generate OAuth URL" });
  }
});

// ── STEP 2: OAuth Callback ────────────────────────────────────────────────────
// GET /api/reviews/oauth/callback?code=xxx&state=tenantId
router.get("/oauth/callback", async (req, res) => {
  const { code, state: tenantId } = req.query;
  if (!code || !tenantId) return res.status(400).send("Missing code or state");

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    // Get the Google Business Account and first location
    const mybusiness = google.mybusinessaccountmanagement({
      version: "v1",
      auth: client,
    });

    const accountRes = await mybusiness.accounts.list();
    const account = accountRes.data.accounts?.[0];
    if (!account) throw new Error("No Google Business account found");

    // Get first location
    const locationRes = await google.mybusinessbusinessinformation({
      version: "v1",
      auth: client,
    }).locations.list({ parent: account.name, readMask: "name,title" });

    const location = locationRes.data.locations?.[0];
    const locationId = location?.name || account.name;

    // Store tokens in DB
    await db.query(
      `UPDATE tenants SET
        google_access_token = $1,
        google_refresh_token = $2,
        google_token_expiry = $3,
        google_location_id = $4
       WHERE id = $5`,
      [
        tokens.access_token,
        tokens.refresh_token,
        tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        locationId,
        tenantId,
      ]
    );

    // Redirect back to dashboard settings
    res.redirect(`${process.env.FRONTEND_URL || "https://aifrontdeskhelper.com"}/settings?google_connected=true`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`${process.env.FRONTEND_URL || "https://aifrontdeskhelper.com"}/settings?google_error=true`);
  }
});

// ── STEP 3: Check connection status ──────────────────────────────────────────
// GET /api/reviews/status?tenant_id=xxx
router.get("/status", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const result = await db.query(
      "SELECT google_location_id, google_access_token, reviews_addon_active FROM tenants WHERE id = $1",
      [tenantId]
    );
    const tenant = result.rows[0];
    res.json({
      connected: !!tenant?.google_location_id && !!tenant?.google_access_token,
      location_id: tenant?.google_location_id || null,
      addon_active: tenant?.reviews_addon_active || false,
    });
  } catch (err) {
    console.error("GET /api/reviews/status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── STEP 4: Disconnect Google ─────────────────────────────────────────────────
// DELETE /api/reviews/disconnect?tenant_id=xxx
router.delete("/disconnect", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    await db.query(
      `UPDATE tenants SET
        google_access_token = NULL,
        google_refresh_token = NULL,
        google_token_expiry = NULL,
        google_location_id = NULL
       WHERE id = $1`,
      [tenantId]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/reviews/disconnect error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── STEP 5: Poll for new reviews (called by cron or manually) ─────────────────
// POST /api/reviews/poll?tenant_id=xxx
router.post("/poll", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const count = await pollReviewsForTenant(tenantId);
    res.json({ success: true, new_reviews: count });
  } catch (err) {
    console.error("POST /api/reviews/poll error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Core polling function ─────────────────────────────────────────────────────
async function pollReviewsForTenant(tenantId) {
  const { client, locationId } = await getAuthenticatedClient(tenantId);

  // Fetch reviews from Google
  const response = await fetch(
    `https://mybusiness.googleapis.com/v4/${locationId}/reviews?pageSize=50`,
    {
      headers: {
        Authorization: `Bearer ${(await client.getAccessToken()).token}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) throw new Error(`Google API error: ${response.status}`);
  const data = await response.json();
  const reviews = data.reviews || [];

  let newCount = 0;

  for (const review of reviews) {
    // Skip if already has a reply
    if (review.reviewReply) continue;

    const reviewId = review.reviewId;
    const existing = await db.query(
      "SELECT id FROM google_reviews WHERE tenant_id = $1 AND google_review_id = $2",
      [tenantId, reviewId]
    );

    if (existing.rows.length > 0) continue;

    // Generate AI draft
    const aiDraft = await generateReviewResponse({
      reviewerName: review.reviewer?.displayName || "Valued Customer",
      rating: review.starRating,
      reviewText: review.comment || "",
      tenantId,
    });

    // Store in DB
    await db.query(
      `INSERT INTO google_reviews
        (tenant_id, google_review_id, reviewer_name, rating, review_text, review_date, ai_draft, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
       ON CONFLICT (tenant_id, google_review_id) DO NOTHING`,
      [
        tenantId,
        reviewId,
        review.reviewer?.displayName || "Valued Customer",
        ratingToNumber(review.starRating),
        review.comment || "",
        review.createTime ? new Date(review.createTime) : new Date(),
        aiDraft,
      ]
    );

    newCount++;
  }

  return newCount;
}

// ── Star rating converter ─────────────────────────────────────────────────────
function ratingToNumber(starRating) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[starRating] || 5;
}

// ── AI Response Generator ─────────────────────────────────────────────────────
async function generateReviewResponse({ reviewerName, rating, reviewText, tenantId }) {
  // Get tenant info for context
  const tenantResult = await db.query(
    "SELECT company_name, name FROM tenants WHERE id = $1",
    [tenantId]
  );
  const tenant = tenantResult.rows[0];
  const businessName = tenant?.company_name || tenant?.name || "our business";
  const ratingNum = typeof rating === "string" ? ratingToNumber(rating) : rating;

  let toneInstruction = "";
  if (ratingNum >= 4) {
    toneInstruction = "This is a positive review. Be warm, grateful, and enthusiastic. Reference specific details from their review.";
  } else if (ratingNum === 3) {
    toneInstruction = "This is a mixed review. Be appreciative of the feedback, acknowledge any concerns professionally, and highlight your commitment to improvement.";
  } else {
    toneInstruction = "This is a negative review. Be empathetic, professional, and solution-focused. Apologize for any shortcomings, do not be defensive, and offer to make it right. Include a phone number or email to contact directly.";
  }

  const prompt = `You are writing a Google Business review response for ${businessName}, a professional painting contractor.

REVIEW DETAILS:
- Reviewer name: ${reviewerName}
- Star rating: ${ratingNum}/5
- Review text: "${reviewText || "No text provided"}"

INSTRUCTIONS:
${toneInstruction}

RULES:
1. Keep response between 75-150 words
2. Address the reviewer by first name if possible
3. Mention "${businessName}" naturally once for SEO
4. Include a local SEO keyword naturally (e.g. "painting contractor", "exterior painting", "interior painting")
5. End with an invitation to work together again or a call to action
6. Sound like a real business owner, not a robot
7. Never use generic phrases like "We value your feedback" or "Thank you for your business"
8. Be specific to what they actually said in the review

Write only the response text, no preamble or explanation.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 300,
    temperature: 0.7,
  });

  return completion.choices[0]?.message?.content?.trim() || "";
}

// ── GET all reviews ───────────────────────────────────────────────────────────
// GET /api/reviews?tenant_id=xxx&status=pending
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { status } = req.query;

    let query = "SELECT * FROM google_reviews WHERE tenant_id = $1";
    const params = [tenantId];

    if (status) {
      query += " AND status = $2";
      params.push(status);
    }

    query += " ORDER BY review_date DESC";

    const result = await db.query(query, params);
    const pending = result.rows.filter(r => r.status === "pending").length;

    res.json({ reviews: result.rows, pending_count: pending });
  } catch (err) {
    console.error("GET /api/reviews error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── REGENERATE AI draft ───────────────────────────────────────────────────────
// POST /api/reviews/:id/regenerate?tenant_id=xxx
router.post("/:id/regenerate", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { id } = req.params;

    const result = await db.query(
      "SELECT * FROM google_reviews WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    const review = result.rows[0];
    if (!review) return res.status(404).json({ error: "Review not found" });

    const aiDraft = await generateReviewResponse({
      reviewerName: review.reviewer_name,
      rating: review.rating,
      reviewText: review.review_text,
      tenantId,
    });

    await db.query(
      "UPDATE google_reviews SET ai_draft = $1 WHERE id = $2",
      [aiDraft, id]
    );

    res.json({ success: true, ai_draft: aiDraft });
  } catch (err) {
    console.error("POST /api/reviews/:id/regenerate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── APPROVE & POST to Google ──────────────────────────────────────────────────
// POST /api/reviews/:id/approve?tenant_id=xxx
router.post("/:id/approve", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { id } = req.params;
    const { custom_response } = req.body;

    const result = await db.query(
      "SELECT * FROM google_reviews WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );
    const review = result.rows[0];
    if (!review) return res.status(404).json({ error: "Review not found" });

    const responseText = custom_response || review.ai_draft;
    if (!responseText) return res.status(400).json({ error: "No response text to post" });

    // Get authenticated client
    const { client, locationId } = await getAuthenticatedClient(tenantId);
    const token = (await client.getAccessToken()).token;

    // Post to Google Business Profile
    const postRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationId}/reviews/${review.google_review_id}/reply`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ comment: responseText }),
      }
    );

    if (!postRes.ok) {
      const errorText = await postRes.text();
      throw new Error(`Google API error: ${postRes.status} — ${errorText}`);
    }

    // Update status in DB
    await db.query(
      `UPDATE google_reviews SET
        status = 'posted',
        ai_draft = $1,
        posted_at = now()
       WHERE id = $2`,
      [responseText, id]
    );

    res.json({ success: true, posted_at: new Date() });
  } catch (err) {
    console.error("POST /api/reviews/:id/approve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// ── SKIP review ───────────────────────────────────────────────────────────────
// POST /api/reviews/:id/skip?tenant_id=xxx
router.post("/:id/skip", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { id } = req.params;

    await db.query(
      "UPDATE google_reviews SET status = 'skipped' WHERE id = $1 AND tenant_id = $2",
      [id, tenantId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/reviews/:id/skip error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ── CRON: Poll all connected tenants every 4 hours ────────────────────────────
// This is called internally by a cron job in server.js
async function pollAllTenants() {
  try {
    const result = await db.query(
      "SELECT id FROM tenants WHERE google_refresh_token IS NOT NULL AND google_location_id IS NOT NULL"
    );
    const tenants = result.rows;
    console.log(`[Reviews Cron] Polling ${tenants.length} connected tenants`);

    for (const tenant of tenants) {
      try {
        const count = await pollReviewsForTenant(tenant.id);
        if (count > 0) {
          console.log(`[Reviews Cron] ${count} new reviews found for tenant ${tenant.id}`);
        }
      } catch (err) {
        console.error(`[Reviews Cron] Error polling tenant ${tenant.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[Reviews Cron] Fatal error:", err);
  }
}

module.exports = router;
module.exports.pollAllTenants = pollAllTenants;

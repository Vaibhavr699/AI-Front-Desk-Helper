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

// ── Get authenticated client with auto-refresh ────────────────────────────────
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

// ── Star rating converter ─────────────────────────────────────────────────────
function ratingToNumber(starRating) {
  const map = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  return map[starRating] || 5;
}

// ── Industry detection ────────────────────────────────────────────────────────
function detectIndustry(serviceType, businessName, description) {
  const text = `${serviceType || ""} ${businessName || ""} ${description || ""}`.toLowerCase();
  if (text.match(/paint|painting|coat|stain/)) return "painting";
  if (text.match(/plumb|pipe|drain|water heater|leak/)) return "plumbing";
  if (text.match(/hvac|heating|cooling|furnace|ac |air condition/)) return "hvac";
  if (text.match(/electric|wiring|panel|outlet|circuit/)) return "electrical";
  if (text.match(/roof|shingle|gutter|siding/)) return "roofing";
  if (text.match(/landscape|lawn|mow|tree|yard|garden/)) return "landscaping";
  if (text.match(/clean|maid|janitorial|pressure wash/)) return "cleaning";
  if (text.match(/fence|deck|pergola|patio/)) return "fencing";
  if (text.match(/floor|tile|hardwood|carpet/)) return "flooring";
  if (text.match(/remodel|renovate|general contractor|handyman/)) return "remodeling";
  if (text.match(/pest|extermina|termite|bug/)) return "pest control";
  if (text.match(/window|door|glass/)) return "windows and doors";
  if (text.match(/garage|opener/)) return "garage doors";
  if (text.match(/move|moving|haul/)) return "moving";
  return "home services";
}

// ── SEO keyword map by industry ───────────────────────────────────────────────
const SEO_KEYWORDS = {
  "painting":          ["interior painting", "exterior painting", "house painting", "painting contractor", "residential painting"],
  "plumbing":          ["plumbing services", "plumber", "plumbing contractor", "drain repair", "water heater installation"],
  "hvac":              ["HVAC services", "heating and cooling", "AC repair", "furnace installation", "HVAC contractor"],
  "electrical":        ["electrical services", "electrician", "electrical contractor", "panel upgrade", "wiring services"],
  "roofing":           ["roofing contractor", "roof repair", "roof replacement", "roofing services", "shingle installation"],
  "landscaping":       ["landscaping services", "lawn care", "landscape contractor", "yard maintenance", "lawn maintenance"],
  "cleaning":          ["cleaning services", "house cleaning", "cleaning company", "maid service", "residential cleaning"],
  "fencing":           ["fence installation", "fencing contractor", "fence repair", "privacy fence", "fencing services"],
  "flooring":          ["flooring contractor", "floor installation", "hardwood flooring", "tile installation", "flooring services"],
  "remodeling":        ["home remodeling", "renovation contractor", "home improvement", "general contractor", "remodeling services"],
  "pest control":      ["pest control services", "exterminator", "pest management", "pest removal", "pest control contractor"],
  "windows and doors": ["window installation", "door replacement", "window contractor", "window and door services", "window replacement"],
  "garage doors":      ["garage door repair", "garage door installation", "garage door contractor", "garage door services", "garage door replacement"],
  "moving":            ["moving services", "moving company", "residential moving", "local movers", "moving contractor"],
  "home services":     ["home services", "home improvement", "residential contractor", "home repair", "local contractor"],
};

// ── AI Response Generator ─────────────────────────────────────────────────────
async function generateReviewResponse({ reviewerName, rating, reviewText, tenantId }) {
  const tenantResult = await db.query(
    `SELECT company_name, name, city, state, instructions, transfer_numbers
     FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = tenantResult.rows[0] || {};

  const businessName = tenant.company_name || tenant.name || "our business";
  const city = tenant.city || "";
  const state = tenant.state || "";
  const location = city && state ? `${city}, ${state}` : city || state || "";

  // Extract first phone number from transfer_numbers jsonb array if available
  let phone = "";
  try {
    const numbers = tenant.transfer_numbers;
    if (Array.isArray(numbers) && numbers.length > 0) {
      phone = numbers[0]?.number || numbers[0] || "";
    }
  } catch { phone = ""; }

  const industry = detectIndustry(
    "",
    businessName,
    tenant.instructions || ""
  );

  const keywords = SEO_KEYWORDS[industry] || SEO_KEYWORDS["home services"];
  const primaryKeyword = location ? `${keywords[0]} in ${location}` : keywords[0];
  const secondaryKeyword = keywords[1] || keywords[0];

  const ratingNum = typeof rating === "string" ? ratingToNumber(rating) : (rating || 5);
  const firstName = reviewerName ? reviewerName.split(" ")[0] : "there";

  let toneInstruction = "";
  let contactHint = "";

  if (ratingNum >= 4) {
    toneInstruction = `This is a positive review. Be warm, genuinely grateful, and enthusiastic. Reference at least one specific detail from their review — mention the actual work done if described. Celebrate the result without being over the top.`;
  } else if (ratingNum === 3) {
    toneInstruction = `This is a mixed review. Acknowledge both what went well and what could have been better. Be appreciative of the honest feedback, show professionalism, and highlight your commitment to continuous improvement. Do not be defensive.`;
    contactHint = phone ? `Invite them to reach out directly at ${phone} so you can make it right.` : `Invite them to contact you directly so you can make it right.`;
  } else {
    toneInstruction = `This is a negative review. Lead with genuine empathy — not excuses. Apologize clearly for falling short of expectations. Do not be defensive or argue with their experience. Offer a path to resolution.`;
    contactHint = phone ? `Include your contact info (${phone}) and invite them to call directly so you can resolve this personally.` : `Invite them to contact you directly so you can make it right.`;
  }

  const prompt = `You are writing a Google Business review response for ${businessName}, a professional ${industry} business${location ? ` based in ${location}` : ""}.

REVIEW DETAILS:
- Reviewer: ${reviewerName || "Anonymous"} (address as "${firstName}")
- Star rating: ${ratingNum}/5  
- Review text: "${reviewText || "No written review — just a star rating"}"

TONE:
${toneInstruction}
${contactHint ? `\nCONTACT: ${contactHint}` : ""}

SEO REQUIREMENTS:
- Mention "${businessName}" once naturally
- Include this keyword naturally once: "${primaryKeyword}"
- Optionally weave in: "${secondaryKeyword}"
${location ? `- Reference "${location}" naturally for local SEO` : ""}

RULES:
1. 80-160 words — no shorter, no longer
2. Address "${firstName}" by name at least once
3. Sound like a real business owner — personal, not corporate
4. NEVER use: "We value your feedback", "Thank you for your business", "We strive to", "We are committed to", "It was a pleasure serving you", "We appreciate your review"
5. Be specific to what they actually wrote — no generic filler
6. End with a forward-looking statement or invitation to work together again
7. Use ${industry}-appropriate language that shows real expertise

Write ONLY the response. No quotes, no preamble, no explanation.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: prompt }],
    max_tokens: 350,
    temperature: 0.75,
  });

  return completion.choices[0]?.message?.content?.trim() || "";
}

// ── Core polling function ─────────────────────────────────────────────────────
async function pollReviewsForTenant(tenantId) {
  const { client, locationId } = await getAuthenticatedClient(tenantId);

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
    if (review.reviewReply) continue;

    const reviewId = review.reviewId;
    const existing = await db.query(
      "SELECT id FROM google_reviews WHERE tenant_id = $1 AND google_review_id = $2",
      [tenantId, reviewId]
    );
    if (existing.rows.length > 0) continue;

    const aiDraft = await generateReviewResponse({
      reviewerName: review.reviewer?.displayName || "Valued Customer",
      rating: review.starRating,
      reviewText: review.comment || "",
      tenantId,
    });

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

// ── Cron: Poll all connected tenants ─────────────────────────────────────────
async function pollAllTenants() {
  try {
    const result = await db.query(
      "SELECT id FROM tenants WHERE google_refresh_token IS NOT NULL AND google_location_id IS NOT NULL"
    );
    console.log(`[Reviews Cron] Polling ${result.rows.length} connected tenants`);
    for (const tenant of result.rows) {
      try {
        const count = await pollReviewsForTenant(tenant.id);
        if (count > 0) console.log(`[Reviews Cron] ${count} new reviews for tenant ${tenant.id}`);
      } catch (err) {
        console.error(`[Reviews Cron] Error for tenant ${tenant.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[Reviews Cron] Fatal:", err);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ROUTES
// ────────────────────────────────────────────────────────────────────────────

// GET /api/reviews/oauth/url
router.get("/oauth/url", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const client = getOAuthClient();
    const url = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/business.manage"],
      state: tenantId,
    });
    res.json({ url });
  } catch (err) {
    console.error("GET /api/reviews/oauth/url error:", err);
    res.status(500).json({ error: "Failed to generate OAuth URL" });
  }
});

// GET /api/reviews/oauth/callback
router.get("/oauth/callback", async (req, res) => {
  const { code, state: tenantId } = req.query;
  if (!code || !tenantId) return res.status(400).send("Missing code or state");

  try {
    const client = getOAuthClient();
    const { tokens } = await client.getToken(code);
    client.setCredentials(tokens);

    const mybusiness = google.mybusinessaccountmanagement({ version: "v1", auth: client });
    const accountRes = await mybusiness.accounts.list();
    const account = accountRes.data.accounts?.[0];
    if (!account) throw new Error("No Google Business account found");

    const locationRes = await google.mybusinessbusinessinformation({
      version: "v1", auth: client,
    }).locations.list({ parent: account.name, readMask: "name,title" });

    const location = locationRes.data.locations?.[0];
    const locationId = location?.name || account.name;

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

    res.redirect(`${process.env.FRONTEND_URL || "https://aifrontdeskhelper.com"}/settings?google_connected=true`);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.redirect(`${process.env.FRONTEND_URL || "https://aifrontdeskhelper.com"}/settings?google_error=true`);
  }
});

// GET /api/reviews/status
router.get("/status", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const result = await db.query(
      "SELECT google_location_id, google_access_token, reviews_addon_active, plan FROM tenants WHERE id = $1",
      [tenantId]
    );
    const tenant = result.rows[0];
    const isElite = tenant?.plan === "elite";
    res.json({
      connected: !!tenant?.google_location_id && !!tenant?.google_access_token,
      location_id: tenant?.google_location_id || null,
      addon_active: isElite || tenant?.reviews_addon_active || false,
    });
  } catch (err) {
    console.error("GET /api/reviews/status error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// DELETE /api/reviews/disconnect
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

// POST /api/reviews/poll
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

// GET /api/reviews
router.get("/", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const { status } = req.query;

    let query = "SELECT * FROM google_reviews WHERE tenant_id = $1";
    const params = [tenantId];
    if (status) { query += " AND status = $2"; params.push(status); }
    query += " ORDER BY review_date DESC";

    const result = await db.query(query, params);
    const pending = result.rows.filter(r => r.status === "pending").length;
    res.json({ reviews: result.rows, pending_count: pending });
  } catch (err) {
    console.error("GET /api/reviews error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/reviews/:id/regenerate
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

    await db.query("UPDATE google_reviews SET ai_draft = $1 WHERE id = $2", [aiDraft, id]);
    res.json({ success: true, ai_draft: aiDraft });
  } catch (err) {
    console.error("POST /api/reviews/:id/regenerate error:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// POST /api/reviews/:id/approve
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
    if (!responseText) return res.status(400).json({ error: "No response text" });

    const { client, locationId } = await getAuthenticatedClient(tenantId);
    const token = (await client.getAccessToken()).token;

    const postRes = await fetch(
      `https://mybusiness.googleapis.com/v4/${locationId}/reviews/${review.google_review_id}/reply`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ comment: responseText }),
      }
    );

    if (!postRes.ok) {
      const errorText = await postRes.text();
      throw new Error(`Google API error: ${postRes.status} — ${errorText}`);
    }

    await db.query(
      "UPDATE google_reviews SET status = 'posted', ai_draft = $1, posted_at = now() WHERE id = $2",
      [responseText, id]
    );

    res.json({ success: true, posted_at: new Date() });
  } catch (err) {
    console.error("POST /api/reviews/:id/approve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reviews/:id/skip
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

// POST /api/reviews/subscribe
router.post("/subscribe", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
    const FRONTEND_URL = process.env.FRONTEND_URL || "https://aifrontdeskhelper.com";

    const result = await db.query(
      "SELECT stripe_customer_id, plan FROM tenants WHERE id = $1",
      [tenantId]
    );
    const tenant = result.rows[0];
    if (!tenant) return res.status(404).json({ error: "Tenant not found" });

    if (tenant.plan === "elite") {
      return res.status(400).json({ error: "Reviews included in Elite plan" });
    }

    const sessionParams = {
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_REVIEWS_PRICE_ID, quantity: 1 }],
      success_url: `${FRONTEND_URL}/reviews?subscribed=true`,
      cancel_url: `${FRONTEND_URL}/reviews?cancelled=true`,
      metadata: { tenant_id: tenantId, addon: "reviews" },
    };

    if (tenant.stripe_customer_id) sessionParams.customer = tenant.stripe_customer_id;

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    console.error("POST /api/reviews/subscribe error:", err);
    res.status(500).json({ error: "Failed to create checkout session" });
  }
});

// POST /api/reviews/unsubscribe
router.post("/unsubscribe", authMiddleware, async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

    const result = await db.query(
      "SELECT reviews_subscription_id FROM tenants WHERE id = $1",
      [tenantId]
    );
    const tenant = result.rows[0];
    if (!tenant?.reviews_subscription_id) {
      return res.status(400).json({ error: "No active Reviews subscription" });
    }

    await stripe.subscriptions.update(tenant.reviews_subscription_id, {
      cancel_at_period_end: true,
    });

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/reviews/unsubscribe error:", err);
    res.status(500).json({ error: "Failed to cancel subscription" });
  }
});

module.exports = router;
module.exports.pollAllTenants = pollAllTenants;
module.exports.handleReviewsWebhook = async function(event, db) {
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      if (session.metadata?.addon !== "reviews") return;
      await db.query(
        "UPDATE tenants SET reviews_addon_active = true, reviews_subscription_id = $1 WHERE id = $2",
        [session.subscription, session.metadata.tenant_id]
      );
      console.log(`[Reviews] Activated for tenant ${session.metadata.tenant_id}`);
    }

    if (event.type === "customer.subscription.deleted") {
      await db.query(
        "UPDATE tenants SET reviews_addon_active = false, reviews_subscription_id = NULL WHERE reviews_subscription_id = $1",
        [event.data.object.id]
      );
      console.log(`[Reviews] Deactivated — subscription ${event.data.object.id} cancelled`);
    }

    if (event.type === "customer.subscription.updated") {
      if (event.data.object.status === "active") {
        await db.query(
          "UPDATE tenants SET reviews_addon_active = true WHERE reviews_subscription_id = $1",
          [event.data.object.id]
        );
      }
    }
  } catch (err) {
    console.error("[Reviews Webhook] Error:", err);
  }
};

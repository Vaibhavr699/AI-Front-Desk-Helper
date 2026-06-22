"use strict";

/**
 * services/gbpPosting.js
 *
 * GBP Traction — G2: post generation + G3: live publish.
 *
 * generateDraftsForTenant — writes status='draft' rows to gbp_posts. The
 *   generation prompt is tuned for LOCAL SEO + AI-SEARCH RETRIEVAL, not
 *   generic marketing copy (see prompt notes below).
 *
 * publishPost — the gated live path. Requires an image (media_url). Calls the
 *   legacy v4 localPosts.create endpoint via reviewsHelper.authedRequest
 *   (same auth path as Reviews reply), flips status published/failed, stores
 *   the returned resource name. Owner-approval-gated by the route layer.
 *
 * listLocationPhotos — lists existing GBP photos so the owner can pick one as
 *   a post image (re-hosted via lib/gbpImageStore before publish).
 *
 * Auth/billing: callers (routes/gbp.js) gate on hasReviewsAccess BEFORE
 * calling. This service does not re-check billing.
 */

const axios = require("axios");
const db = require("../lib/db");
const reviewsHelper = require("../lib/reviewsHelper");

const LEGACY_V4_BASE = "https://mybusiness.googleapis.com/v4";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_REVIEWS_MODEL || "gpt-4o";

// Map a CTA type to the LocalPost actionType enum Google expects.
const CTA_ACTION_TYPE = {
  LEARN_MORE: "LEARN_MORE",
  BOOK:       "BOOK",
  ORDER:      "ORDER",
  SHOP:       "SHOP",
  SIGN_UP:    "SIGN_UP",
  CALL:       "CALL",
};

function seasonHint(date = new Date()) {
  const m = date.getMonth();
  if (m === 11 || m <= 1) return "winter (interior projects, holiday-season scheduling, cold-weather prep)";
  if (m >= 2 && m <= 4)   return "spring (exterior season ramping up, deck/fence refresh, booking ahead)";
  if (m >= 5 && m <= 7)   return "summer (peak exterior season, fast scheduling, curb appeal)";
  return "fall (last exterior window before winter, interior planning, year-end booking)";
}

async function getTenantContext(tenantId) {
  const res = await db.query(
    `SELECT id, name, company_name, city, state,
            tone_of_voice, instructions, business_type,
            booking_domain, booking_domain_status,
            google_access_token, google_refresh_token, google_token_expiry,
            google_account_id, google_location_id
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

/**
 * Pull the audited primary category + services from the latest gbp_audit
 * snapshot so generation can weave in the EXACT category/keywords Google
 * already associates with this profile. Best-effort.
 */
async function getAuditKeywords(tenantId) {
  try {
    const res = await db.query(
      "SELECT profile_snapshot FROM gbp_audit WHERE tenant_id = $1",
      [tenantId]
    );
    const snap = res.rows[0]?.profile_snapshot || {};
    return {
      primaryCategory: snap.primary_category || null,
    };
  } catch (e) {
    return { primaryCategory: null };
  }
}

async function getRecentJobs(tenantId, limit = 5) {
  try {
    const res = await db.query(
      `SELECT l.name, l.project_type, l.last_service_date, b.preferred_date
         FROM leads l
         LEFT JOIN bookings b ON b.lead_id = l.id
        WHERE l.tenant_id = $1
          AND l.status = 'Won'
          AND l.last_service_date IS NOT NULL
        ORDER BY l.last_service_date DESC
        LIMIT $2`,
      [tenantId, limit]
    );
    return res.rows || [];
  } catch (e) {
    console.warn("[GBP Post] getRecentJobs failed tenant=%s: %s", tenantId, e.message);
    return [];
  }
}

function resolveCtaUrl(tenant) {
  if (tenant.booking_domain && tenant.booking_domain_status === "active") {
    return `https://${tenant.booking_domain}`;
  }
  const base = (process.env.PUBLIC_BACKEND_URL || "https://ai-front-desk-backend.onrender.com").replace(/\/+$/, "");
  return `${base}/book/${tenant.id}`;
}

/**
 * Generate N post drafts. Persists status='draft'. Returns created rows.
 */
async function generateDraftsForTenant(tenantId, { count = 1, postType = "STANDARD" } = {}) {
  if (!OPENAI_API_KEY) return { ok: false, reason: "openai_not_configured" };

  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const jobs = await getRecentJobs(tenantId);
  const { primaryCategory } = await getAuditKeywords(tenantId);
  const ctaUrl = resolveCtaUrl(tenant);
  const businessName = tenant.company_name || tenant.name || "our team";
  const tone = tenant.tone_of_voice || "warm, professional";
  const localArea = [tenant.city, tenant.state].filter(Boolean).join(", ");
  const city = (tenant.city || "").trim();
  const season = seasonHint();
  const categoryLine = primaryCategory ? `Primary Google category: ${primaryCategory}` : "";

  const jobSummary = jobs.length
    ? jobs.map(j => `- ${j.project_type || "project"}${j.last_service_date ? ` (completed ${j.last_service_date})` : ""}`).join("\n")
    : "(no recent completed jobs on file — write about the core services offered)";

  const created = [];

  for (let i = 0; i < count; i++) {
    try {
      // ── SEO / AI-SEARCH-TUNED PROMPT ──────────────────────────────────────
      // The audience for these posts is two-fold: Google's local ranking, and
      // the LLM answer engines (ChatGPT/Gemini/Perplexity) that increasingly
      // answer "best <service> near me" by reading the GBP feed. So the post
      // must be naturally indexable: it should name the SERVICE and the PLACE
      // in plain language a search/answer engine maps to intent — without
      // reading like keyword spam to a human. Specific service language beats
      // vague enthusiasm ("interior cabinet repainting in Omaha" >> "we love
      // what we do"). One clear, plain CTA.
      const systemPrompt =
        "You write short Google Business Profile posts for a local home-services business. " +
        "These posts are read by BOTH humans and AI search engines (ChatGPT, Gemini, Perplexity) " +
        "that answer 'best [service] near me' questions by reading the business's profile feed. " +
        "Your job: write copy that a search/answer engine can clearly map to a real service in a real place, " +
        "while still reading naturally to a person.\n\n" +
        "RULES:\n" +
        "- 1-2 short paragraphs, ~300-700 characters (hard max 1500).\n" +
        "- Name the SPECIFIC service in plain searchable language (e.g. 'interior cabinet repainting', " +
        "'exterior trim and siding painting', 'deck staining'), not vague phrases like 'transform your space'.\n" +
        (city ? `- Mention the service area (${localArea}) ONCE, naturally (e.g. 'for homeowners in ${city}'). Never repeat it or keyword-stuff.\n` : "") +
        "- Voice: " + tone + ". First person plural ('we'). Plain, concrete, credible.\n" +
        "- NO hashtags. NO emojis. At most ONE exclamation point.\n" +
        "- Do NOT invent prices, guarantees, warranties, or customer names.\n" +
        "- Ground it in the real recent work or core services listed.\n" +
        "- End with ONE clear, plain CTA to get a free estimate or book a walkthrough.\n" +
        "- Return ONLY the post body text. No title, no preamble, no quotes, no markdown.";

      const userPrompt =
        `Business: ${businessName}\n` +
        (categoryLine ? categoryLine + "\n" : "") +
        (localArea ? `Service area: ${localArea}\n` : "") +
        `Post type: ${postType}\n` +
        `Recent completed work:\n${jobSummary}\n` +
        `Seasonal context (soft nudge, not a script): ${season}\n` +
        (tenant.instructions ? `Business notes: ${String(tenant.instructions).slice(0, 400)}\n` : "") +
        `\nWrite one ${postType.toLowerCase()} post body now, optimized to be found by search and AI answer engines.`;

      const res = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: OPENAI_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
          temperature: 0.75,
          max_tokens: 500,
        },
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
      );

      const summary = res.data?.choices?.[0]?.message?.content?.trim();
      if (!summary) {
        console.warn("[GBP Post] empty draft from OpenAI tenant=%s", tenantId);
        continue;
      }

      const insert = await db.query(
        `INSERT INTO gbp_posts
           (tenant_id, post_type, summary, cta_type, cta_url, status, source, industry_tag, created_at, updated_at)
         VALUES ($1, $2, $3, 'LEARN_MORE', $4, 'draft', 'ai_generated', $5, now(), now())
         RETURNING id, post_type, summary, cta_type, cta_url, media_url, status, created_at`,
        [tenantId, postType, summary, ctaUrl, tenant.business_type || "home_services"]
      );
      created.push(insert.rows[0]);
    } catch (e) {
      console.error("[GBP Post] draft generation failed tenant=%s: %s", tenantId,
        e.response?.data ? JSON.stringify(e.response.data) : e.message);
    }
  }

  console.log("[GBP Post] generated %d draft(s) tenant=%s", created.length, tenantId);
  return { ok: true, drafts: created };
}

/**
 * List existing GBP photos for the picker. Returns
 * { ok, photos: [{ name, url, createTime }] } or { ok:false, reason }.
 * `url` is Google's googleUrl — used only for preview + as the source we
 * re-host from when the owner picks it (see routes/gbp.js).
 */
async function listLocationPhotos(tenantId, { limit = 24 } = {}) {
  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_account_id && tenant.google_location_id)) {
    return { ok: false, reason: "not_connected" };
  }
  try {
    const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/media`;
    const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
      params: { pageSize: Math.min(100, limit) },
    });
    const items = (res.data?.mediaItems || []).slice(0, limit);
    const photos = items
      .filter(m => m.googleUrl || m.thumbnailUrl)
      .map(m => ({
        name: m.name,
        url: m.googleUrl || m.thumbnailUrl,
        thumbnail: m.thumbnailUrl || m.googleUrl,
        createTime: m.createTime || null,
      }));
    return { ok: true, photos };
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[GBP Post] listLocationPhotos failed tenant=%s: %s", tenantId, detail);
    return { ok: false, reason: "fetch_failed", message: detail };
  }
}

/**
 * Publish a draft/approved post to the live GBP via localPosts.create.
 * REQUIRES the post to have a media_url (image-required rule enforced by the
 * route, double-checked here). Flips status published/failed and stores the
 * returned resource name. Reuses reviewsHelper.authedRequest auth path.
 *
 * Returns { ok, post } or { ok:false, reason, message }.
 */
async function publishPost(tenantId, postId, { approvedBy = null } = {}) {
  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_account_id && tenant.google_location_id && tenant.google_access_token)) {
    return { ok: false, reason: "not_connected" };
  }

  const postRes = await db.query(
    `SELECT id, post_type, summary, cta_type, cta_url, media_url, status,
            offer_coupon_code, offer_terms, event_title, event_start, event_end
       FROM gbp_posts WHERE id = $1 AND tenant_id = $2`,
    [postId, tenantId]
  );
  const post = postRes.rows[0];
  if (!post) return { ok: false, reason: "post_not_found" };
  if (!["draft", "approved", "failed"].includes(post.status)) {
    return { ok: false, reason: "not_publishable", message: `Post is '${post.status}', cannot publish.` };
  }
  // Image-required rule.
  if (!post.media_url) {
    return { ok: false, reason: "image_required", message: "An image is required before publishing." };
  }

  // Mark publishing (so a concurrent approve can't double-fire).
  await db.query(
    "UPDATE gbp_posts SET status = 'publishing', updated_at = now() WHERE id = $1 AND tenant_id = $2",
    [postId, tenantId]
  );

  // Build the LocalPost body. Google v4 localPosts.create shape:
  //   { languageCode, summary, callToAction:{actionType,url}, media:[{mediaFormat,sourceUrl}], topicType }
  const body = {
    languageCode: "en-US",
    summary: post.summary,
    topicType: post.post_type === "OFFER" ? "OFFER"
             : post.post_type === "EVENT" ? "EVENT"
             : "STANDARD",
    media: [{ mediaFormat: "PHOTO", sourceUrl: post.media_url }],
  };

  // CTA (Google rejects callToAction on some OFFER posts; only attach for STANDARD/EVENT).
  const action = CTA_ACTION_TYPE[post.cta_type] || "LEARN_MORE";
  if (post.post_type !== "OFFER" && post.cta_url) {
    body.callToAction = { actionType: action, url: post.cta_url };
  }

  if (post.post_type === "EVENT" && post.event_title && post.event_start) {
    body.event = {
      title: post.event_title,
      schedule: {
        startDate: ymd(post.event_start),
        endDate:   ymd(post.event_end || post.event_start),
      },
    };
  }
  if (post.post_type === "OFFER") {
    body.offer = {};
    if (post.offer_coupon_code) body.offer.couponCode = post.offer_coupon_code;
    if (post.offer_terms)       body.offer.termsConditions = post.offer_terms;
  }

  const url = `${LEGACY_V4_BASE}/${tenant.google_account_id}/${tenant.google_location_id}/localPosts`;

  let createRes;
  try {
    createRes = await reviewsHelper.authedRequest(tenant, "POST", url, { data: body });
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[GBP Post] publish failed tenant=%s post=%s: %s", tenantId, postId, detail);
    await db.query(
      "UPDATE gbp_posts SET status = 'failed', publish_error = $3, updated_at = now() WHERE id = $1 AND tenant_id = $2",
      [postId, tenantId, detail.slice(0, 2000)]
    );
    return { ok: false, reason: "publish_failed", message: detail };
  }

  const resourceName = createRes.data?.name || null;
  const updated = await db.query(
    `UPDATE gbp_posts
        SET status = 'published',
            google_post_resource_name = $3,
            publish_error = NULL,
            approved_by = $4,
            approved_at = now(),
            published_at = now(),
            updated_at = now()
      WHERE id = $1 AND tenant_id = $2
      RETURNING id, post_type, summary, status, google_post_resource_name, published_at`,
    [postId, tenantId, resourceName, approvedBy]
  );

  console.log("[GBP Post] PUBLISHED tenant=%s post=%s resource=%s", tenantId, postId, resourceName);
  return { ok: true, post: updated.rows[0] };
}

// YYYY-MM-DD → {year,month,day} for the EVENT schedule shape.
function ymd(value) {
  const d = new Date(value);
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

module.exports = {
  generateDraftsForTenant,
  listLocationPhotos,
  publishPost,
  // exported for reuse/testing
  getRecentJobs,
  resolveCtaUrl,
  seasonHint,
};

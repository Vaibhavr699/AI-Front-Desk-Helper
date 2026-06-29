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
 *   ── CONTENT ROTATION (Jun 2026) ─────────────────────────────────────────
 *   Posts used to repeat because every generation got the SAME prompt + facts,
 *   so GPT-4o returned rewordings of one idea (all "summer exterior curb
 *   appeal"). Generation now rotates through a 12-CATEGORY calendar so each
 *   post covers a different angle (process, seasonality, how-to, why-us,
 *   booking, FAQ x2, two service spotlights, trends, proof, maintenance).
 *
 *   Two layers:
 *     - OUTER: 12 categories, selected by (existingPostCount + i) % 12. Loops.
 *       No migration — the cursor is derived from how many posts the tenant
 *       already has, so it advances naturally across BOTH manual batches and
 *       the scheduler's recurring cadence (Tue/Thu etc.).
 *     - INNER: FAQ / trends / how-to carry a sub-list of specific topics that
 *       advances each time that category recurs, so the category loops but the
 *       actual question/topic keeps moving.
 *
 *   ── FAQ FROM THE TENANT'S OWN SITE (Phase A, Jun 2026) ───────────────────
 *   When the FAQ category comes up, we PREFER the tenant's real FAQs pulled by
 *   the website extractor (lib/websiteExtractor → website_audits.facts.faqs),
 *   rephrased (never copied) into a GBP post. Only when the site has no FAQ do
 *   we fall back to the generic industry FAQ sub-list. Same site read is wired
 *   exactly like lib/presenceCrossRef.loadLatestWebsiteFacts. No migration for
 *   FAQs — they ride inside the existing website_audits.facts JSONB.
 *
 *   INDUSTRY-AWARE: the category instructions + generic sub-topic lists are
 *   keyed off tenant.business_type via INDUSTRY_PLAYBOOK. Painting is filled
 *   out fully; a generic home-services default covers any vertical not yet
 *   mapped, so the feature WORKS for every tenant on day one and gets sharper
 *   per-vertical when someone adds that industry's block (see "ADD A NEW
 *   INDUSTRY" note). The site-FAQ path works for EVERY industry automatically
 *   because it reads the tenant's own site.
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

// ════════════════════════════════════════════════════════════════════════════
// CONTENT CALENDAR — 12-category rotation
// ════════════════════════════════════════════════════════════════════════════
//
// The ORDER the 12 categories cycle in. FAQ appears twice (indexes 5 and 8),
// spaced apart, because industry FAQ posts are the highest-value content for
// AI-search retrieval. Edit this array to reweight the calendar; the rotation
// math adapts to whatever length it is.
const THEME_ORDER = [
  "process",              // 0  how the work actually gets done
  "seasonality",          // 1  right service for the season / book-ahead
  "howto",                // 2  homeowner tips (sub-rotates)
  "why_us",               // 3  credentials / differentiators
  "book_estimate",        // 4  how fast/easy it is to get a free estimate
  "faq",                  // 5  FAQ — prefers SITE faqs, else generic  ← FAQ #1
  "spotlight_primary",    // 6  the main service
  "spotlight_secondary",  // 7  a second service (breaks the "always exterior" default)
  "faq",                  // 8  FAQ — prefers SITE faqs, else generic  ← FAQ #2
  "trends",               // 9  current trends (sub-rotates)
  "proof",                // 10 recent real work (self-varies from live jobs)
  "maintenance",          // 11 protecting the investment / when to redo
];

// ── INDUSTRY_PLAYBOOK ───────────────────────────────────────────────────────
// Per-vertical content. Keyed by tenant.business_type. Each entry provides:
//   - label:      human label used in logs
//   - categories: { <categoryKey>: "hard instruction line for the post" }
//   - subTopics:  { faq:[...], trends:[...], howto:[...] }  generic topics that
//                 advance each time that category recurs (FAQ generic list is
//                 the FALLBACK when the tenant's site has no FAQ content).
//
// ── ADD A NEW INDUSTRY ──────────────────────────────────────────────────────
// Copy the "_default" block, rename the key to the tenant.business_type value
// (e.g. "roofing"), and rewrite the category lines + subTopics for that trade.
// No other code changes, no migration. Until you do, that vertical uses
// "_default" automatically — it still works, just less trade-specific.
const INDUSTRY_PLAYBOOK = {
  painting: {
    label: "painting",
    categories: {
      process:
        "Explain how a quality paint job actually goes — surface prep, priming, the number of coats, cleanup. Help the reader understand what they're paying for. Do NOT make it a generic curb-appeal pitch.",
      seasonality:
        "Focus on why THIS time of year is right for a specific painting service, and the value of booking ahead before the calendar fills. Tie to the season provided.",
      howto:
        "Give the homeowner one genuinely useful, specific tip they can act on. Teach, don't sell. The specific tip is provided below — write about THAT, not a general overview.",
      why_us:
        "Make the case for choosing this painter: real credentials and differentiators (licensed & insured, quality materials like Sherwin-Williams, locally owned, community involvement). Concrete, not boastful. Only use differentiators that appear in the business notes/facts — do not invent any.",
      book_estimate:
        "Focus on how easy and low-pressure it is to get a free estimate — the booking path, fast scheduling, what to expect on the visit. One clear CTA to book.",
      faq:
        "Answer ONE common industry question clearly and helpfully, in plain language. The specific question is provided below. Answer from general painting knowledge that is true for any reputable painter. Do NOT invent this company's specific prices, warranties, or guarantees.",
      spotlight_primary:
        "Spotlight the business's PRIMARY exterior service (exterior trim and siding painting). Name it in specific, searchable language. Ground it in real recent work if available.",
      spotlight_secondary:
        "Spotlight a DIFFERENT, non-exterior service (interior painting, cabinet refinishing, drywall) so the feed isn't all exterior. Name it specifically.",
      trends:
        "Talk about a current painting trend homeowners are asking about. The specific trend is provided below. Keep it informative, not gimmicky.",
      proof:
        "Highlight recent real completed work (use the recent-jobs list). Make it concrete and local. If no recent jobs are on file, describe the core service honestly without inventing a specific project.",
      maintenance:
        "Help the reader protect their investment — how to make a paint job last, signs it's time to repaint, simple upkeep. Useful and honest.",
    },
    subTopics: {
      faq: [
        "how long exterior paint typically lasts before it needs redoing",
        "the real difference between one coat and two, and when each is right",
        "what prep is involved and whether furniture/landscaping is protected",
        "roughly how long a typical interior or exterior job takes",
        "the difference between interior and exterior paint and why it matters",
        "how to choose the right sheen/finish for a room or surface",
      ],
      trends: [
        "the exterior color palettes homeowners are choosing this year",
        "warm neutrals and earthy tones taking over interiors",
        "black and dark-toned trim, doors, and accents",
        "repainting kitchen cabinets instead of replacing them",
        "matte and low-sheen finishes for a modern look",
      ],
      howto: [
        "how to tell when exterior paint is starting to fail (chalking, peeling, fading)",
        "how to prep walls properly so the finish lasts",
        "how to help interior paint stay looking fresh longer",
        "how to pick exterior colors that suit the home and the neighborhood",
      ],
    },
  },

  // Generic fallback for any vertical not yet mapped. Works out of the box;
  // less trade-specific than a hand-tuned block. Copy + specialize to upgrade.
  _default: {
    label: "home services",
    categories: {
      process:
        "Explain how the work actually gets done, step by step, so the reader understands what they're paying for. Educational, not a sales pitch.",
      seasonality:
        "Focus on why this time of year is a good time for the service and the value of booking ahead. Tie to the season provided.",
      howto:
        "Give the homeowner one genuinely useful, specific tip they can act on. The tip is provided below — write about THAT.",
      why_us:
        "Make the case for choosing this business using only real differentiators that appear in the business notes/facts (licensing, experience, local ownership, materials). Do not invent any.",
      book_estimate:
        "Focus on how easy it is to get a free estimate or quote — the booking path and what to expect. One clear CTA.",
      faq:
        "Answer ONE common industry question in plain language. The specific question is provided below. Answer from general knowledge true for any reputable provider in this trade. Do NOT invent this company's specific prices, warranties, or guarantees.",
      spotlight_primary:
        "Spotlight the business's primary service in specific, searchable language. Ground it in real recent work if available.",
      spotlight_secondary:
        "Spotlight a different, secondary service so the feed shows range. Name it specifically.",
      trends:
        "Talk about a current trend or common homeowner question in this trade. The specific topic is provided below.",
      proof:
        "Highlight recent real completed work from the recent-jobs list. Concrete and local. If none on file, describe the core service honestly without inventing a project.",
      maintenance:
        "Help the reader maintain or protect the result over time — simple upkeep and when to call a pro again.",
    },
    subTopics: {
      faq: [
        "what to look for when hiring a contractor in this trade",
        "how long the work typically takes",
        "what preparation the homeowner should do beforehand",
        "how to know when it's time to schedule this service",
      ],
      trends: [
        "what homeowners in this trade are asking for most this year",
        "popular materials or finishes right now",
        "cost-saving choices customers are making",
      ],
      howto: [
        "how to spot early signs the service is needed",
        "how to prepare your home for the work",
        "how to make the results last longer",
      ],
    },
  },
};

function getPlaybook(businessType) {
  const key = (businessType || "").toLowerCase().trim();
  return INDUSTRY_PLAYBOOK[key] || INDUSTRY_PLAYBOOK._default;
}

// Pick the category for a post given how many posts the tenant already has,
// plus (for sub-rotating categories) the specific topic, advanced by how many
// of THAT category have come before. categoryCountsSoFar is mutated by the
// caller as it generates a batch so multiple posts in one call still advance.
function pickTheme(playbook, absolutePostIndex, categoryCountsSoFar) {
  const category = THEME_ORDER[absolutePostIndex % THEME_ORDER.length];
  let subTopic = null;
  const subList = playbook.subTopics && playbook.subTopics[category];
  if (Array.isArray(subList) && subList.length) {
    const n = categoryCountsSoFar[category] || 0;
    subTopic = subList[n % subList.length];
  }
  return { category, subTopic };
}

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

/**
 * Load the tenant's own FAQs from the latest website_audits row. Mirrors
 * lib/presenceCrossRef.loadLatestWebsiteFacts exactly (same table, same
 * string-or-object facts handling) so this read matches what's deployed.
 * Returns an array of { q, a } (possibly empty). Best-effort, never throws.
 */
async function getSiteFaqs(tenantId) {
  try {
    const res = await db.query(
      `SELECT facts FROM website_audits
        WHERE tenant_id = $1
        ORDER BY created_at DESC
        LIMIT 1`,
      [tenantId]
    );
    const row = res.rows[0];
    if (!row) return [];
    const facts = typeof row.facts === "string" ? JSON.parse(row.facts) : row.facts;
    const faqs = facts && Array.isArray(facts.faqs) ? facts.faqs : [];
    // Keep only well-formed pairs.
    return faqs
      .filter((x) => x && typeof x === "object" && x.q && x.a)
      .map((x) => ({ q: String(x.q).trim(), a: String(x.a).trim() }));
  } catch (e) {
    console.warn("[GBP Post] getSiteFaqs failed tenant=%s: %s", tenantId, e.message);
    return [];
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

// How many posts this tenant already has — drives the rotation cursor so the
// category advances across manual batches AND scheduler cycles with no schema
// change. Counts every post regardless of status (a generated draft "uses up"
// its slot whether or not it's published).
async function getTenantPostCount(tenantId) {
  try {
    const res = await db.query(
      "SELECT COUNT(*)::int AS n FROM gbp_posts WHERE tenant_id = $1",
      [tenantId]
    );
    return res.rows[0]?.n || 0;
  } catch (e) {
    console.warn("[GBP Post] getTenantPostCount failed tenant=%s: %s", tenantId, e.message);
    return 0;
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
 * Each post rotates to the next content category (and sub-topic) so a batch of
 * N — or N posts spread across scheduler cycles — covers N different angles.
 */
async function generateDraftsForTenant(tenantId, { count = 1, postType = "STANDARD" } = {}) {
  if (!OPENAI_API_KEY) return { ok: false, reason: "openai_not_configured" };

  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const jobs = await getRecentJobs(tenantId);
  const { primaryCategory } = await getAuditKeywords(tenantId);
  const siteFaqs = await getSiteFaqs(tenantId); // tenant's OWN FAQs (may be empty)
  const ctaUrl = resolveCtaUrl(tenant);
  const businessName = tenant.company_name || tenant.name || "our team";
  const tone = tenant.tone_of_voice || "warm, professional";
  const localArea = [tenant.city, tenant.state].filter(Boolean).join(", ");
  const city = (tenant.city || "").trim();
  const season = seasonHint();
  const categoryLine = primaryCategory ? `Primary Google category: ${primaryCategory}` : "";

  // Content-rotation setup.
  const playbook = getPlaybook(tenant.business_type);
  const startIndex = await getTenantPostCount(tenantId); // cursor: posts so far
  const categoryCountsSoFar = {}; // advances sub-topics within this batch

  const jobSummary = jobs.length
    ? jobs.map(j => `- ${j.project_type || "project"}${j.last_service_date ? ` (completed ${j.last_service_date})` : ""}`).join("\n")
    : "(no recent completed jobs on file — write about the core services offered)";

  const created = [];

  for (let i = 0; i < count; i++) {
    try {
      // Choose this post's category + specific sub-topic from the rotation.
      const { category, subTopic } = pickTheme(playbook, startIndex + i, categoryCountsSoFar);
      categoryCountsSoFar[category] = (categoryCountsSoFar[category] || 0) + 1;

      const categoryInstruction =
        playbook.categories[category] || INDUSTRY_PLAYBOOK._default.categories[category] || "";

      // ── FAQ category: prefer the tenant's OWN site FAQ, else generic ──────
      // For an FAQ post, if the site has real FAQs we rotate through THOSE
      // (rephrased into a GBP post, never copied). Only when the site has none
      // do we fall back to the generic industry FAQ sub-topic from the playbook.
      let faqSourceLine = "";
      let usedSiteFaq = false;
      if (category === "faq" && siteFaqs.length > 0) {
        // Advance through the tenant's FAQs the same way sub-topics advance:
        // by how many FAQ posts we've emitted so far this batch + cursor.
        const faqIdx = (startIndex + i) % siteFaqs.length;
        const f = siteFaqs[faqIdx];
        usedSiteFaq = true;
        faqSourceLine =
          `\nUse THIS real question and answer from the business's own website as the basis. ` +
          `Rephrase it naturally into a short post — do NOT copy it word-for-word, and do NOT ` +
          `change its meaning or add claims it doesn't make.\n` +
          `Question: ${f.q}\nAnswer (from their site): ${f.a}`;
      }

      // ── SEO / AI-SEARCH-TUNED PROMPT ──────────────────────────────────────
      // The audience is two-fold: Google's local ranking, and the LLM answer
      // engines (ChatGPT/Gemini/Perplexity) that answer "best <service> near me"
      // by reading the GBP feed. Name the SERVICE and the PLACE in plain
      // language. One clear CTA. The per-post CATEGORY instruction is injected
      // as a HARD constraint so each post covers a distinct angle.
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
        "- End with ONE clear, plain CTA to get a free estimate or book a walkthrough.\n" +
        "- Return ONLY the post body text. No title, no preamble, no quotes, no markdown.\n\n" +
        "THIS POST'S TOPIC (write specifically about this — do not drift to a generic pitch):\n" +
        categoryInstruction +
        (faqSourceLine ? faqSourceLine
                       : (subTopic ? `\nSpecific focus for this post: ${subTopic}.` : ""));

      const userPrompt =
        `Business: ${businessName}\n` +
        (categoryLine ? categoryLine + "\n" : "") +
        (localArea ? `Service area: ${localArea}\n` : "") +
        `Post type: ${postType}\n` +
        `Content category: ${category}${usedSiteFaq ? " (from site FAQ)" : subTopic ? ` — ${subTopic}` : ""}\n` +
        `Recent completed work:\n${jobSummary}\n` +
        `Seasonal context (soft nudge, not a script): ${season}\n` +
        (tenant.instructions ? `Business notes: ${String(tenant.instructions).slice(0, 400)}\n` : "") +
        `\nWrite one post body now on the topic above, optimized to be found by search and AI answer engines.`;

      const res = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: OPENAI_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user",   content: userPrompt },
          ],
          temperature: 0.8,
          max_tokens: 500,
        },
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" } }
      );

      const summary = res.data?.choices?.[0]?.message?.content?.trim();
      if (!summary) {
        console.warn("[GBP Post] empty draft from OpenAI tenant=%s category=%s", tenantId, category);
        continue;
      }

      const insert = await db.query(
        `INSERT INTO gbp_posts
           (tenant_id, post_type, summary, cta_type, cta_url, status, source, industry_tag, content_category, created_at, updated_at)
         VALUES ($1, $2, $3, 'LEARN_MORE', $4, 'draft', 'ai_generated', $5, $6, now(), now())
         RETURNING id, post_type, summary, cta_type, cta_url, media_url, status, content_category, created_at`,
        [tenantId, postType, summary, ctaUrl, tenant.business_type || "home_services", category]
      );
      created.push(insert.rows[0]);
      console.log("[GBP Post] draft tenant=%s category=%s%s", tenantId, category,
        usedSiteFaq ? " (site FAQ)" : subTopic ? ` (${subTopic})` : "");
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
  pickTheme,
  getPlaybook,
  getSiteFaqs,
  THEME_ORDER,
};

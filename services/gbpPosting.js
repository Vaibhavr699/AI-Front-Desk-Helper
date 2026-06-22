"use strict";

/**
 * services/gbpPosting.js
 *
 * GBP Traction — G2: Post content generation (DRAFT ONLY, no publishing).
 *
 * Generates on-brand Google Business Profile post drafts and writes them to
 * gbp_posts (mig 107) with status='draft'. This phase does NOT call any
 * Google write API — drafts wait in the approval queue (G3) until the owner
 * approves. Publishing (LocalPosts.create) lands in G3.
 *
 * ── Inputs to a post ───────────────────────────────────────────────────────
 *   - Recent completed jobs (leads/bookings written by the DripJobs
 *     /webhooks/crm/job-completed handler — status='Won' / 'Completed')
 *   - Tenant services + brand voice + city/state (seasonality, local SEO)
 *
 * ── Draft, never blast ─────────────────────────────────────────────────────
 * Mirrors the Reviews discipline: AI proposes, owner disposes. Even Google's
 * own auto-suggested content underperforms a brief human touch, so generation
 * fills a queue — it does not reach the public profile here.
 *
 * Auth/billing: callers (routes/gbp.js) gate on hasReviewsAccess BEFORE
 * calling this. This service does not re-check billing.
 */

const axios = require("axios");
const db = require("../lib/db");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL   = process.env.OPENAI_REVIEWS_MODEL || "gpt-4o";

// Map month → a coarse season hint for the Northern Hemisphere / Omaha-like
// climate. Used only as a soft nudge for the model, never hard-coded copy.
function seasonHint(date = new Date()) {
  const m = date.getMonth(); // 0=Jan
  if (m === 11 || m <= 1) return "winter (interior projects, holiday-season scheduling, cold-weather prep)";
  if (m >= 2 && m <= 4)   return "spring (exterior season ramping up, deck/fence refresh, booking ahead)";
  if (m >= 5 && m <= 7)   return "summer (peak exterior season, fast scheduling, curb appeal)";
  return "fall (last exterior window before winter, interior planning, year-end booking)";
}

/**
 * Pull tenant brand context for prompt building.
 */
async function getTenantContext(tenantId) {
  const res = await db.query(
    `SELECT id, name, company_name, city, state,
            tone_of_voice, instructions,
            booking_domain, booking_domain_status
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  return res.rows[0] || null;
}

/**
 * Recent completed/won jobs for this tenant, to ground posts in real work.
 * Reads the rows the CRM job-completed webhook writes. Best-effort: returns
 * [] on any error so generation can still proceed with services-only context.
 */
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

/**
 * Determine the post's CTA URL: branded booking domain if active, else the
 * default booking page on the backend. Never returns null for LEARN_MORE.
 */
function resolveCtaUrl(tenant) {
  if (tenant.booking_domain && tenant.booking_domain_status === "active") {
    return `https://${tenant.booking_domain}`;
  }
  const base = (process.env.PUBLIC_BACKEND_URL || "https://ai-front-desk-backend.onrender.com").replace(/\/+$/, "");
  return `${base}/book/${tenant.id}`;
}

/**
 * Generate N post drafts (default 1) for a tenant and persist them as
 * status='draft' rows in gbp_posts. Returns the created draft rows.
 *
 * postType: 'STANDARD' | 'OFFER' | 'EVENT' (default STANDARD)
 * Never throws on a single-draft failure — logs and continues; returns
 * whatever was created.
 */
async function generateDraftsForTenant(tenantId, { count = 1, postType = "STANDARD" } = {}) {
  if (!OPENAI_API_KEY) {
    return { ok: false, reason: "openai_not_configured" };
  }

  const tenant = await getTenantContext(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const jobs = await getRecentJobs(tenantId);
  const ctaUrl = resolveCtaUrl(tenant);
  const businessName = tenant.company_name || tenant.name || "our team";
  const tone = tenant.tone_of_voice || "warm, professional";
  const localArea = [tenant.city, tenant.state].filter(Boolean).join(", ");
  const season = seasonHint();

  const jobSummary = jobs.length
    ? jobs.map(j => `- ${j.project_type || "project"}${j.last_service_date ? ` (completed ${j.last_service_date})` : ""}`).join("\n")
    : "(no recent completed jobs on file — write a general post about the services offered)";

  const created = [];

  for (let i = 0; i < count; i++) {
    try {
      const systemPrompt =
        "You write short, authentic Google Business Profile posts for a local home-services business. " +
        "Posts are 1-2 short paragraphs (max ~1500 characters, but aim for 300-600). " +
        "Voice: " + tone + ". First person plural ('we'). " +
        "NO hashtags. NO emojis. NO exclamation-point spam (one at most). " +
        "Do NOT invent specific prices, guarantees, or customer names. " +
        "Ground the post in the real recent work or services provided. " +
        (localArea
          ? "Work in ONE natural mention of the local area (" + localArea + ") — never keyword-stuff. "
          : "") +
        "Seasonal context (use as a soft nudge, not a script): " + season + ". " +
        "End with a light, non-pushy invitation to get an estimate or learn more. " +
        "Return ONLY the post body text — no title, no preamble, no quotation marks.";

      const userPrompt =
        `Business: ${businessName}\n` +
        (localArea ? `Service area: ${localArea}\n` : "") +
        `Post type: ${postType}\n` +
        `Recent completed work:\n${jobSummary}\n` +
        (tenant.instructions ? `Business notes: ${String(tenant.instructions).slice(0, 400)}\n` : "") +
        `\nWrite one ${postType.toLowerCase()} post body now.`;

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
        {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
        }
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
         RETURNING id, post_type, summary, cta_type, cta_url, status, created_at`,
        [tenantId, postType, summary, ctaUrl, tenant.business_type || "home_services"]
      );
      created.push(insert.rows[0]);
    } catch (e) {
      console.error("[GBP Post] draft generation failed tenant=%s: %s", tenantId,
        e.response?.data ? JSON.stringify(e.response.data) : e.message);
      // continue to next draft
    }
  }

  console.log("[GBP Post] generated %d draft(s) tenant=%s", created.length, tenantId);
  return { ok: true, drafts: created };
}

module.exports = {
  generateDraftsForTenant,
  // exported for reuse/testing
  getRecentJobs,
  resolveCtaUrl,
  seasonHint,
};

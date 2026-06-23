"use strict";

/**
 * services/gbpDescription.js
 *
 * GBP STRENGTH ENGINE — flagship fix: the business DESCRIPTION SEO rewrite.
 *
 * Two operations, deliberately separate so the dashboard can run a strict
 * generate -> owner APPROVE -> push flow (we NEVER auto-push a description to
 * a live profile):
 *
 *   generateDescription(tenantId, { angle }) -> { ok, current, proposed, ... }
 *       Reads the current description + tenant context, asks GPT-4o for an
 *       optimized rewrite weighted toward an optional `angle`, returns the
 *       proposed text WITHOUT writing anything.
 *
 *   pushDescription(tenantId, text) -> { ok, description }
 *       Validates length (Google hard limit 750 chars) and PATCHes
 *       profile.description on the Business Information API location.
 *
 * API surface: profile.description lives on the Business Information API
 * location resource (mybusinessbusinessinformation.googleapis.com/v1), the
 * SAME resource gbpAudit.fetchLocation reads. Writing is a PATCH with
 * updateMask=profile.description. That API is already enabled (the audit reads
 * it), so unlike the booking link (placeActions) there's no GCP enable step.
 *
 * OpenAI: this codebase calls GPT-4o via raw fetch to the OpenAI REST API
 * (see server.js runSmsAiOrchestrator / OPENAI_TEXT_MODEL), NOT the `openai`
 * npm SDK. We match that pattern here — no new dependency.
 *
 * Auth/billing: callers (routes/gbp.js) gate on hasReviewsAccess first. Reuses
 * reviewsHelper.authedRequest for token refresh + 401 retry.
 */

const db = require("../lib/db");
const fetch = require("node-fetch");
const reviewsHelper = require("../lib/reviewsHelper");

const BIZ_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const DESC_MAX = 750; // Google hard limit on profile.description
const OPENAI_MODEL = "gpt-4o";

const READ_MASK = [
  "name",
  "title",
  "profile",
  "categories",
  "serviceItems",
  "storefrontAddress",
  "serviceArea",
].join(",");

// Angle keys the picker offers. null/"balanced" = smart default.
const ANGLES = {
  balanced:   "Balance all services evenly with strong local-SEO keywords, the service-area cities, and a clear booking call-to-action.",
  margin:     "Lead with and emphasize the highest-value / highest-margin service while still mentioning the others, so the profile attracts more of that premium work.",
  geo:        "Maximize geographic reach: weave the service-area cities/suburbs in naturally and repeatedly with 'near me' style local phrasing to rank across the whole service area, not just the home city.",
  commercial: "Tilt toward commercial / property-management clients: emphasize crews, scale, insured/licensed credibility, and the ability to handle larger commercial jobs.",
  trust:      "Lead with trust and differentiation: years in business, licensed & insured, warranty/guarantee, free estimates, and review reputation — for searchers comparing on quality not price.",
  speed:      "Emphasize speed and convenience: instant online quote, fast scheduling, easy booking — tied to the booking call-to-action — to convert 'I want it done now' searchers.",
};

/**
 * Defensive tenant load. We SELECT only id/name/company_name + the google
 * columns that definitely exist (used by every other GBP service), then try
 * a SECOND optional read for vertical_name/services_offered/booking_domain so
 * a missing column in some environment can't throw and take down the router.
 */
async function loadTenant(tenantId) {
  const base = await db.query(
    `SELECT id, name, company_name,
            google_access_token, google_refresh_token, google_token_expiry,
            google_account_id, google_location_id
       FROM tenants WHERE id = $1`,
    [tenantId]
  );
  const tenant = base.rows[0];
  if (!tenant) return null;

  // Optional context columns — best-effort, never fatal.
  try {
    const extra = await db.query(
      `SELECT vertical_name, services_offered, booking_domain, booking_domain_status
         FROM tenants WHERE id = $1`,
      [tenantId]
    );
    Object.assign(tenant, extra.rows[0] || {});
  } catch (e) {
    console.warn("[GBP Description] optional tenant cols unavailable: %s", e.message);
  }
  return tenant;
}

function resolveBookingUrl(tenant) {
  if (tenant.booking_domain && tenant.booking_domain_status === "active") {
    return `https://${tenant.booking_domain}`;
  }
  return null;
}

async function fetchLocation(tenant) {
  const url = `${BIZ_INFO_BASE}/${tenant.google_location_id}`;
  const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
    params: { readMask: READ_MASK },
  });
  return res.data || {};
}

function buildContext(tenant, location) {
  const title = location.title || tenant.company_name || tenant.name || "the business";
  const primaryCategory = location.categories?.primaryCategory
    ? (location.categories.primaryCategory.displayName || location.categories.primaryCategory.name)
    : (tenant.vertical_name || null);

  const city = location.storefrontAddress?.locality || null;
  const region = location.storefrontAddress?.administrativeArea || null;

  const places = location.serviceArea?.places?.placeInfos || [];
  const areaCities = places
    .map((p) => (p.placeName ? String(p.placeName).split(",")[0].trim() : null))
    .filter(Boolean)
    .slice(0, 12);

  const svcNames = [];
  for (const item of location.serviceItems || []) {
    const label =
      item.freeFormServiceItem?.label?.displayName ||
      item.structuredServiceItem?.description ||
      null;
    if (label && !svcNames.includes(label)) svcNames.push(label);
  }
  let services = svcNames;
  if (services.length === 0 && tenant.services_offered) {
    if (Array.isArray(tenant.services_offered)) services = tenant.services_offered;
    else if (typeof tenant.services_offered === "string") {
      services = tenant.services_offered.split(/[,;\n]/).map((x) => x.trim()).filter(Boolean);
    }
  }

  return {
    title,
    primaryCategory,
    city,
    region,
    areaCities,
    services: services.slice(0, 12),
    bookingUrl: resolveBookingUrl(tenant),
    currentDescription: location.profile?.description || "",
  };
}

function buildMessages(ctx, angleKey) {
  const angle = ANGLES[angleKey] || ANGLES.balanced;

  const lines = [];
  lines.push(`Business name: ${ctx.title}`);
  if (ctx.primaryCategory) lines.push(`Category: ${ctx.primaryCategory}`);
  if (ctx.city) lines.push(`Primary city: ${ctx.city}${ctx.region ? ", " + ctx.region : ""}`);
  if (ctx.areaCities.length) lines.push(`Service-area cities: ${ctx.areaCities.join(", ")}`);
  if (ctx.services.length) lines.push(`Services: ${ctx.services.join(", ")}`);
  if (ctx.bookingUrl) lines.push(`Booking page: ${ctx.bookingUrl}`);
  if (ctx.currentDescription) lines.push(`Current description: """${ctx.currentDescription}"""`);

  const system =
    "You write Google Business Profile 'from the business' descriptions that rank well in local search and read naturally to a homeowner. " +
    "You write ONE description as plain prose. No markdown, no headings, no bullet points, no quotes around the whole thing, no emojis. " +
    "Hard rules: " +
    `(1) Maximum ${DESC_MAX} characters - count carefully and stay under it. ` +
    "(2) Put the primary category keyword (e.g. 'painter' / 'painting contractor') in the first sentence. " +
    "(3) Mention the main city early and weave in service-area cities naturally where it fits. " +
    "(4) Name the core services. " +
    "(5) End with a soft call to action to get a quote or book, mentioning the booking page only if one was provided (write the bare domain, not a markdown link). " +
    "(6) Sound like a real local business, not an ad. No superlatives you can't back up, no 'best in town' fluff. " +
    "Return ONLY the description text, nothing else.";

  const user =
    `Write an optimized Google Business Profile description.\n\n` +
    `Weighting / angle: ${angle}\n\n` +
    `Business details:\n${lines.join("\n")}`;

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

async function callOpenAIChat(messages, { temperature = 0.7, maxTokens = 500 } = {}) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      temperature,
      max_tokens: maxTokens,
      messages,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function generateDescription(tenantId, { angle } = {}) {
  const tenant = await loadTenant(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_access_token && tenant.google_location_id)) {
    return { ok: false, reason: "not_connected" };
  }

  let location;
  try {
    location = await fetchLocation(tenant);
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[GBP Description] location fetch failed tenant=%s: %s", tenantId, detail);
    return { ok: false, reason: "fetch_failed", message: detail };
  }

  const ctx = buildContext(tenant, location);
  const angleKey = angle && ANGLES[angle] ? angle : "balanced";

  let proposed;
  try {
    proposed = await callOpenAIChat(buildMessages(ctx, angleKey), { temperature: 0.7, maxTokens: 500 });
  } catch (e) {
    console.error("[GBP Description] GPT-4o failed tenant=%s: %s", tenantId, e.message);
    return { ok: false, reason: "generation_failed", message: e.message };
  }

  // Strip wrapping quotes the model sometimes adds despite instructions.
  proposed = proposed.replace(/^["'\u201C\u201D]+|["'\u201C\u201D]+$/g, "").trim();

  let overLimit = false;
  if (proposed.length > DESC_MAX) {
    overLimit = true;
    const slice = proposed.slice(0, DESC_MAX);
    const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
    proposed = (lastStop > 200 ? slice.slice(0, lastStop + 1) : slice).trim();
  }

  return {
    ok: true,
    current: ctx.currentDescription,
    proposed,
    length: proposed.length,
    max: DESC_MAX,
    angle: angleKey,
    over_limit: overLimit,
  };
}

async function pushDescription(tenantId, text) {
  const description = String(text || "").trim();
  if (!description) return { ok: false, reason: "empty" };
  if (description.length > DESC_MAX) {
    return { ok: false, reason: "too_long", message: `Description is ${description.length} chars; max is ${DESC_MAX}.` };
  }

  const tenant = await loadTenant(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!(tenant.google_access_token && tenant.google_location_id)) {
    return { ok: false, reason: "not_connected" };
  }

  const url = `${BIZ_INFO_BASE}/${tenant.google_location_id}`;
  try {
    await reviewsHelper.authedRequest(tenant, "PATCH", url, {
      params: { updateMask: "profile.description" },
      data: { profile: { description } },
    });
    console.log("[GBP Description] pushed tenant=%s len=%d", tenantId, description.length);
    return { ok: true, description };
  } catch (e) {
    const detail = e.response?.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[GBP Description] push failed tenant=%s: %s", tenantId, detail);
    const lc = String(detail).toLowerCase();
    if (lc.includes("permission")) return { ok: false, reason: "permission_denied", message: detail };
    if (lc.includes("disabled") || lc.includes("not been used") || lc.includes("not enabled")) {
      return { ok: false, reason: "api_not_enabled", message: detail };
    }
    return { ok: false, reason: "push_failed", message: detail };
  }
}

module.exports = {
  generateDescription,
  pushDescription,
  ANGLES,
  DESC_MAX,
};

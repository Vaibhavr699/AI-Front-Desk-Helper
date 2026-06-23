"use strict";

/**
 * services/gbpServices.js
 *
 * GBP STRENGTH ENGINE — services GUIDE (read + suggest only, NO writes).
 *
 * Why guide-only: the GBP API's service-write path is clunky (you must fetch
 * the allowed serviceTypes for the location's category, then write only from
 * that set) AND has a destructive failure mode (a bad write can blank the
 * existing services list). The visible "products" grid isn't API-writable at
 * all. So this build READS the current services and SUGGESTS additions the
 * owner adds by hand. Service WRITES are a deferred future module.
 *
 *   suggestServices(tenantId) -> { ok, current, suggested_to_add, ... }
 *       Reads the live serviceItems, asks GPT-4o for the standard service
 *       names a business in this category should list, returns the diff. No
 *       write to Google at any point.
 *
 * OpenAI via raw fetch (matches server.js), NOT the openai npm SDK.
 * Auth/billing: callers (routes/gbp.js) gate on hasReviewsAccess first.
 */

const db = require("../lib/db");
const fetch = require("node-fetch");
const reviewsHelper = require("../lib/reviewsHelper");

const BIZ_INFO_BASE = "https://mybusinessbusinessinformation.googleapis.com/v1";
const READ_MASK = ["name", "title", "categories", "serviceItems"].join(",");
const OPENAI_MODEL = "gpt-4o";

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
  try {
    const extra = await db.query(`SELECT vertical_name FROM tenants WHERE id = $1`, [tenantId]);
    Object.assign(tenant, extra.rows[0] || {});
  } catch (e) {
    console.warn("[GBP Services] optional tenant cols unavailable: %s", e.message);
  }
  return tenant;
}

async function fetchLocation(tenant) {
  const url = `${BIZ_INFO_BASE}/${tenant.google_location_id}`;
  const res = await reviewsHelper.authedRequest(tenant, "GET", url, {
    params: { readMask: READ_MASK },
  });
  return res.data || {};
}

function currentServiceNames(location) {
  const names = [];
  for (const item of location.serviceItems || []) {
    const label =
      item.freeFormServiceItem?.label?.displayName ||
      item.structuredServiceItem?.description ||
      null;
    if (label && !names.includes(label)) names.push(label);
  }
  return names;
}

function normalizeForCompare(s) {
  return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function callOpenAIChat(messages, { temperature = 0.4, maxTokens = 300 } = {}) {
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

async function suggestServices(tenantId) {
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
    console.error("[GBP Services] location fetch failed tenant=%s: %s", tenantId, detail);
    return { ok: false, reason: "fetch_failed", message: detail };
  }

  const current = currentServiceNames(location);
  const category = location.categories?.primaryCategory
    ? (location.categories.primaryCategory.displayName || location.categories.primaryCategory.name)
    : (tenant.vertical_name || "home services contractor");

  let suggestedAll = [];
  try {
    const system =
      "You list the standard, customer-recognizable services a business in a given category should have on its Google Business Profile. " +
      "Return ONLY a JSON array of short service-name strings (2-4 words each, Title Case), no commentary, no markdown, no code fences. " +
      "Use the plain names customers search for (e.g. 'Interior Painting', 'Cabinet Refinishing'), not internal jargon. 8-14 items.";
    const user =
      `Category / trade: ${category}\n` +
      (current.length ? `Already listed (don't repeat these): ${current.join(", ")}\n` : "") +
      `List the standard services this business should have on its profile.`;

    let raw = await callOpenAIChat(
      [{ role: "system", content: system }, { role: "user", content: user }],
      { temperature: 0.4, maxTokens: 300 }
    );
    raw = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) suggestedAll = parsed.map((x) => String(x).trim()).filter(Boolean);
  } catch (e) {
    console.error("[GBP Services] GPT-4o/parse failed tenant=%s: %s", tenantId, e.message);
    return { ok: false, reason: "suggest_failed", message: e.message };
  }

  const haveNorm = new Set(current.map(normalizeForCompare));
  const toAdd = [];
  for (const s of suggestedAll) {
    const n = normalizeForCompare(s);
    if (!haveNorm.has(n) && !toAdd.some((t) => normalizeForCompare(t) === n)) toAdd.push(s);
  }

  return {
    ok: true,
    category,
    current,
    suggested_to_add: toAdd,
    all_suggested: suggestedAll,
    copy_block: toAdd.join("\n"),
    note: "Add these in your Google Business Profile under Edit profile -> Services. (We don't change your services automatically to avoid overwriting your list.)",
  };
}

module.exports = {
  suggestServices,
  currentServiceNames,
};

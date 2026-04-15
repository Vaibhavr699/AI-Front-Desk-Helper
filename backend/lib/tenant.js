"use strict";

const db = require("./db");

let cache = null;
let cacheTime = 0;
const CACHE_MS = 60000;

function normalizePhone(phone) {
  return (phone || "").replace(/\D/g, "").slice(-10);
}

async function getTenantByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized || normalized.length < 10) return null;
  const res = await db.query(
    `SELECT t.*, pn.phone as matched_phone, pn.lead_source
     FROM tenants t
     JOIN phone_numbers pn ON pn.tenant_id = t.id
     WHERE RIGHT(REGEXP_REPLACE(pn.phone, '\\D', '', 'g'), 10) = $1
     LIMIT 1`,
    [normalized]
  );
  return res.rows[0] || null;
}

async function getTenantById(id) {
  if (!id || typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return null;
  }
  const res = await db.query("SELECT * FROM tenants WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function getTenantByFacebookPageId(pageId) {
  if (!pageId) return null;
  // pageId from webhook is usually numeric (e.g. 61576059478850)
  // If we have a URL in the DB, we want to match it.
  const res = await db.query(
    "SELECT * FROM tenants WHERE facebook_page_id = $1 OR facebook_page_id LIKE '%' || $2 LIMIT 1",
    [pageId, pageId]
  );
  return res.rows[0] || null;
}

async function getTenantBySlug(slug) {
  if (!slug) return null;
  const lookupSlug = slug === "gladiators-painting" ? "gladiator-painting" : slug;
  const res = await db.query("SELECT * FROM tenants WHERE slug = $1 LIMIT 1", [lookupSlug]);
  return res.rows[0] || null;
}

async function getAllTenants() {
  if (cache && Date.now() - cacheTime < CACHE_MS) return cache;
  const res = await db.query(
    "SELECT * FROM tenants ORDER BY name"
  );
  cache = res.rows;
  cacheTime = Date.now();
  return cache;
}

function invalidateTenantCache() {
  cache = null;
}

module.exports = {
  getTenantByPhone,
  getTenantById,
  getAllTenants,
  getTenantByFacebookPageId,
  getTenantBySlug,
  invalidateTenantCache,
};

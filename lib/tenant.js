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
    `SELECT t.*, pn.phone as matched_phone
     FROM tenants t
     JOIN phone_numbers pn ON pn.tenant_id = t.id
     WHERE RIGHT(REGEXP_REPLACE(pn.phone, '\\D', '', 'g'), 10) = $1
     LIMIT 1`,
    [normalized]
  );
  return res.rows[0] || null;
}

async function getTenantById(id) {
  const res = await db.query("SELECT * FROM tenants WHERE id = $1", [id]);
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
  invalidateTenantCache,
};

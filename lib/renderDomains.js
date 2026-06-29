"use strict";
const fetch = require("node-fetch");

const RENDER_API_BASE = "https://api.render.com/v1";
const SERVICE_ID = process.env.RENDER_SERVICE_ID || "srv-d6e9527gi27c738qvuc0";

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

// POST /v1/services/{serviceId}/custom-domains  body { name }
// Returns { ok, id, verificationStatus } | { ok:false, reason }
async function addCustomDomain(name) {
  if (!process.env.RENDER_API_KEY) return { ok: false, reason: "render_not_configured" };
  try {
    const r = await fetch(`${RENDER_API_BASE}/services/${SERVICE_ID}/custom-domains`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ name }),
    });
    if (r.status === 201) {
      const d = await r.json();
      return { ok: true, id: d.id, verificationStatus: d.verificationStatus, name: d.name };
    }
    if (r.status === 409) return { ok: false, reason: "already_added" };
    if (r.status === 402) return { ok: false, reason: "payment_required" };
    const body = await r.text();
    console.error("[renderDomains] add failed status=%s body=%s", r.status, body.slice(0, 300));
    return { ok: false, reason: `render_error_${r.status}` };
  } catch (e) {
    console.error("[renderDomains] add threw:", e.message);
    return { ok: false, reason: "render_exception", message: e.message };
  }
}

// GET /v1/services/{serviceId}/custom-domains → find one by name
async function getDomainStatus(name) {
  if (!process.env.RENDER_API_KEY) return { ok: false, reason: "render_not_configured" };
  try {
    const r = await fetch(`${RENDER_API_BASE}/services/${SERVICE_ID}/custom-domains?limit=100`, {
      headers: authHeaders(),
    });
    if (!r.ok) return { ok: false, reason: `render_error_${r.status}` };
    const list = await r.json();
    // Render list responses are arrays of { customDomain: {...} } or flat — handle both.
    const rows = Array.isArray(list) ? list.map((x) => x.customDomain || x) : [];
    const match = rows.find((d) => (d.name || "").toLowerCase() === name.toLowerCase());
    if (!match) return { ok: true, found: false };
    return { ok: true, found: true, verificationStatus: match.verificationStatus, id: match.id };
  } catch (e) {
    console.error("[renderDomains] status threw:", e.message);
    return { ok: false, reason: "render_exception", message: e.message };
  }
}

module.exports = { addCustomDomain, getDomainStatus };

// routes/serviceArea.js
// PATCH /api/tenants/:id/service-area — set, update, or clear the service area
//
// Mounted at /api/tenants in server.js with authMiddleware. Validates the
// JSONB shape per type, audit-logs via logAction, returns updated tenant.
// Pass body { service_area: null } to clear.
//
// (Migration 068 — May 14, 2026)

const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { logAction } = require("../lib/auditLogger");

const US_STATES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY",
  "DC"
]);

function normalizeStateList(values) {
  if (!Array.isArray(values)) return { error: "values must be an array of state codes" };
  const seen = new Set();
  const cleaned = [];
  for (const raw of values) {
    if (typeof raw !== "string") return { error: "state codes must be strings" };
    const code = raw.trim().toUpperCase();
    if (!US_STATES.has(code)) return { error: `Invalid state code: ${raw}` };
    if (!seen.has(code)) { seen.add(code); cleaned.push(code); }
  }
  if (cleaned.length === 0) return { error: "Select at least one state" };
  return { values: cleaned };
}

function normalizeRadius(values) {
  if (!Array.isArray(values) || values.length !== 1) {
    return { error: "radius requires exactly one numeric value (miles)" };
  }
  const miles = Number(values[0]);
  if (!Number.isFinite(miles) || miles < 1 || miles > 100) {
    return { error: "Radius must be between 1 and 100 miles" };
  }
  return { values: [Math.round(miles)] };
}

function normalizeZips(values) {
  if (!Array.isArray(values)) return { error: "values must be an array of zip codes" };
  const seen = new Set();
  const cleaned = [];
  for (const raw of values) {
    const z = String(raw || "").trim();
    if (!/^\d{5}$/.test(z)) return { error: `Invalid ZIP: ${raw} (must be exactly 5 digits)` };
    if (!seen.has(z)) { seen.add(z); cleaned.push(z); }
  }
  if (cleaned.length === 0) return { error: "Add at least one ZIP code" };
  if (cleaned.length > 500) return { error: "Maximum 500 ZIP codes per tenant" };
  return { values: cleaned };
}

router.patch("/:id/service-area", async (req, res) => {
  const tenantId = req.params.id;

  // ── Auth + ownership guard ──────────────────────────────────
  if (!req.user) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  if (req.user.tenant_id !== tenantId && !req.user.is_super_admin) {
    return res.status(403).json({ error: "Forbidden — cannot modify another tenant's service area" });
  }

  const { service_area } = req.body || {};

  // ── Clear path ──────────────────────────────────────────────
  if (service_area === null) {
    try {
      const existing = await db.query(
        "SELECT service_area FROM tenants WHERE id = $1 LIMIT 1",
        [tenantId]
      );
      if (existing.rows.length === 0) {
        return res.status(404).json({ error: "Tenant not found" });
      }

      const updated = await db.query(
        "UPDATE tenants SET service_area = NULL, updated_at = now() WHERE id = $1 RETURNING *",
        [tenantId]
      );

      await logAction({
        tenant_id: tenantId,
        actor_type: req.user.is_super_admin ? "superadmin" : "owner",
        actor_id: req.user.id || null,
        action: "service_area.cleared",
        target_type: "tenant",
        target_id: tenantId,
        metadata: { previous: existing.rows[0].service_area || null }
      });

      return res.json({ tenant: updated.rows[0] });
    } catch (e) {
      console.error("[serviceArea] clear path error:", e.message);
      return res.status(500).json({ error: e.message });
    }
  }

  // ── Validate shape ──────────────────────────────────────────
  if (!service_area || typeof service_area !== "object") {
    return res.status(400).json({ error: "service_area must be an object or null" });
  }
  const { type, values, home_city, home_state } = service_area;
  if (!["states", "radius", "zips"].includes(type)) {
    return res.status(400).json({ error: "type must be one of: states, radius, zips" });
  }

  let normalized;
  if (type === "states") normalized = normalizeStateList(values);
  else if (type === "radius") normalized = normalizeRadius(values);
  else normalized = normalizeZips(values);

  if (normalized.error) return res.status(400).json({ error: normalized.error });

  // home_city / home_state: required for radius, recommended for others.
  const homeCity = (home_city || "").trim();
  const homeState = (home_state || "").trim().toUpperCase();

  if (type === "radius") {
    if (!homeCity) {
      return res.status(400).json({ error: "home_city is required for radius mode" });
    }
    if (!homeState || !US_STATES.has(homeState)) {
      return res.status(400).json({ error: "home_state must be a valid US state code for radius mode" });
    }
  }
  if (homeState && !US_STATES.has(homeState)) {
    return res.status(400).json({ error: `Invalid home_state: ${home_state}` });
  }

  const payload = {
    type,
    values: normalized.values,
    home_city: homeCity || null,
    home_state: homeState || null
  };

  try {
    const existing = await db.query(
      "SELECT service_area FROM tenants WHERE id = $1 LIMIT 1",
      [tenantId]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    const updated = await db.query(
      "UPDATE tenants SET service_area = $1::jsonb, updated_at = now() WHERE id = $2 RETURNING *",
      [JSON.stringify(payload), tenantId]
    );

    await logAction({
      tenant_id: tenantId,
      actor_type: req.user.is_super_admin ? "superadmin" : "owner",
      actor_id: req.user.id || null,
      action: existing.rows[0].service_area ? "service_area.updated" : "service_area.set",
      target_type: "tenant",
      target_id: tenantId,
      metadata: {
        previous: existing.rows[0].service_area || null,
        next: payload
      }
    });

    return res.json({ tenant: updated.rows[0] });
  } catch (e) {
    console.error("[serviceArea] set/update path error:", e.message);
    return res.status(500).json({ error: e.message });
  }
});

module.exports = router;

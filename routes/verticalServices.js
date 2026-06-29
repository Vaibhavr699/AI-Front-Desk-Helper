"use strict";

/**
 * routes/verticalServices.js
 *
 * Tenant-scoped lookup of services in the tenant's vertical (Phase 7 V2,
 * May 12, 2026). Powers the Service Rate Adjustments section of the
 * Estimator tab so it renders the correct services per vertical:
 *   - Painting tenants → Interior / Exterior / Cabinets / Deck & Fence
 *   - Home Exterior tenants → Siding / Roofing / Gutters / Fence
 *
 * Replaces the previously hardcoded painting-only frontend list, which
 * was leaking painting services into Paragon's home_exterior dashboard
 * (caught May 12, 2026).
 *
 * GET /api/estimator/services/:tenantId
 *   Returns: {
 *     services: [
 *       { vertical_service_id, service_slug, display_label, unit_description }
 *     ]
 *   }
 *
 * URL-based tenantId to match the sibling /api/estimator/rate-overrides
 * pattern. Joins through tenants.vertical_id → vertical_services so a
 * tenant can never see services outside their own vertical.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");

router.get("/:tenantId", async (req, res) => {
  const { tenantId } = req.params;
  if (!tenantId) {
    return res.status(400).json({ error: "tenantId required" });
  }

  try {
    const result = await db.query(
      `SELECT
         vs.id           AS vertical_service_id,
         vs.service_slug AS service_slug,
         vs.display_name AS display_name,
         vs.pricing_mode AS pricing_mode
       FROM vertical_services vs
       JOIN tenants t ON t.vertical_id = vs.vertical_id
       WHERE t.id = $1
       ORDER BY vs.id`,
      [tenantId]
    );

    const services = result.rows.map((row) => ({
      vertical_service_id: row.vertical_service_id,
      service_slug: row.service_slug,
      display_label: row.display_name || formatSlugFallback(row.service_slug),
      unit_description: describePricingMode(row.pricing_mode),
    }));

    res.json({ services });
  } catch (err) {
    console.error(
      "[VerticalServices] GET failed tenant=%s err=%s",
      tenantId,
      err.message
    );
    res.status(500).json({ error: "Failed to load services" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

// Fallback if display_name is null — title-case the slug.
function formatSlugFallback(slug) {
  if (!slug) return "Service";
  return String(slug)
    .split(/[_-]/g)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

// Map vertical_services.pricing_mode → human-readable UI unit description.
// Falls back gracefully if mode is unknown so we never crash a tenant's
// settings page over a missing label.
function describePricingMode(mode) {
  switch (mode) {
    case "per_room_bundled":     return "per room (size-bucketed)";
    case "per_paintable_sqft":   return "per paintable sqft";
    case "bundled_per_facing":   return "per door/drawer facing";
    case "per_sq":               return "per square (100 sqft)";
    case "per_lf":               return "per linear ft";
    case "per_sqft":             return "per sqft";
    case "per_unit":             return "per unit";
    case "industry_default":     return "per sqft / per linear ft";
    case "flat":                 return "flat rate";
    default:
      return mode ? `per ${mode.replace(/_/g, " ")}` : "default rate";
  }
}

module.exports = router;

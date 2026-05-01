"use strict";

// ============================================================================
// routes/estimatorAdmin.js
// ============================================================================
// Phase 7 V1 — Admin estimator endpoints. Mounted at /api/admin/estimator.
// Auth: requireSuperAdmin (gated at router mount in server.js).
//
// Endpoints:
//   GET /vertical/:slug  → full vertical inspection (services, mods, rates, etc.)
// ============================================================================

const express = require("express");
const db = require("../lib/db");

const router = express.Router();

// -------------------- GET /vertical/:slug --------------------
//
// Returns the full configured state of a vertical: services, modifier
// categories with options, service-modifier junction, widget questions,
// default rates across all buckets, and regional multipliers.
//
// Used for admin debugging — "is the painting vertical correctly seeded?"
// and for future per-tenant override tooling.
router.get("/vertical/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;
    if (!slug) return res.status(400).json({ error: "slug required" });

    const verticalRes = await db.query(
      `SELECT * FROM verticals WHERE slug = $1 LIMIT 1`,
      [slug]
    );
    const vertical = verticalRes.rows[0];
    if (!vertical) return res.status(404).json({ error: `Vertical not found: ${slug}` });

    const verticalId = vertical.vertical_id;

    const [services, modifiers, junction, questions, rates, multipliers] = await Promise.all([
      db.query(
        `SELECT * FROM vertical_services WHERE vertical_id = $1 ORDER BY sort_order`,
        [verticalId]
      ),
      db.query(
        `SELECT * FROM vertical_modifier_categories WHERE vertical_id = $1 ORDER BY sort_order`,
        [verticalId]
      ),
      db.query(
        `SELECT vsmc.*, vs.service_slug, vmc.category_slug
           FROM vertical_service_modifier_categories vsmc
           JOIN vertical_services vs ON vs.id = vsmc.service_id
           JOIN vertical_modifier_categories vmc ON vmc.id = vsmc.modifier_category_id
          WHERE vs.vertical_id = $1
          ORDER BY vs.sort_order, vsmc.sort_order`,
        [verticalId]
      ),
      db.query(
        `SELECT * FROM vertical_widget_questions WHERE vertical_id = $1 ORDER BY sort_order`,
        [verticalId]
      ),
      db.query(
        `SELECT * FROM vertical_default_rates WHERE vertical_id = $1
          ORDER BY service_slug, cost_region, unit`,
        [verticalId]
      ),
      db.query(
        `SELECT * FROM vertical_regional_multipliers WHERE vertical_id = $1 ORDER BY bucket`,
        [verticalId]
      ),
    ]);

    res.json({
      vertical,
      services: services.rows,
      modifiers: modifiers.rows,
      junction: junction.rows,
      questions: questions.rows,
      rates: rates.rows,
      multipliers: multipliers.rows,
      counts: {
        services: services.rows.length,
        modifiers: modifiers.rows.length,
        junction: junction.rows.length,
        questions: questions.rows.length,
        rates: rates.rows.length,
        multipliers: multipliers.rows.length,
      },
    });
  } catch (e) {
    console.error("[EstimatorAdmin] /vertical error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

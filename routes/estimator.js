"use strict";

// ============================================================================
// routes/estimator.js
// ============================================================================
// Phase 7 V1 — Public estimator endpoints. Called by widget JS from painter
// websites (cross-origin). NO auth — these are widget-facing.
//
// Endpoints (mounted at /api/estimator):
//   POST /quote                    → calculate price range
//   POST /validate                 → input validation only
//   GET  /tenant-config/:tenantId  → widget config bundle
//   POST /lead                     → capture estimator_payload to leads
//
// Admin-only endpoint (GET /vertical/:slug) lives in routes/estimatorAdmin.js
// and mounts at /api/admin/estimator with requireSuperAdmin gate.
// ============================================================================

const express = require("express");
const db = require("../lib/db");
const estimator = require("../lib/estimator");
const leadsService = require("../services/leads");

const router = express.Router();

// -------------------- POST /quote --------------------
//
// Body: { tenant_id, service_slug, inputs }
// Returns either a quote with range_min_cents/range_max_cents, OR a
// specialized routing object with reason/trigger.
router.post("/quote", async (req, res) => {
  try {
    const { tenant_id, service_slug, inputs } = req.body || {};

    if (!tenant_id || !service_slug) {
      return res.status(400).json({ error: "tenant_id and service_slug are required" });
    }

    // Validate first — surface input errors before hitting DB
    const validation = estimator.validateInputs(service_slug, inputs || {});
    if (!validation.valid) {
      return res.status(400).json({
        error: "Invalid inputs",
        validation_errors: validation.errors,
      });
    }

    const result = await estimator.calculateRange(tenant_id, service_slug, inputs || {});
    res.json(result);
  } catch (e) {
    console.error("[Estimator] /quote error:", e.message);
    res.status(500).json({ error: e.message || "Server error" });
  }
});

// -------------------- POST /validate --------------------
//
// Body: { service_slug, inputs }
// Returns { valid, errors }. No DB access — pure input validation.
// Useful for live widget feedback as the user fills out the form.
router.post("/validate", async (req, res) => {
  try {
    const { service_slug, inputs } = req.body || {};
    if (!service_slug) {
      return res.status(400).json({ error: "service_slug is required" });
    }
    const result = estimator.validateInputs(service_slug, inputs || {});
    res.json(result);
  } catch (e) {
    console.error("[Estimator] /validate error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- GET /tenant-config/:tenantId --------------------
//
// Returns full vertical config for widget rendering: services, modifiers,
// junction, questions. Widget calls this once on load, then renders forms
// dynamically without further DB hits until /quote.
router.get("/tenant-config/:tenantId", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId required" });
    }
    const config = await estimator.getVerticalConfig(tenantId);

    // Gate: only return config if widget is actually enabled for this tenant.
    // Prevents widget from rendering on tenants who haven't activated the addon.
    if (!config.tenant.widget_enabled) {
      return res.status(403).json({ error: "Estimator widget not enabled for this tenant" });
    }

    res.json(config);
  } catch (e) {
    console.error("[Estimator] /tenant-config error:", e.message);
    if (e.message && e.message.includes("not found")) {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- POST /lead --------------------
//
// Body: { tenant_id, phone, name?, email?, address?, project_type?,
//         estimator_payload, quote_result? }
// Captures the homeowner's contact info + full estimator scope into the
// leads table. Uses getOrCreateLead pattern for cross-channel dedup
// (matches /lead-capture and /api/widget/start-sms behavior).
//
// estimator_payload is the full submission state (service, inputs, modifier
// selections). quote_result is the calculateRange output (range, breakdown).
// Both stored as JSONB on leads.estimator_payload column.
router.post("/lead", async (req, res) => {
  try {
    const {
      tenant_id,
      phone,
      name,
      email,
      address,
      project_type,
      estimator_payload,
      quote_result,
    } = req.body || {};

    if (!tenant_id || !phone) {
      return res.status(400).json({ error: "tenant_id and phone are required" });
    }
    if (!estimator_payload || typeof estimator_payload !== "object") {
      return res.status(400).json({ error: "estimator_payload object required" });
    }

    // Find or create lead — matches existing widget patterns
    const lead = await leadsService.getOrCreateLead(
      tenant_id,
      phone,
      name || null,
      "estimator_widget",
      "web_form"
    );
    if (!lead) {
      return res.status(500).json({ error: "Failed to create lead" });
    }

    // Build the full estimator payload — includes both inputs and computed quote
    const fullPayload = {
      ...estimator_payload,
      quote_result: quote_result || null,
      submitted_at: new Date().toISOString(),
    };

    // Update lead with contact info + estimator payload in one query
    await db.query(
      `UPDATE leads
          SET name              = COALESCE($2, name),
              email             = COALESCE($3, email),
              address           = COALESCE($4, address),
              project_type      = COALESCE($5, project_type),
              estimator_payload = $6,
              updated_at        = now()
        WHERE id = $1`,
      [
        lead.id,
        name || null,
        email || null,
        address || null,
        project_type || null,
        JSON.stringify(fullPayload),
      ]
    );

    console.log(
      "[Estimator] /lead captured tenantId=%s leadId=%s service=%s specialized=%s",
      tenant_id,
      lead.id,
      estimator_payload.service_slug || "(none)",
      quote_result?.specialized || false
    );

    res.json({ success: true, lead_id: lead.id });
  } catch (e) {
    console.error("[Estimator] /lead error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

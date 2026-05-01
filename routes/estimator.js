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

    // ─────────────────────────────────────────────────────────────
    // CRM FORWARDING — added May 1, 2026 (Phase 7 V1.5 critical fix)
    // 
    // Without this, estimator leads landed in the leads table but
    // never reached DripJobs/Zapier. Tenants would see leads in
    // /leads dashboard but their actual sales workflow had no idea
    // they existed. Mirrors the pattern from processSmsConversation
    // in server.js.
    // ─────────────────────────────────────────────────────────────
    try {
      // Build the CRM payload from estimator data + contact info.
      // Using direct require (not server.js import) to avoid circular deps.
      const crmWebhookPayload = require("../lib/crmWebhookPayload");
      
      // Format the quote range for project_details if we have one
      let projectDetailsText = "";
      if (quote_result && !quote_result.specialized) {
        const minDollars = Math.round(quote_result.range_min_cents / 100);
        const maxDollars = Math.round(quote_result.range_max_cents / 100);
        projectDetailsText = `Estimator quote range: $${minDollars.toLocaleString()} - $${maxDollars.toLocaleString()}`;
        if (estimator_payload.rooms && estimator_payload.rooms.length > 0) {
          const roomSummary = estimator_payload.rooms
            .filter(r => r.count > 0)
            .map(r => `${r.count} ${r.size || "medium"} ${r.type || "rooms"}`)
            .join(", ");
          if (roomSummary) projectDetailsText += ` | ${roomSummary}`;
        }
      } else if (quote_result?.specialized) {
        projectDetailsText = `Specialized project — needs in-person walkthrough. Reason: ${quote_result.reason || "(not provided)"}`;
      }

      const nameParts = crmWebhookPayload.splitDisplayName(name || "");
      const phoneNorm = crmWebhookPayload.normalizePhoneForCrm(phone) || phone;

      const crmPayload = {
        event_type: "lead_capture",
        source: "estimator_widget",
        full_name: nameParts.full_name || name || "",
        first_name: nameParts.first_name,
        last_name: nameParts.last_name,
        contact_name: name || "",
        phone: phoneNorm,
        contact_phone: phoneNorm,
        email: email || "",
        address: address || "",
        job_type: project_type || "",
        project_type: project_type || "",
        project_details: projectDetailsText,
        appointment_details: projectDetailsText,
        lead_type: "INQUIRY",
        timestamp: new Date().toISOString(),
        tenant_id: tenant_id,
      };

      // Look up tenant CRM webhooks and POST. Inline implementation
      // because sendToCRM lives in server.js and isn't exported.
      const tenantRow = await db.query(
        "SELECT crm_webhook_url, zapier_webhook_url, name, company_name FROM tenants WHERE id = $1",
        [tenant_id]
      ).then(r => r.rows[0]);

      const webhookUrls = [];
      if (tenantRow?.crm_webhook_url?.trim()) webhookUrls.push(tenantRow.crm_webhook_url.trim());
      if (tenantRow?.zapier_webhook_url?.trim()) webhookUrls.push(tenantRow.zapier_webhook_url.trim());

      if (webhookUrls.length === 0) {
        console.warn("[Estimator] No CRM webhook configured for tenant %s. Lead saved but not forwarded.", tenant_id);
      } else {
        crmPayload.tenant_name = tenantRow.name;
        crmPayload.company_name = tenantRow.company_name;

        // Smart fallbacks matching sendToCRM behavior
        if (!crmPayload.first_name) crmPayload.first_name = "New Lead";
        if (!crmPayload.last_name) crmPayload.last_name = ".";
        if (!crmPayload.email) {
          crmPayload.email = `lead-${phoneNorm.replace(/\D/g, "").slice(-10)}@placeholder.local`;
        }
        if (!crmPayload.address) crmPayload.address = "Not provided";
        crmPayload.city = "Omaha";
        crmPayload.state = "NE";
        crmPayload.zip = "00000";
        crmPayload.preferred_date = new Date().toISOString().split("T")[0];

        console.log("[Estimator] Forwarding lead to %d CRM webhook(s)", webhookUrls.length);
        for (const url of webhookUrls) {
          try {
            const resp = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(crmPayload),
            });
            if (resp.ok) {
              console.log("[Estimator] CRM forward SUCCESS url=%s tenantId=%s leadId=%s", url, tenant_id, lead.id);
            } else {
              const errBody = await resp.text();
              console.error("[Estimator] CRM forward FAILED url=%s status=%d body=%s", url, resp.status, errBody.slice(0, 200));
            }
          } catch (fwdErr) {
            console.error("[Estimator] CRM forward error url=%s error=%s", url, fwdErr.message);
          }
        }
      }
    } catch (crmErr) {
      // CRM failure must NOT break the lead capture. Log and proceed.
      console.error("[Estimator] CRM forwarding error (non-fatal):", crmErr.message);
    }

    // Bell notification — matches notification pattern from book_appointment
    try {
      const notificationsService = require("../services/notifications");
      await notificationsService.createNotification(tenant_id, {
        type: 'lead_captured',
        title: 'New Estimator Lead',
        body: `${name || "A new lead"} requested a quote${quote_result?.specialized ? ' (specialized project)' : quote_result ? ` — range $${Math.round(quote_result.range_min_cents/100).toLocaleString()}-$${Math.round(quote_result.range_max_cents/100).toLocaleString()}` : ''}.`,
        data: { lead_id: lead.id, source: 'estimator_widget', phone, project_type, quote_result }
      });
    } catch (notifErr) {
      console.error("[Estimator] Notification failed (non-fatal):", notifErr.message);
    }

    res.json({ success: true, lead_id: lead.id });
  } catch (e) {
    console.error("[Estimator] /lead error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

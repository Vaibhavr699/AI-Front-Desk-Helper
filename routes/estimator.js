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
//   POST /log-events               → synthetic conversation messages
//   GET  /rate-overrides/:tenantId → per-service rate override read
//   PATCH /rate-overrides/:tenantId → per-service rate override upsert
//
// Admin-only endpoint (GET /vertical/:slug) lives in routes/estimatorAdmin.js
// and mounts at /api/admin/estimator with requireSuperAdmin gate.
// ============================================================================

const express = require("express");
const db = require("../lib/db");
const estimator = require("../lib/estimator");
const leadsService = require("../services/leads");

const router = express.Router();

// ─── Includes-text helpers (Phase 7 V2 — May 5, 2026) ───────────────────────
// These overlay tenant-level scope_options onto the per-service includes_text
// returned by getVerticalConfig. They run only inside /tenant-config; the
// rest of the file is unchanged. If you change the prose format here, also
// update buildIncludesPreview() in dashboard/src/pages/ScopeSettings.jsx so
// the owner preview matches what the customer actually sees.

function stripIncludePrefix(label) {
  return String(label || "").replace(/^Include\s+/i, "").toLowerCase();
}

function formatList(items) {
  if (!items.length)        return "";
  if (items.length === 1)   return items[0];
  if (items.length === 2)   return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

// Three-state return:
//   undefined → no scope_options rows with affects_includes_text=true exist for this
//               service. Caller leaves the legacy vertical_services.includes_text in
//               place (deck_fence + future verticals fall through here).
//   null      → rows exist but every toggle is OFF. Caller sets includes_text=null
//               so the widget's `if (includes)` guard hides the box entirely
//               (Drew's call, May 5 2026).
//   string    → at least one toggle is ON. Returns the formatted prose.
function buildIncludesText(scopeRows) {
  const visible = scopeRows.filter(r => r.affects_includes_text);
  if (visible.length === 0) return undefined;

  const enabled  = visible.filter(r =>  r.enabled).map(r => stripIncludePrefix(r.display_label));
  const disabled = visible.filter(r => !r.enabled).map(r => stripIncludePrefix(r.display_label));

  if (enabled.length === 0) return null;

  let result = `Includes: ${formatList(enabled)}.`;
  if (disabled.length > 0) {
    const list = formatList(disabled);
    result += ` ${list.charAt(0).toUpperCase()}${list.slice(1)} quoted separately on walkthrough.`;
  }
  return result;
}

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
//
// Phase 7 V2 (May 5, 2026): After getVerticalConfig() returns, overlay the
// owner's scope_options (mig 058) onto each service's includes_text. This
// keeps lib/estimator.js untouched while making the widget reflect live
// toggle state from the Standard Scope settings tab. Failure to overlay is
// non-fatal — falls back to the static vertical_services.includes_text.
router.get("/tenant-config/:tenantId", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId required" });
    }
    const config = await estimator.getVerticalConfig(tenantId);

    // Gate: only return config if estimator is actually enabled for this tenant.
    // Prevents widget from rendering on tenants who haven't activated the addon.
    // Phase 7 V1.5 — renamed widget_enabled → estimator_enabled (master toggle).
    if (!config.tenant.estimator_enabled) {
      return res.status(403).json({ error: "Estimator not enabled for this tenant" });
    }

    // ─── Overlay scope_options onto per-service includes_text ─────────────
    // ASSUMPTION: scope_options.service_id is an FK to vertical_services.id.
    // If your schema stores service_slug directly on scope_options, change
    // the JOIN to: WHERE so.tenant_id = $1 and select so.service_slug.
    try {
      const { rows: scopeRows } = await db.query(
  `SELECT
     vs.service_slug,
     vso.option_key,
     vso.display_label,
     COALESCE(tso.enabled, vso.default_enabled) AS enabled,
     vso.affects_includes_text
   FROM tenants t
   JOIN vertical_services vs       ON vs.vertical_id          = t.vertical_id
   JOIN vertical_scope_options vso ON vso.vertical_service_id = vs.id
   LEFT JOIN tenant_service_scope_options tso
     ON tso.vertical_service_id = vso.vertical_service_id
    AND tso.option_key          = vso.option_key
    AND tso.tenant_id           = t.id
   WHERE t.id = $1
   ORDER BY vs.service_slug, vso.display_order`,
  [tenantId]
);

      // Group rows by service_slug for O(1) lookup per service
      const bySlug = {};
      for (const row of scopeRows) {
        if (!bySlug[row.service_slug]) bySlug[row.service_slug] = [];
        bySlug[row.service_slug].push(row);
      }

      // Patch each service. Three outcomes per service:
      //   - No scope_options rows for this slug → leave static includes_text
      //   - Rows exist, all toggles OFF        → null (widget hides box)
      //   - Rows exist, at least one ON        → computed prose string
      if (Array.isArray(config.services)) {
        for (const svc of config.services) {
          const rows = bySlug[svc.service_slug];
          if (!rows) continue;

          const computed = buildIncludesText(rows);
          if (computed !== undefined) {
            svc.includes_text = computed; // string or null
          }
        }
      }
    } catch (scopeErr) {
      // Non-fatal — if the overlay fails (missing table on staging, schema
      // drift, query timeout, etc), still return config with the legacy
      // static includes_text rather than 500ing the widget load.
      console.error("[Estimator] scope_options overlay failed (non-fatal): %s", scopeErr.message);
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
    // in server.js, but inlined to keep this route self-contained.
    // ─────────────────────────────────────────────────────────────
    try {
      // Inline helpers — keep this route self-contained
      const splitName = (fullName) => {
        const trimmed = String(fullName || "").trim();
        if (!trimmed) return { first_name: "", last_name: "", full_name: "" };
        const parts = trimmed.split(/\s+/);
        if (parts.length === 1) return { first_name: parts[0], last_name: ".", full_name: trimmed };
        return {
          first_name: parts[0],
          last_name: parts.slice(1).join(" "),
          full_name: trimmed,
        };
      };
      const normalizePhone = (raw) => {
        if (!raw) return "";
        const digits = String(raw).replace(/\D/g, "");
        if (digits.length === 10) return `+1${digits}`;
        if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
        if (String(raw).startsWith("+") && digits.length >= 10) return `+${digits}`;
        return String(raw).trim();
      };

      // Build human-readable project_details with quote range
      let projectDetailsText = "";
      if (quote_result && !quote_result.specialized) {
        const minDollars = Math.round(quote_result.range_min_cents / 100);
        const maxDollars = Math.round(quote_result.range_max_cents / 100);
        projectDetailsText = (minDollars === maxDollars)
          ? `Estimator quote: $${minDollars.toLocaleString()}`
          : `Estimator quote range: $${minDollars.toLocaleString()} - $${maxDollars.toLocaleString()}`;
        if (estimator_payload.rooms && estimator_payload.rooms.length > 0) {
          const roomSummary = estimator_payload.rooms
            .filter(r => r.count > 0)
            .map(r => `${r.count} ${r.size || "medium"} ${r.type || "room(s)"}`)
            .join(", ");
          if (roomSummary) projectDetailsText += ` | ${roomSummary}`;
        }
      } else if (quote_result?.specialized) {
        projectDetailsText = `Specialized project — needs in-person walkthrough. Reason: ${quote_result.reason || "(not provided)"}`;
      }

      const nameParts = splitName(name);
      const phoneNorm = normalizePhone(phone);

      // Look up tenant CRM webhooks
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
        // Smart fallbacks matching sendToCRM behavior in server.js
        const crmPayload = {
          event_type: "lead_capture",
          source: "estimator_widget",
          full_name: nameParts.full_name || "New Lead",
          first_name: nameParts.first_name || "New Lead",
          last_name: nameParts.last_name || ".",
          contact_name: nameParts.full_name || "New Lead",
          phone: phoneNorm,
          contact_phone: phoneNorm,
          email: email || `lead-${phoneNorm.replace(/\D/g, "").slice(-10)}@placeholder.local`,
          contact_email: email || `lead-${phoneNorm.replace(/\D/g, "").slice(-10)}@placeholder.local`,
          address: address || "Not provided",
          city: "Omaha",
          state: "NE",
          zip: "00000",
          job_type: project_type || "Residential",
          project_type: project_type || "",
          project_details: projectDetailsText,
          appointment_details: projectDetailsText,
          preferred_date: new Date().toISOString().split("T")[0],
          lead_type: "INQUIRY",
          timestamp: new Date().toISOString(),
          tenant_id: tenant_id,
          tenant_name: tenantRow?.name || null,
          company_name: tenantRow?.company_name || null,
        };

        // Use built-in fetch (Node 18+). Fallback to global if not present.
        const fetchFn = (typeof fetch !== "undefined") ? fetch : require("node-fetch");

        console.log("[Estimator] Forwarding lead to %d CRM webhook(s) tenantId=%s leadId=%s", webhookUrls.length, tenant_id, lead.id);
        for (const url of webhookUrls) {
          try {
            const resp = await fetchFn(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(crmPayload),
            });
            if (resp.ok) {
              console.log("[Estimator] CRM forward SUCCESS url=%s leadId=%s", url, lead.id);
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

    // Bell notification — matches notification pattern from book_appointment in server.js
    try {
      const notificationsService = require("../services/notifications");
      const notifTitle = "New Estimator Lead";
      let notifBody;
      if (quote_result?.specialized) {
        notifBody = `${name || "A new lead"} requested a quote (specialized project — needs walkthrough).`;
      } else if (quote_result) {
        const minDollars = Math.round(quote_result.range_min_cents / 100);
        const maxDollars = Math.round(quote_result.range_max_cents / 100);
        const rangeStr = (minDollars === maxDollars)
          ? `$${minDollars.toLocaleString()}`
          : `$${minDollars.toLocaleString()} - $${maxDollars.toLocaleString()}`;
        notifBody = `${name || "A new lead"} requested a quote — range ${rangeStr}.`;
      } else {
        notifBody = `${name || "A new lead"} requested a quote.`;
      }
      await notificationsService.createNotification(tenant_id, {
        type: 'lead_captured',
        title: notifTitle,
        body: notifBody,
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

// -------------------- POST /log-events --------------------
//
// Body: { tenant_id, lead_id, events: [{event_type, content, timestamp}] }
//
// Phase 7 V1.5 — May 1, 2026. Writes synthetic messages to the messages
// table representing key estimator flow events, so the Conversations
// dashboard shows the full estimator interaction (service selected, quote
// shown, contact captured) alongside normal Alex chat.
//
// Called by chat-widget.js immediately after /lead succeeds. Events are
// buffered client-side so they all share the same lead_id and write in one
// batch. If this POST fails, the lead is still captured — events are a
// secondary record for dashboard visibility, not a revenue-critical path.
router.post("/log-events", async (req, res) => {
  try {
    const { tenant_id, lead_id, events } = req.body || {};

    if (!tenant_id || !lead_id || !Array.isArray(events)) {
      return res.status(400).json({ error: "tenant_id, lead_id, and events array required" });
    }
    if (events.length === 0 || events.length > 10) {
      return res.status(400).json({ error: "events must be 1-10 items" });
    }

    // Verify lead belongs to this tenant — prevents cross-tenant injection
    const leadCheck = await db.query(
      "SELECT id FROM leads WHERE id = $1 AND tenant_id = $2",
      [lead_id, tenant_id]
    );
    if (leadCheck.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found for this tenant" });
    }

    // Insert each event as a message row. Direction is 'inbound' for
    // user actions (selected service, submitted form) and 'outbound' for
    // system responses (quote shown). Channel always 'website' since this
    // flow only runs in the chat widget on the marketing site.
    let inserted = 0;
    for (const evt of events) {
      const eventType = String(evt.event_type || "").trim();
      const content = String(evt.content || "").trim();
      const timestamp = evt.timestamp ? new Date(evt.timestamp) : new Date();

      if (!eventType || !content) continue;
      if (content.length > 2000) continue;

      // Map event type to direction
      let direction = "inbound";
      if (eventType === "quote_shown" || eventType === "estimator_started") {
        direction = "outbound";  // System-driven events
      }

      try {
        await db.query(
          `INSERT INTO messages (tenant_id, lead_id, channel, direction, body, metadata, created_at)
           VALUES ($1, $2, 'website', $3, $4, $5, $6)`,
          [
            tenant_id,
            lead_id,
            direction,
            content,
            JSON.stringify({
              source: "estimator_widget",
              event_type: eventType,
              synthetic: true,
            }),
            timestamp,
          ]
        );
        inserted++;
      } catch (insertErr) {
        console.error("[Estimator] log-events insert failed event=%s error=%s", eventType, insertErr.message);
        // Continue with next event — partial success is acceptable
      }
    }

    console.log("[Estimator] /log-events tenantId=%s leadId=%s inserted=%d/%d", tenant_id, lead_id, inserted, events.length);
    res.json({ success: true, inserted });
  } catch (e) {
    console.error("[Estimator] /log-events error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- GET /rate-overrides/:tenantId --------------------
//
// Returns per-service rate overrides for a tenant. Used by Settings UI
// to populate the override inputs. Returns empty object if no overrides set.
//
// Phase 7 V1.5 (May 4, 2026).
//
// NOTE: This endpoint is unauthenticated to match other /tenant-config calls.
// In V2 hardening, gate behind auth so only tenant owner/admin can read.
router.get("/rate-overrides/:tenantId", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: "tenantId required" });
    }

    const result = await db.query(
      `SELECT service_slug, percentage_adjustment, updated_at
         FROM tenant_service_rate_overrides
        WHERE tenant_id = $1`,
      [tenantId]
    );

    // Return as object keyed by service_slug for easy UI consumption
    const overrides = {};
    for (const row of result.rows) {
      overrides[row.service_slug] = {
        percentage_adjustment: Number(row.percentage_adjustment),
        updated_at: row.updated_at,
      };
    }

    res.json({ overrides });
  } catch (e) {
    console.error("[Estimator] /rate-overrides GET error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

// -------------------- PATCH /rate-overrides/:tenantId --------------------
//
// Body: { service_slug, percentage_adjustment | null }
//
// Upsert one override. Pass null/undefined percentage_adjustment to delete
// the row (revert to default for that service).
//
// Phase 7 V1.5 (May 4, 2026).
//
// SECURITY: Currently unauthenticated to match the rest of /api/estimator.
// V2 hardening: validate JWT + ensure caller owns this tenant.
router.patch("/rate-overrides/:tenantId", async (req, res) => {
  try {
    const tenantId = req.params.tenantId;
    const { service_slug, percentage_adjustment } = req.body || {};

    if (!tenantId || !service_slug) {
      return res.status(400).json({ error: "tenantId and service_slug required" });
    }

    // Validate service_slug — must be one this vertical supports
    const validSlugs = ["interior", "exterior", "cabinets", "deck_fence"];
    if (!validSlugs.includes(service_slug)) {
      return res.status(400).json({ error: `service_slug must be one of: ${validSlugs.join(", ")}` });
    }

    // null/undefined → delete the override row
    if (percentage_adjustment === null || percentage_adjustment === undefined) {
      await db.query(
        `DELETE FROM tenant_service_rate_overrides
          WHERE tenant_id = $1 AND service_slug = $2`,
        [tenantId, service_slug]
      );
      console.log("[Estimator] Reset rate override tenantId=%s service=%s", tenantId, service_slug);
      return res.json({ success: true, deleted: true });
    }

    // Validate range
    const pct = Number(percentage_adjustment);
    if (!Number.isFinite(pct)) {
      return res.status(400).json({ error: "percentage_adjustment must be a number" });
    }
    if (pct < -0.50 || pct > 1.00) {
      return res.status(400).json({ error: "percentage_adjustment must be between -0.50 and +1.00 (-50% to +100%)" });
    }

    // Upsert
    await db.query(
      `INSERT INTO tenant_service_rate_overrides (tenant_id, service_slug, percentage_adjustment, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (tenant_id, service_slug)
       DO UPDATE SET
         percentage_adjustment = EXCLUDED.percentage_adjustment,
         updated_at = now()`,
      [tenantId, service_slug, pct]
    );

    console.log("[Estimator] Set rate override tenantId=%s service=%s pct=%s", tenantId, service_slug, pct);
    res.json({ success: true, service_slug, percentage_adjustment: pct });
  } catch (e) {
    console.error("[Estimator] /rate-overrides PATCH error:", e.message);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

"use strict";

/**
 * routes/recovery.js
 *
 * Phase 10 — Recovery Toggle System routes.
 *
 * Mounted at /api/recovery with authMiddleware applied at the mount level
 * (server.js). All endpoints assume req.tenantId is set by auth middleware.
 *
 * Endpoints:
 *   GET    /api/recovery/settings              — load current settings + tier allow-list
 *   PATCH  /api/recovery/settings              — update settings (tier-gated fields)
 *   POST   /api/recovery/leads/:id/pause       — pause a single lead's recovery
 *   POST   /api/recovery/leads/:id/resume      — resume a single lead's recovery
 *   PATCH  /api/recovery/leads/:id/cadence     — per-lead cadence override
 *
 * Tier gating: backend-enforced via field allow-list. Frontend reads
 * tier_allowed_fields from GET response and disables locked controls
 * with an upgrade tooltip.
 *
 * Security:
 *   - All writes scoped to req.tenantId — caller can't mutate another tenant.
 *   - Allow-list keys are hardcoded identifiers; no SQL injection vector
 *     from req.body keys reaching the dynamic UPDATE.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");

// Defensive audit-log wrapper — won't crash a route if auditLogger is missing.
async function logAudit(payload) {
  try {
    const { auditLog } = require("../lib/auditLogger");
    await auditLog(payload);
  } catch (err) {
    console.warn("[recovery] audit log skipped: %s", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Tier gating — field allow-lists
// ─────────────────────────────────────────────────────────────────────────────
const BASIC_FIELDS = ["recovery_enabled"];

const PRO_FIELDS = [
  ...BASIC_FIELDS,
  "sms_enabled", "email_enabled", "voice_enabled",
  "cadence_preset", "custom_cadence_days",
  "trigger_estimate_recovery", "trigger_missed_call",
  "trigger_appointment_reminder", "trigger_nurturing",
  "trigger_voicemail_followup", "trigger_no_show",
  "quiet_hours_enabled", "quiet_hours_start", "quiet_hours_end",
  "quiet_hours_timezone", "quiet_hours_weekend",
  "auto_pause_enabled", "auto_pause_sentiment_threshold", "auto_pause_keywords",
  "cohort_analysis_opt_in",
];

// Elite = same as Pro for now; Phase 10E (DISC-adaptive) deferred until 8A
const ELITE_FIELDS = PRO_FIELDS;
const ELITE_PLANS  = ["elite", "white_label", "reseller", "franchise", "franchise_hq"];

function getAllowedFields(plan) {
  const p = String(plan || "").toLowerCase();
  if (ELITE_PLANS.includes(p)) return ELITE_FIELDS;
  if (p === "pro")             return PRO_FIELDS;
  return BASIC_FIELDS;
}

const {
  getRecoverySettings,
  CADENCE_PRESETS,
} = require("../lib/recoverySettings");

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/recovery/settings
// ═══════════════════════════════════════════════════════════════════════════
router.get("/settings", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) return res.status(401).json({ error: "Not authenticated" });

  try {
    const settings = await getRecoverySettings(tenantId);
    const plan = req.tenant?.plan || req.user?.plan || "basic";

    res.json({
      settings,
      tier_allowed_fields: getAllowedFields(plan),
      presets: CADENCE_PRESETS,
      plan,
    });
  } catch (err) {
    console.error("[recovery/settings GET] tenant=%s err=%s", tenantId, err.message);
    res.status(500).json({ error: "Failed to load recovery settings" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/recovery/settings
// ═══════════════════════════════════════════════════════════════════════════
router.patch("/settings", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) return res.status(401).json({ error: "Not authenticated" });

  const userId = req.userId || req.user?.id || null;
  const plan   = req.tenant?.plan || req.user?.plan || "basic";
  const allowed = getAllowedFields(plan);

  const updates  = {};
  const rejected = [];

  for (const [k, v] of Object.entries(req.body || {})) {
    if (allowed.includes(k)) updates[k] = v;
    else                     rejected.push(k);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({
      error: "No permitted fields in payload",
      rejected,
      hint: "Upgrade tier to edit additional fields",
    });
  }

  // Validate cadence_preset if present
  if (
    updates.cadence_preset &&
    !["aggressive", "standard", "gentle", "single", "custom"].includes(updates.cadence_preset)
  ) {
    return res.status(400).json({ error: "Invalid cadence_preset" });
  }

  // Build dynamic UPDATE. Keys come from the hardcoded allow-list, so no
  // SQL injection risk; values are parameterized.
  const updateKeys = Object.keys(updates);
  const setClauses = updateKeys.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const params     = [tenantId, ...updateKeys.map(k => updates[k])];

  try {
    const result = await db.query(
      `UPDATE recovery_settings
          SET ${setClauses}, updated_at = now()
        WHERE tenant_id = $1
        RETURNING *`,
      params
    );

    if (result.rows.length === 0) {
      // Settings row doesn't exist yet — lazy-create then retry once.
      await getRecoverySettings(tenantId);
      const retry = await db.query(
        `UPDATE recovery_settings
            SET ${setClauses}, updated_at = now()
          WHERE tenant_id = $1
          RETURNING *`,
        params
      );
      if (retry.rows.length === 0) {
        return res.status(500).json({ error: "Failed to persist settings" });
      }
      await logAudit({
        tenantId, userId,
        action: "recovery_settings.update",
        meta: { updated_fields: updateKeys, rejected },
      });
      return res.json({ settings: retry.rows[0], rejected });
    }

    await logAudit({
      tenantId, userId,
      action: "recovery_settings.update",
      meta: { updated_fields: updateKeys, rejected },
    });

    console.log("[recovery/settings PATCH] tenant=%s fields=%j", tenantId, updateKeys);
    res.json({ settings: result.rows[0], rejected });
  } catch (err) {
    console.error("[recovery/settings PATCH] tenant=%s err=%s", tenantId, err.message);
    res.status(500).json({ error: "Failed to update recovery settings" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/recovery/leads/:id/pause
// ═══════════════════════════════════════════════════════════════════════════
router.post("/leads/:id/pause", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) return res.status(401).json({ error: "Not authenticated" });

  const userId = req.userId || req.user?.id || null;
  const leadId = req.params.id;
  const { reason } = req.body || {};

  try {
    const result = await db.query(
      `UPDATE leads
          SET recovery_paused        = true,
              recovery_paused_reason = $3,
              recovery_paused_at     = now(),
              recovery_paused_by     = $4
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [leadId, tenantId, reason || "manual", userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    await logAudit({
      tenantId, userId,
      action: "lead.recovery_paused",
      meta: { lead_id: leadId, reason: reason || "manual" },
    });

    res.json({ lead: result.rows[0] });
  } catch (err) {
    console.error("[recovery/leads/pause] tenant=%s lead=%s err=%s", tenantId, leadId, err.message);
    res.status(500).json({ error: "Failed to pause recovery" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/recovery/leads/:id/resume
// ═══════════════════════════════════════════════════════════════════════════
router.post("/leads/:id/resume", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) return res.status(401).json({ error: "Not authenticated" });

  const userId = req.userId || req.user?.id || null;
  const leadId = req.params.id;

  try {
    const result = await db.query(
      `UPDATE leads
          SET recovery_paused        = false,
              recovery_paused_reason = NULL,
              recovery_paused_at     = NULL,
              recovery_paused_by     = NULL
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [leadId, tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    await logAudit({
      tenantId, userId,
      action: "lead.recovery_resumed",
      meta: { lead_id: leadId },
    });

    res.json({ lead: result.rows[0] });
  } catch (err) {
    console.error("[recovery/leads/resume] tenant=%s lead=%s err=%s", tenantId, leadId, err.message);
    res.status(500).json({ error: "Failed to resume recovery" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATCH /api/recovery/leads/:id/cadence
// Per-lead override: aggressive | standard | gentle | single | off | null
// ═══════════════════════════════════════════════════════════════════════════
router.patch("/leads/:id/cadence", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) return res.status(401).json({ error: "Not authenticated" });

  const userId = req.userId || req.user?.id || null;
  const leadId = req.params.id;
  const { cadence } = req.body || {};

  const valid = [null, "aggressive", "standard", "gentle", "single", "off"];
  if (!valid.includes(cadence)) {
    return res.status(400).json({ error: "Invalid cadence", valid });
  }

  try {
    const result = await db.query(
      `UPDATE leads
          SET rec

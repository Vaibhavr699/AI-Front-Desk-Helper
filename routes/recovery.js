"use strict";

/**
 * routes/recovery.js
 *
 * Phase 10 — Recovery Toggle System routes.
 *
 * Mounted at /api/recovery with authMiddleware applied at the mount level
 * (server.js).
 *
 * TENANT RESOLUTION (fixed May 22, 2026):
 *   Previously every handler read `req.tenantId || req.user?.tenant_id`.
 *   `req.tenantId` is NEVER set by authMiddleware — it does not exist —
 *   so this silently fell back to req.user.tenant_id. Under superadmin
 *   impersonation that resolved to the SUPERADMIN's own tenant, not the
 *   impersonated tenant: GET /settings loaded the wrong tenant's tier
 *   allow-list (disabling the master toggle in the UI), and PATCH wrote
 *   recovery settings to the wrong tenant.
 *
 *   Fix: use getGuaranteedTenantId(req) from lib/auth.js — the same
 *   helper /api/leads, /api/metrics, etc. use. It honors the
 *   x-impersonate-tenant-id header for superadmins, the requested tenant
 *   for parent/HQ users, and the JWT tenant_id otherwise.
 *
 * CUSTOM CADENCE FORMAT (Phase A — June 8, 2026):
 *   custom_cadence_days migrated from integer[] to jsonb to support
 *   per-day channel selection. Two accepted input formats:
 *     Legacy:  [1, 3, 7]                          (plain int days, SMS implied)
 *     New:     [{day:1,channel:"sms"}, {day:5,channel:"call"}, ...]
 *   Incoming payloads are normalized + validated here before write, then
 *   written explicitly as jsonb (JSON.stringify + ::jsonb cast) so the
 *   write doesn't depend on driver type-inference. recoverySettings.js
 *   reads both formats via normalizeCustomCadence.
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
 *   - All writes scoped to the resolved tenantId — caller can't mutate
 *     another tenant.
 *   - Allow-list keys are hardcoded identifiers; no SQL injection vector
 *     from req.body keys reaching the dynamic UPDATE.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");
const { getGuaranteedTenantId } = require("../lib/auth");

const {
  getRecoverySettings,
  normalizeCustomCadence,
  CADENCE_PRESETS,
} = require("../lib/recoverySettings");

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

// ─────────────────────────────────────────────────────────────────────────────
// Custom cadence validation (Phase A — June 8, 2026)
//
// Accepts the raw value from the request body and returns:
//   { ok: true,  value: <normalized {day,channel}[]> }   on success
//   { ok: false, error: <message> }                       on invalid input
//
// Uses the same normalizeCustomCadence as the engine so the UI, the writer,
// and the runtime all agree on what a custom cadence means. We treat an
// empty result as valid ONLY if the input was itself an empty array — a
// non-empty input that normalizes to empty means every entry was garbage,
// which we reject so the user gets feedback instead of a silent no-op.
// ─────────────────────────────────────────────────────────────────────────────
// Max length for any single user-authored message/script/voicemail field.
// 1600 chars ≈ 10 SMS segments — generous for a follow-up, but bounded so a
// runaway paste can't blow past Twilio limits or rack up segment costs. Call
// scripts/voicemails are read aloud, so this is well beyond a sane spoken length.
const MAX_CUSTOM_TEXT_LEN = 1600;

function validateCustomCadence(raw) {
  if (raw === null || raw === undefined) {
    return { ok: true, value: [] };
  }
  if (!Array.isArray(raw)) {
    return { ok: false, error: "custom_cadence_days must be an array" };
  }
  if (raw.length === 0) {
    return { ok: true, value: [] };
  }

  const normalized = normalizeCustomCadence(raw);

  if (normalized.length === 0) {
    return {
      ok: false,
      error: "custom_cadence_days had no valid entries (days must be 0–90; channel must be 'sms' or 'call')",
    };
  }

  // Phase B (June 8, 2026): enforce a length cap on any user-authored text
  // fields the normalizer passed through (message / script / voicemail).
  // Blank/whitespace fields are left as-is (the engine treats them as
  // "not provided" and falls back to canonical copy). Unknown {{tokens}}
  // are NOT validated here — they pass through and render literally if
  // unrecognized, by design.
  for (const entry of normalized) {
    for (const field of ["message", "script", "voicemail"]) {
      if (typeof entry[field] === "string" && entry[field].length > MAX_CUSTOM_TEXT_LEN) {
        return {
          ok: false,
          error: `custom cadence day ${entry.day} ${field} exceeds ${MAX_CUSTOM_TEXT_LEN} characters`,
        };
      }
    }
  }

  return { ok: true, value: normalized, dropped: raw.length - normalized.length };
}

// Plan lookup — authMiddleware sets req.user but not the full tenant row
// for the resolved (possibly impersonated) tenant, so we hit the DB.
// Single SELECT, cheap. Falls back to 'basic' on any error so locked
// controls stay locked rather than silently unlocking.
async function getTenantPlan(tenantId) {
  try {
    const r = await db.query(
      "SELECT plan FROM tenants WHERE id = $1 LIMIT 1",
      [tenantId]
    );
    return r.rows[0]?.plan || "basic";
  } catch (err) {
    console.error("[recovery] getTenantPlan failed: %s", err.message);
    return "basic";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/recovery/settings
// ═══════════════════════════════════════════════════════════════════════════
router.get("/settings", async (req, res) => {
  const tenantId = getGuaranteedTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "Not authenticated" });

  try {
    const settings = await getRecoverySettings(tenantId);
    const plan = await getTenantPlan(tenantId);

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
  const tenantId = getGuaranteedTenantId(req);
  if (!tenantId) return res.status(401).json({ error: "Not authenticated" });

  const userId = req.userId || req.user?.id || null;
  const plan = await getTenantPlan(tenantId);
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

  // Validate + normalize custom_cadence_days if present. Phase A: this is
  // now jsonb and supports per-day channels. We normalize before write so
  // the stored value is always canonical {day,channel}[] (or [] when empty).
  let customCadenceDropped = 0;
  if (Object.prototype.hasOwnProperty.call(updates, "custom_cadence_days")) {
    const v = validateCustomCadence(updates.custom_cadence_days);
    if (!v.ok) {
      return res.status(400).json({ error: v.error });
    }
    updates.custom_cadence_days = v.value;       // canonical normalized array
    customCadenceDropped = v.dropped || 0;
  }

  // Build dynamic UPDATE. Keys come from the hardcoded allow-list, so no
  // SQL injection risk; values are parameterized.
  //
  // custom_cadence_days needs an explicit ::jsonb cast with a JSON string
  // param, so the write doesn't depend on driver type-inference (the column
  // is jsonb as of the Phase A migration). All other fields bind normally.
  const updateKeys = Object.keys(updates);
  const setClauses = updateKeys.map((k, i) => {
    if (k === "custom_cadence_days") {
      return `${k} = $${i + 2}::jsonb`;
    }
    return `${k} = $${i + 2}`;
  }).join(", ");

  const params = [
    tenantId,
    ...updateKeys.map(k =>
      k === "custom_cadence_days" ? JSON.stringify(updates[k]) : updates[k]
    ),
  ];

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
        meta: { updated_fields: updateKeys, rejected, custom_cadence_dropped: customCadenceDropped },
      });
      return res.json({ settings: retry.rows[0], rejected, custom_cadence_dropped: customCadenceDropped });
    }

    await logAudit({
      tenantId, userId,
      action: "recovery_settings.update",
      meta: { updated_fields: updateKeys, rejected, custom_cadence_dropped: customCadenceDropped },
    });

    console.log("[recovery/settings PATCH] tenant=%s fields=%j", tenantId, updateKeys);
    res.json({ settings: result.rows[0], rejected, custom_cadence_dropped: customCadenceDropped });
  } catch (err) {
    console.error("[recovery/settings PATCH] tenant=%s err=%s", tenantId, err.message);
    res.status(500).json({ error: "Failed to update recovery settings" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/recovery/leads/:id/pause
// ═══════════════════════════════════════════════════════════════════════════
router.post("/leads/:id/pause", async (req, res) => {
  const tenantId = getGuaranteedTenantId(req);
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
  const tenantId = getGuaranteedTenantId(req);
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
  const tenantId = getGuaranteedTenantId(req);
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
          SET recovery_cadence_override = $3
        WHERE id = $1 AND tenant_id = $2
        RETURNING *`,
      [leadId, tenantId, cadence]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lead not found" });
    }

    await logAudit({
      tenantId, userId,
      action: "lead.recovery_cadence_override",
      meta: { lead_id: leadId, cadence },
    });

    res.json({ lead: result.rows[0] });
  } catch (err) {
    console.error("[recovery/leads/cadence] tenant=%s lead=%s err=%s", tenantId, leadId, err.message);
    res.status(500).json({ error: "Failed to update cadence" });
  }
});

module.exports = router;

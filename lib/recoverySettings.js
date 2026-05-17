"use strict";

/**
 * lib/recoverySettings.js
 *
 * Phase 10 — Recovery Toggle System core helper.
 *
 * Used by:
 *   - routes/recovery.js (settings CRUD + per-lead overrides)
 *   - services/estimateRecovery.js (gate before each send)
 *   - services/runSmsFollowUps.js (gate before each send)
 *   - services/sentimentAutoPause.js (keyword + sentiment check)
 *
 * Exposes:
 *   getRecoverySettings(tenantId)        → row from recovery_settings (lazy-creates if missing)
 *   canSendRecovery({tenantId, channel, trigger, leadId})
 *                                        → { allowed, reason } master gate
 *   isInQuietHours(settings, now?)       → bool, timezone-aware, no external deps
 *   getCadenceDays(settings, override?)  → integer[] trigger days
 *   matchesOptOutKeywords(text, settings)→ matched keyword string or null
 *
 * Industry-default presets (memory line 28): roofing/home_ext = aggressive,
 * fence = gentle, everything else = standard.
 */

const db = require("../lib/db");

// ─────────────────────────────────────────────────────────────────────────────
// Cadence presets — days after estimate sent / trigger fire
// ─────────────────────────────────────────────────────────────────────────────
const CADENCE_PRESETS = {
  aggressive: [1, 3, 5, 7, 10, 14, 17, 21],
  standard:   [1, 3, 7, 14, 21],
  gentle:     [3, 10, 21],
  single:     [3],
};

const INDUSTRY_DEFAULTS = {
  roofing:       "aggressive",
  home_ext:      "aggressive",
  home_exterior: "aggressive",
  fence:         "gentle",
  painting:      "standard",
};

// ─────────────────────────────────────────────────────────────────────────────
// getRecoverySettings — fetch row, lazy-create if missing
// ─────────────────────────────────────────────────────────────────────────────
async function getRecoverySettings(tenantId) {
  if (!tenantId) throw new Error("tenantId required");

  const existing = await db.query(
    `SELECT * FROM recovery_settings WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  // No row yet — look up the tenant's industry for the default preset.
  const tenantResult = await db.query(
    `SELECT id, industry FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId]
  );
  const industry = tenantResult.rows[0]?.industry || null;
  const preset = INDUSTRY_DEFAULTS[industry] || "standard";

  // ON CONFLICT no-op handles race where two concurrent requests both
  // try to create a row for the same tenant.
  const created = await db.query(
    `INSERT INTO recovery_settings (tenant_id, cadence_preset, industry_tag)
     VALUES ($1, $2, $3)
     ON CONFLICT (tenant_id) DO UPDATE SET tenant_id = EXCLUDED.tenant_id
     RETURNING *`,
    [tenantId, preset, industry]
  );
  return created.rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Quiet-hours check — timezone-aware, no external deps
// ─────────────────────────────────────────────────────────────────────────────
function isInQuietHours(settings, now = new Date()) {
  if (!settings?.quiet_hours_enabled) return false;

  const tz = settings.quiet_hours_timezone || "America/Chicago";

  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = fmt.formatToParts(now);
  const hour    = parseInt(parts.find(p => p.type === "hour").value, 10);
  const minute  = parseInt(parts.find(p => p.type === "minute").value, 10);
  const weekday = parts.find(p => p.type === "weekday").value;

  if (settings.quiet_hours_weekend && (weekday === "Sat" || weekday === "Sun")) {
    return true;
  }

  const [sH, sM] = (settings.quiet_hours_start || "21:00").split(":").map(Number);
  const [eH, eM] = (settings.quiet_hours_end   || "08:00").split(":").map(Number);

  const nowMin   = hour * 60 + minute;
  const startMin = sH   * 60 + sM;
  const endMin   = eH   * 60 + eM;

  if (startMin === endMin) return false;
  if (startMin < endMin)   return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;  // overnight window
}

// ─────────────────────────────────────────────────────────────────────────────
// getCadenceDays — lead override beats tenant preset
// ─────────────────────────────────────────────────────────────────────────────
function getCadenceDays(settings, leadOverride = null) {
  if (leadOverride === "off") return [];
  if (leadOverride && CADENCE_PRESETS[leadOverride]) return CADENCE_PRESETS[leadOverride];

  if (settings.cadence_preset === "custom" && Array.isArray(settings.custom_cadence_days)) {
    return settings.custom_cadence_days;
  }
  return CADENCE_PRESETS[settings.cadence_preset] || CADENCE_PRESETS.standard;
}

// ─────────────────────────────────────────────────────────────────────────────
// canSendRecovery — MASTER GATE. Call before EVERY recovery send.
//
// Valid `channel`: sms | email | voice
// Valid `trigger`: estimate_recovery | missed_call | appointment_reminder |
//                  nurturing | voicemail_followup | no_show
// ─────────────────────────────────────────────────────────────────────────────
async function canSendRecovery({ tenantId, channel, trigger, leadId = null, now = new Date() }) {
  const settings = await getRecoverySettings(tenantId);

  if (!settings.recovery_enabled) return { allowed: false, reason: "master_off" };

  if (channel === "sms"   && !settings.sms_enabled)   return { allowed: false, reason: "sms_disabled" };
  if (channel === "email" && !settings.email_enabled) return { allowed: false, reason: "email_disabled" };
  if (channel === "voice" && !settings.voice_enabled) return { allowed: false, reason: "voice_disabled" };

  const triggerKey = `trigger_${trigger}`;
  if (settings[triggerKey] === false) return { allowed: false, reason: `${trigger}_disabled` };

  if (isInQuietHours(settings, now)) return { allowed: false, reason: "quiet_hours" };

  if (leadId) {
    const leadResult = await db.query(
      `SELECT recovery_paused, recovery_cadence_override
         FROM leads
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [leadId, tenantId]
    );
    const lead = leadResult.rows[0];
    if (lead?.recovery_paused) return { allowed: false, reason: "lead_paused" };
    if (lead?.recovery_cadence_override === "off") return { allowed: false, reason: "lead_cadence_off" };
  }

  return { allowed: true, reason: null, settings };
}

// ─────────────────────────────────────────────────────────────────────────────
// matchesOptOutKeywords — used by sentimentAutoPause
// ─────────────────────────────────────────────────────────────────────────────
function matchesOptOutKeywords(text, settings) {
  if (!text || !settings?.auto_pause_keywords?.length) return null;
  const lower = String(text).toLowerCase();
  return settings.auto_pause_keywords.find(kw =>
    lower.includes(String(kw).toLowerCase())
  ) || null;
}

module.exports = {
  getRecoverySettings,
  canSendRecovery,
  isInQuietHours,
  getCadenceDays,
  matchesOptOutKeywords,
  CADENCE_PRESETS,
  INDUSTRY_DEFAULTS,
};

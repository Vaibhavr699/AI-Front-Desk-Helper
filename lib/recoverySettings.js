"use strict";

/**
 * lib/recoverySettings.js
 *
 * Phase 10 — Recovery Toggle System core helper.
 *
 * Used by:
 *   - routes/recovery.js (settings CRUD + per-lead overrides)
 *   - lib/recoveryEngine.js (gate before each send + custom cadence)
 *   - server.js runSmsFollowUps (gate before each send)
 *   - services/sentimentAutoPause.js (keyword + sentiment check)
 *
 * Exposes:
 *   getRecoverySettings(tenantId)        → row from recovery_settings (lazy-creates if missing)
 *   canSendRecovery({tenantId, channel, trigger, leadId})
 *                                        → { allowed, reason } master gate
 *   isInQuietHours(settings, now?)       → bool, timezone-aware, no external deps
 *   getCadenceDays(settings, override?)  → integer[] trigger days
 *   getCustomCadenceSteps(settings, override?)
 *                                        → {day, channel}[] for custom preset (Phase A)
 *   normalizeCustomCadence(raw)          → {day, channel}[] from legacy int[] or new object[]
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
  // Safe default: new tenants auto-create with recovery DISABLED.
  // Owners must explicitly opt in via the UI. Prevents the "schema default
  // = true" footgun where a brand-new tenant inherits recovery-on.
  const created = await db.query(
    `INSERT INTO recovery_settings (tenant_id, cadence_preset, industry_tag, recovery_enabled)
     VALUES ($1, $2, $3, false)
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
// CUSTOM CADENCE NORMALIZATION (Phase A — June 8, 2026)
//
// custom_cadence_days supports TWO formats for backward compatibility:
//   Legacy:  [1, 3, 7]                          (plain int days, SMS implied)
//   New:     [{day:1,channel:"sms"}, ...]        (per-day channel)
//
// normalizeCustomCadence() accepts either and returns a sorted, de-duped
// array of {day, channel} objects. Invalid entries are dropped. A plain
// int N becomes {day:N, channel:"sms"}. Default channel is "sms".
//
// Valid channels: sms | call. (voicemail is part of a call step, not its
// own channel — the call step carries both script + voicemail text.)
// ─────────────────────────────────────────────────────────────────────────────
const VALID_CUSTOM_CHANNELS = new Set(["sms", "call"]);

function normalizeCustomCadence(raw) {
  if (!Array.isArray(raw)) return [];

  const out = [];
  const seenDays = new Set();

  for (const entry of raw) {
    let day = null;
    let channel = "sms";

    if (typeof entry === "number") {
      day = entry;
    } else if (entry && typeof entry === "object") {
      day = Number(entry.day);
      if (entry.channel && VALID_CUSTOM_CHANNELS.has(String(entry.channel).toLowerCase())) {
        channel = String(entry.channel).toLowerCase();
      }
    }

    if (!Number.isFinite(day)) continue;
    day = Math.trunc(day);
    if (day < 0 || day > 90) continue;          // sane bounds, matches UI 0–90
    if (seenDays.has(day)) continue;            // first wins on duplicate day
    seenDays.add(day);

    // Phase B note: when entry carries message/script/voicemail text, we
    // pass it through here so the engine can prefer user copy over defaults.
    const normalized = { day, channel };
    if (entry && typeof entry === "object") {
      if (typeof entry.message === "string")   normalized.message = entry.message;
      if (typeof entry.script === "string")    normalized.script = entry.script;
      if (typeof entry.voicemail === "string") normalized.voicemail = entry.voicemail;
    }

    out.push(normalized);
  }

  out.sort((a, b) => a.day - b.day);
  return out;
}

// Returns the normalized {day,channel}[] for a tenant's custom cadence, or
// [] if the tenant isn't on a custom preset. Lead override "off" wins.
function getCustomCadenceSteps(settings, leadOverride = null) {
  if (leadOverride === "off") return [];
  if (settings.cadence_preset !== "custom") return [];
  return normalizeCustomCadence(settings.custom_cadence_days);
}

// ─────────────────────────────────────────────────────────────────────────────
// getCadenceDays — lead override beats tenant preset
// ─────────────────────────────────────────────────────────────────────────────
function getCadenceDays(settings, leadOverride = null) {
  if (leadOverride === "off") return [];
  if (leadOverride && CADENCE_PRESETS[leadOverride]) return CADENCE_PRESETS[leadOverride];

  if (settings.cadence_preset === "custom" && Array.isArray(settings.custom_cadence_days)) {
    // Return just the day numbers, normalized — accepts both legacy int[]
    // and new {day,channel}[] forms. Used by anything that only cares about
    // WHICH days fire (e.g. the legacy Phase 10B preset filter). The custom
    // scheduling path uses getCustomCadenceSteps() instead, which keeps the
    // per-day channel info.
    return normalizeCustomCadence(settings.custom_cadence_days).map((s) => s.day);
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
  getCustomCadenceSteps,
  normalizeCustomCadence,
  matchesOptOutKeywords,
  CADENCE_PRESETS,
  INDUSTRY_DEFAULTS,
};

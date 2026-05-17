"use strict";

/**
 * services/sentimentAutoPause.js
 *
 * Phase 10D — Auto-pause leads on negative sentiment / opt-out keywords.
 *
 * v1 (this file): keyword-based, zero LLM cost. Polls inbound messages
 *                 on a cron AND exposes checkAndAutoPause() for real-time
 *                 use from inbound SMS webhook handlers.
 * v2 (future):    layer sentiment scoring on top, gated by
 *                 auto_pause_sentiment_threshold (already in mig 074).
 *
 * NOTE: this complements the existing hasRecentNegativeSentiment() in
 * services/estimateRecovery.js. Both write to leads.recovery_paused;
 * both are idempotent. Once we see real data, we can consolidate.
 */

const db = require("../lib/db");
const {
  getRecoverySettings,
  matchesOptOutKeywords,
} = require("../lib/recoverySettings");

const POLL_WINDOW_MINUTES = 10;        // overlap with cron interval = safety margin
const CRON_INTERVAL_MS    = 5 * 60 * 1000;

// Defensive audit-log wrapper
async function logAudit(payload) {
  try {
    const { auditLog } = require("../lib/auditLogger");
    await auditLog(payload);
  } catch (err) {
    console.warn("[auto-pause] audit log skipped: %s", err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Synchronous check — safe from inbound webhook for real-time pause.
// Idempotent: won't re-pause an already-paused lead.
// ─────────────────────────────────────────────────────────────────────────────
async function checkAndAutoPause({ tenantId, leadId, messageText }) {
  if (!tenantId || !leadId || !messageText) {
    return { paused: false, keyword: null };
  }

  let settings;
  try {
    settings = await getRecoverySettings(tenantId);
  } catch (err) {
    console.error("[auto-pause] getRecoverySettings failed tenant=%s err=%s", tenantId, err.message);
    return { paused: false, keyword: null };
  }

  if (!settings.auto_pause_enabled) {
    return { paused: false, keyword: null };
  }

  const matchedKeyword = matchesOptOutKeywords(messageText, settings);
  if (!matchedKeyword) return { paused: false, keyword: null };

  try {
    const existing = await db.query(
      `SELECT id, recovery_paused
         FROM leads
        WHERE id = $1 AND tenant_id = $2
        LIMIT 1`,
      [leadId, tenantId]
    );
    if (existing.rows.length === 0) return { paused: false, keyword: null };
    if (existing.rows[0].recovery_paused) {
      return { paused: false, keyword: matchedKeyword };
    }

    await db.query(
      `UPDATE leads
          SET recovery_paused        = true,
              recovery_paused_reason = $3,
              recovery_paused_at     = now(),
              recovery_paused_by     = NULL
        WHERE id = $1 AND tenant_id = $2`,
      [leadId, tenantId, `auto:keyword:${matchedKeyword}`]
    );

    await logAudit({
      tenantId,
      userId: null,
      action: "lead.recovery_auto_paused",
      meta: { lead_id: leadId, keyword: matchedKeyword, source: "keyword_match" },
    });

    console.log("[auto-pause] tenant=%s lead=%s keyword=\"%s\"", tenantId, leadId, matchedKeyword);
    return { paused: true, keyword: matchedKeyword };
  } catch (err) {
    console.error("[auto-pause] update failed tenant=%s lead=%s err=%s", tenantId, leadId, err.message);
    return { paused: false, keyword: matchedKeyword, error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron handler — scans last N min of inbound messages for opt-out keywords.
// Catches anything that slipped past the real-time hook.
//
// IMPORTANT: this query assumes inbound SMS lives in a table with columns:
//   tenant_id, lead_id, body, direction='inbound', created_at
//
// If your schema uses a different table (e.g. sms_log, messages) or column
// names (e.g. text instead of body), adjust the SQL below.
// ─────────────────────────────────────────────────────────────────────────────
async function runAutoPauseCron() {
  const sinceIso = new Date(Date.now() - POLL_WINDOW_MINUTES * 60 * 1000).toISOString();

  let messages;
  try {
    const result = await db.query(
      `SELECT id, tenant_id, lead_id, body, created_at
         FROM sms_messages
        WHERE direction = 'inbound'
          AND created_at > $1
          AND lead_id IS NOT NULL
        LIMIT 500`,
      [sinceIso]
    );
    messages = result.rows;
  } catch (err) {
    console.error("[auto-pause-cron] query error: %s", err.message);
    return { checked: 0, paused: 0, error: err.message };
  }

  let pausedCount = 0;
  for (const msg of messages) {
    try {
      const r = await checkAndAutoPause({
        tenantId: msg.tenant_id,
        leadId: msg.lead_id,
        messageText: msg.body,
      });
      if (r.paused) pausedCount += 1;
    } catch (err) {
      console.error("[auto-pause-cron] per-message error: %s", err.message);
    }
  }

  if (pausedCount > 0) {
    console.log("[auto-pause-cron] scanned=%d paused=%d", messages.length, pausedCount);
  }
  return { checked: messages.length, paused: pausedCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cron starter — call once from server.js boot
// ─────────────────────────────────────────────────────────────────────────────
function startAutoPauseCron() {
  // First run delayed 30s so DB pool is warm
  setTimeout(
    () => runAutoPauseCron().catch(e => console.error("[auto-pause-cron] init err: %s", e.message)),
    30000
  );

  setInterval(
    () => runAutoPauseCron().catch(e => console.error("[auto-pause-cron] tick err: %s", e.message)),
    CRON_INTERVAL_MS
  );

  console.log(
    "[startup] sentimentAutoPause cron scheduled — interval=%ds window=%dmin",
    CRON_INTERVAL_MS / 1000,
    POLL_WINDOW_MINUTES
  );
}

module.exports = {
  checkAndAutoPause,
  runAutoPauseCron,
  startAutoPauseCron,
};

// services/sentimentAutoPause.js
// Phase 10D — Auto-pause leads on negative sentiment / opt-out keywords
//
// v1 (this file): keyword-based. Polls inbound messages on a cron and
//                 also exposes a sync function for real-time webhook use.
// v2 (later):     sentiment scoring via existing GPT-4o pipeline,
//                 gated by auto_pause_sentiment_threshold.

const { supabase } = require('../lib/supabase');
const { auditLog } = require('../lib/auditLogger');
const {
  getRecoverySettings,
  matchesOptOutKeywords
} = require('../lib/recoverySettings');

const POLL_WINDOW_MINUTES = 10;     // overlap window vs cron interval = safety margin
const CRON_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------
// Synchronous check — safe to call from inbound SMS webhook for
// real-time pause. Idempotent: won't re-pause an already-paused lead.
// ---------------------------------------------------------------------
async function checkAndAutoPause({ tenantId, leadId, messageText }) {
  if (!tenantId || !leadId || !messageText) {
    return { paused: false, keyword: null };
  }

  const settings = await getRecoverySettings(tenantId);
  if (!settings.auto_pause_enabled) {
    return { paused: false, keyword: null };
  }

  const matchedKeyword = matchesOptOutKeywords(messageText, settings);
  if (!matchedKeyword) return { paused: false, keyword: null };

  // Skip if already paused
  const { data: existing } = await supabase
    .from('leads')
    .select('id, recovery_paused')
    .eq('id', leadId)
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (!existing) return { paused: false, keyword: null };
  if (existing.recovery_paused) return { paused: false, keyword: matchedKeyword };

  const { error: updateErr } = await supabase
    .from('leads')
    .update({
      recovery_paused: true,
      recovery_paused_reason: `auto:keyword:${matchedKeyword}`,
      recovery_paused_at: new Date().toISOString(),
      recovery_paused_by: null   // null = system action
    })
    .eq('id', leadId)
    .eq('tenant_id', tenantId);

  if (updateErr) {
    console.error('[auto-pause] update failed:', updateErr);
    return { paused: false, keyword: matchedKeyword, error: updateErr.message };
  }

  await auditLog({
    tenantId,
    userId: null,
    action: 'lead.recovery_auto_paused',
    meta: { lead_id: leadId, keyword: matchedKeyword, source: 'keyword_match' }
  });

  console.log(`[auto-pause] tenant=${tenantId} lead=${leadId} keyword="${matchedKeyword}"`);
  return { paused: true, keyword: matchedKeyword };
}

// ---------------------------------------------------------------------
// Cron handler — scans last N minutes of inbound messages.
// Catches anything that slipped past real-time hooks.
// ---------------------------------------------------------------------
async function runAutoPauseCron() {
  const since = new Date(Date.now() - POLL_WINDOW_MINUTES * 60 * 1000).toISOString();

  // NOTE: verify this table name matches your schema.
  // Likely candidates: sms_messages, messages, sms_log, twilio_messages.
  // The query needs: tenant_id, lead_id, body/text, direction, created_at.
  const { data: messages, error } = await supabase
    .from('sms_messages')          // <-- VERIFY this matches your table
    .select('id, tenant_id, lead_id, body, created_at')
    .eq('direction', 'inbound')
    .gte('created_at', since)
    .limit(500);

  if (error) {
    console.error('[auto-pause-cron] query error:', error);
    return { checked: 0, paused: 0, error: error.message };
  }

  let pausedCount = 0;
  for (const msg of messages || []) {
    if (!msg.lead_id) continue;
    try {
      const result = await checkAndAutoPause({
        tenantId: msg.tenant_id,
        leadId: msg.lead_id,
        messageText: msg.body
      });
      if (result.paused) pausedCount++;
    } catch (err) {
      console.error('[auto-pause-cron] per-message error:', err);
    }
  }

  if (pausedCount > 0) {
    console.log(`[auto-pause-cron] scanned=${messages?.length || 0} paused=${pausedCount}`);
  }
  return { checked: messages?.length || 0, paused: pausedCount };
}

// ---------------------------------------------------------------------
// Cron starter — call once from server.js boot
// ---------------------------------------------------------------------
function startAutoPauseCron() {
  // Delayed first run so DB pool is warm
  setTimeout(
    () => runAutoPauseCron().catch(e => console.error('[auto-pause-cron] init', e)),
    30000
  );
  setInterval(
    () => runAutoPauseCron().catch(e => console.error('[auto-pause-cron] tick', e)),
    CRON_INTERVAL_MS
  );
  console.log(
    `[auto-pause-cron] started — interval=${CRON_INTERVAL_MS / 1000}s, window=${POLL_WINDOW_MINUTES}min`
  );
}

module.exports = {
  checkAndAutoPause,
  runAutoPauseCron,
  startAutoPauseCron
};

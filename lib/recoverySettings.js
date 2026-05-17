// lib/recoverySettings.js
// Phase 10 — Recovery Toggle System helper
// Used by routes/recovery.js + services/estimateRecovery.js + services/runSmsFollowUps.js

const { supabase } = require('./supabase');

// ---------------------------------------------------------------------
// Cadence presets (days after estimate sent / trigger fire)
// ---------------------------------------------------------------------
const CADENCE_PRESETS = {
  aggressive: [1, 2, 4, 7, 10, 14, 18, 21],
  standard:   [1, 3, 7, 14, 21],
  gentle:     [3, 10, 21],
  single:     [3]
};

const INDUSTRY_DEFAULTS = {
  roofing:        'aggressive',
  home_ext:       'aggressive',
  home_exterior:  'aggressive',
  fence:          'gentle',
  painting:       'standard'
};

// ---------------------------------------------------------------------
// Load settings (lazy-creates row if missing)
// ---------------------------------------------------------------------
async function getRecoverySettings(tenantId) {
  if (!tenantId) throw new Error('tenantId required');

  let { data, error } = await supabase
    .from('recovery_settings')
    .select('*')
    .eq('tenant_id', tenantId)
    .maybeSingle();

  if (error) throw error;
  if (data) return data;

  // lazy-create with industry default
  const { data: tenant } = await supabase
    .from('tenants')
    .select('id, industry')
    .eq('id', tenantId)
    .single();

  const preset = INDUSTRY_DEFAULTS[tenant?.industry] || 'standard';

  const { data: created, error: insertErr } = await supabase
    .from('recovery_settings')
    .insert({
      tenant_id: tenantId,
      cadence_preset: preset,
      industry_tag: tenant?.industry || null
    })
    .select()
    .single();

  if (insertErr) throw insertErr;
  return created;
}

// ---------------------------------------------------------------------
// Quiet-hours check — timezone-aware, no external deps
// ---------------------------------------------------------------------
function isInQuietHours(settings, now = new Date()) {
  if (!settings?.quiet_hours_enabled) return false;

  const tz = settings.quiet_hours_timezone || 'America/Chicago';

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false
  });
  const parts = fmt.formatToParts(now);
  const hour    = parseInt(parts.find(p => p.type === 'hour').value, 10);
  const minute  = parseInt(parts.find(p => p.type === 'minute').value, 10);
  const weekday = parts.find(p => p.type === 'weekday').value;

  if (settings.quiet_hours_weekend && (weekday === 'Sat' || weekday === 'Sun')) {
    return true;
  }

  const [sH, sM] = (settings.quiet_hours_start || '21:00').split(':').map(Number);
  const [eH, eM] = (settings.quiet_hours_end   || '08:00').split(':').map(Number);

  const nowMin   = hour * 60 + minute;
  const startMin = sH   * 60 + sM;
  const endMin   = eH   * 60 + eM;

  if (startMin === endMin) return false;
  if (startMin < endMin) return nowMin >= startMin && nowMin < endMin;
  return nowMin >= startMin || nowMin < endMin;  // overnight window
}

// ---------------------------------------------------------------------
// Cadence resolution (lead override > tenant preset)
// ---------------------------------------------------------------------
function getCadenceDays(settings, leadOverride = null) {
  if (leadOverride === 'off') return [];
  if (leadOverride && CADENCE_PRESETS[leadOverride]) return CADENCE_PRESETS[leadOverride];

  if (settings.cadence_preset === 'custom' && Array.isArray(settings.custom_cadence_days)) {
    return settings.custom_cadence_days;
  }
  return CADENCE_PRESETS[settings.cadence_preset] || CADENCE_PRESETS.standard;
}

// ---------------------------------------------------------------------
// MASTER GATE — call before EVERY recovery send
// Returns { allowed, reason }
// Valid `trigger` values: estimate_recovery | missed_call | appointment_reminder
//                        | nurturing | voicemail_followup | no_show
// Valid `channel` values: sms | email | voice
// ---------------------------------------------------------------------
async function canSendRecovery({ tenantId, channel, trigger, leadId = null, now = new Date() }) {
  const settings = await getRecoverySettings(tenantId);

  if (!settings.recovery_enabled) return { allowed: false, reason: 'master_off' };

  if (channel === 'sms'   && !settings.sms_enabled)   return { allowed: false, reason: 'sms_disabled' };
  if (channel === 'email' && !settings.email_enabled) return { allowed: false, reason: 'email_disabled' };
  if (channel === 'voice' && !settings.voice_enabled) return { allowed: false, reason: 'voice_disabled' };

  const triggerKey = `trigger_${trigger}`;
  if (settings[triggerKey] === false) return { allowed: false, reason: `${trigger}_disabled` };

  if (isInQuietHours(settings, now)) return { allowed: false, reason: 'quiet_hours' };

  if (leadId) {
    const { data: lead } = await supabase
      .from('leads')
      .select('recovery_paused, recovery_cadence_override')
      .eq('id', leadId)
      .maybeSingle();

    if (lead?.recovery_paused) return { allowed: false, reason: 'lead_paused' };
    if (lead?.recovery_cadence_override === 'off') return { allowed: false, reason: 'lead_cadence_off' };
  }

  return { allowed: true, reason: null, settings };
}

// ---------------------------------------------------------------------
// Negative-sentiment / opt-out keyword check (used by auto-pause cron)
// ---------------------------------------------------------------------
function matchesOptOutKeywords(text, settings) {
  if (!text || !settings?.auto_pause_keywords?.length) return null;
  const lower = String(text).toLowerCase();
  return settings.auto_pause_keywords.find(kw => lower.includes(String(kw).toLowerCase())) || null;
}

module.exports = {
  getRecoverySettings,
  canSendRecovery,
  isInQuietHours,
  getCadenceDays,
  matchesOptOutKeywords,
  CADENCE_PRESETS,
  INDUSTRY_DEFAULTS
};

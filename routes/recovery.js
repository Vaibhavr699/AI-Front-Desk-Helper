// routes/recovery.js
// Phase 10 — Recovery Toggle System routes
// Mounted at /api/recovery with authMiddleware applied at server.js mount level

const express = require('express');
const router = express.Router();
const { auditLog } = require('../lib/auditLogger');
const { supabase } = require('../lib/supabase');
const {
  getRecoverySettings,
  CADENCE_PRESETS
} = require('../lib/recoverySettings');

// ---------------------------------------------------------------------
// Tier gating — field allow-lists
// ---------------------------------------------------------------------
const BASIC_FIELDS = ['recovery_enabled'];

const PRO_FIELDS = [
  ...BASIC_FIELDS,
  'sms_enabled', 'email_enabled', 'voice_enabled',
  'cadence_preset', 'custom_cadence_days',
  'trigger_estimate_recovery', 'trigger_missed_call',
  'trigger_appointment_reminder', 'trigger_nurturing',
  'trigger_voicemail_followup', 'trigger_no_show',
  'quiet_hours_enabled', 'quiet_hours_start', 'quiet_hours_end',
  'quiet_hours_timezone', 'quiet_hours_weekend',
  'auto_pause_enabled', 'auto_pause_sentiment_threshold', 'auto_pause_keywords',
  'cohort_analysis_opt_in'
];

// Elite = same as Pro for now; Phase 10E (DISC-adaptive) deferred until 8A ships
const ELITE_FIELDS = PRO_FIELDS;

const ELITE_PLANS = ['elite', 'white_label', 'reseller', 'franchise', 'franchise_hq'];

function getAllowedFields(plan) {
  const p = String(plan || '').toLowerCase();
  if (ELITE_PLANS.includes(p)) return ELITE_FIELDS;
  if (p === 'pro')             return PRO_FIELDS;
  return BASIC_FIELDS;
}

// =====================================================================
// GET /api/recovery/settings
// =====================================================================
router.get('/settings', async (req, res) => {
  try {
    const settings = await getRecoverySettings(req.tenantId);
    const plan = req.tenant?.plan || 'basic';
    res.json({
      settings,
      tier_allowed_fields: getAllowedFields(plan),
      presets: CADENCE_PRESETS,
      plan
    });
  } catch (err) {
    console.error('[recovery/settings GET]', err);
    res.status(500).json({ error: 'failed to load recovery settings' });
  }
});

// =====================================================================
// PATCH /api/recovery/settings
// =====================================================================
router.patch('/settings', async (req, res) => {
  try {
    const tenantId = req.tenantId;
    const userId   = req.userId;
    const plan     = req.tenant?.plan || 'basic';

    const allowed = getAllowedFields(plan);
    const updates = {};
    const rejected = [];

    for (const [k, v] of Object.entries(req.body || {})) {
      if (allowed.includes(k)) updates[k] = v;
      else rejected.push(k);
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        error: 'no permitted fields in payload',
        rejected,
        hint: 'upgrade tier to edit additional fields'
      });
    }

    // Validate cadence_preset if present
    if (updates.cadence_preset &&
        !['aggressive','standard','gentle','single','custom'].includes(updates.cadence_preset)) {
      return res.status(400).json({ error: 'invalid cadence_preset' });
    }

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('recovery_settings')
      .update(updates)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (error) throw error;

    await auditLog({
      tenantId, userId,
      action: 'recovery_settings.update',
      meta: {
        updated_fields: Object.keys(updates).filter(k => k !== 'updated_at'),
        rejected
      }
    });

    res.json({ settings: data, rejected });
  } catch (err) {
    console.error('[recovery/settings PATCH]', err);
    res.status(500).json({ error: 'failed to update recovery settings' });
  }
});

// =====================================================================
// POST /api/recovery/leads/:id/pause
// =====================================================================
router.post('/leads/:id/pause', async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const { reason } = req.body || {};

    const { data, error } = await supabase
      .from('leads')
      .update({
        recovery_paused: true,
        recovery_paused_reason: reason || 'manual',
        recovery_paused_at: new Date().toISOString(),
        recovery_paused_by: req.userId
      })
      .eq('id', leadId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();

    if (error) throw error;

    await auditLog({
      tenantId: req.tenantId,
      userId: req.userId,
      action: 'lead.recovery_paused',
      meta: { lead_id: leadId, reason: reason || 'manual' }
    });

    res.json({ lead: data });
  } catch (err) {
    console.error('[recovery/leads/pause]', err);
    res.status(500).json({ error: 'failed to pause recovery' });
  }
});

// =====================================================================
// POST /api/recovery/leads/:id/resume
// =====================================================================
router.post('/leads/:id/resume', async (req, res) => {
  try {
    const { id: leadId } = req.params;

    const { data, error } = await supabase
      .from('leads')
      .update({
        recovery_paused: false,
        recovery_paused_reason: null,
        recovery_paused_at: null,
        recovery_paused_by: null
      })
      .eq('id', leadId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();

    if (error) throw error;

    await auditLog({
      tenantId: req.tenantId,
      userId: req.userId,
      action: 'lead.recovery_resumed',
      meta: { lead_id: leadId }
    });

    res.json({ lead: data });
  } catch (err) {
    console.error('[recovery/leads/resume]', err);
    res.status(500).json({ error: 'failed to resume recovery' });
  }
});

// =====================================================================
// PATCH /api/recovery/leads/:id/cadence
// Per-lead cadence override: aggressive | standard | gentle | single | off | null
// =====================================================================
router.patch('/leads/:id/cadence', async (req, res) => {
  try {
    const { id: leadId } = req.params;
    const { cadence } = req.body || {};

    const valid = [null, 'aggressive', 'standard', 'gentle', 'single', 'off'];
    if (!valid.includes(cadence)) {
      return res.status(400).json({ error: 'invalid cadence', valid });
    }

    const { data, error } = await supabase
      .from('leads')
      .update({ recovery_cadence_override: cadence })
      .eq('id', leadId)
      .eq('tenant_id', req.tenantId)
      .select()
      .single();

    if (error) throw error;

    await auditLog({
      tenantId: req.tenantId,
      userId: req.userId,
      action: 'lead.recovery_cadence_override',
      meta: { lead_id: leadId, cadence }
    });

    res.json({ lead: data });
  } catch (err) {
    console.error('[recovery/leads/cadence]', err);
    res.status(500).json({ error: 'failed to update cadence' });
  }
});

module.exports = router;

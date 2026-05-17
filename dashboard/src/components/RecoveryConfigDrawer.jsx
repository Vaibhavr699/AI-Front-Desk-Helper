import React, { useState, useEffect, useCallback } from 'react';
import { getRecoverySettings, updateRecoverySettings } from '../api';

// Maps each ghost-sequence day to its channel (per GHOST_SEQUENCE in
// services/estimateRecovery.js). Days not in this map don't fire for
// estimate recovery — they'd only be useful for future custom sequences.
const SEQUENCE_DAY_CHANNELS = {
  1:  'sms',
  3:  'sms',
  5:  'call',
  7:  'sms',
  10: 'call',
  14: 'sms',
  17: 'call',
  21: 'sms',
};

const CADENCE_OPTIONS = [
  { value: 'aggressive', label: 'Aggressive', days: [1, 3, 5, 7, 10, 14, 17, 21] },
  { value: 'standard',   label: 'Standard',   days: [1, 3, 7, 14, 21] },
  { value: 'gentle',     label: 'Gentle',     days: [3, 10, 21] },
  { value: 'single',     label: 'Single',     days: [3] },
  { value: 'custom',     label: 'Custom',     days: null },
];

const TRIGGER_KEYS = [
  { key: 'trigger_estimate_recovery',    label: 'Estimate Recovery',     desc: 'Follow-ups after sending an estimate' },
  { key: 'trigger_missed_call',          label: 'Missed Calls',          desc: 'Auto-text and callback after missed calls' },
  { key: 'trigger_appointment_reminder', label: 'Appointment Reminders', desc: '24h and 2h reminders before booked estimates' },
  { key: 'trigger_nurturing',            label: 'Nurturing',             desc: 'Long-term re-engagement campaigns' },
  { key: 'trigger_voicemail_followup',   label: 'Voicemail Follow-up',   desc: 'SMS after AI leaves a voicemail' },
  { key: 'trigger_no_show',              label: 'No-Show Follow-up',     desc: 'Follow up when a customer misses their appointment' },
];

const ELITE_PLANS = ['elite', 'white_label', 'reseller', 'franchise', 'franchise_hq'];

function summarizeSchedule(days) {
  if (!days?.length) return { sms: 0, call: 0, total: 0, invalid: 0 };
  let sms = 0, call = 0, invalid = 0;
  for (const d of days) {
    const ch = SEQUENCE_DAY_CHANNELS[d];
    if (ch === 'call') call++;
    else if (ch === 'sms') sms++;
    else invalid++;
  }
  return { sms, call, total: sms + call, invalid };
}

function ScheduleChips({ days }) {
  if (!days?.length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {days.map(day => {
        const ch = SEQUENCE_DAY_CHANNELS[day];
        const styleClass = ch === 'call'
          ? 'bg-purple-50 text-purple-700 border-purple-200'
          : ch === 'sms'
          ? 'bg-blue-50 text-blue-700 border-blue-200'
          : 'bg-stone-100 text-stone-400 border-stone-200';
        const title = ch
          ? `Day ${day} · ${ch === 'call' ? 'AI Call' : 'SMS'}`
          : `Day ${day} · No matching estimate recovery step (will be ignored)`;
        return (
          <span
            key={day}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border ${styleClass}`}
            title={title}
          >
            D{day}
            <span>{ch === 'call' ? '📞' : ch === 'sms' ? '📱' : '·'}</span>
          </span>
        );
      })}
    </div>
  );
}

function formatScheduleSummary(s) {
  if (s.total === 0) return 'No matching steps';
  const parts = [];
  if (s.sms > 0)  parts.push(`${s.sms} SMS`);
  if (s.call > 0) parts.push(`${s.call} AI call${s.call !== 1 ? 's' : ''}`);
  return `${s.total} follow-up${s.total !== 1 ? 's' : ''} · ${parts.join(' + ')}`;
}

export default function RecoveryConfigDrawer({ open, onClose }) {
  const [settings, setSettings] = useState(null);
  const [allowedFields, setAllowedFields] = useState([]);
  const [plan, setPlan] = useState('basic');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState('general');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    getRecoverySettings()
      .then(data => {
        setSettings(data.settings);
        setAllowedFields(data.tier_allowed_fields || []);
        setPlan(data.plan || 'basic');
      })
      .catch(err => {
        console.error('Failed to load recovery settings:', err);
        setError('Failed to load settings. Please try again.');
      })
      .finally(() => setLoading(false));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const isAllowed = useCallback((field) => allowedFields.includes(field), [allowedFields]);

  const handleChange = useCallback(async (field, value) => {
    if (!isAllowed(field)) return;
    const prev = settings;
    setSettings(s => ({ ...s, [field]: value }));
    setSaving(true);
    try {
      const res = await updateRecoverySettings({ [field]: value });
      setSettings(res.settings);
    } catch (err) {
      console.error('Save failed:', err);
      setSettings(prev);
      setError('Failed to save change');
      setTimeout(() => setError(null), 3000);
    } finally {
      setSaving(false);
    }
  }, [settings, isAllowed]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/40 z-40 transition-opacity"
        onClick={onClose}
      />

      <div className="fixed top-0 right-0 h-full w-full max-w-xl bg-stone-50 z-50 shadow-2xl flex flex-col">
        <div className="px-6 py-5 border-b border-stone-200 bg-white flex items-start justify-between">
          <div>
            <h2 className="text-xl font-bold text-stone-900">Configure Follow-ups</h2>
            <p className="text-sm text-stone-500 mt-0.5">
              Customize how and when your AI follows up with leads.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-stone-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="h-5 w-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="px-6 bg-white border-b border-stone-200 flex gap-1">
          {[
            { id: 'general',   label: 'General' },
            { id: 'triggers',  label: 'Triggers' },
            { id: 'autopause', label: 'Auto-Pause' },
            { id: 'analytics', label: 'Analytics' },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-4 py-3 text-sm font-semibold transition-colors border-b-2 -mb-px ${
                activeTab === t.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-stone-500 hover:text-stone-900'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-stone-900"></div>
            </div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
              {error}
            </div>
          ) : settings ? (
            <>
              {activeTab === 'general'   && <GeneralTab   settings={settings} isAllowed={isAllowed} onChange={handleChange} plan={plan} />}
              {activeTab === 'triggers'  && <TriggersTab  settings={settings} isAllowed={isAllowed} onChange={handleChange} plan={plan} />}
              {activeTab === 'autopause' && <AutoPauseTab settings={settings} isAllowed={isAllowed} onChange={handleChange} plan={plan} />}
              {activeTab === 'analytics' && <AnalyticsTab plan={plan} />}
            </>
          ) : null}
        </div>

        {saving && (
          <div className="px-6 py-2 bg-blue-50 border-t border-blue-100 text-xs text-blue-700 flex items-center gap-2">
            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-700"></div>
            Saving...
          </div>
        )}
      </div>
    </>
  );
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        disabled
          ? 'bg-stone-200 cursor-not-allowed opacity-50'
          : checked ? 'bg-blue-600' : 'bg-stone-300'
      }`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`} />
    </button>
  );
}

function TierBadge({ tier }) {
  const colors = {
    PRO:   'bg-purple-100 text-purple-700 border-purple-200',
    ELITE: 'bg-amber-100 text-amber-700 border-amber-200',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded border ${colors[tier]}`}>
      {tier}
    </span>
  );
}

function FieldRow({ label, desc, tier, locked, children }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-stone-100 last:border-0">
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-0.5">
          <span className={`text-sm font-semibold ${locked ? 'text-stone-400' : 'text-stone-900'}`}>{label}</span>
          {tier && locked && <TierBadge tier={tier} />}
        </div>
        {desc && <p className="text-xs text-stone-500">{desc}</p>}
      </div>
      <div className="flex-shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function tierLabelFor(field, isAllowed, plan) {
  if (isAllowed(field)) return null;
  return plan === 'basic' ? 'PRO' : 'ELITE';
}

function GeneralTab({ settings, isAllowed, onChange, plan }) {
  const tierLabel = (f) => tierLabelFor(f, isAllowed, plan);

  const [customDaysText, setCustomDaysText] = useState(
    (settings.custom_cadence_days || []).join(', ')
  );
  const [customDaysError, setCustomDaysError] = useState(null);

  useEffect(() => {
    setCustomDaysText((settings.custom_cadence_days || []).join(', '));
  }, [settings.custom_cadence_days]);

  const handleCustomDaysBlur = () => {
    setCustomDaysError(null);
    if (!customDaysText.trim()) {
      onChange('custom_cadence_days', []);
      return;
    }
    const parts = customDaysText.split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    const days = [];
    for (const p of parts) {
      const n = parseInt(p, 10);
      if (isNaN(n) || n < 0 || n > 90) {
        setCustomDaysError(`Invalid: "${p}". Use whole numbers 0–90, comma-separated.`);
        return;
      }
      if (!days.includes(n)) days.push(n);
    }
    days.sort((a, b) => a - b);
    onChange('custom_cadence_days', days);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Master Toggle</h3>
        <FieldRow
          label="Enable follow-ups"
          desc="When off, no automated SMS, email, or voice follow-ups will be sent."
        >
          <Toggle
            checked={settings.recovery_enabled}
            onChange={(v) => onChange('recovery_enabled', v)}
            disabled={!isAllowed('recovery_enabled')}
          />
        </FieldRow>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Channels</h3>
        <FieldRow label="SMS"   desc="Text messages"     tier={tierLabel('sms_enabled')}   locked={!isAllowed('sms_enabled')}>
          <Toggle checked={settings.sms_enabled}   onChange={(v) => onChange('sms_enabled', v)}   disabled={!isAllowed('sms_enabled')} />
        </FieldRow>
        <FieldRow label="Email" desc="Email follow-ups"  tier={tierLabel('email_enabled')} locked={!isAllowed('email_enabled')}>
          <Toggle checked={settings.email_enabled} onChange={(v) => onChange('email_enabled', v)} disabled={!isAllowed('email_enabled')} />
        </FieldRow>
        <FieldRow label="Voice" desc="AI callback calls" tier={tierLabel('voice_enabled')} locked={!isAllowed('voice_enabled')}>
          <Toggle checked={settings.voice_enabled} onChange={(v) => onChange('voice_enabled', v)} disabled={!isAllowed('voice_enabled')} />
        </FieldRow>
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3 flex items-center gap-2">
          Cadence Preset
          {!isAllowed('cadence_preset') && <TierBadge tier={tierLabel('cadence_preset')} />}
        </h3>
        <p className="text-xs text-stone-500 mb-3">
          Estimate recovery sends Day 0 confirmation (always), then follows up across 21 days. 📱 = SMS · 📞 = AI call. Email isn't part of this sequence — use the Channels toggles for email follow-ups in other flows.
        </p>
        <div className="space-y-2">
          {CADENCE_OPTIONS.map(opt => {
            const summary = opt.days ? summarizeSchedule(opt.days) : null;
            return (
              <label
                key={opt.value}
                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                  settings.cadence_preset === opt.value
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-stone-200 hover:border-stone-300'
                } ${!isAllowed('cadence_preset') ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <input
                  type="radio"
                  name="cadence_preset"
                  value={opt.value}
                  checked={settings.cadence_preset === opt.value}
                  onChange={() => onChange('cadence_preset', opt.value)}
                  disabled={!isAllowed('cadence_preset')}
                  className="h-4 w-4 text-blue-600 mt-0.5"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-stone-900">{opt.label}</div>
                  {opt.value === 'custom' ? (
                    <div className="text-xs text-stone-500">Set your own day intervals (below)</div>
                  ) : (
                    <>
                      <div className="text-xs text-stone-500">{formatScheduleSummary(summary)}</div>
                      <ScheduleChips days={opt.days} />
                    </>
                  )}
                </div>
              </label>
            );
          })}
        </div>

        {settings.cadence_preset === 'custom' && (
          <div className="mt-4 pt-4 border-t border-stone-100">
            <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">
              Custom Days
            </label>
            <p className="text-xs text-stone-500 mb-2">
              Comma-separated day numbers (0–90). Valid estimate recovery step days: 1, 3, 5, 7, 10, 14, 17, 21. Other days save but won't fire for estimate recovery. Saves on blur.
            </p>
            <input
              type="text"
              value={customDaysText}
              onChange={(e) => setCustomDaysText(e.target.value)}
              onBlur={handleCustomDaysBlur}
              placeholder="1, 3, 7, 14, 21"
              disabled={!isAllowed('custom_cadence_days')}
              className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
            />
            {customDaysError && (
              <p className="text-xs text-red-600 mt-1">{customDaysError}</p>
            )}
            {!customDaysError && settings.custom_cadence_days?.length > 0 && (
              <>
                <p className="text-xs text-stone-500 mt-2">
                  {formatScheduleSummary(summarizeSchedule(settings.custom_cadence_days))}
                  {summarizeSchedule(settings.custom_cadence_days).invalid > 0 && (
                    <span className="text-stone-400"> ({summarizeSchedule(settings.custom_cadence_days).invalid} day{summarizeSchedule(settings.custom_cadence_days).invalid !== 1 ? 's' : ''} won't match a step)</span>
                  )}
                </p>
                <ScheduleChips days={settings.custom_cadence_days} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Quiet Hours</h3>
        <FieldRow
          label="Enable quiet hours"
          desc="Don't send messages during these times."
          tier={tierLabel('quiet_hours_enabled')}
          locked={!isAllowed('quiet_hours_enabled')}
        >
          <Toggle
            checked={settings.quiet_hours_enabled}
            onChange={(v) => onChange('quiet_hours_enabled', v)}
            disabled={!isAllowed('quiet_hours_enabled')}
          />
        </FieldRow>
        {settings.quiet_hours_enabled && (
          <>
            <FieldRow label="Start time" tier={tierLabel('quiet_hours_start')} locked={!isAllowed('quiet_hours_start')}>
              <input
                type="time"
                value={(settings.quiet_hours_start || '21:00:00').slice(0, 5)}
                onChange={(e) => onChange('quiet_hours_start', e.target.value)}
                disabled={!isAllowed('quiet_hours_start')}
                className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5 text-sm font-mono disabled:opacity-50"
              />
            </FieldRow>
            <FieldRow label="End time" tier={tierLabel('quiet_hours_end')} locked={!isAllowed('quiet_hours_end')}>
              <input
                type="time"
                value={(settings.quiet_hours_end || '08:00:00').slice(0, 5)}
                onChange={(e) => onChange('quiet_hours_end', e.target.value)}
                disabled={!isAllowed('quiet_hours_end')}
                className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-1.5 text-sm font-mono disabled:opacity-50"
              />
            </FieldRow>
            <FieldRow label="Pause on weekends" desc="No messages on Saturday or Sunday." tier={tierLabel('quiet_hours_weekend')} locked={!isAllowed('quiet_hours_weekend')}>
              <Toggle
                checked={settings.quiet_hours_weekend}
                onChange={(v) => onChange('quiet_hours_weekend', v)}
                disabled={!isAllowed('quiet_hours_weekend')}
              />
            </FieldRow>
          </>
        )}
      </div>
    </div>
  );
}

function TriggersTab({ settings, isAllowed, onChange, plan }) {
  const tierLabel = (f) => tierLabelFor(f, isAllowed, plan);
  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
      <p className="text-sm text-stone-500 mb-4">
        Control which event types trigger automated follow-ups. Turning a trigger off stops new sends for that type.
      </p>
      {TRIGGER_KEYS.map(t => (
        <FieldRow
          key={t.key}
          label={t.label}
          desc={t.desc}
          tier={tierLabel(t.key)}
          locked={!isAllowed(t.key)}
        >
          <Toggle
            checked={settings[t.key]}
            onChange={(v) => onChange(t.key, v)}
            disabled={!isAllowed(t.key)}
          />
        </FieldRow>
      ))}
    </div>
  );
}

function AutoPauseTab({ settings, isAllowed, onChange, plan }) {
  const tierLabel = (f) => tierLabelFor(f, isAllowed, plan);
  const [keywordsText, setKeywordsText] = useState(
    (settings.auto_pause_keywords || []).join('\n')
  );

  useEffect(() => {
    setKeywordsText((settings.auto_pause_keywords || []).join('\n'));
  }, [settings.auto_pause_keywords]);

  const handleKeywordsBlur = () => {
    const arr = keywordsText.split('\n').map(s => s.trim()).filter(Boolean);
    onChange('auto_pause_keywords', arr);
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
        <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-3">Auto-Pause</h3>
        <FieldRow
          label="Pause on negative signals"
          desc="Automatically pause recovery when a lead replies with opt-out keywords."
          tier={tierLabel('auto_pause_enabled')}
          locked={!isAllowed('auto_pause_enabled')}
        >
          <Toggle
            checked={settings.auto_pause_enabled}
            onChange={(v) => onChange('auto_pause_enabled', v)}
            disabled={!isAllowed('auto_pause_enabled')}
          />
        </FieldRow>
      </div>

      {settings.auto_pause_enabled && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
          <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-2 flex items-center gap-2">
            Opt-Out Keywords
            {!isAllowed('auto_pause_keywords') && <TierBadge tier={tierLabel('auto_pause_keywords')} />}
          </h3>
          <p className="text-xs text-stone-500 mb-3">
            One keyword or phrase per line. Case-insensitive substring match. Saves on blur.
          </p>
          <textarea
            value={keywordsText}
            onChange={(e) => setKeywordsText(e.target.value)}
            onBlur={handleKeywordsBlur}
            disabled={!isAllowed('auto_pause_keywords')}
            rows={8}
            className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm font-mono focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
            placeholder="stop&#10;unsubscribe&#10;remove me&#10;not interested"
          />
        </div>
      )}
    </div>
  );
}

function AnalyticsTab({ plan }) {
  const isElite = ELITE_PLANS.includes(String(plan).toLowerCase());

  if (!isElite) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 text-center">
        <div className="inline-flex items-center justify-center h-12 w-12 rounded-full bg-amber-100 text-amber-600 mb-3">
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </div>
        <h3 className="font-bold text-stone-900 mb-1">Recovery Analytics</h3>
        <p className="text-sm text-stone-500 mb-4">
          Detailed analytics on follow-up performance — sends, replies, bookings, auto-pauses — available on Elite.
        </p>
        <TierBadge tier="ELITE" />
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
      <h3 className="text-xs font-bold text-stone-400 uppercase tracking-widest mb-4">Last 30 Days</h3>
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Follow-ups Sent',    value: '—', sub: 'across all triggers' },
          { label: 'Replies Received',   value: '—', sub: '—% response rate' },
          { label: 'Bookings Generated', value: '—', sub: '—% conversion' },
          { label: 'Auto-Pauses Fired',  value: '—', sub: 'sentiment / opt-out' },
        ].map(stat => (
          <div key={stat.label} className="bg-stone-50 rounded-xl p-4 border border-stone-100">
            <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">{stat.label}</div>
            <div className="text-2xl font-bold text-stone-900">{stat.value}</div>
            <div className="text-xs text-stone-500 mt-1">{stat.sub}</div>
          </div>
        ))}
      </div>
      <p className="text-xs text-stone-400 mt-4 italic">
        Live analytics endpoint coming in a Phase 10F follow-up build. Stats are placeholders for now.
      </p>
    </div>
  );
}

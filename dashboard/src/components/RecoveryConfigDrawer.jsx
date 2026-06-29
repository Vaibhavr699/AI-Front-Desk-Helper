import React, { useState, useEffect, useCallback } from 'react';
import { getRecoverySettings, updateRecoverySettings } from '../api';

// ─────────────────────────────────────────────────────────────────────────────
// Canonical estimate-recovery step days → channel (per GHOST_SEQUENCE in
// lib/recoveryEngine.js). Used only for the PRESET cards' chip rendering.
// Custom cadences (Phase A/B/C) define their own day+channel per entry and
// are NOT constrained to these days.
// ─────────────────────────────────────────────────────────────────────────────
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

const MAX_CUSTOM_TEXT_LEN = 1600;

// ─────────────────────────────────────────────────────────────────────────────
// Custom cadence helpers (Phase C)
//
// custom_cadence_days is stored as jsonb. Two accepted shapes (the backend
// normalizer handles both):
//   Legacy:  [1, 3, 7]
//   New:     [{day, channel, message?, script?, voicemail?}]
// normalizeCustomEntries() coerces either into the editor's working shape:
//   [{ day:number, channel:'sms'|'call', message, script, voicemail }]
// ─────────────────────────────────────────────────────────────────────────────
function normalizeCustomEntries(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const entry of raw) {
    let day = null;
    let channel = 'sms';
    let message = '';
    let script = '';
    let voicemail = '';
    if (typeof entry === 'number') {
      day = entry;
    } else if (entry && typeof entry === 'object') {
      day = Number(entry.day);
      if (entry.channel === 'call' || entry.channel === 'sms') channel = entry.channel;
      if (typeof entry.message === 'string') message = entry.message;
      if (typeof entry.script === 'string') script = entry.script;
      if (typeof entry.voicemail === 'string') voicemail = entry.voicemail;
    }
    if (!Number.isFinite(day)) continue;
    day = Math.trunc(day);
    if (day < 0 || day > 90) continue;
    if (seen.has(day)) continue;
    seen.add(day);
    out.push({ day, channel, message, script, voicemail });
  }
  out.sort((a, b) => a.day - b.day);
  return out;
}

// Strip empty text fields so we never persist blank strings (the engine
// treats absent fields as "use canonical default"). Sorts by day.
function serializeCustomEntries(entries) {
  return [...entries]
    .filter(e => Number.isFinite(e.day))
    .sort((a, b) => a.day - b.day)
    .map(e => {
      const obj = { day: e.day, channel: e.channel === 'call' ? 'call' : 'sms' };
      if (obj.channel === 'sms') {
        if (e.message && e.message.trim()) obj.message = e.message.trim();
      } else {
        if (e.script && e.script.trim()) obj.script = e.script.trim();
        if (e.voicemail && e.voicemail.trim()) obj.voicemail = e.voicemail.trim();
      }
      return obj;
    });
}

function customSummary(entries) {
  let sms = 0, call = 0;
  for (const e of entries) {
    if (e.channel === 'call') call++;
    else sms++;
  }
  const total = sms + call;
  if (total === 0) return 'No follow-ups configured';
  const parts = [];
  if (sms > 0)  parts.push(`${sms} SMS`);
  if (call > 0) parts.push(`${call} AI call${call !== 1 ? 's' : ''}`);
  return `${total} follow-up${total !== 1 ? 's' : ''} · ${parts.join(' + ')}`;
}

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

// ─────────────────────────────────────────────────────────────────────────────
// CustomCadenceEditor (Phase C — June 8, 2026)
//
// Row-based editor for custom cadences. Each row: day (0–90), channel
// (SMS / Call), and a collapsible message editor (one textarea for SMS,
// two for Call: script + voicemail). Message text is OPTIONAL — blank uses
// the canonical default copy for the nearest step. Tokens {{first_name}} /
// {{company_name}} are substituted at send time.
//
// Persistence: save-on-blur, whole-array (matches the rest of the drawer).
// We only PATCH when every row has a valid numeric day, so a half-typed row
// never gets written. Local edits live in component state; committing
// happens on blur of any field.
// ─────────────────────────────────────────────────────────────────────────────
function CustomCadenceEditor({ settings, isAllowed, onChange }) {
  const locked = !isAllowed('custom_cadence_days');
  const [rows, setRows] = useState(() => normalizeCustomEntries(settings.custom_cadence_days));
  const [expanded, setExpanded] = useState({});   // index -> bool (message editor open)
  const [rowError, setRowError] = useState(null);

  // Re-sync from server whenever the persisted value changes (e.g. after a
  // successful save returns the canonical array).
  useEffect(() => {
    setRows(normalizeCustomEntries(settings.custom_cadence_days));
  }, [settings.custom_cadence_days]);

  const voiceEnabled = !!settings.voice_enabled;

  // Commit the current rows to the server (save-on-blur). Validates that every
  // row has a numeric day and text fields are within length. No-op on invalid.
  const commit = useCallback((nextRows) => {
    setRowError(null);

    // Every row needs a finite day to be persistable.
    for (const r of nextRows) {
      if (!Number.isFinite(r.day)) return;   // half-typed; don't persist yet
      if (r.day < 0 || r.day > 90) {
        setRowError(`Day must be between 0 and 90 (got ${r.day}).`);
        return;
      }
    }
    // Duplicate-day guard.
    const days = nextRows.map(r => r.day);
    if (new Set(days).size !== days.length) {
      setRowError('Each day can only appear once.');
      return;
    }
    // Length guard on any text field.
    for (const r of nextRows) {
      for (const f of ['message', 'script', 'voicemail']) {
        if ((r[f] || '').length > MAX_CUSTOM_TEXT_LEN) {
          setRowError(`Day ${r.day} ${f} exceeds ${MAX_CUSTOM_TEXT_LEN} characters.`);
          return;
        }
      }
    }

    onChange('custom_cadence_days', serializeCustomEntries(nextRows));
  }, [onChange]);

  const updateRow = (idx, patch) => {
    setRows(rs => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setRows(rs => {
      // Suggest the next sensible day: max existing + 3, or 1 if empty.
      const maxDay = rs.reduce((m, r) => Math.max(m, Number.isFinite(r.day) ? r.day : 0), 0);
      const suggested = rs.length === 0 ? 1 : Math.min(maxDay + 3, 90);
      return [...rs, { day: suggested, channel: 'sms', message: '', script: '', voicemail: '' }];
    });
  };

  const removeRow = (idx) => {
    setRows(rs => {
      const next = rs.filter((_, i) => i !== idx);
      // Removing a row is a definite commit.
      commit(next);
      return next;
    });
    setExpanded(ex => {
      const copy = { ...ex };
      delete copy[idx];
      return copy;
    });
  };

  const toggleExpand = (idx) => {
    setExpanded(ex => ({ ...ex, [idx]: !ex[idx] }));
  };

  const sortedRows = [...rows].sort((a, b) => (a.day ?? 999) - (b.day ?? 999));
  const hasCallRows = rows.some(r => r.channel === 'call');
  const firstDay = sortedRows.length ? sortedRows[0].day : null;

  return (
    <div className="mt-4 pt-4 border-t border-stone-100">
      <div className="flex items-center justify-between mb-1">
        <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest">
          Custom Schedule
        </label>
        <span className="text-xs text-stone-500">{customSummary(rows)}</span>
      </div>
      <p className="text-xs text-stone-500 mb-3">
        Add a follow-up for any day (0–90) and pick how it's sent. Leave the message blank to use our
        proven default copy, or write your own. Use{' '}
        <code className="px-1 py-0.5 bg-stone-100 rounded text-[10px]">{'{{first_name}}'}</code> and{' '}
        <code className="px-1 py-0.5 bg-stone-100 rounded text-[10px]">{'{{company_name}}'}</code> to personalize.
      </p>

      {/* Config-time warnings */}
      {hasCallRows && !voiceEnabled && (
        <div className="mb-3 flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          <span className="text-amber-600 text-sm leading-none mt-0.5">⚠</span>
          <p className="text-xs text-amber-800">
            You have call steps, but the <strong>Voice</strong> channel is off. Those call days will be
            skipped until you enable Voice in the Channels section above.
          </p>
        </div>
      )}
      {firstDay !== null && firstDay > 0 && (
        <div className="mb-3 flex items-start gap-2 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
          <span className="text-blue-600 text-sm leading-none mt-0.5">ℹ</span>
          <p className="text-xs text-blue-800">
            Your first follow-up is on <strong>day {firstDay}</strong>. Customers won't get an immediate
            estimate confirmation — add a <strong>day 0</strong> step if you want one.
          </p>
        </div>
      )}

      {sortedRows.length === 0 && (
        <div className="text-center py-6 px-4 bg-stone-50 border border-dashed border-stone-300 rounded-xl">
          <p className="text-sm text-stone-500 mb-2">No follow-up days yet.</p>
          <p className="text-xs text-stone-400">Add your first day below to build a custom schedule.</p>
        </div>
      )}

      <div className="space-y-2">
        {sortedRows.map((row) => {
          // Find the real index in the unsorted rows array for updates.
          const idx = rows.indexOf(row);
          const isOpen = !!expanded[idx];
          return (
            <div
              key={idx}
              className="bg-white border border-stone-200 rounded-xl overflow-hidden"
            >
              <div className="flex items-center gap-2 p-3">
                {/* Day */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-bold text-stone-400 uppercase">Day</span>
                  <input
                    type="number"
                    min={0}
                    max={90}
                    value={Number.isFinite(row.day) ? row.day : ''}
                    onChange={(e) => {
                      const val = e.target.value === '' ? NaN : parseInt(e.target.value, 10);
                      updateRow(idx, { day: val });
                    }}
                    onBlur={() => commit(rows)}
                    disabled={locked}
                    className="w-16 bg-stone-50 border border-stone-200 rounded-lg px-2 py-1.5 text-sm font-mono text-center focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                  />
                </div>

                {/* Channel */}
                <div className="flex rounded-lg border border-stone-200 overflow-hidden">
                  {['sms', 'call'].map(ch => (
                    <button
                      key={ch}
                      type="button"
                      disabled={locked}
                      onClick={() => {
                        updateRow(idx, { channel: ch });
                        // Channel change is a meaningful edit; commit after state settles.
                        setTimeout(() => commit(rows.map((r, i) => i === idx ? { ...r, channel: ch } : r)), 0);
                      }}
                      className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                        row.channel === ch
                          ? ch === 'call'
                            ? 'bg-purple-600 text-white'
                            : 'bg-blue-600 text-white'
                          : 'bg-white text-stone-500 hover:bg-stone-50'
                      } disabled:opacity-50`}
                    >
                      {ch === 'call' ? '📞 Call' : '📱 SMS'}
                    </button>
                  ))}
                </div>

                {/* Customize text toggle */}
                <button
                  type="button"
                  onClick={() => toggleExpand(idx)}
                  disabled={locked}
                  className="ml-auto text-xs font-medium text-stone-500 hover:text-blue-600 transition-colors disabled:opacity-50"
                >
                  {isOpen ? 'Hide text' : (rowHasText(row) ? 'Edit text ✏️' : 'Customize text')}
                </button>

                {/* Remove */}
                <button
                  type="button"
                  onClick={() => removeRow(idx)}
                  disabled={locked}
                  className="p-1.5 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                  aria-label={`Remove day ${row.day}`}
                >
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {/* Default vs custom indicator (collapsed state) */}
              {!isOpen && (
                <div className="px-3 pb-3 -mt-1">
                  {rowHasText(row) ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Custom message
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold bg-stone-100 text-stone-500 border border-stone-200">
                      Default message
                    </span>
                  )}
                </div>
              )}

              {/* Expanded message editor */}
              {isOpen && (
                <div className="px-3 pb-3 pt-1 space-y-3 bg-stone-50/50 border-t border-stone-100">
                  {row.channel === 'sms' ? (
                    <TextField
                      label="SMS message"
                      placeholder="Leave blank to use our default copy for this day…"
                      value={row.message}
                      disabled={locked}
                      onChange={(v) => updateRow(idx, { message: v })}
                      onBlur={() => commit(rows)}
                    />
                  ) : (
                    <>
                      <TextField
                        label="Call script (spoken when answered)"
                        placeholder="Leave blank to use our default call script…"
                        value={row.script}
                        disabled={locked}
                        onChange={(v) => updateRow(idx, { script: v })}
                        onBlur={() => commit(rows)}
                      />
                      <TextField
                        label="Voicemail (left if no answer)"
                        placeholder="Leave blank to use our default voicemail…"
                        value={row.voicemail}
                        disabled={locked}
                        onChange={(v) => updateRow(idx, { voicemail: v })}
                        onBlur={() => commit(rows)}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {rowError && <p className="text-xs text-red-600 mt-2">{rowError}</p>}

      <button
        type="button"
        onClick={addRow}
        disabled={locked}
        className="mt-3 w-full flex items-center justify-center gap-2 py-2.5 rounded-xl border border-dashed border-stone-300 text-sm font-semibold text-stone-600 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors disabled:opacity-50"
      >
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
        </svg>
        Add follow-up day
      </button>
    </div>
  );
}

function rowHasText(row) {
  if (row.channel === 'sms') return !!(row.message && row.message.trim());
  return !!((row.script && row.script.trim()) || (row.voicemail && row.voicemail.trim()));
}

function TextField({ label, placeholder, value, onChange, onBlur, disabled }) {
  const len = (value || '').length;
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{label}</label>
        <span className={`text-[10px] font-mono ${len > MAX_CUSTOM_TEXT_LEN ? 'text-red-500' : 'text-stone-400'}`}>
          {len}/{MAX_CUSTOM_TEXT_LEN}
        </span>
      </div>
      <textarea
        rows={3}
        value={value || ''}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className="w-full bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50 resize-y"
      />
    </div>
  );
}

function GeneralTab({ settings, isAllowed, onChange, plan }) {
  const tierLabel = (f) => tierLabelFor(f, isAllowed, plan);

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
                    <div className="text-xs text-stone-500">Build your own day-by-day schedule (below)</div>
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
          <CustomCadenceEditor settings={settings} isAllowed={isAllowed} onChange={onChange} />
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

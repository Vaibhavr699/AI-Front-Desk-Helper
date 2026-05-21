import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  getLeadById,
  getLeadHistory,
  updateLead,
  pauseLeadRecovery,
  resumeLeadRecovery,
  updateLeadCadence,
  submitRepQuote,
  getDiscFeedback,
  assignLeadTech,
} from '../api';
import Header from '../components/Header';
import StatusStepper from '../components/StatusStepper';
import DiscFeedbackModal from '../components/CallCoach/DiscFeedbackModal';

// ──── Phase 8A — DISC display metadata ───────────────────────────────────────
//
// 4-quadrant DISC labels with color tokens matching existing card aesthetics
// (Recovery=amber, Compliance=blue, Widget=indigo, Variance=blue/amber,
//  Rep Quote=emerald). DISC gets its own family — purple/rose/teal/slate —
// so it's visually distinct from coaching/recovery/quote concerns.
const DISC_META = {
  D: { label: 'Dominant',      tagline: 'Direct, results-focused, fast decisions',                      bg: 'bg-rose-50',    border: 'border-rose-200',   text: 'text-rose-900',   badge: 'bg-rose-100 text-rose-700',     bar: 'bg-rose-500' },
  I: { label: 'Influencer',    tagline: 'Relational, enthusiastic, sells the vision',                  bg: 'bg-amber-50',   border: 'border-amber-200',  text: 'text-amber-900',  badge: 'bg-amber-100 text-amber-700',   bar: 'bg-amber-500' },
  S: { label: 'Steady',        tagline: 'Supportive, patient, consensus-driven',                       bg: 'bg-emerald-50', border: 'border-emerald-200',text: 'text-emerald-900',badge: 'bg-emerald-100 text-emerald-700',bar: 'bg-emerald-500' },
  C: { label: 'Conscientious', tagline: 'Analytical, precise, needs documentation',                    bg: 'bg-indigo-50',  border: 'border-indigo-200', text: 'text-indigo-900', badge: 'bg-indigo-100 text-indigo-700', bar: 'bg-indigo-500' },
};

// ──── Phase 8F — DISC sales advice playbooks ─────────────────────────────────
//
// Synthesized from Groovy Hues' DISC sales training (the "Presenting to
// High D/I/S/C" material) into rep-facing imperative guidance. Five fixed
// fields per type so the card renders a clean, scannable block. This is
// advice for how to WORK the customer — the layer on top of the DISC
// label that Phase 8A produces. Gated on a confident classification:
// an unprofiled or low-confidence lead shows nothing.
const DISC_ADVICE = {
  D: {
    open:    'Skip the small talk. Get to the point within the first minute.',
    pace:    'Fast and efficient — they value directness and decisiveness.',
    leadWith:'The bottom line: timeline and price range up front.',
    close:   'Direct ask, now — "I can hold a crew slot next week, want it?"',
    avoid:   'Long rapport-building, hedging, or presenting too many options.',
  },
  I: {
    open:    'Warm and friendly — genuine conversation is welcome here.',
    pace:    'Energetic and expressive. Match their enthusiasm.',
    leadWith:'The vision — how great it will look, happy customers nearby.',
    close:   'Collaborative — "Let\'s pick a start date together."',
    avoid:   'Dry spec sheets, a cold numbers-first pitch, or rushing them.',
  },
  S: {
    open:    'Calm and unhurried. Let them set the pace.',
    pace:    'Slow and steady — never apply pressure.',
    leadWith:'Reassurance — guarantees, references, exactly what to expect.',
    close:   'Soft — "No rush, take the evening, I\'ll follow up tomorrow."',
    avoid:   'Hard closes, urgency tactics, or any surprises.',
  },
  C: {
    open:    'Professional and prepared. Have your materials organized.',
    pace:    'Methodical — answer every question thoroughly.',
    leadWith:'Specifics — prep process, paint specs, line-item breakdown.',
    close:   'Evidence-based — quote and warranty terms in writing to review.',
    avoid:   'Vague claims, pressure, or glossing over the details.',
  },
};

// Expect questions like: "When do you start? How long will it take? How
// do I prepare?" — a C customer asking these is a buying signal, not doubt.

const PERSONA_LABELS = {
  researcher: 'The Researcher',
  protector: 'The Protector',
  status_seeker: 'The Status Seeker',
  pragmatist: 'The Pragmatist',
  negotiator: 'The Negotiator',
  collaborator: 'The Collaborator',
  unknown: 'Unclassified',
};

export default function LeadDetail({ tenantId }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [lead, setLead] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [editData, setEditData] = useState({});
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  // Phase 7 E — rep quote entry state
  const [quoteInput, setQuoteInput] = useState('');
  const [submittingQuote, setSubmittingQuote] = useState(false);
  const [editingQuote, setEditingQuote] = useState(false);
  const [quoteError, setQuoteError] = useState(null);

  // Phase 8E — DISC feedback state
  const [discFeedback, setDiscFeedback] = useState([]);
  const [discFeedbackOpen, setDiscFeedbackOpen] = useState(false);

  // Phase 8B — tech assignment state
  const [assigningTech, setAssigningTech] = useState(false);

  useEffect(() => {
    fetchData();
  }, [id, tenantId]);

  async function fetchData() {
    try {
      setLoading(true);
      const [leadData, historyData, feedbackData] = await Promise.all([
        getLeadById(id),
        getLeadHistory(id),
        getDiscFeedback(id).catch(() => ({ feedback: [] })), // tolerate 404 pre-classification
      ]);
      setLead(leadData);
      setHistory(historyData || []);
      setDiscFeedback(feedbackData?.feedback || []);
      setEditData(leadData);
    } catch (err) {
      console.error("Failed to fetch lead data:", err);
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    try {
      const updated = await updateLead(id, editData);
      setLead(updated);
      setIsEditing(false);
    } catch (err) {
      alert("Failed to update lead");
    }
  }

  async function handlePauseToggle() {
    if (recoveryBusy) return;
    setRecoveryBusy(true);
    try {
      if (lead.recovery_paused) {
        await resumeLeadRecovery(id);
      } else {
        await pauseLeadRecovery(id, 'manual');
      }
      await fetchData();
    } catch (err) {
      console.error("Recovery pause/resume failed:", err);
      alert("Failed to update recovery status");
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function handleCadenceChange(e) {
    if (recoveryBusy) return;
    const value = e.target.value || null;
    setRecoveryBusy(true);
    try {
      await updateLeadCadence(id, value);
      await fetchData();
    } catch (err) {
      console.error("Cadence override failed:", err);
      alert("Failed to update cadence");
    } finally {
      setRecoveryBusy(false);
    }
  }

  // ──── Phase 8B — assign / unassign the estimator for this lead ────────
  async function handleAssignTech(e) {
    if (assigningTech) return;
    const value = e.target.value || null; // "" → null (unassign)
    setAssigningTech(true);
    try {
      const updated = await assignLeadTech(id, value);
      setLead(updated);
    } catch (err) {
      console.error("Tech assignment failed:", err);
      alert(err.message || "Failed to assign estimator");
    } finally {
      setAssigningTech(false);
    }
  }

  // ──── Phase 7 E — Submit rep quote, trigger variance coaching ────────
  async function handleQuoteSubmit() {
    if (submittingQuote) return;
    setQuoteError(null);

    const trimmed = String(quoteInput).trim();
    if (!trimmed) {
      setQuoteError("Enter a quote amount");
      return;
    }
    const dollars = parseFloat(trimmed);
    if (!Number.isFinite(dollars) || dollars < 0) {
      setQuoteError("Enter a valid positive number");
      return;
    }
    if (dollars > 1_000_000) {
      setQuoteError("Quote cannot exceed $1,000,000");
      return;
    }

    setSubmittingQuote(true);
    try {
      const result = await submitRepQuote(id, dollars);
      setLead(result.lead);
      setQuoteInput('');
      setEditingQuote(false);
    } catch (err) {
      console.error("Quote submit failed:", err);
      setQuoteError(err.message || "Failed to save quote");
    } finally {
      setSubmittingQuote(false);
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-stone-900"></div>
    </div>
  );

  if (!lead) return (
    <div className="min-h-screen bg-stone-50 flex flex-col items-center justify-center">
      <h2 className="text-xl font-bold">Lead not found</h2>
      <button onClick={() => navigate('/leads')} className="mt-4 text-blue-600 hover:underline">Back to Leads</button>
    </div>
  );

  // Phase 7 E — derive display state
  const hasWidgetEstimate = lead.widget_estimate_low_cents != null && lead.widget_estimate_high_cents != null;
  const hasRepQuote = lead.rep_quote_total_cents != null;
  const showQuoteCard = hasWidgetEstimate || hasRepQuote;
  const showQuoteInput = !hasRepQuote || editingQuote;
  const variance = lead.variance_coaching;

  // ──── Phase 8A — Customer Intel display state ──────────────────────────
  //
  // Show the card whenever we have ANY signal — DISC OR persona. Within
  // the card, gracefully degrade based on what's classified.
  //
  // Three display states for DISC:
  //   1. classified (primary in D/I/S/C, no skip reason)
  //   2. low-confidence (primary='unknown' with skip_reason='low_confidence_classification')
  //   3. skipped (primary='unknown' with other skip_reason — not enough speech)
  //
  // The persona has its own classified/unclassified state independent of DISC.
  const discPrimary = lead.disc_primary;
  const discSecondary = lead.disc_secondary;
  const discScores = lead.disc_scores; // { D, I, S, C } summing to 1.0
  const discConfidence = lead.disc_confidence;
  const discSignals = lead.disc_signals;
  const discClassified = discPrimary && discPrimary !== 'unknown' && DISC_META[discPrimary];
  const discLowConf = discPrimary === 'unknown' && discScores; // we have scores but conf was low

  const personaKey = lead.buyer_persona;
  const personaConfidence = lead.persona_confidence;
  const personaSignals = lead.persona_signals;
  const personaClassified = personaKey && personaKey !== 'unknown';

  // Show card if EITHER classified, OR we at least have skip-reason context to display
  const showIntelCard = discClassified || discLowConf || personaClassified || lead.disc_detected_at || lead.persona_detected_at;

  const primaryMeta = discClassified ? DISC_META[discPrimary] : null;
  const secondaryMeta = discSecondary ? DISC_META[discSecondary] : null;

  // ──── Phase 8E — derive feedback display state ──────────────────────────
  // Most recent human verdict (owner or rep) on this lead's classification.
  // AI self-grade rows are visible to know the AI flagged something, but
  // they don't count as "human validated".
  const latestHumanFeedback = discFeedback.find((f) => f.submitted_by_role !== 'ai');
  const aiFlaggedThis = discFeedback.some((f) => f.submitted_by_role === 'ai');
  const canSubmitFeedback = discClassified && !latestHumanFeedback;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1 max-w-full w-full mx-auto">
        <div className="mb-6 flex items-center gap-4">
          <button
            onClick={() => navigate('/leads')}
            className="p-2 bg-white border border-stone-200 rounded-lg hover:bg-stone-50 transition-colors shadow-sm"
          >
            <svg className="h-5 w-5 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-bold text-stone-900">
              {lead.name || (lead.phone.startsWith('fb-') ? 'Facebook Visitor' : lead.phone.startsWith('web-') ? 'Website Visitor' : lead.phone)}
            </h1>
            <p className="text-sm text-stone-500">Customer Record · Created {new Date(lead.created_at).toLocaleDateString()}</p>
          </div>

          <div className="ml-auto flex gap-3">
            <select
              value={lead.status}
              onChange={(e) => updateLead(id, { status: e.target.value }).then(setLead)}
              className="bg-white border border-stone-200 rounded-xl px-4 py-2 text-sm font-semibold shadow-sm focus:ring-2 focus:ring-blue-500"
            >
              {['New Lead', 'Qualified', 'Estimate Sent', 'FollowUp', 'Booked', 'Closed', 'Lost'].map(s => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>
        </div>

        <StatusStepper currentStatus={lead.status} />

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Left: Profile Info */}
          <div className="lg:col-span-1 space-y-6">
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Profile Details</h3>
                <button
                  onClick={() => isEditing ? handleSave() : setIsEditing(true)}
                  className="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
                >
                  {isEditing ? 'Save Changes' : 'Edit Profile'}
                </button>
              </div>

              <div className="space-y-4">
                {[
                  { label: 'Name', key: 'name' },
                  { label: 'Phone', key: 'phone', mono: true },
                  { label: 'Email', key: 'email' },
                  { label: 'Address', key: 'address' },
                  { label: 'Project Type', key: 'project_type' },
                  { label: 'Estimated Revenue ($)', key: 'estimated_revenue_cents', isRevenue: true },
                ].map(({ label, key, mono, isRevenue }) => (
                  <div key={key}>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">{label}</label>
                    {isEditing ? (
                      <input
                        type={isRevenue ? 'number' : 'text'}
                        step={isRevenue ? '0.01' : undefined}
                        className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                        value={isRevenue ? (editData[key] / 100 || '') : (editData[key] || '')}
                        onChange={(e) => {
                          const val = isRevenue ? Math.round(parseFloat(e.target.value) * 100) : e.target.value;
                          setEditData({ ...editData, [key]: val });
                        }}
                      />
                    ) : (
                      <div className={`text-stone-900 text-sm font-medium ${mono ? 'font-mono' : ''}`}>
                        {isRevenue
                          ? ((lead[key] || 0) / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                          : (lead[key] || <span className="text-stone-300 italic">Not provided</span>)
                        }
                      </div>
                    )}
                  </div>
                ))}

                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Notes</label>
                  {isEditing ? (
                    <textarea
                      rows={4}
                      className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
                      value={editData.notes || ''}
                      onChange={(e) => setEditData({ ...editData, notes: e.target.value })}
                    />
                  ) : (
                    <div className="text-stone-600 text-sm bg-stone-50 rounded-xl p-4 border border-stone-100 italic leading-relaxed">
                      {lead.notes || "No notes available for this lead."}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ═══ Phase 8A — Customer Intel (DISC + Persona) ═══ */}
            {showIntelCard && (
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-5">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-purple-100 rounded-lg text-purple-600">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Customer Intel</h3>
                  </div>
                  <span className="text-[9px] font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded uppercase tracking-widest">v0 · learning</span>
                </div>

                {/* ──── DISC Primary ──── */}
                {discClassified ? (
                  <div className={`${primaryMeta.bg} ${primaryMeta.border} border rounded-xl p-4 mb-4`}>
                    <div className="flex items-baseline gap-2 mb-1">
                      <span className={`text-3xl font-black ${primaryMeta.text} tracking-tight`}>
                        {discPrimary}
                        {secondaryMeta && (
                          <span className="text-lg font-bold text-stone-400 ml-1">/{discSecondary}</span>
                        )}
                      </span>
                      <span className={`text-sm font-bold ${primaryMeta.text}`}>{primaryMeta.label}</span>
                      {secondaryMeta && (
                        <span className="text-[10px] font-semibold text-stone-500">— with {secondaryMeta.label} traits</span>
                      )}
                    </div>
                    <div className={`text-xs ${primaryMeta.text} opacity-80 leading-relaxed`}>
                      {primaryMeta.tagline}
                    </div>
                    {typeof discConfidence === 'number' && (
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Confidence</span>
                        <span className={`text-[10px] font-mono font-bold ${
                          discConfidence >= 0.7 ? 'text-emerald-700' :
                          discConfidence >= 0.5 ? 'text-amber-700' :
                          'text-rose-700'
                        }`}>{(discConfidence * 100).toFixed(0)}%</span>
                        {discConfidence < 0.5 && (
                          <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded uppercase">Low — verify in person</span>
                        )}
                      </div>
                    )}
                  </div>
                ) : discLowConf ? (
                  <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 mb-4">
                    <div className="text-sm font-bold text-stone-700 mb-1">Mixed signals</div>
                    <div className="text-xs text-stone-500 leading-relaxed">
                      Customer showed traits across multiple styles — not enough dominance in one to commit. See score breakdown below.
                    </div>
                  </div>
                ) : (
                  <div className="bg-stone-50 border border-stone-200 rounded-xl p-4 mb-4">
                    <div className="text-sm font-bold text-stone-700 mb-1">Not enough customer speech</div>
                    <div className="text-xs text-stone-500 leading-relaxed">
                      DISC classification needs at least 2 customer turns. This call was too short or one-sided.
                    </div>
                  </div>
                )}

                {/* ──── DISC Score Breakdown (always shown when scores exist) ──── */}
                {discScores && (
                  <div className="mb-4">
                    <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">DISC Profile Breakdown</div>
                    <div className="space-y-1.5">
                      {['D', 'I', 'S', 'C'].map((q) => {
                        const pct = Math.round((discScores[q] || 0) * 100);
                        const meta = DISC_META[q];
                        const isPrimary = q === discPrimary;
                        const isSecondary = q === discSecondary;
                        return (
                          <div key={q} className="flex items-center gap-2">
                            <span className={`text-[10px] font-black w-3 ${isPrimary ? meta.text : 'text-stone-400'}`}>{q}</span>
                            <div className="flex-1 h-2 bg-stone-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full ${meta.bar} transition-all`}
                                style={{ width: `${pct}%`, opacity: isPrimary ? 1 : isSecondary ? 0.7 : 0.35 }}
                              />
                            </div>
                            <span className={`text-[10px] font-mono w-8 text-right ${isPrimary ? 'font-bold text-stone-700' : 'text-stone-400'}`}>{pct}%</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

               {/* ──── Phase 8F — How to work this customer ──── */}
                {discClassified && DISC_ADVICE[discPrimary] && (
                  <div className="mb-4">
                    <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">
                      How to Work This Customer
                    </div>
                    <div className={`${primaryMeta.bg} ${primaryMeta.border} border rounded-xl p-4 space-y-2.5`}>
                      {[
                        { label: 'Open',      value: DISC_ADVICE[discPrimary].open },
                        { label: 'Pace',      value: DISC_ADVICE[discPrimary].pace },
                        { label: 'Lead with', value: DISC_ADVICE[discPrimary].leadWith },
                        { label: 'Close',     value: DISC_ADVICE[discPrimary].close },
                        { label: 'Avoid',     value: DISC_ADVICE[discPrimary].avoid },
                      ].map(({ label, value }) => (
                        <div key={label} className="flex gap-2.5">
                          <span className={`text-[10px] font-bold uppercase tracking-wider ${primaryMeta.text} opacity-70 w-16 flex-shrink-0 pt-0.5`}>
                            {label}
                          </span>
                          <span className={`text-xs ${primaryMeta.text} leading-relaxed flex-1`}>
                            {value}
                          </span>
                        </div>
                      ))}
                    </div>
                    {secondaryMeta && (
                      <p className="text-[10px] text-stone-400 italic mt-2 leading-relaxed">
                        Primary style shown. This customer also shows {secondaryMeta.label} traits — adapt if the read feels off in person.
                      </p>
                    )}
                  </div>
                )}
                
                {/* ──── DISC Cues ──── */}
                {discSignals?.primary_cues?.length > 0 && (
                  <div className="mb-4">
                    <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Key Signals</div>
                    <ul className="space-y-1">
                      {discSignals.primary_cues.slice(0, 3).map((cue, idx) => (
                        <li key={idx} className="text-xs text-stone-600 leading-relaxed flex gap-2">
                          <span className="text-stone-400 flex-shrink-0 mt-0.5">•</span>
                          <span>{cue}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* ──── Persona Cross-Reference (smaller, Phase 6 data) ──── */}
                {personaClassified && (
                  <div className="pt-4 border-t border-stone-100">
                    <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Cross-Reference (Persona)</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-stone-700">{PERSONA_LABELS[personaKey] || personaKey}</span>
                      {typeof personaConfidence === 'number' && (
                        <span className="text-[10px] font-mono text-stone-400">{(personaConfidence * 100).toFixed(0)}% conf</span>
                      )}
                    </div>
                    {personaSignals?.reasoning && (
                      <div className="text-[11px] text-stone-500 italic leading-relaxed mt-1">{personaSignals.reasoning}</div>
                    )}
                  </div>
                )}

                {/* ──── Phase 8E — AI flagged banner (if AI marked uncertain) ──── */}
                {aiFlaggedThis && !latestHumanFeedback && (
                  <div className="mt-4 pt-4 border-t border-stone-100">
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <svg className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div className="text-xs text-amber-900 leading-relaxed">
                          <span className="font-bold">AI flagged this for review.</span> Confidence was borderline — your verdict will help refine future classifications.
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ──── Phase 8E — Feedback affordance / prior verdict ──── */}
                {discClassified && (
                  <div className="mt-4 pt-4 border-t border-stone-100">
                    {latestHumanFeedback ? (
                      // Show prior verdict — locked, no re-submission
                      <div className={`rounded-lg p-3 ${
                        latestHumanFeedback.was_accurate
                          ? 'bg-emerald-50 border border-emerald-200'
                          : 'bg-rose-50 border border-rose-200'
                      }`}>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`text-xs font-bold uppercase tracking-wider ${
                            latestHumanFeedback.was_accurate ? 'text-emerald-700' : 'text-rose-700'
                          }`}>
                            {latestHumanFeedback.was_accurate ? '✓ Confirmed Accurate' : '✗ Corrected'}
                          </span>
                          <span className="text-[10px] text-stone-500 font-mono ml-auto">
                            {new Date(latestHumanFeedback.created_at).toLocaleDateString()}
                          </span>
                        </div>
                        {!latestHumanFeedback.was_accurate && (
                          <div className="text-xs text-rose-900 leading-relaxed">
                            You said the actual type was <span className="font-bold">{latestHumanFeedback.corrected_primary}</span>
                            {latestHumanFeedback.corrected_secondary && (
                              <span> / {latestHumanFeedback.corrected_secondary}</span>
                            )}
                          </div>
                        )}
                        {latestHumanFeedback.reason && (
                          <div className="text-[11px] text-stone-600 italic leading-relaxed mt-1">
                            "{latestHumanFeedback.reason}"
                          </div>
                        )}
                        {latestHumanFeedback.submitted_by_email && (
                          <div className="text-[10px] text-stone-400 mt-1 font-mono">
                            — {latestHumanFeedback.submitted_by_email}
                          </div>
                        )}
                      </div>
                    ) : (
                      // No prior verdict — show feedback prompt
                      <div>
                        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Was this accurate?</div>
                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              try {
                                await import('../api').then((m) => m.post(`/api/disc-feedback/leads/${id}`, { was_accurate: true }));
                                fetchData();
                              } catch (err) {
                                console.error('Quick feedback failed:', err);
                                alert('Failed to submit feedback');
                              }
                            }}
                            className="flex-1 py-2 rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-xs font-bold text-emerald-700 uppercase tracking-wider transition-colors"
                          >
                            ✓ Yes
                          </button>
                          <button
                            onClick={() => setDiscFeedbackOpen(true)}
                            className="flex-1 py-2 rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-xs font-bold text-rose-700 uppercase tracking-wider transition-colors"
                          >
                            ✗ No, correct it
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ──── Footer: timestamp ──── */}
                {lead.disc_detected_at && (
                  <div className="text-[10px] text-stone-400 font-mono mt-4 pt-3 border-t border-stone-100">
                    AI-classified {new Date(lead.disc_detected_at).toLocaleString()}
                  </div>
                )}
              </div>
            )}

            {/* ═══ Phase 8B — Assigned Estimator ═══ */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-5">
                <div className="p-1.5 bg-teal-100 rounded-lg text-teal-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a4 4 0 00-3-3.87M9 20H4v-2a4 4 0 013-3.87m6-1.13a4 4 0 100-8 4 4 0 000 8z" />
                  </svg>
                </div>
                <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Assigned Estimator</h3>
              </div>

              {lead.assignment_booking_id ? (
                <div className="space-y-3">
                  <select
                    value={lead.assigned_technician?.id || ''}
                    onChange={handleAssignTech}
                    disabled={assigningTech}
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                  >
                    <option value="">— Unassigned —</option>
                    {(lead.assignable_technicians || []).map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}{t.phone ? '' : ' (no phone)'}
                      </option>
                    ))}
                  </select>

                  {lead.assigned_technician ? (
                    lead.assigned_technician.phone ? (
                      <div className="bg-teal-50 border border-teal-100 rounded-lg p-3">
                        <div className="text-xs text-teal-900 leading-relaxed">
                          <span className="font-bold">{lead.assigned_technician.name}</span> will get the
                          pre-visit briefing SMS at{' '}
                          <span className="font-mono">{lead.assigned_technician.phone}</span> about an hour
                          before the appointment.
                        </div>
                      </div>
                    ) : (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                        <div className="text-xs text-amber-900 leading-relaxed">
                          <span className="font-bold">No phone on file for this estimator.</span> Add a cell
                          number on the Team page (Technicians tab) so they can receive the pre-visit
                          briefing — otherwise it falls back to the account's default recipient.
                        </div>
                      </div>
                    )
                  ) : (
                    <p className="text-xs text-stone-400 leading-relaxed">
                      No estimator assigned. The pre-visit briefing goes to the account's default recipient.
                    </p>
                  )}

                  {(lead.assignable_technicians || []).length === 0 && (
                    <p className="text-xs text-stone-400 leading-relaxed italic">
                      No technicians added yet. Add estimators on the Team page → Technicians tab.
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-xs text-stone-400 leading-relaxed italic">
                  Assign an estimator once an appointment is booked for this lead.
                </p>
              )}
            </div>

            {/* Recovery Section (Phase 10) */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
              <div className="flex items-center gap-2 mb-6">
                <div className="p-1.5 bg-amber-100 rounded-lg text-amber-600">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Recovery</h3>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Status</label>
                  {lead.recovery_paused ? (
                    <div>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-700 text-[10px] font-bold uppercase rounded-md border border-amber-100">
                        ⏸ Paused
                      </span>
                      {lead.recovery_paused_reason && (
                        <p className="text-xs text-stone-500 mt-1.5">Reason: <span className="font-medium text-stone-700">{lead.recovery_paused_reason}</span></p>
                      )}
                      {lead.recovery_paused_at && (
                        <p className="text-[10px] text-stone-400 font-mono mt-0.5">Since {new Date(lead.recovery_paused_at).toLocaleString()}</p>
                      )}
                    </div>
                  ) : (
                    <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-emerald-50 text-emerald-700 text-[10px] font-bold uppercase rounded-md border border-emerald-100">
                      ● Active
                    </span>
                  )}
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Cadence Override</label>
                  <select
                    value={lead.recovery_cadence_override || ''}
                    onChange={handleCadenceChange}
                    disabled={recoveryBusy}
                    className="w-full bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                  >
                    <option value="">Use tenant default</option>
                    <option value="aggressive">Aggressive</option>
                    <option value="standard">Standard</option>
                    <option value="gentle">Gentle</option>
                    <option value="single">Single</option>
                    <option value="off">Off (no follow-ups)</option>
                  </select>
                </div>

                <button
                  onClick={handlePauseToggle}
                  disabled={recoveryBusy}
                  className={`w-full text-xs font-bold uppercase tracking-wider py-2 rounded-lg transition-colors disabled:opacity-50 ${
                    lead.recovery_paused
                      ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                  }`}
                >
                  {recoveryBusy ? '...' : (lead.recovery_paused ? 'Resume Recovery' : 'Pause Recovery')}
                </button>
              </div>
            </div>

            {/* SMS Compliance Section */}
            {lead.has_sms_consent && (
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
                <div className="flex items-center gap-2 mb-6">
                  <div className="p-1.5 bg-blue-100 rounded-lg text-blue-600">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Compliance Audit</h3>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Status</label>
                      <span className="inline-flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-700 text-[10px] font-bold uppercase rounded-md border border-blue-100">
                        Verified Opt-in
                      </span>
                    </div>
                    <div className="text-right">
                      <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Captured</label>
                      <div className="text-stone-900 text-[10px] font-mono">{new Date(lead.last_consent_at).toLocaleString()}</div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">Disclosure Agreed To</label>
                    <div className="text-stone-600 text-[11px] bg-stone-50 p-3 rounded-xl border border-stone-100 italic leading-relaxed">
                      "{lead.consent_text}"
                    </div>
                  </div>

                  <div className="pt-2 border-t border-stone-50 space-y-3">
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-stone-400 font-bold uppercase tracking-wider">IP Address</span>
                      <span className="text-stone-900 font-mono">{lead.ip_address || "---"}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-stone-400 font-bold uppercase tracking-wider">Platform Source</span>
                      <span className="text-stone-900 font-medium">{lead.consent_source || "AI Chat Widget"}</span>
                    </div>
                    <div className="flex justify-between items-center text-[10px]">
                      <span className="text-stone-400 font-bold uppercase tracking-wider">Page URL</span>
                      <span className="text-stone-900 truncate max-w-[150px]" title={lead.page_url}>{lead.page_url ? new URL(lead.page_url).pathname : "---"}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Right: Widget Estimate / Conversation History */}
          <div className="lg:col-span-2 space-y-6">

            {/* ═══ Phase 7 E — Widget Estimate + Rep Quote + Variance Coaching ═══ */}
            {showQuoteCard && (
              <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">

                {/* Widget Estimate (what customer saw on website) */}
                {hasWidgetEstimate && (
                  <div className="mb-5">
                    <div className="flex items-center gap-2 mb-3">
                      <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-600">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      </div>
                      <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Widget Ballpark Shown to Customer</h3>
                    </div>

                    <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-4">
                      <div className="text-2xl font-bold text-indigo-900">
                        ${Math.round(lead.widget_estimate_low_cents / 100).toLocaleString()}
                        <span className="text-indigo-400 mx-2">–</span>
                        ${Math.round(lead.widget_estimate_high_cents / 100).toLocaleString()}
                      </div>
                      {lead.widget_estimate_scope_summary && (
                        <div className="text-sm text-indigo-700 mt-1.5 leading-relaxed">
                          {lead.widget_estimate_scope_summary}
                        </div>
                      )}
                      {lead.widget_estimated_at && (
                        <div className="text-[10px] text-indigo-500 font-mono mt-2">
                          Shown {new Date(lead.widget_estimated_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Rep Quote (what rep priced in person) */}
                <div className={hasWidgetEstimate ? 'pt-5 border-t border-stone-100' : ''}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-emerald-100 rounded-lg text-emerald-600">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Your Real Quote</h3>
                    </div>
                    {hasRepQuote && !editingQuote && (
                      <button
                        onClick={() => {
                          setQuoteInput((lead.rep_quote_total_cents / 100).toString());
                          setEditingQuote(true);
                          setQuoteError(null);
                        }}
                        className="text-xs font-bold text-blue-600 hover:text-blue-700 uppercase tracking-wider"
                      >
                        Edit
                      </button>
                    )}
                  </div>

                  {hasRepQuote && !editingQuote && (
                    <div>
                      <div className="text-2xl font-bold text-stone-900">
                        ${Math.round(lead.rep_quote_total_cents / 100).toLocaleString()}
                      </div>
                      {lead.rep_quote_entered_at && (
                        <div className="text-[10px] text-stone-400 font-mono mt-1">
                          Entered {new Date(lead.rep_quote_entered_at).toLocaleString()}
                        </div>
                      )}
                    </div>
                  )}

                  {showQuoteInput && (
                    <div>
                      <div className="flex gap-2">
                        <div className="flex-1 relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 text-sm font-medium pointer-events-none">$</span>
                          <input
                            type="number"
                            step="0.01"
                            placeholder="1800.00"
                            value={quoteInput}
                            onChange={(e) => { setQuoteInput(e.target.value); setQuoteError(null); }}
                            onKeyDown={(e) => { if (e.key === 'Enter' && !submittingQuote) handleQuoteSubmit(); }}
                            disabled={submittingQuote}
                            className="w-full pl-7 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none disabled:opacity-50"
                          />
                        </div>
                        <button
                          onClick={handleQuoteSubmit}
                          disabled={submittingQuote || !quoteInput}
                          className="bg-blue-600 text-white text-xs font-bold uppercase tracking-wider px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                        >
                          {submittingQuote ? 'Analyzing…' : (editingQuote ? 'Update' : 'Save Quote')}
                        </button>
                        {editingQuote && (
                          <button
                            onClick={() => { setEditingQuote(false); setQuoteInput(''); setQuoteError(null); }}
                            disabled={submittingQuote}
                            className="text-xs font-bold text-stone-500 hover:text-stone-700 uppercase tracking-wider px-2 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                      {quoteError && (
                        <p className="text-xs text-rose-600 mt-1.5">{quoteError}</p>
                      )}
                      {submittingQuote && (
                        <p className="text-[11px] text-stone-500 mt-1.5 italic">Saving and analyzing variance with AI coach…</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Variance Coaching (only when generated) */}
                {variance && (
                  <div className="mt-5 pt-5 border-t border-stone-100">
                    <div className="flex items-center gap-2 mb-4">
                      <div className={`p-1.5 rounded-lg ${
                        Math.abs(variance.variance_percent || 0) > 30
                          ? 'bg-amber-100 text-amber-600'
                          : 'bg-blue-100 text-blue-600'
                      }`}>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                        </svg>
                      </div>
                      <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Variance Coaching</h3>
                      <span className={`ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        variance.variance_direction === 'above_ballpark'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                      }`}>
                        {variance.variance_percent > 0 ? '+' : ''}{variance.variance_percent}% {variance.variance_direction === 'above_ballpark' ? 'above' : 'below'} ballpark
                      </span>
                    </div>

                    {Array.isArray(variance.likely_reasons) && variance.likely_reasons.length > 0 && (
                      <div className="mb-4">
                        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Likely Reasons for the Gap</div>
                        <ul className="space-y-2">
                          {variance.likely_reasons.map((reason, idx) => (
                            <li key={idx} className="text-sm text-stone-700 leading-relaxed flex gap-2">
                              <span className="text-stone-400 flex-shrink-0 mt-0.5">•</span>
                              <span>{reason}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {Array.isArray(variance.suggested_talking_points) && variance.suggested_talking_points.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-2">Suggested Talking Points</div>
                        <div className="space-y-2">
                          {variance.suggested_talking_points.map((point, idx) => (
                            <div key={idx} className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-emerald-900 italic leading-relaxed">
                              "{point}"
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {variance.computed_at && (
                      <div className="text-[10px] text-stone-400 font-mono mt-3 pt-3 border-t border-stone-50">
                        AI-generated {new Date(variance.computed_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Conversation Feed */}
            <div className="bg-white rounded-2xl border border-stone-200 shadow-sm flex flex-col h-[700px]">
              <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-white sticky top-0 z-10 rounded-t-2xl">
                <h3 className="font-bold text-stone-900 uppercase text-xs tracking-widest">Conversation Feed</h3>
                <span className="text-[10px] bg-stone-100 text-stone-500 font-bold px-2 py-1 rounded-md uppercase tracking-wider">
                  {history.length} Events
                </span>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-8 scrollbar-thin scrollbar-thumb-stone-200">
                {history.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-stone-400 gap-3">
                    <svg className="h-10 w-10 opacity-20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                    <p className="text-sm font-medium">No conversation history yet.</p>
                  </div>
                ) : (
                  history.map((event, idx) => {
                    const isUser = event.direction === 'inbound' || event.type === 'call';
                    const isCall = event.type === 'call';
                    const isBooking = event.type === 'booking';

                    return (
                      <div key={idx} className={`flex flex-col ${isUser ? 'items-start' : 'items-end'}`}>
                        <div className="flex items-center gap-2 mb-1.5 px-1">
                          <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wide">
                            {isCall ? '📞 Voice Call' : isBooking ? '📅 Booking' : (event.channel === 'facebook' ? '💬 Facebook' : event.channel === 'website' ? '🌐 Website' : '📱 SMS')}
                          </span>
                          <span className="text-[10px] text-stone-300">•</span>
                          <span className="text-[10px] font-medium text-stone-400 font-mono">
                            {new Date(event.created_at).toLocaleString([], { hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' })}
                          </span>
                        </div>

                        {isBooking ? (
                          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 w-full max-w-md shadow-sm">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="h-8 w-8 bg-emerald-100 rounded-full flex items-center justify-center">
                                <svg className="h-4 w-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                                </svg>
                              </div>
                              <h4 className="font-bold text-emerald-900 text-sm">Estimate Scheduled</h4>
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-xs">
                              <div>
                                <p className="text-emerald-600 font-semibold uppercase tracking-tighter mb-1">Date</p>
                                <p className="text-emerald-900 font-bold">{new Date(event.preferred_date).toLocaleDateString()}</p>
                              </div>
                              <div>
                                <p className="text-emerald-600 font-semibold uppercase tracking-tighter mb-1">Project</p>
                                <p className="text-emerald-900 font-bold">{event.scope}</p>
                              </div>
                            </div>
                          </div>
                        ) : isCall ? (
                          <div className="bg-stone-50 border border-stone-200 rounded-2xl p-5 w-full shadow-sm hover:shadow-md transition-shadow group">
                            <div className="flex items-center justify-between mb-4">
                              <div className="flex items-center gap-3">
                                <div className="h-8 w-8 bg-stone-200 rounded-full flex items-center justify-center animate-pulse-slow">
                                  <svg className="h-4 w-4 text-stone-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h2.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                                  </svg>
                                </div>
                                <div>
                                  <p className="text-sm font-bold text-stone-900">Transcription</p>
                                  <p className="text-[10px] text-stone-500 font-mono">Disposition: {event.disposition}</p>
                                </div>
                              </div>
                             <span className="px-2 py-0.5 bg-stone-200 text-stone-600 text-[9px] font-bold rounded uppercase tracking-widest">{event.status}</span>
                            </div>
                            <div className="text-stone-600 text-sm leading-relaxed whitespace-pre-wrap italic">
                              {event.transcript || "No transcript available for this call."}
                            </div>
                          </div>
                        ) : (
                          <div className={`max-w-[85%] rounded-2xl px-5 py-3 shadow-sm text-sm border ${
                            isUser
                              ? 'bg-blue-600 text-white border-blue-500 rounded-bl-none'
                              : 'bg-white text-stone-900 border-stone-200 rounded-br-none'
                          }`}>
                            <p className="leading-relaxed">{event.body}</p>
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Phase 8E — DISC correction modal */}
      {discClassified && (
        <DiscFeedbackModal
          leadId={id}
          classified={{
            primary: discPrimary,
            secondary: discSecondary,
            confidence: discConfidence,
          }}
          open={discFeedbackOpen}
          onClose={() => setDiscFeedbackOpen(false)}
          onSubmitted={() => fetchData()}
        />
      )}
    </div>
  );
}

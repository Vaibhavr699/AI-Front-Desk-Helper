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
} from '../api';
import Header from '../components/Header';
import StatusStepper from '../components/StatusStepper';

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

  useEffect(() => {
    fetchData();
  }, [id, tenantId]);

  async function fetchData() {
    try {
      setLoading(true);
      const [leadData, historyData] = await Promise.all([
        getLeadById(id),
        getLeadHistory(id),
      ]);
      setLead(leadData);
      setHistory(historyData || []);
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
    </div>
  );
}

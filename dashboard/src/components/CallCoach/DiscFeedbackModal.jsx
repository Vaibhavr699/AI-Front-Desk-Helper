import { useState, useEffect } from "react";
import { post } from "../../api";

// ═══════════════════════════════════════════════════════════════════════════
// DiscFeedbackModal — Phase 8E (May 19, 2026)
//
// Structured correction modal for DISC classifications. Owner/rep opens
// from the Customer Intel card on Lead Detail to submit a verdict on
// whether the AI classified the customer correctly.
//
// UX:
//   - Shows what the AI classified (D/I/S/C with secondary)
//   - Asks: was this accurate?
//   - If No: pick the actual primary, optional secondary
//   - Optional free-text "what gave it away" → feeds future refinement
//
// Different shape from FeedbackModal (which is free-text prose for coaching
// rule extraction). Same submit pattern.
// ═══════════════════════════════════════════════════════════════════════════

const DISC_OPTIONS = [
  { key: "D", label: "Dominant",      tagline: "Direct, results-focused, fast decisions",      color: "rose" },
  { key: "I", label: "Influencer",    tagline: "Relational, enthusiastic, sells the vision",   color: "amber" },
  { key: "S", label: "Steady",        tagline: "Supportive, patient, consensus-driven",        color: "emerald" },
  { key: "C", label: "Conscientious", tagline: "Analytical, precise, needs documentation",     color: "indigo" },
];

// Pre-resolved Tailwind classes so JIT picks them up reliably
const COLOR_CLASSES = {
  rose:    { bg: "bg-rose-50",    border: "border-rose-300",    text: "text-rose-900",    ring: "ring-rose-500" },
  amber:   { bg: "bg-amber-50",   border: "border-amber-300",   text: "text-amber-900",   ring: "ring-amber-500" },
  emerald: { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-900", ring: "ring-emerald-500" },
  indigo:  { bg: "bg-indigo-50",  border: "border-indigo-300",  text: "text-indigo-900",  ring: "ring-indigo-500" },
};

export default function DiscFeedbackModal({ leadId, classified, open, onClose, onSubmitted }) {
  // classified = { primary, secondary, confidence } — what the AI said
  const [stage, setStage] = useState("verdict"); // 'verdict' | 'correct'
  const [wasAccurate, setWasAccurate] = useState(null);
  const [correctedPrimary, setCorrectedPrimary] = useState(null);
  const [correctedSecondary, setCorrectedSecondary] = useState(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset state on open
  useEffect(() => {
    if (open) {
      setStage("verdict");
      setWasAccurate(null);
      setCorrectedPrimary(null);
      setCorrectedSecondary(null);
      setReason("");
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  function handleVerdictYes() {
    setWasAccurate(true);
    // Skip straight to allowing optional reason + submit
    setStage("correct");
  }

  function handleVerdictNo() {
    setWasAccurate(false);
    setStage("correct");
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget && !submitting) onClose();
  }

  const canSubmit = (() => {
    if (submitting) return false;
    if (wasAccurate === true) return true;
    if (wasAccurate === false && correctedPrimary) return true;
    return false;
  })();

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = { was_accurate: wasAccurate };
      if (wasAccurate === false) {
        body.corrected_primary = correctedPrimary;
        if (correctedSecondary) body.corrected_secondary = correctedSecondary;
      }
      const trimmedReason = reason.trim();
      if (trimmedReason.length > 0) body.reason = trimmedReason;

      const result = await post(`/api/disc-feedback/leads/${leadId}`, body);
      onSubmitted?.(result);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to submit feedback");
      setSubmitting(false);
    }
  }

  const classifiedMeta = DISC_OPTIONS.find((o) => o.key === classified?.primary);

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-stone-100">
          <h2 className="text-xl font-bold text-stone-900">Was this DISC profile accurate?</h2>
          <p className="mt-1 text-sm text-stone-500 leading-relaxed">
            Your verdict trains the AI to classify customers like this one better.
          </p>
        </div>

        {/* Show what AI classified */}
        {classifiedMeta && (
          <div className="px-6 pt-5">
            <div className={`${COLOR_CLASSES[classifiedMeta.color].bg} ${COLOR_CLASSES[classifiedMeta.color].border} border rounded-lg p-3`}>
              <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">AI Classified As</div>
              <div className="flex items-baseline gap-2">
                <span className={`text-2xl font-black ${COLOR_CLASSES[classifiedMeta.color].text} tracking-tight`}>
                  {classified.primary}
                  {classified.secondary && (
                    <span className="text-base font-bold text-stone-400 ml-1">/{classified.secondary}</span>
                  )}
                </span>
                <span className={`text-sm font-bold ${COLOR_CLASSES[classifiedMeta.color].text}`}>
                  {classifiedMeta.label}
                </span>
              </div>
              <div className="text-xs text-stone-600 mt-1">{classifiedMeta.tagline}</div>
              {typeof classified.confidence === "number" && (
                <div className="text-[10px] font-mono text-stone-500 mt-1">
                  Confidence: {(classified.confidence * 100).toFixed(0)}%
                </div>
              )}
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {stage === "verdict" && (
            <div className="flex gap-3">
              <button
                onClick={handleVerdictYes}
                disabled={submitting}
                className="flex-1 py-4 rounded-lg border-2 border-emerald-200 bg-emerald-50 hover:bg-emerald-100 hover:border-emerald-300 transition-colors disabled:opacity-50"
              >
                <div className="text-2xl mb-1">✓</div>
                <div className="font-bold text-emerald-900 text-sm">Yes, accurate</div>
              </button>
              <button
                onClick={handleVerdictNo}
                disabled={submitting}
                className="flex-1 py-4 rounded-lg border-2 border-rose-200 bg-rose-50 hover:bg-rose-100 hover:border-rose-300 transition-colors disabled:opacity-50"
              >
                <div className="text-2xl mb-1">✗</div>
                <div className="font-bold text-rose-900 text-sm">No, wrong type</div>
              </button>
            </div>
          )}

          {stage === "correct" && wasAccurate === false && (
            <>
              <div>
                <label className="block text-xs uppercase tracking-wide text-stone-500 font-semibold mb-2">
                  What was the customer actually?
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {DISC_OPTIONS.map((opt) => {
                    const c = COLOR_CLASSES[opt.color];
                    const selected = correctedPrimary === opt.key;
                    return (
                      <button
                        key={opt.key}
                        onClick={() => setCorrectedPrimary(opt.key)}
                        disabled={submitting}
                        className={`p-3 rounded-lg border-2 text-left transition-all disabled:opacity-50 ${
                          selected
                            ? `${c.bg} ${c.border} ring-2 ${c.ring}`
                            : `bg-white border-stone-200 hover:${c.bg} hover:${c.border}`
                        }`}
                      >
                        <div className="flex items-baseline gap-1.5">
                          <span className={`text-lg font-black ${selected ? c.text : "text-stone-700"}`}>{opt.key}</span>
                          <span className={`text-xs font-bold ${selected ? c.text : "text-stone-600"}`}>{opt.label}</span>
                        </div>
                        <div className="text-[10px] text-stone-500 mt-0.5 leading-tight">{opt.tagline}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {correctedPrimary && (
                <div>
                  <label className="block text-xs uppercase tracking-wide text-stone-500 font-semibold mb-2">
                    Secondary type? <span className="font-normal lowercase tracking-normal text-stone-400">(optional)</span>
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => setCorrectedSecondary(null)}
                      disabled={submitting}
                      className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-colors disabled:opacity-50 ${
                        correctedSecondary === null
                          ? "bg-stone-800 text-white border-stone-800"
                          : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                      }`}
                    >
                      None
                    </button>
                    {DISC_OPTIONS.filter((o) => o.key !== correctedPrimary).map((opt) => {
                      const selected = correctedSecondary === opt.key;
                      return (
                        <button
                          key={opt.key}
                          onClick={() => setCorrectedSecondary(opt.key)}
                          disabled={submitting}
                          className={`px-3 py-1.5 rounded-md text-xs font-bold border transition-colors disabled:opacity-50 ${
                            selected
                              ? "bg-stone-800 text-white border-stone-800"
                              : "bg-white text-stone-600 border-stone-200 hover:bg-stone-50"
                          }`}
                        >
                          {opt.key} · {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Optional reason — shown in both stages once verdict given */}
          {stage === "correct" && (
            <div>
              <label className="block text-xs uppercase tracking-wide text-stone-500 font-semibold mb-2">
                {wasAccurate ? "Any extra context?" : "What gave it away?"} <span className="font-normal lowercase tracking-normal text-stone-400">(optional)</span>
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value.slice(0, 1000))}
                placeholder={
                  wasAccurate
                    ? "e.g. 'Spot on — she made the call quick and pushed for a date.'"
                    : "e.g. 'She was way more careful than the AI heard — asked about the paint warranty 3 times in the appointment.'"
                }
                rows={3}
                disabled={submitting}
                className="w-full px-3 py-2 border border-stone-300 rounded-md text-sm text-stone-900 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-stone-50 resize-none"
              />
              <div className="mt-1 text-xs text-stone-400 text-right">{reason.length}/1000</div>
            </div>
          )}

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-stone-100 bg-stone-50 flex items-center justify-between gap-2 rounded-b-xl">
          {stage === "correct" ? (
            <button
              type="button"
              onClick={() => setStage("verdict")}
              disabled={submitting}
              className="text-xs font-bold text-stone-500 hover:text-stone-700 uppercase tracking-wider disabled:opacity-50"
            >
              ← Back
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2 text-sm font-medium text-stone-700 bg-white border border-stone-300 rounded-md hover:bg-stone-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            {stage === "correct" && (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-stone-300 disabled:cursor-not-allowed transition-colors"
              >
                {submitting ? "Submitting…" : "Submit Feedback"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { post } from "../../api";

// ═══════════════════════════════════════════════════════════════════════════
// FeedbackModal — Phase 6 B0 (May 15, 2026)
//
// Modal mounted on CallCoachDetail.jsx. Owner submits feedback on a scored
// conversation; backend writes to coaching_feedback. B1 extractor cron then
// turns pending feedback into coaching_rules.
// ═══════════════════════════════════════════════════════════════════════════

export default function FeedbackModal({ conversationId, open, onClose, onSubmitted }) {
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [whatWentRight, setWhatWentRight] = useState("");
  const [whatToImprove, setWhatToImprove] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset state every time the modal opens fresh
  useEffect(() => {
    if (open) {
      setRating(0);
      setHoverRating(0);
      setWhatWentRight("");
      setWhatToImprove("");
      setSubmitting(false);
      setError(null);
    }
  }, [open]);

  if (!open) return null;

  const trimmedRight   = whatWentRight.trim();
  const trimmedImprove = whatToImprove.trim();
  const canSubmit = (trimmedRight.length > 0 || trimmedImprove.length > 0 || rating > 0) && !submitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {};
      if (trimmedRight.length > 0)   body.what_went_right = trimmedRight;
      if (trimmedImprove.length > 0) body.what_to_improve = trimmedImprove;
      if (rating > 0)                body.overall_rating = rating;

      const result = await post(`/api/call-coach/conversations/${conversationId}/feedback`, body);
      onSubmitted?.(result);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to submit feedback");
      setSubmitting(false);
    }
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget && !submitting) onClose();
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-gray-100">
          <h2 className="text-xl font-bold text-gray-900">Coach the AI on this call</h2>
          <p className="mt-1 text-sm text-gray-500 leading-relaxed">
            Your feedback trains the AI to handle calls like this better.
            Be specific about what to do or avoid — the AI will turn it into a rule for future conversations.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-5">
          {/* Star rating */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
              Overall rating <span className="font-normal lowercase tracking-normal text-gray-400">(optional)</span>
            </label>
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => {
                const filled = (hoverRating || rating) >= n;
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setRating(rating === n ? 0 : n)}
                    onMouseEnter={() => setHoverRating(n)}
                    onMouseLeave={() => setHoverRating(0)}
                    className="p-1 focus:outline-none transition-transform hover:scale-110"
                    disabled={submitting}
                    aria-label={`${n} star${n === 1 ? "" : "s"}`}
                  >
                    <svg
                      className={`w-8 h-8 ${filled ? "text-amber-400" : "text-gray-300"}`}
                      fill="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                    </svg>
                  </button>
                );
              })}
              {rating > 0 && (
                <button
                  type="button"
                  onClick={() => setRating(0)}
                  className="ml-2 text-xs text-gray-400 hover:text-gray-600"
                  disabled={submitting}
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* What went right */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
              What did the AI do well? <span className="font-normal lowercase tracking-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={whatWentRight}
              onChange={(e) => setWhatWentRight(e.target.value.slice(0, 2000))}
              placeholder="e.g. Good job pushing back when the caller said 'just send me a price' — kept them on the line and got the appointment."
              rows={4}
              disabled={submitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-gray-50"
            />
            <div className="mt-1 text-xs text-gray-400 text-right">
              {whatWentRight.length}/2000
            </div>
          </div>

          {/* What should improve */}
          <div>
            <label className="block text-xs uppercase tracking-wide text-gray-500 font-semibold mb-2">
              What should the AI do differently? <span className="font-normal lowercase tracking-normal text-gray-400">(optional)</span>
            </label>
            <textarea
              value={whatToImprove}
              onChange={(e) => setWhatToImprove(e.target.value.slice(0, 2000))}
              placeholder="e.g. When a caller asks about competitor pricing, the AI should redirect to our value (free 2-year warranty) instead of giving a number over the phone."
              rows={6}
              disabled={submitting}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent disabled:bg-gray-50"
            />
            <div className="mt-1 text-xs text-gray-400 text-right">
              {whatToImprove.length}/2000
            </div>
          </div>

          {error && (
            <div className="bg-rose-50 border border-rose-200 text-rose-700 px-3 py-2 rounded-md text-sm">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-end gap-2 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="px-4 py-2 text-sm font-medium text-white bg-brand-600 rounded-md hover:bg-brand-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? "Submitting…" : "Submit Feedback"}
          </button>
        </div>
      </div>
    </div>
  );
}

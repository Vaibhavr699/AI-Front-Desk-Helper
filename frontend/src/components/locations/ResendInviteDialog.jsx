import React, { useState, useEffect } from "react";
import { resendFranchiseeInvite } from "../../api/locations";

/**
 * Resend Franchisee Invite dialog.
 *
 * Backend currently requires explicit franchisee_email in the resend body
 * (we don't store the original recipient). This dialog asks the user to
 * confirm/enter the email, then calls POST /api/franchisee/invite/:childId/resend.
 */
export default function ResendInviteDialog({
  open,
  onClose,
  onResent,
  location,
}) {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [resultData, setResultData] = useState(null);

  useEffect(() => {
    if (open) {
      setEmail("");
      setSubmitting(false);
      setError(null);
      setResultData(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape" && !submitting) onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  if (!open || !location) return null;

  const locationLabel = location.company_name || location.name || "Location";

  const handleResend = async () => {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError("Enter a valid email address");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const data = await resendFranchiseeInvite(location.id, trimmed);
      setResultData(data);
      onResent?.(data);
      setTimeout(() => onClose?.(), 1400);
    } catch (err) {
      console.error("[ResendInviteDialog] error:", err);
      setError(err.message || "Failed to resend invite");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={() => !submitting && onClose?.()}
      />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-2xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-200 mx-4"
        role="dialog"
        aria-modal="true"
      >
        {resultData ? (
          <div className="p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-stone-900 mb-1">Invite resent</h3>
            <p className="text-sm text-stone-500">
              Fresh link sent to <span className="font-semibold">{resultData?.invite?.sent_to || email}</span>.
              Expires in 14 days.
            </p>
          </div>
        ) : (
          <>
            <div className="p-6 pb-4">
              <h3 className="text-lg font-bold text-stone-900 mb-1">Resend invite</h3>
              <p className="text-sm text-stone-500 mb-5">
                Generates a new 14-day invite link for <span className="font-semibold">{locationLabel}</span>.
                The previous link will stop working.
              </p>

              <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">
                Franchisee email <span className="text-red-500">*</span>
              </label>
              <p className="text-xs text-stone-500 mb-2">
                Enter the address to send the new invite to (we don't store the original).
              </p>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="owner@franchisee-business.com"
                autoFocus
                disabled={submitting}
                className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 outline-none transition-all disabled:bg-stone-50"
              />

              {error && (
                <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
                  {error}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-stone-100 bg-stone-50 rounded-b-2xl flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="px-4 py-2.5 text-sm font-bold text-stone-600 hover:text-stone-900 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleResend}
                disabled={submitting || !email.trim()}
                className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {submitting && (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                )}
                {submitting ? "Sending…" : "Send fresh invite"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

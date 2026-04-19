import React, { useState, useEffect } from "react";
import { removeLocation } from "../../api/locations";

/**
 * Remove Location confirmation dialog.
 *
 * Per Apr 19 spec — strong friction:
 *   - Type the location name to confirm (defense against fat-finger)
 *   - Clear messaging: "Deactivates immediately. No refund. Data retained until [date]."
 *   - Calls DELETE /tenants/:parentId/locations/:childId
 *
 * Used for both active locations AND pending invites (cancel invite).
 * Slightly different copy for each.
 */
export default function RemoveLocationDialog({
  open,
  onClose,
  onRemoved,
  parentTenant,
  location,
}) {
  const [confirmText, setConfirmText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [resultData, setResultData] = useState(null);

  useEffect(() => {
    if (open) {
      setConfirmText("");
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

  const isPendingInvite =
    location.billing_responsibility === "self_pays" && !location.stripe_subscription_id;
  const locationLabel = location.company_name || location.name || "this location";
  const expectedConfirm = locationLabel.trim();
  const matches = confirmText.trim().toLowerCase() === expectedConfirm.toLowerCase();

  const handleRemove = async () => {
    if (!matches || !parentTenant?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      const data = await removeLocation(parentTenant.id, location.id);
      setResultData(data);
      onRemoved?.(data);
      // Auto-close after a beat so user sees the success state briefly
      setTimeout(() => onClose?.(), 1400);
    } catch (err) {
      console.error("[RemoveLocationDialog] error:", err);
      setError(err.message || "Failed to remove location");
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
        aria-labelledby="remove-location-title"
      >
        {resultData ? (
          /* ── Success state ───────────────────────────────────────── */
          <div className="p-6 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-emerald-100 text-emerald-600 mb-3">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h3 className="text-lg font-bold text-stone-900 mb-1">
              {isPendingInvite ? "Invite cancelled" : `${locationLabel} removed`}
            </h3>
            <p className="text-sm text-stone-500">
              {isPendingInvite
                ? "The invite has been revoked."
                : `Data will be deleted on ${formatDate(resultData.data_retention_until)}.`}
            </p>
          </div>
        ) : (
          /* ── Confirmation form ───────────────────────────────────── */
          <>
            <div className="p-6 pb-4">
              <div className="flex items-start gap-3 mb-4">
                <div className="shrink-0 w-10 h-10 rounded-full bg-red-100 text-red-600 flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="remove-location-title" className="text-lg font-bold text-stone-900">
                    {isPendingInvite ? "Cancel invite?" : `Remove ${locationLabel}?`}
                  </h3>
                  <p className="text-sm text-stone-500 mt-0.5">
                    {isPendingInvite
                      ? "The franchisee won't be able to use the invite link."
                      : "This action takes effect immediately and can't be undone via the dashboard."}
                  </p>
                </div>
              </div>

              {!isPendingInvite && (
                <div className="rounded-xl bg-stone-50 border border-stone-200 p-4 mb-4 space-y-2.5 text-sm">
                  <Bullet
                    icon="bolt"
                    text="Deactivates immediately — calls and SMS stop routing"
                  />
                  <Bullet
                    icon="ban"
                    text="No refund for the remaining billing period"
                  />
                  <Bullet
                    icon="archive"
                    text="Data retained for 30 days, then permanently deleted"
                  />
                  <Bullet
                    icon="restore"
                    text="Restorable by support during the 30-day window"
                  />
                </div>
              )}

              {!isPendingInvite && (
                <div>
                  <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">
                    Type <span className="text-stone-900">{expectedConfirm}</span> to confirm
                  </label>
                  <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    placeholder={expectedConfirm}
                    autoFocus
                    disabled={submitting}
                    className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-red-500 focus:ring-2 focus:ring-red-500/10 outline-none transition-all disabled:bg-stone-50"
                  />
                </div>
              )}

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
                Keep it
              </button>
              <button
                type="button"
                onClick={handleRemove}
                disabled={submitting || (!isPendingInvite && !matches)}
                className="px-5 py-2.5 bg-red-600 hover:bg-red-700 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {submitting && (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                )}
                {submitting
                  ? "Removing…"
                  : isPendingInvite
                  ? "Cancel invite"
                  : "Remove location"}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Bullet({ icon, text }) {
  const icons = {
    bolt: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />,
    ban: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />,
    archive: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />,
    restore: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />,
  };
  return (
    <div className="flex items-start gap-2.5">
      <svg className="w-4 h-4 text-stone-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        {icons[icon]}
      </svg>
      <span className="text-stone-700 leading-relaxed">{text}</span>
    </div>
  );
}

function formatDate(isoString) {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

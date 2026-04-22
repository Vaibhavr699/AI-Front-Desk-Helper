import React, { useState } from "react";

/**
 * Single location card. Four visual states:
 *   - active         → green dot, clean white card
 *   - sync_failed    → red dot, red-tinted card, retry button (Apr 20, 2026)
 *   - pending_invite → amber dot, warm cream card (self_pays awaiting franchisee)
 *   - removed        → slate dot, faded card with retention countdown
 *
 * sync_failed is an overlay on top of "active" — a location can be active
 * AND have a failed Stripe sync simultaneously (e.g. rate override made
 * Stripe reject the item). The retry button calls the backend's
 * /retry-sync endpoint and refreshes the card on success.
 *
 * Action buttons fire callback props — parent (Locations.jsx) handles
 * routing to the right modal/sheet/navigation AND the retry handler.
 *
 * UPDATE Apr 20, 2026 (Stripe retry): Added sync_failed visual state and
 * onRetrySync callback. When stripe_sync_status === 'failed' on a
 * parent_pays active child, the card flips red and offers an inline
 * retry + Remove pair instead of Edit/Remove. The retry error message
 * (stripe_sync_error column) is shown inline so users can see why it
 * failed (e.g. "Customer has no active payment method").
 */
export default function LocationCard({
  location,
  parentMode,
  onEdit,
  onRemove,
  onResendInvite,
  onView,
  onSettings,
  onRetrySync,
}) {
  const state = getLocationState(location);

  // Local state: track an in-flight retry click so we can disable the button
  // and show a spinner. Also track the last error locally so the inline
  // message updates even before a parent-level reload finishes.
  const [retrying, setRetrying] = useState(false);
  const [localRetryError, setLocalRetryError] = useState(null);

  const handleRetryClick = async () => {
    if (retrying || typeof onRetrySync !== "function") return;
    setRetrying(true);
    setLocalRetryError(null);
    try {
      await onRetrySync(location);
      // Parent will refetch and re-render; nothing to do here.
    } catch (err) {
      setLocalRetryError(err?.message || "Retry failed. Try again in a moment.");
    } finally {
      setRetrying(false);
    }
  };

  const styles = {
    active: {
      card: "bg-white border-stone-200 hover:border-stone-300 hover:shadow-md",
      dot: "bg-emerald-500",
      dotRing: "bg-emerald-500/20",
      label: "Active",
      labelClass: "text-emerald-700",
    },
    sync_failed: {
      card: "bg-red-50/40 border-red-200 hover:border-red-300",
      dot: "bg-red-500",
      dotRing: "bg-red-500/20",
      label: "Billing issue",
      labelClass: "text-red-700",
    },
    pending_invite: {
      card: "bg-amber-50/40 border-amber-200 hover:border-amber-300",
      dot: "bg-amber-500",
      dotRing: "bg-amber-500/20",
      label: "Awaiting franchisee",
      labelClass: "text-amber-700",
    },
    removed: {
      card: "bg-stone-50/60 border-stone-200 opacity-75",
      dot: "bg-stone-400",
      dotRing: "bg-stone-400/20",
      label: "Removed",
      labelClass: "text-stone-500",
    },
  }[state];

  const billingLabel =
    location.billing_responsibility === "self_pays" ? "Self-pays" : "Parent pays";

  const monthlyDollars = formatMoneyCents(location.location_cost_monthly_cents);
  const planLabel = formatPlanLabel(location.plan);
  const createdLabel = formatRelativeDate(location.created_at);
  const inviteExpires = formatExpiryDate(location.franchisee_invite_expires_at);

  // View button is disabled on removed locations — no operational dashboard
  // to load. It stays available on sync_failed because the AI front desk
  // still works; only billing is out of sync.
  const viewDisabled = state === "removed";

  // Error to show in the red banner: prefer the fresh local retry error
  // (from the most recent click) over the stored column value.
  const displayedSyncError =
    localRetryError || location.stripe_sync_error || "Stripe couldn't add this location to your subscription.";

  return (
    <div
      className={`rounded-2xl border p-5 transition-all duration-200 ${styles.card}`}
    >
      {/* Status row — with quick access icons on the right */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="relative flex w-2 h-2">
            <span
              className={`absolute inline-flex h-full w-full rounded-full ${styles.dotRing} animate-ping opacity-75`}
            />
            <span
              className={`relative inline-flex w-2 h-2 rounded-full ${styles.dot}`}
            />
          </span>
          <span
            className={`text-[10px] font-bold uppercase tracking-wider ${styles.labelClass}`}
          >
            {styles.label}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {(state === "active" || state === "sync_failed") && (
            <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider mr-1">
              {billingLabel}
            </span>
          )}
          {/* Settings gear — always available */}
          <button
            type="button"
            onClick={() => onSettings?.(location)}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            title="Location settings"
            aria-label="Open location settings"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Name + plan */}
      <h3
        className="text-lg font-bold text-stone-900 leading-tight mb-1 truncate"
        title={location.company_name || location.name}
      >
        {location.company_name || location.name || "Unnamed location"}
      </h3>
      <p className="text-sm text-stone-500 mb-4">
        {state === "active" || state === "sync_failed" ? (
          <>
            <span className="font-semibold text-stone-700">{planLabel}</span>{" "}
            <span className="text-stone-400">·</span>{" "}
            <span className="font-semibold text-stone-900">{monthlyDollars}/mo</span>
          </>
        ) : state === "pending_invite" ? (
          <>
            <span className="font-semibold text-stone-700">Self-pays</span>{" "}
            <span className="text-stone-400">·</span>{" "}
            <span className="text-stone-500">Plan picked at checkout</span>
          </>
        ) : (
          <span className="text-stone-500">Pending hard-delete</span>
        )}
      </p>

      {/* State-specific body */}
      {state === "active" && (
        <p className="text-xs text-stone-400 mb-5">Added {createdLabel}</p>
      )}

      {state === "sync_failed" && (
        <div className="rounded-lg bg-white border border-red-200 px-3 py-2.5 mb-5 text-xs">
          <div className="flex items-start gap-2">
            <svg className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-red-900 mb-0.5">
                Stripe sync failed
              </div>
              <div
                className="text-stone-600 line-clamp-3 break-words"
                title={displayedSyncError}
              >
                {displayedSyncError}
              </div>
              <div className="text-stone-400 mt-1">
                Your AI front desk still works — this only affects billing for
                this location.
              </div>
            </div>
          </div>
        </div>
      )}

      {state === "pending_invite" && (
        <div className="rounded-lg bg-white border border-amber-200 px-3 py-2.5 mb-5 text-xs">
          <div className="text-stone-500 mb-0.5">Invite expires</div>
          <div className="font-semibold text-stone-900">{inviteExpires}</div>
        </div>
      )}

      {state === "removed" && (
        <div className="rounded-lg bg-white border border-stone-200 px-3 py-2.5 mb-5 text-xs">
          <div className="text-stone-500 mb-0.5">Data deleted on</div>
          <div className="font-semibold text-stone-900">
            {formatExpiryDate(location.location_data_retention_until)}
          </div>
        </div>
      )}

      {/* View button — top of action block, full width, dark for prominence */}
      <button
        type="button"
        onClick={() => !viewDisabled && onView?.(location)}
        disabled={viewDisabled}
        title={viewDisabled ? "Location has been removed — no operational dashboard to view" : "Open this location's dashboard"}
        className={`w-full flex items-center justify-center gap-2 px-3 py-2.5 mb-2 text-xs font-bold rounded-lg transition-colors ${
          viewDisabled
            ? "text-stone-400 bg-stone-100 cursor-not-allowed"
            : "text-white bg-stone-900 hover:bg-stone-800"
        }`}
      >
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
          />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
          />
        </svg>
        {viewDisabled ? "Location removed" : "View dashboard"}
      </button>

      {/* State-specific secondary actions */}
      <div className="flex items-center gap-2">
        {state === "active" && (
          <>
            <button
              type="button"
              onClick={() => onEdit?.(location)}
              className="flex-1 px-3 py-2 text-xs font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onRemove?.(location)}
              className="flex-1 px-3 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
            >
              Remove
            </button>
          </>
        )}

        {state === "sync_failed" && (
          <>
            <button
              type="button"
              onClick={handleRetryClick}
              disabled={retrying}
              className="flex-1 inline-flex items-center justify-center gap-2 px-3 py-2 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors disabled:opacity-60 disabled:cursor-wait"
            >
              {retrying ? (
                <>
                  <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Retrying…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    />
                  </svg>
                  Retry Stripe sync
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => onRemove?.(location)}
              disabled={retrying}
              className="flex-1 px-3 py-2 text-xs font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors disabled:opacity-60"
            >
              Remove
            </button>
          </>
        )}

        {state === "pending_invite" && (
          <>
            <button
              type="button"
              onClick={() => onResendInvite?.(location)}
              className="flex-1 px-3 py-2 text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
            >
              Resend invite
            </button>
            <button
              type="button"
              onClick={() => onRemove?.(location)}
              className="flex-1 px-3 py-2 text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
            >
              Cancel invite
            </button>
          </>
        )}

        {state === "removed" && (
          <button
            type="button"
            disabled
            className="flex-1 px-3 py-2 text-xs font-bold text-stone-400 bg-stone-100 rounded-lg cursor-not-allowed"
          >
            Awaiting deletion
          </button>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function getLocationState(location) {
  // Removed takes precedence — even if sync failed, "removed" is the real
  // end state for the user (it's on its way to hard-delete).
  if (location.location_removed_at) return "removed";

  // Pending invite — self_pays before franchisee checkout
  if (location.billing_responsibility === "self_pays" && !location.stripe_subscription_id) {
    return "pending_invite";
  }

  // Sync failed — parent_pays child where Stripe rejected the item.
  // Self-pays children never sync to the parent's subscription, so their
  // status column is irrelevant here (always 'pending' for them).
  if (
    location.billing_responsibility !== "self_pays" &&
    location.stripe_sync_status === "failed"
  ) {
    return "sync_failed";
  }

  return "active";
}

function formatMoneyCents(cents) {
  if (cents == null || isNaN(cents)) return "$0";
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatPlanLabel(planId) {
  const id = (planId || "").toLowerCase();
  if (id === "basic") return "Basic plan";
  if (id === "pro") return "Pro plan";
  if (id === "elite") return "Elite plan";
  if (id === "hq_starter") return "HQ Starter";
  if (id === "hq_growth") return "HQ Growth";
  if (id === "hq_enterprise") return "HQ Enterprise";
  return "Pro plan";
}

function formatRelativeDate(isoString) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function formatExpiryDate(isoString) {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

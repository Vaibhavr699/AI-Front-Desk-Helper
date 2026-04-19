import React from "react";

/**
 * Single location card. Three visual states:
 *   - active        → green dot, clean white card
 *   - pending_invite → amber dot, warm cream card (self_pays awaiting franchisee)
 *   - removed       → slate dot, faded card with retention countdown
 *
 * Action buttons fire callback props — parent (Locations.jsx) handles routing
 * to the right modal/sheet/navigation.
 *
 * UPDATE Apr 20, 2026: Added View + Settings buttons so users can jump directly
 * into any location from the roster. View switches LocationSwitcher + navigates
 * to /dashboard. Settings switches + navigates to /settings. Removed-state
 * locations get a disabled View button (no operational dashboard), but Settings
 * remains accessible so superadmins can inspect archived data.
 */
export default function LocationCard({
  location,
  parentMode,
  onEdit,
  onRemove,
  onResendInvite,
  onView,
  onSettings,
}) {
  const state = getLocationState(location);

  const styles = {
    active: {
      card: "bg-white border-stone-200 hover:border-stone-300 hover:shadow-md",
      dot: "bg-emerald-500",
      dotRing: "bg-emerald-500/20",
      label: "Active",
      labelClass: "text-emerald-700",
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

  // View button is disabled on removed locations — no operational dashboard to load
  const viewDisabled = state === "removed";

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
          {state === "active" && (
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
        {state === "active" ? (
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
  if (location.location_removed_at) return "removed";
  if (location.billing_responsibility === "self_pays" && !location.stripe_subscription_id) {
    return "pending_invite";
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

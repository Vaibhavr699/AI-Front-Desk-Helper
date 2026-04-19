import React from "react";

/**
 * Single location card. Three visual states:
 *   - active        → green dot, clean white card
 *   - pending_invite → amber dot, warm cream card (self_pays awaiting franchisee)
 *   - removed       → slate dot, faded card with retention countdown
 *
 * Action buttons fire callback props — parent (Locations.jsx) handles routing
 * to the right modal/sheet.
 */
export default function LocationCard({
  location,
  parentMode,
  onEdit,
  onRemove,
  onResendInvite,
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

  return (
    <div
      className={`rounded-2xl border p-5 transition-all duration-200 ${styles.card}`}
    >
      {/* Status row */}
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

        {state === "active" && (
          <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
            {billingLabel}
          </span>
        )}
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

      {/* Actions */}
      <div className="flex items-center gap-2 pt-3 border-t border-stone-100">
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

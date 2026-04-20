import React from "react";

/**
 * Single customer tenant card for the reseller dashboard. Mirrors
 * LocationCard's visual language so parent_hq and reseller users share a
 * consistent mental model ("this card = one sub-account I manage").
 *
 * Three visual states:
 *   - active        → emerald dot, white card, shows 30d metrics
 *   - pending_setup → amber dot, cream card, customer hasn't set password yet
 *   - removed       → slate dot, faded card (soft-deleted, awaiting hard-delete)
 *
 * Key differences from LocationCard:
 *   - NO sync_failed state — reseller customers don't sync to Drew's Stripe
 *     at all (billing_owner='reseller' means the reseller bills customer directly
 *     from their own Stripe; Drew has no per-customer subscription to fail sync on).
 *   - NO billing label (always billed by reseller, so showing it is redundant).
 *   - NO View button — resellers manage subscription relationships, not call logs
 *     or customer dashboards. View-as-customer is a superadmin feature, not reseller.
 *   - SHOWS 30d metrics inline (calls, bookings) because at-a-glance activity
 *     signals help resellers spot at-risk customers. Reseller.jsx passes
 *     metrics_30d from the backend /reseller/customers response.
 *
 * Action buttons fire callback props — parent (Reseller.jsx) handles
 * modals, API calls, and list refresh.
 */
export default function CustomerTenantCard({
  customer,
  onEdit,
  onRemove,
  onResendInvite,
  onSettings,
}) {
  const state = getCustomerState(customer);

  const styles = {
    active: {
      card: "bg-white border-stone-200 hover:border-stone-300 hover:shadow-md",
      dot: "bg-emerald-500",
      dotRing: "bg-emerald-500/20",
      label: "Active",
      labelClass: "text-emerald-700",
    },
    pending_setup: {
      card: "bg-amber-50/40 border-amber-200 hover:border-amber-300",
      dot: "bg-amber-500",
      dotRing: "bg-amber-500/20",
      label: "Awaiting setup",
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

  const planLabel = formatPlanLabel(customer.plan);
  const createdLabel = formatRelativeDate(customer.created_at);

  const metrics = customer.metrics_30d || { calls: 0, bookings: 0 };

  return (
    <div
      className={`rounded-2xl border p-5 transition-all duration-200 ${styles.card}`}
    >
      {/* Status row — with settings gear on the right */}
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

        {state !== "removed" && (
          <button
            type="button"
            onClick={() => onSettings?.(customer)}
            className="p-1.5 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            title="Customer settings"
            aria-label="Open customer settings"
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
        )}
      </div>

      {/* Name + plan */}
      <h3
        className="text-lg font-bold text-stone-900 leading-tight mb-1 truncate"
        title={customer.name}
      >
        {customer.name || "Unnamed customer"}
      </h3>
      <p className="text-sm text-stone-500 mb-4">
        <span className="font-semibold text-stone-700">{planLabel}</span>{" "}
        <span className="text-stone-400">·</span>{" "}
        <span className="text-stone-500">Added {createdLabel}</span>
      </p>

      {/* State-specific body */}
      {state === "active" && (
        <div className="flex items-center gap-3 mb-5 px-1">
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
              />
            </svg>
            <span className="text-xs font-semibold text-stone-900">
              {metrics.calls}
            </span>
            <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
              calls
            </span>
          </div>
          <div className="w-px h-3 bg-stone-200" />
          <div className="flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-stone-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <span className="text-xs font-semibold text-stone-900">
              {metrics.bookings}
            </span>
            <span className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
              bookings
            </span>
          </div>
          <span className="text-[10px] text-stone-400 ml-auto">last 30d</span>
        </div>
      )}

      {state === "pending_setup" && (
        <div className="rounded-lg bg-white border border-amber-200 px-3 py-2.5 mb-5 text-xs">
          <div className="text-stone-500 mb-0.5">Setup email</div>
          <div className="font-semibold text-stone-900 truncate" title={customer.primary_email}>
            {customer.primary_email}
          </div>
          <div className="text-stone-400 mt-1">
            Customer hasn't set their password yet.
          </div>
        </div>
      )}

      {state === "removed" && (
        <div className="rounded-lg bg-white border border-stone-200 px-3 py-2.5 mb-5 text-xs">
          <div className="text-stone-500">Pending hard-delete</div>
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        {state === "active" && (
          <>
            <button
              type="button"
              onClick={() => onEdit?.(customer)}
              className="flex-1 px-3 py-2 text-xs font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onRemove?.(customer)}
              className="flex-1 px-3 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 rounded-lg transition-colors"
            >
              Remove
            </button>
          </>
        )}

        {state === "pending_setup" && (
          <>
            <button
              type="button"
              onClick={() => onResendInvite?.(customer)}
              className="flex-1 px-3 py-2 text-xs font-bold text-amber-700 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
            >
              Resend welcome
            </button>
            <button
              type="button"
              onClick={() => onRemove?.(customer)}
              className="flex-1 px-3 py-2 text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
            >
              Cancel
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

function getCustomerState(customer) {
  if (customer.deleted_at) return "removed";

  // If backend exposes setup_completed_at or last_login_at, use that.
  // For v1 we conservatively treat never-logged-in customers as pending_setup
  // only when the backend explicitly flags them. Until Step 6 ships the
  // password-set endpoint, this flag stays false and everyone shows as active.
  if (customer.pending_setup === true) return "pending_setup";

  return "active";
}

function formatPlanLabel(planId) {
  const id = (planId || "").toLowerCase();
  if (id === "basic") return "Basic plan";
  if (id === "pro") return "Pro plan";
  if (id === "elite") return "Elite plan";
  if (id === "growth") return "Growth plan";
  return "Pro plan";
}

function formatRelativeDate(isoString) {
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

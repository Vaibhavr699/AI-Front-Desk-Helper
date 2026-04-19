import React, { useState, useEffect, useCallback } from "react";
import { getTenant } from "../api";
import { listLocations } from "../api/locations";
import { useToast } from "../components/ui/Toast";
import LocationCard from "../components/locations/LocationCard";
import AddLocationSheet from "../components/locations/AddLocationSheet";

/**
 * Locations roster page.
 *
 * Lists all active + pending + removed children under the current tenant.
 * Header summary shows total monthly recurring + active count.
 * "Add Location" opens the sheet (F3 ✓).
 *
 * Edit / Remove / Resend wired in F4.
 */
export default function Locations({ tenantId }) {
  const toast = useToast();
  const [parentTenant, setParentTenant] = useState(null);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [addSheetOpen, setAddSheetOpen] = useState(false);

  const load = useCallback(async () => {
    if (!tenantId || tenantId === "all") {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [tenantData, locationsData] = await Promise.all([
        getTenant(tenantId),
        listLocations(tenantId),
      ]);
      setParentTenant(tenantData);
      setLocations(locationsData?.locations || []);
    } catch (err) {
      console.error("[Locations] Load error:", err);
      setError(err.message || "Failed to load locations");
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = () => setAddSheetOpen(true);
  const handleAdded = () => {
    // Refetch the roster so the new location shows up
    load();
  };

  const handleEdit = (loc) => {
    toast?.show?.(`Edit ${loc.company_name || loc.name} — coming in F4`, { type: "info" });
  };
  const handleRemove = (loc) => {
    toast?.show?.(`Remove ${loc.company_name || loc.name} — coming in F4`, { type: "info" });
  };
  const handleResendInvite = (loc) => {
    toast?.show?.(`Resend invite — coming in F4`, { type: "info" });
  };

  // ── Rollup view ────────────────────────────────────────────────────────
  if (tenantId === "all") {
    return (
      <PageShell>
        <EmptyCard
          title="Pick a specific tenant to manage locations"
          body="Locations are managed per parent tenant. Use the business switcher in the top bar to select a specific HQ, then return to this page."
        />
      </PageShell>
    );
  }

  // ── Loading ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <PageShell>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="rounded-2xl border border-stone-200 bg-white p-5 animate-pulse"
            >
              <div className="h-3 w-16 bg-stone-200 rounded mb-3" />
              <div className="h-5 w-3/4 bg-stone-200 rounded mb-2" />
              <div className="h-4 w-1/2 bg-stone-200 rounded mb-5" />
              <div className="h-9 w-full bg-stone-100 rounded" />
            </div>
          ))}
        </div>
      </PageShell>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────
  if (error) {
    return (
      <PageShell>
        <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
          <div className="text-sm font-bold text-red-900 mb-1">Couldn't load locations</div>
          <div className="text-sm text-red-700 mb-4">{error}</div>
          <button
            type="button"
            onClick={load}
            className="px-4 py-2 text-xs font-bold text-red-700 bg-white border border-red-200 hover:bg-red-100 rounded-lg transition-colors"
          >
            Retry
          </button>
        </div>
      </PageShell>
    );
  }

  // ── Loaded ─────────────────────────────────────────────────────────────
  const activeLocations = locations.filter((l) => !l.location_removed_at);
  const pendingInviteCount = activeLocations.filter(
    (l) => l.billing_responsibility === "self_pays" && !l.stripe_subscription_id
  ).length;
  const totalMonthlyCents = activeLocations.reduce(
    (sum, l) => sum + (l.location_cost_monthly_cents || 0),
    0
  );

  const sortedLocations = [...locations].sort((a, b) => {
    const stateOrder = { active: 0, pending_invite: 1, removed: 2 };
    const aState = a.location_removed_at
      ? "removed"
      : a.billing_responsibility === "self_pays" && !a.stripe_subscription_id
      ? "pending_invite"
      : "active";
    const bState = b.location_removed_at
      ? "removed"
      : b.billing_responsibility === "self_pays" && !b.stripe_subscription_id
      ? "pending_invite"
      : "active";
    if (stateOrder[aState] !== stateOrder[bState]) {
      return stateOrder[aState] - stateOrder[bState];
    }
    return new Date(a.created_at) - new Date(b.created_at);
  });

  return (
    <>
      <PageShell>
        <div className="rounded-2xl bg-gradient-to-br from-stone-900 to-stone-800 text-white p-6 mb-6">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="flex-1">
              <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
                Total recurring
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-black tracking-tight">
                  {formatMoneyCents(totalMonthlyCents)}
                </span>
                <span className="text-sm font-semibold text-stone-400">/month</span>
              </div>
              <div className="text-xs text-stone-400 mt-2">
                Across {activeLocations.length}{" "}
                {activeLocations.length === 1 ? "location" : "locations"}
                {pendingInviteCount > 0 && (
                  <>
                    {" "}
                    <span className="text-amber-300">
                      · {pendingInviteCount} awaiting franchisee
                    </span>
                  </>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={handleAdd}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 bg-white text-stone-900 hover:bg-stone-100 rounded-xl text-sm font-bold transition-colors shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2.5}
                  d="M12 4v16m8-8H4"
                />
              </svg>
              Add Location
            </button>
          </div>
        </div>

        {sortedLocations.length === 0 ? (
          <EmptyCard
            title="No locations yet"
            body={
              parentTenant?.parent_mode === "rollup_only"
                ? "Add your first franchise location to start rolling up calls, leads, and bookings into one dashboard."
                : "Add your first location to expand your AI front desk to a second site. You'll only pay 50% of your plan rate per additional location."
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedLocations.map((loc) => (
              <LocationCard
                key={loc.id}
                location={loc}
                parentMode={parentTenant?.parent_mode}
                onEdit={handleEdit}
                onRemove={handleRemove}
                onResendInvite={handleResendInvite}
              />
            ))}
          </div>
        )}
      </PageShell>

      <AddLocationSheet
        open={addSheetOpen}
        onClose={() => setAddSheetOpen(false)}
        onAdded={handleAdded}
        parentTenant={parentTenant}
      />
    </>
  );
}

function PageShell({ children }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-stone-900">Locations</h1>
        <p className="text-sm text-stone-500 mt-1">
          Manage your franchise locations and per-site billing
        </p>
      </div>
      {children}
    </div>
  );
}

function EmptyCard({ title, body }) {
  return (
    <div className="rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/50 p-12 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-stone-200 text-stone-500 mb-4">
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 21V9l4-3 4 3v12M3 21h8M3 21H1m10 0h2m0 0V11l5-3 5 3v10m-10 0h10m0 0h2"
          />
        </svg>
      </div>
      <h2 className="text-lg font-semibold text-stone-900 mb-1">{title}</h2>
      <p className="text-sm text-stone-500 max-w-md mx-auto">{body}</p>
    </div>
  );
}

function formatMoneyCents(cents) {
  if (cents == null || isNaN(cents)) return "$0";
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

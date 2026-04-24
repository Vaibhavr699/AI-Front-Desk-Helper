import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getResellerOverview,
  getResellerUsage,                    // ← NEW
  listResellerCustomers,
  removeResellerCustomer,
  resendResellerCustomerInvite,
} from "../api";
import CustomerTenantCard from "../components/CustomerTenantCard";
import AddCustomerSheet from "../components/AddCustomerSheet";
import EditCustomerSheet from "../components/EditCustomerSheet";
import ResellerUsageCard from "../components/ResellerUsageCard";  // ← NEW

/**
 * Reseller dashboard — mirrors the Businesses (Tenants.jsx) page pattern for
 * parent_hq accounts. Top hero shows tier + aggregated 30d metrics across all
 * customer tenants. Grid below shows individual CustomerTenantCard per customer.
 *
 * Apr 24: Added ResellerUsageCard for current-month voice/SMS cap tracking.
 */
export default function Reseller() {
  const navigate = useNavigate();
  const [overview, setOverview] = useState(null);
  const [usage, setUsage] = useState(null);        // ← NEW
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showAddSheet, setShowAddSheet] = useState(false);
  const [actionMessage, setActionMessage] = useState(null);
  const [editingCustomer, setEditingCustomer] = useState(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      // Parallelize all 3 API calls. getResellerUsage is added as 3rd promise.
      // If usage endpoint fails (e.g. no caps configured yet), we swallow the
      // error and let the ResellerUsageCard handle its own null state — we
      // don't want usage fetch failure to block the rest of the page.
      const [ov, cs, usg] = await Promise.all([
        getResellerOverview(),
        listResellerCustomers(),
        getResellerUsage().catch((err) => {
          console.warn("[Reseller] Usage fetch failed:", err.message);
          return null;
        }),
      ]);
      setOverview(ov);
      setCustomers(cs.customers || []);
      setUsage(usg);
    } catch (err) {
      setError(err.message || "Failed to load reseller dashboard");
    } finally {
      setLoading(false);
    }
  }

  async function handleRemove(customer) {
    if (!window.confirm(`Remove ${customer.name}? This closes their account and cannot be undone.`)) {
      return;
    }
    try {
      await removeResellerCustomer(customer.id);
      setActionMessage(`${customer.name} has been removed.`);
      await loadAll();
    } catch (err) {
      setActionMessage(`Failed to remove: ${err.message}`);
    }
  }

  async function handleResendInvite(customer) {
    try {
      await resendResellerCustomerInvite(customer.id);
      setActionMessage(`Welcome email re-sent to ${customer.primary_email}.`);
    } catch (err) {
      setActionMessage(`Failed to resend: ${err.message}`);
    }
  }

  function handleEdit(customer) {
    setEditingCustomer(customer);
  }

  function handleSettings(customer) {
    setEditingCustomer(customer);
  }

  function handleEditSaved(updated) {
    setActionMessage(`${updated.name} updated successfully.`);
    loadAll();
  }

  function handleAddClick() {
    setShowAddSheet(true);
  }

  function handleCustomerCreated(customer) {
    setActionMessage(`${customer.name} added successfully.`);
    loadAll();
  }

  function handleUpgradeFromSheet() {
    navigate("/reseller/plans");
  }

  if (loading && !overview) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-stone-400 text-sm">Loading reseller dashboard...</div>
      </div>
    );
  }

  if (error && !overview) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  const tier = overview?.tier;
  const agg = overview?.aggregated_30d || { calls: 0, bookings: 0, open_leads: 0, revenue_cents: 0 };
  const notSubscribed =
  overview &&
  (!tier || !tier.tier || overview.reseller?.subscription_status !== "active");

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 text-stone-900 mb-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            <h1 className="text-2xl font-bold">Customers</h1>
          </div>
          <p className="text-sm text-stone-500">
            {overview?.reseller?.name || "Your reseller account"} ·{" "}
            {customers.length} {customers.length === 1 ? "customer" : "customers"}
          </p>
        </div>
        {tier && tier.tier && !tier.at_cap && (
          <button
            type="button"
            onClick={handleAddClick}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            Add customer
          </button>
        )}
      </div>

      {actionMessage && (
        <div className="mb-4 rounded-lg bg-stone-900 text-white px-4 py-3 text-sm flex items-center justify-between">
          <span>{actionMessage}</span>
          <button
            type="button"
            onClick={() => setActionMessage(null)}
            className="text-stone-400 hover:text-white"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {notSubscribed && (
        <div className="rounded-2xl bg-white border border-stone-200 p-8 text-center">
          <h2 className="text-xl font-bold text-stone-900 mb-2">
            Activate your reseller subscription
          </h2>
          <p className="text-sm text-stone-500 mb-5 max-w-md mx-auto">
            Choose a tier to start onboarding customers. You'll get a unique signup link
            to share and a dashboard to manage everyone in one place.
          </p>
          <button
            type="button"
            onClick={() => navigate("/reseller/plans")}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
          >
            View plans
          </button>
        </div>
      )}

      {tier && tier.tier && (
        <div className="rounded-2xl bg-stone-900 text-white p-6 mb-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">
                Your plan
              </div>
              <div className="text-2xl font-bold">{tier.tier_name}</div>
              <div className="text-sm text-stone-400 mt-1">{tier.tier_tagline}</div>
            </div>
            <button
              type="button"
              onClick={() => navigate("/reseller/plans")}
              className="px-3 py-1.5 text-xs font-bold text-stone-900 bg-white hover:bg-stone-100 rounded-lg transition-colors"
            >
              Manage plan
            </button>
          </div>

          <div className="mb-5">
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className="text-stone-400">Customers</span>
              <span className="font-semibold">
                {tier.customer_count}
                {tier.customer_limit !== null && ` / ${tier.customer_limit}`}
                {tier.customer_limit === null && " (unlimited)"}
              </span>
            </div>
            {tier.customer_limit !== null && (
              <div className="h-1.5 bg-stone-800 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    tier.at_cap
                      ? "bg-red-500"
                      : tier.utilization_pct > 80
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                  style={{ width: `${Math.min(100, tier.utilization_pct)}%` }}
                />
              </div>
            )}
            {tier.at_cap && tier.next_tier && (
              <div className="mt-2 text-xs text-amber-300">
                At capacity. Upgrade to {tier.next_tier.name} to add more customers.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <MetricCell label="Calls (30d)" value={agg.calls.toLocaleString()} />
            <MetricCell label="Bookings (30d)" value={agg.bookings.toLocaleString()} />
            <MetricCell label="Open leads" value={agg.open_leads.toLocaleString()} />
            <MetricCell
              label="Revenue (30d)"
              value={formatMoneyCents(agg.revenue_cents)}
            />
          </div>
        </div>
      )}

      {/* NEW Apr 24: Usage card renders between tier hero and signup link.
          Component returns null if no usage data or caps aren't configured,
          so we don't need to conditionally wrap it. */}
      <ResellerUsageCard usage={usage} />

      {overview?.reseller?.reseller_code && (
        <div className="rounded-2xl bg-white border border-stone-200 p-5 mb-6">
          <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">
            Share your signup link
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 text-sm bg-stone-50 border border-stone-200 rounded-lg font-mono text-stone-700 truncate">
              {window.location.origin}/reseller/{overview.reseller.reseller_code}/signup
            </code>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(
                  `${window.location.origin}/reseller/${overview.reseller.reseller_code}/signup`
                );
                setActionMessage("Signup link copied to clipboard.");
              }}
              className="px-3 py-2 text-xs font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
            >
              Copy
            </button>
          </div>
          <p className="text-xs text-stone-500 mt-2">
            Customers who use this link will sign up directly to your account, branded with your logo and colors.
          </p>
        </div>
      )}

      {tier && tier.tier && customers.length === 0 && (
        <div className="rounded-2xl bg-white border border-stone-200 p-8 text-center">
          <h2 className="text-lg font-bold text-stone-900 mb-2">
            No customers yet
          </h2>
          <p className="text-sm text-stone-500 mb-5 max-w-md mx-auto">
            Add your first customer manually, or share your signup link so they can onboard themselves.
          </p>
          {!tier.at_cap && (
            <button
              type="button"
              onClick={handleAddClick}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
            >
              Add your first customer
            </button>
          )}
        </div>
      )}

      {customers.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {customers.map((c) => (
            <CustomerTenantCard
              key={c.id}
              customer={c}
              onEdit={handleEdit}
              onRemove={handleRemove}
              onResendInvite={handleResendInvite}
              onSettings={handleSettings}
            />
          ))}
        </div>
      )}

      <AddCustomerSheet
        open={showAddSheet}
        onClose={() => setShowAddSheet(false)}
        onCreated={handleCustomerCreated}
        onUpgrade={handleUpgradeFromSheet}
      />

      <EditCustomerSheet
        open={!!editingCustomer}
        customer={editingCustomer}
        onClose={() => setEditingCustomer(null)}
        onSaved={handleEditSaved}
      />
    </div>
  );
}

function MetricCell({ label, value }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-1">
        {label}
      </div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  );
}

function formatMoneyCents(cents) {
  if (cents == null || isNaN(cents)) return "$0";
  const dollars = Number(cents) / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
}

import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getResellerTier,
  createResellerCheckout,
  openResellerBillingPortal,
} from "../api";

/**
 * Reseller plan picker & billing management page.
 *
 * Gating (Apr 21, 2026 fix):
 *   - "CURRENT PLAN" badge + disabled button requires BOTH
 *       (a) current.tier matches the card AND
 *       (b) subscription_status is 'active' or 'trialing'
 *     Previously gated only on reseller_tier, which is set by the admin
 *     modal at tenant-create time to satisfy the tenants_reseller_fields_
 *     consistency CHECK constraint — causing pre-subscription resellers to
 *     render as already-subscribed and blocking the Subscribe button.
 *   - "Change via Stripe portal" appears only when the reseller HAS an
 *     active subscription on a different tier (Stripe handles proration).
 *   - "Subscribe to {tier}" appears when no active subscription exists.
 */
const ACTIVE_SUB_STATUSES = new Set(["active", "trialing"]);

export default function ResellerPlans() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [interval, setBillingInterval] = useState("annual");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadTier();
  }, []);

  async function loadTier() {
    setLoading(true);
    setError(null);
    try {
      const result = await getResellerTier();
      setData(result);
    } catch (err) {
      setError(err.message || "Failed to load plans");
    } finally {
      setLoading(false);
    }
  }

  async function handleSubscribe(tierId) {
    setSubmitting(true);
    setError(null);
    try {
      const { checkout_url } = await createResellerCheckout(tierId, interval);
      window.location.href = checkout_url;
    } catch (err) {
      setError(err.message || "Failed to start checkout");
      setSubmitting(false);
    }
  }

  async function handleManageBilling() {
    setSubmitting(true);
    setError(null);
    try {
      const { portal_url } = await openResellerBillingPortal();
      window.location.href = portal_url;
    } catch (err) {
      setError(err.message || "Failed to open billing portal");
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="text-stone-400 text-sm">Loading plans...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  // ── Corrected subscription gating ──────────────────────────────────────
  // A reseller is "subscribed" only when Stripe reports an active or
  // trialing subscription. reseller_tier alone means nothing — it's set
  // at tenant-create time by admin to satisfy the DB CHECK constraint.
  const subscriptionStatus = data?.subscription_status || null;
  const hasActiveSubscription = ACTIVE_SUB_STATUSES.has(subscriptionStatus);
  const currentTierId = hasActiveSubscription ? data?.current?.tier : null;
  const isSubscribed = hasActiveSubscription;
  const tiers = data?.available || [];

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="mb-8">
        <button
          type="button"
          onClick={() => navigate("/reseller")}
          className="text-xs font-semibold text-stone-500 hover:text-stone-900 mb-2 flex items-center gap-1"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to dashboard
        </button>
        <h1 className="text-3xl font-bold text-stone-900 mb-2">
          {isSubscribed ? "Your plan" : "Choose your plan"}
        </h1>
        <p className="text-sm text-stone-500">
          {isSubscribed
            ? "Manage or change your reseller subscription. Changes are handled securely through Stripe."
            : "Start reselling AI Front Desk under your own brand. All plans include white-label dashboards, custom signup URLs, and direct customer billing."}
        </p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Interval toggle */}
      <div className="flex items-center justify-center mb-8">
        <div className="inline-flex items-center gap-1 p-1 bg-stone-100 rounded-lg">
          <button
            type="button"
            onClick={() => setBillingInterval("monthly")}
            className={`px-4 py-2 text-sm font-bold rounded-md transition-colors ${
              interval === "monthly"
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-900"
            }`}
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setBillingInterval("annual")}
            className={`px-4 py-2 text-sm font-bold rounded-md transition-colors flex items-center gap-2 ${
              interval === "annual"
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-900"
            }`}
          >
            Annual
            <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
              Save 20%
            </span>
          </button>
        </div>
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {tiers.map((tier) => {
          const isCurrent = currentTierId === tier.id;
          const priceCents = interval === "annual" ? tier.annual_price_cents : tier.monthly_price_cents;
          const priceLabel = formatPriceLabel(priceCents, interval);
          const isRecommended = tier.id === "growth";

          return (
            <div
              key={tier.id}
              className={`relative rounded-2xl border p-6 transition-all ${
                isCurrent
                  ? "bg-white border-stone-900 ring-2 ring-stone-900 shadow-lg"
                  : isRecommended
                  ? "bg-white border-stone-300 shadow-md"
                  : "bg-white border-stone-200"
              }`}
            >
              {isCurrent && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-stone-900 text-white text-[10px] font-bold uppercase tracking-wider">
                  Current plan
                </div>
              )}
              {!isCurrent && isRecommended && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold uppercase tracking-wider">
                  Most popular
                </div>
              )}

              <h3 className="text-xl font-bold text-stone-900 mb-1">{tier.name}</h3>
              <p className="text-xs text-stone-500 mb-4">{tier.description}</p>

              <div className="mb-5">
                <div className="text-3xl font-bold text-stone-900">{priceLabel.amount}</div>
                <div className="text-xs text-stone-500">{priceLabel.suffix}</div>
              </div>

              <ul className="space-y-2 mb-6">
                <Feature>
                  {tier.customer_limit === null
                    ? "Unlimited customer tenants"
                    : `Up to ${tier.customer_limit} customer tenants`}
                </Feature>
                <Feature>White-label dashboards</Feature>
                <Feature>Custom signup URL</Feature>
                <Feature>Your own Stripe billing</Feature>
                <Feature>Direct customer management</Feature>
              </ul>

              {/* CTA button */}
              {isCurrent ? (
                <button
                  type="button"
                  disabled
                  className="w-full px-4 py-3 text-sm font-bold text-stone-500 bg-stone-100 rounded-lg cursor-default"
                >
                  Your current plan
                </button>
              ) : isSubscribed ? (
                <button
                  type="button"
                  onClick={handleManageBilling}
                  disabled={submitting}
                  className="w-full px-4 py-3 text-sm font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-60 rounded-lg transition-colors"
                >
                  {submitting ? "Opening..." : "Change via Stripe portal"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleSubscribe(tier.id)}
                  disabled={submitting}
                  className={`w-full px-4 py-3 text-sm font-bold rounded-lg transition-colors ${
                    isRecommended
                      ? "text-white bg-stone-900 hover:bg-stone-800"
                      : "text-stone-900 bg-stone-100 hover:bg-stone-200"
                  } disabled:opacity-60 disabled:cursor-wait`}
                >
                  {submitting ? "Starting..." : `Subscribe to ${tier.name}`}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Subscribed users: billing portal CTA at bottom */}
      {isSubscribed && (
        <div className="mt-8 rounded-2xl bg-stone-50 border border-stone-200 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-sm font-bold text-stone-900 mb-1">Manage billing</h3>
              <p className="text-xs text-stone-500">
                Update payment method, view invoices, cancel subscription, or change tier through Stripe's secure billing portal.
              </p>
            </div>
            <button
              type="button"
              onClick={handleManageBilling}
              disabled={submitting}
              className="whitespace-nowrap px-4 py-2 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 disabled:opacity-60 rounded-lg transition-colors"
            >
              {submitting ? "Opening..." : "Open portal"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Feature({ children }) {
  return (
    <li className="flex items-start gap-2 text-sm text-stone-700">
      <svg className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
      </svg>
      <span>{children}</span>
    </li>
  );
}

function formatPriceLabel(cents, interval) {
  if (cents == null) return { amount: "—", suffix: "" };
  const dollars = Number(cents) / 100;
  const formatted = `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })}`;
  if (interval === "annual") {
    const monthlyEquivalent = dollars / 12;
    return {
      amount: formatted,
      suffix: `per year · $${monthlyEquivalent.toLocaleString("en-US", { maximumFractionDigits: 0 })}/mo equivalent`,
    };
  }
  return { amount: formatted, suffix: "per month" };
}

import { useState, useEffect } from "react";
import { getPlans, getTenant, createCheckout, openBillingPortal, getSubscriptionStatus } from "../api";
import { Loading } from "../components";

const PLAN_EMOJI = { basic: "🥉", pro: "🥈", elite: "🥇" };
const STATUS_LABELS = {
  active: { text: "Active", color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  trialing: { text: "Trial", color: "text-blue-700 bg-blue-50 border-blue-200" },
  past_due: { text: "Past Due", color: "text-amber-700 bg-amber-50 border-amber-200" },
  canceled: { text: "Canceled", color: "text-red-700 bg-red-50 border-red-200" },
  inactive: { text: "No subscription", color: "text-stone-600 bg-stone-50 border-stone-200" },
};

export default function Plans({ tenantId }) {
  const [plans, setPlans] = useState([]);
  const [tenant, setTenant] = useState(null);
  const [subStatus, setSubStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const [message, setMessage] = useState("");

  // Check URL for success/canceled
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "1") {
      setMessage("🎉 Subscription activated! Your plan is now active.");
      window.history.replaceState({}, "", "/plans");
    } else if (params.get("canceled") === "1") {
      setError("Checkout was canceled. You can try again anytime.");
      window.history.replaceState({}, "", "/plans");
    }
  }, []);

  useEffect(() => {
    getPlans()
      .then((res) => setPlans(res.plans || []))
      .catch((e) => {
        setError(e.message);
        setPlans([
          { id: "basic", name: "Basic", tagline: "AI Front Desk Starter", whoItIsFor: "Small ops", voiceMinutes: 300, smsLimit: 500, priceMonthly: 29, priceLabel: "/month", includes: [], excludes: [] },
          { id: "pro", name: "Pro", tagline: "AI Booking Assistant", whoItIsFor: "Growing teams", voiceMinutes: 800, smsLimit: 1500, priceMonthly: 79, priceLabel: "/month", includes: [], excludes: [] },
          { id: "elite", name: "Elite", tagline: "AI Sales & Follow-Up Engine", whoItIsFor: "Scaling companies", voiceMinutes: 2000, smsLimit: 4000, priceMonthly: 199, priceLabel: "/month", includes: [], excludes: [] },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!tenantId) {
      setTenant(null);
      setSubStatus(null);
      return;
    }
    getTenant(tenantId)
      .then(setTenant)
      .catch(() => setTenant(null));
    getSubscriptionStatus(tenantId)
      .then(setSubStatus)
      .catch(() => setSubStatus(null));
  }, [tenantId]);

  async function handleSelectPlan(planId) {
    if (!tenantId) return;
    setError("");
    setMessage("");
    setCheckoutLoading(planId);
    try {
      const result = await createCheckout(tenantId, planId);
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (e) {
      setError(e.message);
      setCheckoutLoading(null);
    }
  }

  async function handleManageSubscription() {
    if (!tenantId) return;
    setError("");
    try {
      const result = await openBillingPortal(tenantId);
      if (result.url) {
        window.location.href = result.url;
      }
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) {
    return (
      <div className="px-0">
        <Loading fullScreen={false} message="Loading plans…" />
      </div>
    );
  }

  if (error && !plans.length) {
    return (
      <div className="px-0">
        <p className="text-red-600 text-sm sm:text-base">{error}</p>
      </div>
    );
  }

  const currentPlanId = (tenant?.plan || "basic").toLowerCase();
  const status = STATUS_LABELS[subStatus?.subscription_status] || STATUS_LABELS.inactive;
  const isSubscribed = subStatus?.subscription_status === "active" || subStatus?.subscription_status === "trialing";

  return (
    <div className="px-0">
      <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-1">Plans</h1>
      <p className="text-sm text-stone-500 mb-6">
        Choose the right AI Front Desk tier for your business. Powered by Stripe.
      </p>

      {/* Subscription status banner */}
      {tenantId && (
        <div className="mb-6 rounded-xl border border-stone-200 bg-white shadow-sm p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-sm font-medium text-stone-700">
                Current plan:{" "}
                <span className="text-stone-900 capitalize font-semibold">{currentPlanId}</span>
              </p>
              <div className="flex items-center gap-2 mt-1">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${status.color}`}>
                  {status.text}
                </span>
                {subStatus?.cancel_at_period_end && (
                  <span className="text-xs text-amber-600">Cancels at period end</span>
                )}
                {subStatus?.current_period_end && isSubscribed && (
                  <span className="text-xs text-stone-500">
                    Renews {new Date(subStatus.current_period_end * 1000).toLocaleDateString()}
                  </span>
                )}
              </div>
            </div>
            {isSubscribed && (
              <button
                onClick={handleManageSubscription}
                className="text-sm font-medium text-stone-600 hover:text-stone-900 underline underline-offset-2"
              >
                Manage subscription →
              </button>
            )}
          </div>
        </div>
      )}

      

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {(plans.length ? plans : [{ id: "basic" }, { id: "pro" }, { id: "elite" }]).map((plan) => {
          const isCurrent = currentPlanId === (plan.id || "").toLowerCase();
          const isLoading = checkoutLoading === plan.id;
          const emoji = PLAN_EMOJI[plan.id] || "";
          const isPro = plan.id === "pro";
          return (
            <div
              key={plan.id}
              className={`rounded-xl border-2 shadow-sm overflow-hidden flex flex-col relative ${isCurrent
                  ? "border-brand-500 bg-brand-50/30"
                  : isPro
                    ? "border-stone-800 bg-white"
                    : "border-stone-200 bg-white hover:border-stone-300"
                }`}
            >
              {isPro && !isCurrent && (
                <div className="absolute top-0 right-0 bg-stone-800 text-white text-xs font-medium px-3 py-1 rounded-bl-lg">
                  Popular
                </div>
              )}
              <div className="p-5 pb-4 border-b border-stone-100">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-2xl" aria-hidden>{emoji}</span>
                  <span className="text-xs font-medium uppercase tracking-wider text-stone-500">
                    {plan.whoItIsFor || (plan.id === "basic" ? "Small ops" : plan.id === "pro" ? "Growing teams" : "Scaling companies")}
                  </span>
                </div>
                <h2 className="mt-2 text-lg font-semibold text-stone-900">
                  {plan.name || plan.id}
                </h2>
                <p className="text-sm text-stone-600 mt-0.5">
                  {plan.tagline || (plan.id === "basic" ? "AI Front Desk Starter" : plan.id === "pro" ? "AI Booking Assistant" : "AI Sales & Follow-Up Engine")}
                </p>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-stone-900">
                    ${plan.priceMonthly ?? (plan.id === "basic" ? 29 : plan.id === "pro" ? 79 : 199)}
                  </span>
                  <span className="text-sm text-stone-500">{plan.priceLabel ?? "/month"}</span>
                </div>
                <div className="mt-3 flex gap-4 text-sm">
                  <span className="text-stone-600">
                    <span className="font-medium text-stone-900">{plan.voiceMinutes ?? (plan.id === "basic" ? 300 : plan.id === "pro" ? 800 : 2000)}</span> voice min
                  </span>
                  <span className="text-stone-600">
                    <span className="font-medium text-stone-900">{plan.smsLimit ?? (plan.id === "basic" ? 500 : plan.id === "pro" ? 1500 : 4000)}</span> SMS
                  </span>
                </div>
                {plan.positioning && (
                  <p className="mt-3 text-xs text-stone-500 italic">"{plan.positioning}"</p>
                )}
              </div>

              <div className="p-5 flex-1 flex flex-col">
                {Array.isArray(plan.includes) && plan.includes.length > 0 && (
                  <ul className="space-y-2 text-sm text-stone-700 mb-4">
                    {plan.includes.map((item, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-emerald-600 shrink-0">✓</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {Array.isArray(plan.excludes) && plan.excludes.length > 0 && (
                  <ul className="space-y-1.5 text-sm text-stone-500 mb-4">
                    {plan.excludes.map((item, i) => (
                      <li key={i} className="flex gap-2">
                        <span className="text-stone-400 shrink-0">✗</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                )}

                {tenantId && (
                  <div className="mt-auto pt-4">
                    {isCurrent && isSubscribed ? (
                      <button
                        type="button"
                        disabled
                        className="w-full py-2.5 rounded-lg text-sm font-medium bg-stone-200 text-stone-500 cursor-default"
                      >
                        Current plan
                      </button>
                    ) : isCurrent && !isSubscribed ? (
                      <button
                        type="button"
                        onClick={() => handleSelectPlan(plan.id)}
                        disabled={isLoading}
                        className="w-full py-2.5 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-emerald-500 disabled:opacity-60 transition-colors"
                      >
                        {isLoading ? "Redirecting to Stripe…" : "Subscribe to this plan"}
                      </button>
                    ) : isSubscribed ? (
                      <button
                        type="button"
                        onClick={handleManageSubscription}
                        className="w-full py-2.5 rounded-lg text-sm font-medium bg-stone-100 text-stone-700 hover:bg-stone-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-400 transition-colors"
                      >
                        Change to this plan →
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleSelectPlan(plan.id)}
                        disabled={isLoading}
                        className={`w-full py-2.5 rounded-lg text-sm font-medium transition-colors ${isPro
                            ? "bg-stone-800 text-white hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 disabled:opacity-60"
                            : "bg-stone-800 text-white hover:bg-stone-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 disabled:opacity-60"
                          }`}
                      >
                        {isLoading ? "Redirecting to Stripe…" : "Subscribe"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {!tenantId && (
        <p className="mt-6 text-sm text-stone-500">
          Select a business in Home or Businesses to subscribe to a plan.
        </p>
      )}
    </div>
  );
}

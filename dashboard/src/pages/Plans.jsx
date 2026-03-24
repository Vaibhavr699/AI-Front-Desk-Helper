import { useState, useEffect } from "react";
import { getPlans, getTenant, createCheckout, openBillingPortal, getSubscriptionStatus } from "../api";
import { Loading } from "../components";
import confetti from "canvas-confetti";

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
  const [hasFiredConfetti, setHasFiredConfetti] = useState(false);

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
          { id: "basic", name: "Basic", tagline: "AI Front Desk Helper Starter", whoItIsFor: "Small ops", voiceMinutes: 500, smsLimit: 500, priceMonthly: 297, setupFee: 197, priceLabel: "/month", includes: [], excludes: [] },
          { id: "pro", name: "Pro", tagline: "AI Booking Assistant", whoItIsFor: "Growing teams", voiceMinutes: 1200, smsLimit: 1500, priceMonthly: 497, setupFee: 297, priceLabel: "/month", includes: [], excludes: [] },
          { id: "elite", name: "Elite", tagline: "AI Sales & Follow-Up Engine", whoItIsFor: "Scaling companies", voiceMinutes: 3000, smsLimit: 4000, priceMonthly: 997, setupFee: 497, priceLabel: "/month", includes: [], excludes: [] },
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

  useEffect(() => {
    if (tenant?.promo_label && tenant?.plan_overrides && !hasFiredConfetti) {
      // Check if any plan actually has an override applied to make the promo active
      const hasActiveOverride = Object.values(tenant.plan_overrides).some(
        plan => plan.monthly != null || plan.setup != null
      );
      
      if (hasActiveOverride) {
        // Fire confetti!
        const duration = 2500;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };

        const randomInRange = (min, max) => Math.random() * (max - min) + min;

        const interval = setInterval(function() {
          const timeLeft = animationEnd - Date.now();

          if (timeLeft <= 0) {
            return clearInterval(interval);
          }

          const particleCount = 50 * (timeLeft / duration);
          confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } }));
          confetti(Object.assign({}, defaults, { particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } }));
        }, 250);

        setHasFiredConfetti(true);
      }
    }
  }, [tenant, hasFiredConfetti]);

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
        Choose the right AI Front Desk Helper tier for your business. Powered by Stripe.
      </p>

      {/* Add-ons section - Moved to top for better visibility */}
      <div className="mb-10 p-6 rounded-2xl border-2 border-brand-200 bg-brand-50/30 flex flex-col sm:flex-row sm:items-center justify-between gap-6 shadow-sm">
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-stone-900 flex items-center gap-2">
              <span className="text-xl">🚀</span>
              New: Customer Nurturing & Referral Add-on
            </h3>
            {tenant?.has_nurturing_referral && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200 uppercase tracking-wider">
                Active
              </span>
            )}
          </div>
          <p className="text-sm text-stone-600 mt-1 max-w-2xl">
            Automated follow-ups, referral requests, and AI re-engagement calls to boost your revenue. **$99/month.** Included free on Elite.
          </p>
        </div>
        <div className="shrink-0">
          {tenant?.has_nurturing_referral ? (
            <div className="flex items-center gap-2 text-emerald-600 font-bold bg-white px-4 py-2 rounded-xl border border-emerald-200 shadow-sm">
              <span className="text-lg">✨</span>
              <span>Enabled</span>
            </div>
          ) : (
            <div className="flex flex-col items-center sm:items-end gap-3">
              {tenantId ? (
                <button
                  type="button"
                  onClick={() => handleSelectPlan("nurturing_addon")}
                  disabled={checkoutLoading === "nurturing_addon" || currentPlanId === "elite"}
                  className="w-full sm:w-auto px-8 py-3 rounded-xl text-sm font-black uppercase tracking-wider bg-stone-900 text-white hover:bg-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-stone-600 border border-stone-800 transition-all shadow-xl shadow-stone-200 disabled:opacity-60 disabled:shadow-none"
                >
                  {currentPlanId === "elite" ? "Included in Elite" : checkoutLoading === "nurturing_addon" ? "Redirecting…" : "Add to Plan — $99/mo"}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-sm font-bold bg-stone-100 text-stone-400 border border-stone-200 cursor-default"
                >
                  Login to add
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Subscription status banner */}
      {tenantId && (
        <div className="mb-6 rounded-xl border border-stone-200 bg-white shadow-sm p-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              {isSubscribed && (
                <p className="text-sm font-medium text-stone-700">
                  Current plan:{" "}
                  <span className="text-stone-900 capitalize font-semibold">{currentPlanId}</span>
                </p>
              )}
              <div className={`flex items-center gap-2 ${isSubscribed ? "mt-1" : ""}`}>
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

          const originalMonthly = plan.priceMonthly ?? (plan.id === "basic" ? 297 : plan.id === "pro" ? 497 : 997);
          const originalSetup = plan.setupFee ?? (plan.id === "basic" ? 197 : plan.id === "pro" ? 297 : 497);
          
          let displayMonthly = originalMonthly;
          let displaySetup = originalSetup;
          let hasMonthlyOverride = false;
          let hasSetupOverride = false;
          
          if (tenant?.plan_overrides && tenant.plan_overrides[plan.id]) {
            const planOverrides = tenant.plan_overrides[plan.id];
            
            if (planOverrides.monthly != null) {
                displayMonthly = planOverrides.monthly / 100;
                hasMonthlyOverride = true;
            }
            if (planOverrides.setup != null) {
                displaySetup = planOverrides.setup / 100;
                hasSetupOverride = true;
            }
          }
          
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
                {tenant?.promo_label && (hasMonthlyOverride || hasSetupOverride) && (
                   <div className="mt-4 relative p-3 rounded-lg border-2 border-dashed border-amber-300 bg-gradient-to-br from-amber-50 to-orange-50 shadow-sm overflow-hidden group">
                     <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full border-r-2 border-dashed border-amber-300"></div>
                     <div className="absolute -right-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-white rounded-full border-l-2 border-dashed border-amber-300"></div>

                     <div className="relative flex items-center justify-center gap-2">
                       <span className="text-lg">🎟️</span>
                       <span className="text-xs font-black text-amber-700 uppercase tracking-widest text-center">
                         {tenant.promo_label}
                       </span>
                     </div>
                   </div>
                )}
                <h2 className="mt-2 text-lg font-semibold text-stone-900">
                  {plan.name || plan.id}
                </h2>
                <p className="text-sm text-stone-600 mt-0.5">
                  {plan.tagline || (plan.id === "basic" ? "AI Front Desk Helper Starter" : plan.id === "pro" ? "AI Booking Assistant" : "AI Sales & Follow-Up Engine")}
                </p>
                
                <div className="mt-4 flex items-baseline gap-1">
                  {hasMonthlyOverride ? (
                    <div className="flex flex-col">
                      <div className="flex items-baseline gap-2">
                         <span className="text-2xl font-bold text-emerald-600">
                           ${displayMonthly}
                         </span>
                         <span className="text-sm font-semibold text-emerald-600 tracking-wide uppercase">Offer price</span>
                      </div>
                      <div className="flex items-center gap-1 mt-1">
                        <span className="text-sm text-stone-400 line-through decoration-stone-300">
                          ${originalMonthly}
                        </span>
                        <span className="text-sm text-stone-500">{plan.priceLabel ?? "/month"}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-2xl font-bold text-stone-900">
                        ${displayMonthly}
                      </span>
                      <span className="text-sm text-stone-500">{plan.priceLabel ?? "/month"}</span>
                    </>
                  )}
                </div>
                <p className="mt-1 text-xs font-semibold text-brand-600 flex items-center gap-1.5">
                  {hasSetupOverride && (
                     <span className="text-stone-400 line-through decoration-stone-300">${originalSetup}</span>
                  )}
                  {displaySetup === 0 ? "No setup fee" : `+$${displaySetup} setup fee`}
                </p>
                <div className="mt-3 flex gap-4 text-sm">
                  <span className="text-stone-600">
                    <span className="font-medium text-stone-900">{plan.voiceMinutes ?? (plan.id === "basic" ? 500 : plan.id === "pro" ? 1200 : 3000)}</span> voice min
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

      {/* Add-ons section was here, moved to top */}

      {!tenantId && (
        <p className="mt-6 text-sm text-stone-500">
          Select a business in Home or Businesses to subscribe to a plan.
        </p>
      )}
    </div>
  );
}

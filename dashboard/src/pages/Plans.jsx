import { useState, useEffect } from "react";
import { getPlans, getTenant, createCheckout, openBillingPortal, getSubscriptionStatus } from "../api";
import { Loading } from "../components";
import confetti from "canvas-confetti";
import { Check, X, Sparkles, Rocket, Crown, ArrowRight, ShieldCheck, Zap, Star } from "lucide-react";

const PLAN_EMOJI = { basic: "🥉", pro: "🥈", elite: "🥇" };
const STATUS_LABELS = {
  active:   { text: "Active",          color: "text-emerald-700 bg-emerald-50 border-emerald-200" },
  trialing: { text: "Trial",           color: "text-blue-700 bg-blue-50 border-blue-200"          },
  past_due: { text: "Past Due",        color: "text-amber-700 bg-amber-50 border-amber-200"        },
  canceled: { text: "Canceled",        color: "text-red-700 bg-red-50 border-red-200"              },
  inactive: { text: "No subscription", color: "text-stone-600 bg-stone-50 border-stone-200"        },
};

const ANNUAL_PRICES = {
  basic: { monthly: 248, total: 2976,  savings: 588  },
  pro:   { monthly: 414, total: 4968,  savings: 996  },
  elite: { monthly: 831, total: 9972,  savings: 1992 },
};

const API_BASE = import.meta.env.VITE_API_URL || "";
const token = () => localStorage.getItem("token");
const hdrs = () => ({ Authorization: `Bearer ${token()}`, "Content-Type": "application/json" });

export default function Plans({ tenantId }) {
  const [plans, setPlans] = useState([]);
  const [tenant, setTenant] = useState(null);
  const [subStatus, setSubStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [checkoutLoading, setCheckoutLoading] = useState(null);
  const [message, setMessage] = useState("");
  const [hasFiredConfetti, setHasFiredConfetti] = useState(false);
  const [annual, setAnnual] = useState(true);
  const [reviewsAddonLoading, setReviewsAddonLoading] = useState(false);

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
      .catch(() => {
        setPlans([
          { id: "basic", name: "Basic", tagline: "AI Front Desk Starter", whoItIsFor: "Small ops", voiceMinutes: 500, smsLimit: 500, priceMonthly: 297, setupFee: 197, priceLabel: "/month", includes: ["24/7 Call Answering", "Custom AI Voice Agent", "Basic Call Forwarding"], excludes: ["CRM Integration", "Advanced Analytics"] },
          { id: "pro",   name: "Pro",   tagline: "AI Booking Assistant",  whoItIsFor: "Growing teams", voiceMinutes: 1200, smsLimit: 1500, priceMonthly: 497, setupFee: 297, priceLabel: "/month", includes: ["Everything in Basic", "Calendar Integration", "Lead Qualifying", "CRM Webhooks"], excludes: ["Follow-Up Sequences"] },
          { id: "elite", name: "Elite", tagline: "AI Sales & Follow-Up Engine", whoItIsFor: "Scaling companies", voiceMinutes: 3000, smsLimit: 4000, priceMonthly: 997, setupFee: 497, priceLabel: "/month", includes: ["Everything in Pro", "Customer Nurturing Add-on FREE", "Dedicated Account Manager", "Priority Support"], excludes: [] },
        ]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!tenantId) { setTenant(null); setSubStatus(null); return; }
    getTenant(tenantId).then(setTenant).catch(() => setTenant(null));
    getSubscriptionStatus(tenantId).then(setSubStatus).catch(() => setSubStatus(null));
  }, [tenantId]);

  useEffect(() => {
    if (tenant?.promo_label && tenant?.plan_overrides && !hasFiredConfetti) {
      const hasActiveOverride = Object.values(tenant.plan_overrides).some(p => p.monthly != null || p.setup != null);
      if (hasActiveOverride) {
        const duration = 2500;
        const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 100 };
        const randomInRange = (min, max) => Math.random() * (max - min) + min;
        const interval = setInterval(() => {
          const timeLeft = animationEnd - Date.now();
          if (timeLeft <= 0) return clearInterval(interval);
          const particleCount = 50 * (timeLeft / duration);
          confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 } });
          confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 } });
        }, 250);
        setHasFiredConfetti(true);
      }
    }
  }, [tenant, hasFiredConfetti]);

  async function handleSelectPlan(planId) {
    if (!tenantId) return;
    setError(""); setMessage(""); setCheckoutLoading(planId);
    try {
      const result = await createCheckout(tenantId, planId, undefined, annual ? "annual" : "monthly");
      if (result.url) window.location.href = result.url;
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
      if (result.url) window.location.href = result.url;
    } catch (e) { setError(e.message); }
  }

  async function handleReviewsAddon() {
    if (!tenantId) return;
    setReviewsAddonLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/reviews/subscribe?tenant_id=${tenantId}`, {
        method: "POST", headers: hdrs(),
      });
      const data = await res.json();
      if (data.url) window.location.href = data.url;
    } catch { setError("Failed to start checkout. Please try again."); }
    finally { setReviewsAddonLoading(false); }
  }

  if (loading) return <div className="px-0"><Loading fullScreen={false} message="Loading plans…" /></div>;

  const currentPlanId = (tenant?.plan || "basic").toLowerCase();
  const status = STATUS_LABELS[subStatus?.subscription_status] || STATUS_LABELS.inactive;
  const isSubscribed = subStatus?.subscription_status === "active" || subStatus?.subscription_status === "trialing";
  const isElite = currentPlanId === "elite";
  const hasReviewsAddon = isElite || tenant?.plan_overrides?.reviews || tenant?.plan_overrides?.reviews_addon;

  return (
    <div className="px-0">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-1">Plans</h1>
        <p className="text-sm text-stone-500">Scale your business with an AI front desk that works 24/7 without taking vacations.</p>
      </div>

      {message && (
        <div className="mb-6 bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-center gap-3 font-medium">
          <Sparkles className="w-5 h-5 text-emerald-500" />{message}
        </div>
      )}
      {error && !plans.length && <div className="mb-6 text-red-600 font-medium">{error}</div>}

      {/* Subscription status banner */}
      {tenantId && (
        <div className="mb-8 bg-white rounded-xl border border-stone-200 p-5 flex items-center justify-between flex-wrap gap-4 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-stone-50 border border-stone-200 shadow-sm flex items-center justify-center text-stone-600">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Current Plan</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-lg font-bold text-stone-900 capitalize leading-none">{isSubscribed ? currentPlanId : "None"}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border ${status.color}`}>{status.text}</span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isSubscribed && (
              <div className="text-right hidden sm:block">
                {subStatus?.cancel_at_period_end ? (
                  <p className="text-sm text-amber-600 font-medium">Cancels at period end</p>
                ) : subStatus?.current_period_end ? (
                  <p className="text-sm text-stone-500">Renews on <span className="font-medium text-stone-900">{new Date(subStatus.current_period_end * 1000).toLocaleDateString()}</span></p>
                ) : null}
              </div>
            )}
            {isSubscribed && (
              <button onClick={handleManageSubscription} className="px-4 py-2 bg-white border border-stone-200 text-stone-700 font-bold text-sm rounded-lg hover:bg-stone-50 shadow-sm transition-all flex items-center gap-2">
                Manage Billing <ArrowRight className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Billing toggle */}
      <div className="flex justify-center mb-8">
        <div className="inline-flex items-center gap-4 bg-stone-100 rounded-xl p-1.5 border border-stone-200">
          <button onClick={() => setAnnual(false)} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all ${!annual ? "bg-white text-stone-900 shadow-sm border border-stone-200" : "text-stone-500 hover:text-stone-700"}`}>
            Monthly
          </button>
          <button onClick={() => setAnnual(true)} className={`px-5 py-2 rounded-lg text-sm font-bold transition-all flex items-center gap-2 ${annual ? "bg-emerald-500 text-white shadow-sm" : "text-stone-500 hover:text-stone-700"}`}>
            Annual
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-md ${annual ? "bg-white/20 text-white" : "bg-emerald-100 text-emerald-700"}`}>2 MONTHS FREE</span>
          </button>
        </div>
      </div>

      {annual && <p className="text-center text-sm text-emerald-600 font-medium mb-6 -mt-2">💰 Save up to $1,992/yr — billed as one annual payment</p>}

      {/* ── Nurturing Add-on Banner ── */}
      <div className="mb-6 relative overflow-hidden rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white shadow-sm group transition-all duration-300">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-indigo-500 blur-[80px] opacity-10 rounded-full"></div>
        <div className="p-6 relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1 text-center md:text-left">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mb-3 rounded-md bg-indigo-100/50 border border-indigo-200 text-indigo-700 text-xs font-bold uppercase tracking-wider">
              <Zap className="w-3.5 h-3.5" /> Optional Add-on
            </div>
            <h3 className="text-xl font-bold text-stone-900 mb-2">Customer Nurturing & Referrals</h3>
            <p className="text-sm text-stone-500 max-w-2xl leading-relaxed">
              Unlock automated post-service follow-ups, intelligent referral requests, and AI re-engagement calls to dramatically boost your lifetime revenue.{" "}
              <strong className="text-stone-800">Included free on Elite.</strong>
            </p>
          </div>
          <div className="shrink-0 flex flex-col items-center gap-3 border-t w-full md:border-t-0 md:border-l border-indigo-100 pt-5 md:pt-0 md:pl-8 md:w-auto">
            <div className="text-center">
              <span className="text-2xl font-black text-stone-900">$99</span>
              <span className="text-stone-500 font-medium text-sm ml-1">/mo</span>
            </div>
            {tenant?.has_nurturing_referral ? (
              <div className="flex items-center justify-center gap-1.5 bg-emerald-500 text-white w-full px-4 py-2 rounded-lg text-sm font-bold shadow-sm">
                <Check className="w-4 h-4" /> Enabled
              </div>
            ) : (
              <button
                type="button"
                onClick={() => handleSelectPlan("nurturing_addon")}
                disabled={checkoutLoading === "nurturing_addon" || isElite || !tenantId}
                className="w-full px-6 py-2 rounded-lg text-sm font-bold bg-stone-900 text-white hover:bg-black transition-all shadow-md disabled:opacity-50 min-w-[160px]"
              >
                {!tenantId ? "Login to add" : isElite ? "Included in Elite" : checkoutLoading === "nurturing_addon" ? "Redirecting…" : "Add to Plan"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Google Reviews Add-on Banner ── */}
      <div className="mb-10 relative overflow-hidden rounded-2xl border border-amber-100 bg-gradient-to-br from-amber-50 to-white shadow-sm group transition-all duration-300">
        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-amber-400 blur-[80px] opacity-10 rounded-full"></div>
        <div className="p-6 relative z-10 flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex-1 text-center md:text-left">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 mb-3 rounded-md bg-amber-100/50 border border-amber-200 text-amber-700 text-xs font-bold uppercase tracking-wider">
              <Star className="w-3.5 h-3.5" /> Optional Add-on
            </div>
            <h3 className="text-xl font-bold text-stone-900 mb-2">AI Google Review Responses</h3>
            <p className="text-sm text-stone-500 max-w-2xl leading-relaxed">
              Auto-detect new Google reviews every 6 hours, generate SEO-optimized AI response drafts, and post them to Google with one click.{" "}
              <strong className="text-stone-800">Included free on Elite.</strong>
            </p>
            <div className="flex flex-wrap gap-3 mt-3 justify-center md:justify-start">
              {["Auto-detect new reviews", "AI draft responses", "One-click post to Google", "SEO-optimized"].map(f => (
                <span key={f} className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-1 rounded-md">
                  <Check className="w-3 h-3" /> {f}
                </span>
              ))}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-center gap-3 border-t w-full md:border-t-0 md:border-l border-amber-100 pt-5 md:pt-0 md:pl-8 md:w-auto">
            <div className="text-center">
              <span className="text-2xl font-black text-stone-900">$29</span>
              <span className="text-stone-500 font-medium text-sm ml-1">/mo</span>
            </div>
            {hasReviewsAddon ? (
              <div className="flex items-center justify-center gap-1.5 bg-emerald-500 text-white w-full px-4 py-2 rounded-lg text-sm font-bold shadow-sm">
                <Check className="w-4 h-4" /> {isElite ? "Included in Elite" : "Enabled"}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleReviewsAddon}
                disabled={reviewsAddonLoading || !tenantId}
                className="w-full px-6 py-2 rounded-lg text-sm font-bold bg-amber-500 text-white hover:bg-amber-600 transition-all shadow-md disabled:opacity-50 min-w-[160px]"
              >
                {!tenantId ? "Login to add" : reviewsAddonLoading ? "Redirecting…" : "Add for $29/mo →"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
        {(plans.length ? plans : [{ id: "basic" }, { id: "pro" }, { id: "elite" }]).map((plan) => {
          const isCurrent = currentPlanId === (plan.id || "").toLowerCase();
          const isLoading = checkoutLoading === plan.id;
          const isPro = plan.id === "pro";
          const isPlanElite = plan.id === "elite";
          const isLocation = tenant?.business_type === "location";

          const originalMonthly = plan.priceMonthly ?? (plan.id === "basic" ? 297 : plan.id === "pro" ? 497 : 997);
          const originalSetup = isLocation ? 197 : (plan.setupFee ?? (plan.id === "basic" ? 197 : plan.id === "pro" ? 297 : 497));

          let displayMonthly = originalMonthly;
          let displaySetup = originalSetup;
          let hasMonthlyOverride = false;
          let hasSetupOverride = false;

          if (tenant?.plan_overrides?.[plan.id]) {
            const ov = tenant.plan_overrides[plan.id];
            if (ov.monthly != null) { displayMonthly = ov.monthly / 100; hasMonthlyOverride = true; }
            if (ov.setup != null)   { displaySetup = ov.setup / 100;     hasSetupOverride = true;   }
          }

          const annualData = ANNUAL_PRICES[plan.id];
          const showAnnual = annual && annualData && !hasMonthlyOverride;
          const shownMonthly = showAnnual ? annualData.monthly : displayMonthly;

          return (
            <div
              key={plan.id}
              className={`relative rounded-2xl flex flex-col transition-all duration-300 ${
                isCurrent
                  ? "bg-brand-50/20 border-2 border-brand-400"
                  : isPro
                    ? "bg-white border-2 border-indigo-400 shadow-xl shadow-indigo-100/40 z-10"
                    : "bg-white border border-stone-200 shadow-sm hover:shadow-md hover:border-stone-300"
              }`}
            >
              {isPro && !isCurrent && (
                <div className="absolute -top-3.5 inset-x-0 flex justify-center">
                  <span className="bg-gradient-to-r from-indigo-500 to-blue-500 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-sm">Most Popular</span>
                </div>
              )}
              {isCurrent && (
                <div className="absolute -top-3.5 inset-x-0 flex justify-center">
                  <span className="bg-stone-800 text-white text-[10px] font-black uppercase tracking-widest px-3 py-1 rounded-full shadow-sm">Current Plan</span>
                </div>
              )}

              <div className="p-6">
                <div className="flex items-center justify-between mb-2">
                  <h2 className={`text-lg font-black ${isPro ? "text-indigo-600" : isPlanElite ? "text-amber-600" : "text-stone-900"}`}>
                    {plan.name || plan.id}
                  </h2>
                  <span className="text-lg px-2 py-0.5 bg-stone-100 rounded-md">
                    {isPlanElite ? <Crown className="w-4 h-4 text-amber-500" /> : PLAN_EMOJI[plan.id]}
                  </span>
                </div>

                <p className="text-sm text-stone-500 min-h-[3.5rem] mb-5 leading-relaxed">
                  {plan.tagline || (plan.id === "basic" ? "Essential AI receptionist to handle missed calls." : plan.id === "pro" ? "Growth engine to qualify leads and book appointments." : "Complete autonomous sales engine with nurturing.")}
                </p>

                {tenant?.promo_label && (hasMonthlyOverride || hasSetupOverride) && (
                  <div className="mb-4 flex items-center justify-center gap-1 px-2 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                    <Sparkles className="w-3 h-3" />{tenant.promo_label}
                  </div>
                )}

                <div className="flex items-baseline gap-1" style={{ minHeight: "48px" }}>
                  {hasMonthlyOverride ? (
                    <div className="flex flex-col">
                      <div className="flex items-baseline gap-1">
                        <span className="text-xs font-bold text-emerald-600 tracking-wide uppercase mr-1">Offer</span>
                        <span className="text-3xl font-black text-emerald-600">${displayMonthly}</span>
                        <span className="text-stone-500 font-medium text-sm">/mo</span>
                      </div>
                      <div className="flex items-center mt-0.5">
                        <span className="text-xs text-stone-400 font-medium line-through decoration-stone-300">${originalMonthly}/mo Orig</span>
                      </div>
                    </div>
                  ) : showAnnual ? (
                    <div className="flex flex-col">
                      <div className="flex items-baseline gap-1">
                        <span className="text-3xl font-black text-stone-900">${annualData.monthly}</span>
                        <span className="text-stone-500 font-medium text-sm">/mo</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-stone-400 line-through">${originalMonthly}/mo</span>
                        <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">SAVE ${annualData.savings}</span>
                      </div>
                    </div>
                  ) : (
                    <>
                      <span className="text-3xl font-black text-stone-900">${displayMonthly}</span>
                      <span className="text-stone-500 font-medium text-sm">{plan.priceLabel ?? "/mo"}</span>
                    </>
                  )}
                </div>

                <p className="mt-2 text-xs font-semibold text-stone-500 h-4">
                  {showAnnual ? (
                    <span className="text-stone-400">Billed as ${annualData.total.toLocaleString()}/yr</span>
                  ) : hasSetupOverride ? (
                    <span className="flex items-center gap-1.5">
                      <span className="line-through decoration-stone-300">${originalSetup} setup</span>
                      <span className="text-emerald-600">{displaySetup === 0 ? "Free setup" : `$${displaySetup} setup`}</span>
                    </span>
                  ) : (
                    <span>{displaySetup === 0 ? "No setup fee" : `+$${displaySetup} one-time setup`}</span>
                  )}
                </p>

                <div className="mt-5 p-3 rounded-xl bg-stone-50 border border-stone-100 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider mb-0.5">Voice</p>
                    <p className="text-stone-900 font-bold text-sm">{plan.voiceMinutes ?? (plan.id === "basic" ? 500 : plan.id === "pro" ? 1200 : 3000)} <span className="text-[10px] font-medium text-stone-500">min</span></p>
                  </div>
                  <div>
                    <p className="text-[10px] text-stone-400 font-bold uppercase tracking-wider mb-0.5">SMS</p>
                    <p className="text-stone-900 font-bold text-sm">{plan.smsLimit ?? (plan.id === "basic" ? 500 : plan.id === "pro" ? 1500 : 4000)} <span className="text-[10px] font-medium text-stone-500">msg</span></p>
                  </div>
                </div>

                <div className="mt-6">
                  {tenantId ? (
                    isCurrent && isSubscribed ? (
                      <button disabled className="w-full py-2.5 rounded-lg text-sm font-bold bg-stone-100 text-stone-400 border border-stone-200 cursor-default shadow-inner">Current Plan</button>
                    ) : isCurrent && !isSubscribed ? (
                      <button onClick={() => handleSelectPlan(plan.id)} disabled={isLoading} className="w-full py-2.5 rounded-lg text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 transition-all shadow-md">
                        {isLoading ? "Redirecting…" : "Reactivate Plan"}
                      </button>
                    ) : isSubscribed ? (
                      <button onClick={handleManageSubscription} className="w-full py-2.5 rounded-lg text-sm font-bold bg-stone-100 text-stone-700 hover:bg-stone-200 transition-all border border-stone-200">
                        Change to {plan.name}
                      </button>
                    ) : (
                      <button onClick={() => handleSelectPlan(plan.id)} disabled={isLoading}
                        className={`w-full py-2.5 rounded-lg text-sm font-bold transition-all shadow-sm ${isPro ? "bg-indigo-600 text-white hover:bg-indigo-500" : "bg-stone-900 text-white hover:bg-stone-800"}`}
                      >
                        {isLoading ? "Redirecting…" : annual ? `Get Started – $${annualData?.monthly ?? shownMonthly}/mo` : "Get Started"}
                      </button>
                    )
                  ) : (
                    <button disabled className="w-full py-2.5 rounded-lg text-sm font-bold bg-stone-100 text-stone-400 border border-stone-200">Login to Subscribe</button>
                  )}
                </div>
              </div>

              <div className="p-6 border-t border-stone-100 flex-1 bg-stone-50 rounded-b-2xl">
                <p className="text-xs font-bold text-stone-900 mb-3">
                  {isPlanElite ? "Everything in Pro, plus:" : isPro ? "Everything in Basic, plus:" : "Includes:"}
                </p>
                <ul className="space-y-3 text-sm">
                  {(plan.includes || ["24/7 AI Receptionist", "Call Transferring", "SMS Responses", "Web Dashboard"]).map((item, i) => (
                    <li key={i} className="flex gap-2.5 text-stone-600 leading-snug">
                      <div className="shrink-0 mt-0.5 bg-emerald-100 text-emerald-600 w-5 h-5 rounded-full flex items-center justify-center">
                        <Check className="w-3 h-3" strokeWidth={3} />
                      </div>
                      <span className={item.includes("Customer Nurturing") ? "font-bold text-stone-900" : ""}>{item}</span>
                    </li>
                  ))}
                  {(plan.excludes || []).map((item, i) => (
                    <li key={`ex-${i}`} className="flex gap-2.5 text-stone-400 leading-snug opacity-75">
                      <div className="shrink-0 mt-0.5 text-stone-300 w-5 h-5 rounded-full flex items-center justify-center">
                        <X className="w-3.5 h-3.5" />
                      </div>
                      <span className="line-through decoration-stone-300 decoration-1">{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

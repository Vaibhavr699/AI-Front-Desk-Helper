import React, { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";

/**
 * Public franchisee invite acceptance page.
 *
 * Mounted at /franchisee-invite/:token (PUBLIC route — no auth).
 *
 * Flow:
 *   1. On mount, GET /api/franchisee/invite/:token → load franchisor branding,
 *      location details, available plans
 *   2. Show error states cleanly: NOT_FOUND, EXPIRED, ALREADY_ACCEPTED, etc.
 *   3. Render franchisor-branded welcome page with plan picker + interval toggle
 *   4. On confirm, POST /api/franchisee/invite/:token/checkout → get Stripe URL
 *      → window.location.href to Stripe
 *   5. After Stripe checkout, franchisee lands on /welcome?success=1&tenant_id=...
 *      (handled by Welcome.jsx)
 */

// Build the API base URL the same way api.js does — direct fetch since this
// page is PUBLIC and we don't want the api() helper's auth handling.
let API_BASE = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
if (API_BASE && !/^https?:\/\//i.test(API_BASE)) {
  API_BASE = "http://" + API_BASE.replace(/^https?:(?!\/\/)/i, "").replace(/^\/+/, "");
}

async function publicFetch(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data?.error || res.statusText || "Request failed");
    err.code = data?.code;
    err.status = res.status;
    throw err;
  }
  return data;
}

export default function FranchiseeInvite() {
  const { token } = useParams();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [invite, setInvite] = useState(null);
  const [errorState, setErrorState] = useState(null);

  const [selectedPlan, setSelectedPlan] = useState("pro");
  const [interval, setInterval] = useState("monthly");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const loadInvite = useCallback(async () => {
    setLoading(true);
    setErrorState(null);
    try {
      const data = await publicFetch(`/api/franchisee/invite/${token}`);
      setInvite(data);
    } catch (err) {
      console.error("[FranchiseeInvite] load error:", err);
      setErrorState({ code: err.code || "UNKNOWN", message: err.message });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadInvite();
  }, [loadInvite]);

  const handleCheckout = async () => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const data = await publicFetch(`/api/franchisee/invite/${token}/checkout`, {
        method: "POST",
        body: JSON.stringify({
          plan: selectedPlan,
          interval,
          return_url: `${window.location.origin}/welcome`,
        }),
      });
      if (data?.checkout_url) {
        window.location.href = data.checkout_url;
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (err) {
      console.error("[FranchiseeInvite] checkout error:", err);
      setSubmitError(err.message || "Failed to start checkout. Please try again.");
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className="text-center py-12">
          <svg className="w-8 h-8 text-stone-400 animate-spin mx-auto mb-3" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
          <p className="text-sm text-stone-500">Loading your invite…</p>
        </div>
      </Shell>
    );
  }

  if (errorState) {
    return <ErrorView code={errorState.code} message={errorState.message} />;
  }

  if (!invite) {
    return <ErrorView code="UNKNOWN" message="Couldn't load invite" />;
  }

  const { franchisor, location, plans } = invite;
  const brandColor = franchisor?.brand_color || "#1c1917";
  const accentColor = franchisor?.accent_color || brandColor;
  const supportEmail = franchisor?.support_email || "";

  return (
    <Shell franchisor={franchisor}>
      <div className="text-center mb-10">
        <div className="text-xs font-bold text-stone-500 uppercase tracking-widest mb-3">
          You're invited to join
        </div>
        <h1 className="text-3xl sm:text-4xl font-black text-stone-900 tracking-tight mb-2">
          {franchisor?.company_name || franchisor?.name || "Your franchisor"}
        </h1>
        <p className="text-base text-stone-500">
          Setting up <span className="font-semibold text-stone-700">{location?.company_name || location?.name}</span>
        </p>
      </div>

      <div className="rounded-2xl bg-stone-50 border border-stone-200 p-6 mb-8">
        <div className="text-xs font-bold text-stone-700 uppercase tracking-wider mb-4">
          What you're getting
        </div>
        <div className="space-y-3">
          <Feature text="Your own AI front desk that answers calls 24/7, captures leads, and books estimates" />
          <Feature text="Your own dashboard with calls, leads, bookings, and metrics for your location" />
          <Feature text={`Branded under ${franchisor?.company_name || franchisor?.name} — your customers see consistent franchise identity`} />
          <Feature text="You're billed directly — your franchisor doesn't pay for or have access to your subscription" />
        </div>
      </div>

      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-xs font-bold text-stone-700 uppercase tracking-wider">
              Pick your plan
            </div>
            <p className="text-xs text-stone-500 mt-0.5">You can change this anytime from billing settings</p>
          </div>
          <IntervalToggle value={interval} onChange={setInterval} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {plans?.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              interval={interval}
              selected={selectedPlan === plan.id}
              onSelect={() => setSelectedPlan(plan.id)}
              accentColor={accentColor}
            />
          ))}
        </div>
      </div>

      {submitError && (
        <div className="mb-6 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
          {submitError}
        </div>
      )}

      <button
        type="button"
        onClick={handleCheckout}
        disabled={submitting}
        style={{ backgroundColor: brandColor }}
        className="w-full py-4 text-white text-base font-bold rounded-2xl transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2 shadow-lg"
      >
        {submitting && (
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
            <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
          </svg>
        )}
        {submitting ? "Redirecting to checkout…" : "Continue to Checkout"}
      </button>

      <p className="text-center text-xs text-stone-400 mt-4">
        Secure checkout powered by Stripe · Cancel anytime
      </p>

      {supportEmail && (
        <p className="text-center text-xs text-stone-400 mt-6">
          Questions? Contact <a href={`mailto:${supportEmail}`} className="font-semibold text-stone-600 hover:text-stone-900">{supportEmail}</a>
        </p>
      )}
    </Shell>
  );
}

function Shell({ children, franchisor }) {
  return (
    <div className="min-h-screen bg-stone-50">
      {franchisor && (
        <header className="bg-white border-b border-stone-200">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
            {franchisor.logo_url ? (
              <img
                src={franchisor.logo_url}
                alt={franchisor.company_name || franchisor.name}
                className="w-10 h-10 rounded-lg object-cover ring-1 ring-stone-200"
              />
            ) : (
              <div className="w-10 h-10 rounded-lg bg-stone-900 flex items-center justify-center text-white font-black text-xs">
                {(franchisor.company_name || franchisor.name || "?").charAt(0).toUpperCase()}
              </div>
            )}
            <div className="min-w-0">
              <div className="text-sm font-bold text-stone-900 truncate">
                {franchisor.company_name || franchisor.name}
              </div>
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">
                Franchise Onboarding
              </div>
            </div>
          </div>
        </header>
      )}
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}

function Feature({ text }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mt-0.5">
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <span className="text-sm text-stone-700 leading-relaxed">{text}</span>
    </div>
  );
}

function IntervalToggle({ value, onChange }) {
  return (
    <div className="inline-flex items-center bg-stone-100 rounded-xl p-0.5">
      <button
        type="button"
        onClick={() => onChange("monthly")}
        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all ${
          value === "monthly"
            ? "bg-white text-stone-900 shadow-sm"
            : "text-stone-500 hover:text-stone-700"
        }`}
      >
        Monthly
      </button>
      <button
        type="button"
        onClick={() => onChange("annual")}
        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all relative ${
          value === "annual"
            ? "bg-white text-stone-900 shadow-sm"
            : "text-stone-500 hover:text-stone-700"
        }`}
      >
        Annual
        <span className="absolute -top-2 -right-2 px-1.5 py-0.5 text-[9px] font-black bg-emerald-500 text-white rounded-full">
          -17%
        </span>
      </button>
    </div>
  );
}

function PlanCard({ plan, interval, selected, onSelect, accentColor }) {
  const isAnnual = interval === "annual";
  const monthly = plan.priceMonthly;
  const annualPerMonth = plan.priceAnnual;
  const displayPrice = isAnnual ? annualPerMonth : monthly;
  const annualTotal = plan.priceAnnualTotal;

  return (
    <button
      type="button"
      onClick={onSelect}
      style={selected ? { borderColor: accentColor } : {}}
      className={`text-left rounded-2xl border-2 p-5 transition-all ${
        selected
          ? "bg-white shadow-md"
          : "bg-white border-stone-200 hover:border-stone-300"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-bold text-stone-900">{plan.name}</span>
        <div
          className={`w-4 h-4 rounded-full border-2 transition-all ${
            selected ? "border-current" : "border-stone-300"
          }`}
          style={selected ? { borderColor: accentColor, backgroundColor: accentColor } : {}}
        >
          {selected && (
            <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="3" />
            </svg>
          )}
        </div>
      </div>
      <div className="text-xs text-stone-500 mb-3">{plan.tagline}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-2xl font-black text-stone-900">${displayPrice}</span>
        <span className="text-xs text-stone-500 font-semibold">/mo</span>
      </div>
      {isAnnual && annualTotal && (
        <div className="text-[10px] text-stone-400 mt-0.5">${annualTotal}/yr · 2 months free</div>
      )}
      <div className="mt-3 pt-3 border-t border-stone-100 space-y-1">
        <div className="text-[11px] text-stone-500">{plan.voiceMinutes?.toLocaleString()} voice min</div>
        <div className="text-[11px] text-stone-500">{plan.smsLimit?.toLocaleString()} SMS</div>
      </div>
    </button>
  );
}

function ErrorView({ code, message }) {
  const config =
    {
      INVITE_NOT_FOUND: {
        icon: "search",
        title: "Invite not found",
        body: "This invite link doesn't match any pending location. The link may have been used or revoked. Ask your franchisor to send a fresh invite.",
      },
      INVITE_EXPIRED: {
        icon: "clock",
        title: "Invite expired",
        body: "This invite has expired. Ask your franchisor to resend a fresh link from their dashboard.",
      },
      INVITE_ALREADY_ACCEPTED: {
        icon: "check",
        title: "Already accepted",
        body: "This invite has already been used. If you've lost access to your account, contact your franchisor or our support team.",
      },
      INVITE_ALREADY_SUBSCRIBED: {
        icon: "check",
        title: "Already subscribed",
        body: "This location already has an active subscription. If you need to log in, contact your franchisor.",
      },
      INVITE_NOT_SELF_PAYS: {
        icon: "alert",
        title: "Can't process this invite",
        body: "This location isn't configured for franchisee self-pay. Contact your franchisor to resolve.",
      },
    }[code] || {
      icon: "alert",
      title: "Something went wrong",
      body: message || "We couldn't load this invite. Please try again or contact support.",
    };

  const icons = {
    search: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />,
    clock: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />,
    check: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />,
    alert: <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />,
  };

  return (
    <Shell>
      <div className="rounded-2xl bg-white border border-stone-200 p-10 text-center shadow-sm">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-stone-100 text-stone-500 mb-4">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {icons[config.icon]}
          </svg>
        </div>
        <h1 className="text-xl font-bold text-stone-900 mb-2">{config.title}</h1>
        <p className="text-sm text-stone-500 max-w-sm mx-auto leading-relaxed">{config.body}</p>
      </div>
    </Shell>
  );
}

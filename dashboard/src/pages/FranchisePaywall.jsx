import { useEffect, useState } from "react";
import { useLocation, Navigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Network, CreditCard, AlertCircle, LogOut } from "lucide-react";
import { LumaSpin } from "../components/ui/luma-spin";
import { getUser, getTenant, createFranchiseCheckout, logout } from "../api";

/**
 * Franchise Zee Paywall — Apr 29, 2026 (Phase 6).
 *
 * Shown to franchise zees who haven't yet subscribed. Loads the zee's tenant
 * record, shows the negotiated monthly rate (or "your franchise rate" if no
 * override), and a single primary CTA that fires Stripe checkout.
 *
 * Routing logic in App.jsx redirects franchise zees here when:
 *   tenant.plan === 'franchise' AND subscription_status !== 'active' AND
 *   plan_overrides.billing_mode !== 'manual'.
 *
 * Manual-billing zees bypass this entirely and reach the dashboard normally.
 *
 * URL params:
 *   ?canceled=1 — zee came back from Stripe checkout without paying. Friendly retry.
 */
export default function FranchisePaywall() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const canceled = params.get("canceled") === "1";

  const user = getUser();
  const [tenant, setTenant] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  // Load active tenant
  useEffect(() => {
    if (!user?.tenant_id) {
      setLoadError("No tenant assigned to this account.");
      setLoading(false);
      return;
    }
    getTenant(user.tenant_id)
      .then((t) => setTenant(t))
      .catch((e) => setLoadError(e.message || "Failed to load account"))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If user isn't logged in, bounce to /login
  if (!user) return <Navigate to="/login" replace />;

  // Compute the zee's negotiated monthly rate from plan_overrides.franchise.monthly
  const overrideCents = tenant?.plan_overrides?.franchise?.monthly;
  const hasOverride = overrideCents != null && overrideCents > 0;
  const monthlyDisplay = hasOverride
    ? `$${(overrideCents / 100).toFixed(0)}`
    : "$225"; // franchise tier default — matches lib/plans.js

  async function handleSubscribe() {
    setSubmitError(null);
    setSubmitting(true);
    try {
      const result = await createFranchiseCheckout(user.tenant_id);
      if (result?.url) {
        window.location.href = result.url;
      } else {
        setSubmitError("Stripe checkout could not be initiated. Try again.");
        setSubmitting(false);
      }
    } catch (err) {
      setSubmitError(err.message || "Failed to start checkout");
      setSubmitting(false);
    }
  }

  function handleLogout() {
    logout().finally(() => {
      window.location.href = "/login";
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <LumaSpin />
          <p className="text-sm text-slate-400 mt-4 font-medium">Loading your account…</p>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <div className="bg-white rounded-3xl shadow-xl border border-slate-100 max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6 border border-red-100/50">
            <AlertCircle size={32} />
          </div>
          <h2 className="text-xl font-black text-slate-900 mb-2">Couldn't load your account</h2>
          <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">{loadError}</p>
          <button
            onClick={handleLogout}
            className="w-full bg-slate-900 hover:bg-black text-white py-3 rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-xl shadow-slate-900/10"
          >
            Sign out
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-6">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-lg w-full overflow-hidden"
      >
        <div className="p-10">
          <div className="w-16 h-16 bg-orange-50 text-orange-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-orange-100/50">
            <Network size={32} />
          </div>

          <h1 className="text-2xl font-black text-slate-900 text-center mb-2">
            Welcome, {tenant?.company_name || tenant?.name}!
          </h1>
          <p className="text-sm text-slate-500 text-center font-medium leading-relaxed mb-8">
            One last step — activate your subscription to unlock your dashboard, AI receptionist, and all franchise features.
          </p>

          {canceled && !submitError && (
            <div className="mb-6 p-4 bg-amber-50/60 border border-amber-200 rounded-2xl">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-900 font-medium leading-relaxed">
                  No worries — checkout was canceled. You can try again whenever you're ready.
                </div>
              </div>
            </div>
          )}

          {submitError && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl text-xs font-bold text-red-600">
              {submitError}
            </div>
          )}

          {/* Pricing card */}
          <div className="mb-8 p-6 bg-gradient-to-br from-slate-900 to-slate-800 text-white rounded-2xl shadow-lg">
            <div className="flex items-baseline justify-center gap-1 mb-2">
              <span className="text-5xl font-black tracking-tight">{monthlyDisplay}</span>
              <span className="text-sm text-slate-400 font-medium">/month</span>
            </div>
            <div className="text-[10px] text-center text-slate-400 font-black uppercase tracking-widest">
              {hasOverride ? "Your franchise rate" : "Franchise tier"}
            </div>
            <div className="mt-5 pt-5 border-t border-white/10">
              <ul className="space-y-2 text-xs text-slate-300 font-medium">
                <li className="flex items-start gap-2">
                  <span className="text-orange-400 shrink-0">✓</span>
                  <span>24/7 AI receptionist + missed-call follow-up</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-orange-400 shrink-0">✓</span>
                  <span>Website chat widget + Facebook Messenger</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-orange-400 shrink-0">✓</span>
                  <span>Google Calendar booking + automated reminders</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-orange-400 shrink-0">✓</span>
                  <span>Lead tracking, follow-ups, revenue reporting</span>
                </li>
              </ul>
            </div>
          </div>

          <button
            onClick={handleSubscribe}
            disabled={submitting}
            className="w-full bg-orange-600 hover:bg-orange-700 text-white py-4 rounded-2xl text-sm font-black uppercase tracking-wider transition-all shadow-xl shadow-orange-600/20 flex items-center justify-center gap-2 disabled:opacity-60"
          >
            {submitting ? (
              <>
                <LumaSpin className="w-4 h-4 border-white" />
                Redirecting to checkout…
              </>
            ) : (
              <>
                <CreditCard size={16} />
                Subscribe — {monthlyDisplay}/month
              </>
            )}
          </button>

          <p className="text-[11px] text-slate-400 text-center font-medium mt-4 leading-relaxed">
            Secure checkout powered by Stripe. Cancel anytime from your dashboard.
            <br />
            Questions? Contact your franchise corporate office.
          </p>

          <button
            onClick={handleLogout}
            className="w-full mt-6 text-slate-400 hover:text-slate-600 font-bold text-[11px] py-2 transition-all uppercase tracking-wide flex items-center justify-center gap-1.5"
          >
            <LogOut size={12} />
            Sign out
          </button>
        </div>
      </motion.div>
    </div>
  );
}

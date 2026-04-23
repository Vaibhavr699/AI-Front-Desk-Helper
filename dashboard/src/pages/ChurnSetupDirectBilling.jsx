import React, { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

export default function ChurnSetupDirectBilling() {
  const { token } = useParams();
  const [searchParams] = useSearchParams();
  const wasCanceled = searchParams.get("canceled") === "1";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);
  const [data, setData] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch(`/api/churn-public/${encodeURIComponent(token)}`);
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(body.error || "Could not load this page");
          setErrorCode(body.code || null);
        } else {
          setData(body);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Network error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [token]);

  async function handleCheckout() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/churn-public/${encodeURIComponent(token)}/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval: "monthly" }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not start checkout");
      if (body.already_active && body.redirect_url) {
        window.location.href = body.redirect_url;
        return;
      }
      if (body.checkout_url) {
        window.location.href = body.checkout_url;
        return;
      }
      throw new Error("Unexpected response from server");
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <PageShell>
        <div className="text-stone-400 text-sm text-center py-12">Loading...</div>
      </PageShell>
    );
  }

  if (errorCode === "TOKEN_EXPIRED") {
    return (
      <PageShell>
        <ErrorCard
          title="This link has expired"
          message="Your 30-day grace period has ended. Please contact support@aifrontdeskhelper.com to restore service."
          ctaLabel="Email support"
          ctaHref="mailto:support@aifrontdeskhelper.com"
        />
      </PageShell>
    );
  }

  if (error || !data) {
    return (
      <PageShell>
        <ErrorCard
          title="We couldn't find this page"
          message={error || "This link is invalid or has already been used."}
          ctaLabel="Go to login"
          ctaHref="/login"
        />
      </PageShell>
    );
  }

  const tenant = data.tenant;
  const plan = data.plan;
  const originatingResellerName = data.originating_reseller_name;
  const expiresAt = data.expires_at;

  const monthlyDollars = plan && plan.monthly_price_cents
    ? "$" + (plan.monthly_price_cents / 100).toFixed(0)
    : null;

  const daysRemaining = expiresAt
    ? Math.max(0, Math.ceil((new Date(expiresAt) - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return (
    <PageShell>
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8">
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-amber-100 mb-3">
            <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">Keep your service active</h1>
          <p className="text-sm text-stone-500 max-w-md mx-auto leading-relaxed">
            <strong className="text-stone-700">{originatingResellerName}</strong> ended their partnership with AI Front Desk Helper. To keep your service running without interruption, set up direct billing below.
          </p>
        </div>

        {wasCanceled ? (
          <div className="mb-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 text-center">
            Checkout canceled. You can try again below.
          </div>
        ) : null}

        {error ? (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        ) : null}

        <div className="rounded-xl bg-stone-50 border border-stone-200 p-5 mb-5 space-y-3">
          <Row label="Account" value={tenant.name} />
          <Row label="Email" value={tenant.primary_email} />
          <Row label="Your plan" value={(plan && plan.name) || tenant.plan} />
          {monthlyDollars ? <Row label="Price" value={monthlyDollars + "/month"} /> : null}
        </div>

        {daysRemaining !== null && daysRemaining <= 7 ? (
          <div className="mb-5 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-sm text-amber-800 text-center">
            <strong>{daysRemaining} {daysRemaining === 1 ? "day" : "days"} remaining</strong> in your grace period.
          </div>
        ) : null}

        <button
          type="button"
          onClick={handleCheckout}
          disabled={submitting}
          className="w-full px-4 py-3.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 disabled:cursor-wait rounded-lg transition-colors"
        >
          {submitting ? "Redirecting to checkout..." : "Set up direct billing"}
        </button>

        <p className="text-xs text-stone-400 text-center mt-4 leading-relaxed">
          Powered by Stripe. No setup fee. Cancel anytime.
        </p>
      </div>
    </PageShell>
  );
}

function PageShell(props) {
  return (
    <div className="min-h-screen bg-stone-100 py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <div className="text-sm font-bold text-stone-900">AI Front Desk Helper</div>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function Row(props) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-stone-500">{props.label}</span>
      <span className="font-semibold text-stone-900 text-right ml-4 truncate max-w-[60%]">{props.value}</span>
    </div>
  );
}

function ErrorCard(props) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-3">
        <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h1 className="text-xl font-bold text-stone-900 mb-2">{props.title}</h1>
      <p className="text-sm text-stone-500 mb-5 leading-relaxed">{props.message}</p>
      
        href={props.ctaHref}
        className="inline-block px-5 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
      >
        {props.ctaLabel}
      </a>
    </div>
  );
}

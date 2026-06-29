import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getResellerOverview } from "../api";

/**
 * Post-checkout landing page. Stripe redirects here after successful
 * subscription creation. We poll getResellerOverview for up to 10 seconds
 * waiting for the webhook to mark the reseller active (race buffer).
 */
export default function ResellerWelcome() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("session_id");
  const [overview, setOverview] = useState(null);
  const [polling, setPolling] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let attempts = 0;
    let cancelled = false;

    async function poll() {
      while (!cancelled && attempts < 10) {
        try {
          const ov = await getResellerOverview();
          if (ov?.tier?.tier) {
            setOverview(ov);
            setPolling(false);
            return;
          }
        } catch (_) {}
        attempts++;
        await new Promise((r) => setTimeout(r, 1000));
      }
      // Give up after 10s — show page anyway
      setPolling(false);
    }

    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  const signupUrl = overview?.reseller?.reseller_code
    ? `${window.location.origin}/reseller/${overview.reseller.reseller_code}/signup`
    : null;

  function copyLink() {
    if (!signupUrl) return;
    navigator.clipboard?.writeText(signupUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 relative">
      {/* Confetti — pure CSS, no dependency */}
      <Confetti />

      {/* Celebration hero */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 mb-4">
          <svg className="w-8 h-8 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-stone-900 mb-2">
          {polling ? "Finalizing your subscription..." : "You're all set!"}
        </h1>
        <p className="text-stone-500">
          {polling
            ? "Confirming payment with Stripe — this takes just a moment."
            : `Your ${overview?.tier?.tier_name || "reseller"} plan is active. Time to start onboarding customers.`}
        </p>
      </div>

      {/* Signup link card */}
      {signupUrl && (
        <div className="rounded-2xl bg-stone-900 text-white p-6 mb-6">
          <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-2">
            Your signup link
          </div>
          <div className="flex items-center gap-2 mb-3">
            <code className="flex-1 px-3 py-2 text-sm bg-stone-800 rounded-lg font-mono truncate">
              {signupUrl}
            </code>
            <button
              type="button"
              onClick={copyLink}
              className="px-4 py-2 text-xs font-bold text-stone-900 bg-white hover:bg-stone-100 rounded-lg transition-colors whitespace-nowrap"
            >
              {copied ? "Copied!" : "Copy link"}
            </button>
          </div>
          <p className="text-xs text-stone-400">
            Share this link with prospects. Customers who sign up here will be under your account, branded with your logo and colors.
          </p>
        </div>
      )}

      {/* Next steps */}
      <div className="rounded-2xl bg-white border border-stone-200 p-6 mb-6">
        <h2 className="text-sm font-bold text-stone-900 mb-4">Get started in 3 steps</h2>
        <ol className="space-y-4">
          <Step number={1} title="Set up your branding">
            Upload your logo and set your brand colors in Settings. Customer dashboards will show your brand.
          </Step>
          <Step number={2} title="Add your first customer">
            Add a customer manually from your dashboard, or share your signup link and let them onboard themselves.
          </Step>
          <Step number={3} title="Share your signup link">
            Paste it in emails, on your website, in ads — anywhere you reach prospects. Every signup is automatically under your account.
          </Step>
        </ol>
      </div>

      {/* Dashboard CTA */}
      <div className="text-center">
        <button
          type="button"
          onClick={() => navigate("/reseller")}
          className="inline-flex items-center gap-2 px-6 py-3 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
        >
          Go to dashboard
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </button>
      </div>

      {sessionId && (
        <div className="text-center mt-8 text-[10px] text-stone-300 font-mono">
          Session: {sessionId.slice(0, 20)}...
        </div>
      )}
    </div>
  );
}

function Step({ number, title, children }) {
  return (
    <li className="flex items-start gap-3">
      <div className="flex items-center justify-center w-7 h-7 rounded-full bg-stone-900 text-white text-xs font-bold shrink-0">
        {number}
      </div>
      <div>
        <div className="text-sm font-bold text-stone-900">{title}</div>
        <div className="text-sm text-stone-500 mt-0.5">{children}</div>
      </div>
    </li>
  );
}

/**
 * Pure-CSS confetti. 24 colored squares falling with staggered delays.
 * No external dependency, zero bundle impact.
 */
function Confetti() {
  const colors = ["#10b981", "#f59e0b", "#ef4444", "#3b82f6", "#8b5cf6", "#ec4899"];
  const pieces = Array.from({ length: 24 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 3,
    duration: 3 + Math.random() * 2,
    color: colors[i % colors.length],
    rotate: Math.random() * 360,
  }));

  return (
    <>
      <style>{`
        @keyframes confetti-fall {
          0% { transform: translateY(-20px) rotate(0deg); opacity: 1; }
          100% { transform: translateY(100vh) rotate(720deg); opacity: 0; }
        }
      `}</style>
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0" aria-hidden="true">
        {pieces.map((p) => (
          <div
            key={p.id}
            style={{
              position: "absolute",
              top: 0,
              left: `${p.left}%`,
              width: "8px",
              height: "8px",
              backgroundColor: p.color,
              transform: `rotate(${p.rotate}deg)`,
              animation: `confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
            }}
          />
        ))}
      </div>
    </>
  );
}

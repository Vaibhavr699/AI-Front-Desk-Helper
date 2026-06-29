import React, { useEffect, useState } from "react";
import { useSearchParams, Link } from "react-router-dom";

/**
 * Post-checkout welcome page.
 * Mounted at /welcome (PUBLIC route).
 *
 * After a franchisee completes Stripe checkout, the success_url from
 * lib/stripe.js's createFranchiseeInviteCheckoutSession redirects here:
 *   /welcome?success=1&tenant_id=xxx
 *
 * The Stripe webhook (handleWebhookEvent in lib/stripe.js) activates the
 * tenant in the background. By the time the user lands here, they should
 * be active. We just show a celebratory landing + CTA to log in for the
 * first time (they'll need to set a password since they don't have one yet).
 */
export default function Welcome() {
  const [searchParams] = useSearchParams();
  const success = searchParams.get("success") === "1";
  const tenantId = searchParams.get("tenant_id");
  const canceled = searchParams.get("canceled") === "1";

  const [showConfetti, setShowConfetti] = useState(false);

  useEffect(() => {
    if (success) {
      // Trigger confetti animation on mount
      setShowConfetti(true);
      const t = setTimeout(() => setShowConfetti(false), 3000);
      return () => clearTimeout(t);
    }
  }, [success]);

  if (canceled) {
    return (
      <Shell>
        <div className="rounded-2xl bg-white border border-stone-200 p-10 text-center shadow-sm">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-stone-100 text-stone-500 mb-4">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-stone-900 mb-2">Checkout cancelled</h1>
          <p className="text-sm text-stone-500 max-w-sm mx-auto mb-6">
            No worries — your invite is still valid. You can come back to it anytime within the 14-day window.
          </p>
          <p className="text-xs text-stone-400">
            If you've lost the invite link, ask your franchisor to resend it.
          </p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {/* Confetti */}
      {showConfetti && <Confetti />}

      <div className="rounded-2xl bg-white border border-stone-200 p-10 text-center shadow-sm relative overflow-hidden">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mb-5">
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h1 className="text-3xl font-black tracking-tight text-stone-900 mb-2">
          You're all set!
        </h1>
        <p className="text-base text-stone-500 max-w-md mx-auto leading-relaxed mb-8">
          Your subscription is active and your AI front desk is ready to start answering calls. Check your email for a password setup link.
        </p>

        <div className="rounded-xl bg-stone-50 border border-stone-200 p-5 mb-6 text-left">
          <div className="text-xs font-bold text-stone-700 uppercase tracking-wider mb-3">
            What happens next
          </div>
          <ol className="space-y-2.5">
            <Step number={1} text="Check your inbox for a password setup email" />
            <Step number={2} text="Set your password and log into your dashboard" />
            <Step number={3} text="Configure your phone number, business hours, and AI personality" />
            <Step number={4} text="Forward your existing business line — your AI front desk handles the rest" />
          </ol>
        </div>

        <Link
          to="/login"
          className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl transition-colors shadow-lg"
        >
          Go to Login
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </Link>

        {tenantId && (
          <p className="text-[10px] text-stone-300 font-mono mt-6">
            Account ID: {tenantId}
          </p>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-2xl">{children}</div>
    </div>
  );
}

function Step({ number, text }) {
  return (
    <li className="flex items-start gap-3">
      <span className="shrink-0 w-6 h-6 rounded-full bg-stone-900 text-white text-xs font-bold flex items-center justify-center mt-0.5">
        {number}
      </span>
      <span className="text-sm text-stone-700 leading-relaxed">{text}</span>
    </li>
  );
}

// ── Confetti — pure CSS, no library ────────────────────────────────────────
function Confetti() {
  const colors = ["#10b981", "#f59e0b", "#3b82f6", "#ec4899", "#8b5cf6"];
  const pieces = Array.from({ length: 60 }, (_, i) => ({
    id: i,
    color: colors[i % colors.length],
    left: `${Math.random() * 100}%`,
    delay: `${Math.random() * 0.5}s`,
    duration: `${2 + Math.random() * 1.5}s`,
    rotation: Math.random() * 360,
  }));

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {pieces.map((p) => (
        <div
          key={p.id}
          className="absolute top-0 w-2 h-3 opacity-90"
          style={{
            left: p.left,
            backgroundColor: p.color,
            transform: `rotate(${p.rotation}deg)`,
            animation: `confetti-fall ${p.duration} linear ${p.delay} forwards`,
          }}
        />
      ))}
      <style>{`
        @keyframes confetti-fall {
          to {
            transform: translateY(110vh) rotate(720deg);
            opacity: 0;
          }
        }
      `}</style>
    </div>
  );
}

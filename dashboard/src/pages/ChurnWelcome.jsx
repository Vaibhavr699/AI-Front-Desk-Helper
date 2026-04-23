import React from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Stripe success URL after the customer completes direct-billing checkout.
 * Their grace token is cleared by the server-side webhook handler in
 * lib/stripe.js (kicked off by metadata.type='churn_direct_billing').
 *
 * This page just confirms the transition + gives them a path back into
 * their dashboard. We don't try to log them in automatically — they should
 * sign in fresh so the auth state is clean.
 *
 * Apr 23, 2026 — Phase 3 Reseller Ops Item 3.
 */
export default function ChurnWelcome() {
  const [searchParams] = useSearchParams();
  const alreadyActive = searchParams.get("already_active") === "1";

  return (
    <div className="min-h-screen bg-stone-100 py-12 px-4">
      <div className="max-w-md mx-auto">
        <div className="text-center mb-6">
          <div className="text-sm font-bold text-stone-900">AI Front Desk Helper</div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 mb-4">
            <svg className="w-7 h-7 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">
            {alreadyActive ? "You're all set!" : "Welcome back!"}
          </h1>
          <p className="text-sm text-stone-500 mb-6 leading-relaxed">
            {alreadyActive
              ? "Your direct billing is already active. Log in to access your dashboard."
              : "Your direct billing is now active. Your service will continue uninterrupted, and you can manage everything from your dashboard."}
          </p>
          
            href="/login"
            className="inline-block w-full px-5 py-3 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
          >
            Log in to your dashboard
          </a>
          <p className="text-xs text-stone-400 mt-5">
            Need help? Email{" "}
            <a href="mailto:support@aifrontdeskhelper.com" className="text-stone-600 hover:text-stone-900 underline">
              support@aifrontdeskhelper.com
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

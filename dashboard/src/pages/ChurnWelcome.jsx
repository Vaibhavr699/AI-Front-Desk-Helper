import React from "react";
import { useSearchParams } from "react-router-dom";

export default function ChurnWelcome() {
  const [searchParams] = useSearchParams();
  const alreadyActive = searchParams.get("already_active") === "1";

  function goToLogin() {
    window.location.href = "/login";
  }

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
              : "Your direct billing is now active. Your service will continue uninterrupted."}
          </p>
          <button
            type="button"
            onClick={goToLogin}
            className="inline-block w-full px-5 py-3 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
          >
            Log in to your dashboard
          </button>
          <p className="text-xs text-stone-400 mt-5">
            Need help? Email support@aifrontdeskhelper.com
          </p>
        </div>
      </div>
    </div>
  );
}

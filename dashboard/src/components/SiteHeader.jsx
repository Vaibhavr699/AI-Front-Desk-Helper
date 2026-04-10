import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { ShimmerButton } from "./ui/shimmer-button";

/* ─────────────────────────────────────────────────────────────
   SMS CONSENT MODAL — same modal as Home.jsx
   Lives here so the "Start setup" navbar button is also covered.
───────────────────────────────────────────────────────────── */
function SmsConsentModal({ isOpen, onClose, onAccept }) {
  const [checked, setChecked] = useState(false);

  if (!isOpen) return null;

  function handleAccept() {
    if (!checked) return;
    onAccept();
    setChecked(false);
  }

  function handleClose() {
    setChecked(false);
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="sms-consent-header-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal box */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-2xl shadow-2xl p-8 flex flex-col gap-6">

        {/* Header */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="w-10 h-10 bg-orange-50 rounded-xl flex items-center justify-center">
              <svg
                className="w-5 h-5 text-orange-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <button
              type="button"
              onClick={handleClose}
              className="text-stone-400 hover:text-stone-600 transition-colors p-1 rounded-lg hover:bg-stone-100"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <h2
            id="sms-consent-header-title"
            className="text-xl font-bold text-stone-900"
          >
            Before you get started
          </h2>
          <p className="mt-1 text-sm text-stone-500">
            Please review and agree to our messaging policy.
          </p>
        </div>

       {/* Consent text box */}
        <div className="bg-stone-50 rounded-xl p-4 border border-stone-200 text-xs text-stone-600 leading-relaxed">
          <p>
            By submitting this form, you agree to receive SMS text messages from{" "}
            <span className="font-semibold text-stone-800">AI Front Desk Helper</span>{" "}
            related to your inquiry, including appointment scheduling, follow-ups, and
            service notifications. Message frequency may vary. Message and data rates
            may apply. Reply <strong>STOP</strong> to opt out or{" "}
            <strong>HELP</strong> for assistance. Consent is not required as a
            condition of purchasing services.{" "}
            <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" className="text-orange-500 hover:text-orange-600 underline underline-offset-2 font-medium">Privacy Policy</a>
            .
          </p>
        </div>

        {/* Checkbox */}
        <label className="flex items-start gap-3 cursor-pointer">
          <div className="flex-shrink-0 mt-0.5">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="w-4 h-4 rounded border-stone-300 text-orange-500 focus:ring-orange-500 focus:ring-offset-0 cursor-pointer"
            />
          </div>
          <span className="text-sm text-stone-700 leading-snug">
            I have read and agree to the SMS messaging terms above.
          </span>
        </label>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={handleClose}
            className="flex-1 px-4 py-3 rounded-xl border border-stone-200 bg-white text-sm font-semibold text-stone-600 hover:border-stone-300 hover:text-stone-800 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleAccept}
            disabled={!checked}
            className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all ${
              checked
                ? "bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-200 cursor-pointer"
                : "bg-stone-200 text-stone-400 cursor-not-allowed"
            }`}
          >
            Continue to sign up →
          </button>
        </div>

      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SITE HEADER
───────────────────────────────────────────────────────────── */
export function SiteHeader() {
  const navigate = useNavigate();
  const [isSmsConsentOpen, setIsSmsConsentOpen] = useState(false);

  function handleStartSetup() {
    setIsSmsConsentOpen(true);
  }

  function handleConsentAccepted() {
    setIsSmsConsentOpen(false);
    navigate("/login?signup=1");
  }

  return (
    <>
      <header className="sticky top-0 z-[500] bg-white/95 backdrop-blur border-b border-stone-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <Link to="/" className="flex items-center gap-2 group transition-all">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-stone-200 shadow-sm group-hover:scale-105 transition-transform duration-200 overflow-hidden p-1">
                <img src="/favicon.png" alt="Logo" className="w-full h-full object-contain" />
              </div>
              <div className="flex flex-col">
                <span className="font-bold text-stone-900 leading-none">
                  AI Front Desk Helper
                </span>
              </div>
            </Link>

            <div className="flex items-center gap-3">
              <Link
                to="/login"
                className="text-sm font-semibold text-stone-700 hover:text-stone-900 transition-colors"
              >
                Sign in
              </Link>
              <ShimmerButton
                onClick={handleStartSetup}
                className="text-sm text-white font-semibold px-4 py-2"
                shimmerSize="0.04em"
                background="rgba(41, 37, 36, 1)"
              >
                Start setup
              </ShimmerButton>
            </div>
          </div>
        </div>
      </header>

      {/* SMS Consent Modal */}
      <SmsConsentModal
        isOpen={isSmsConsentOpen}
        onClose={() => setIsSmsConsentOpen(false)}
        onAccept={handleConsentAccepted}
      />
    </>
  );
}

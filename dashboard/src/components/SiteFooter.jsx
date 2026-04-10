import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";
import { Phone } from "lucide-react";

/* ─────────────────────────────────────────────────────────────
   SMS CONSENT MODAL — same modal used in SiteHeader and Home
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
      aria-labelledby="sms-consent-footer-title"
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
            id="sms-consent-footer-title"
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
   SITE FOOTER
───────────────────────────────────────────────────────────── */
export function SiteFooter() {
  const navigate = useNavigate();
  const [isSmsConsentOpen, setIsSmsConsentOpen] = useState(false);

  function handleGetStarted(e) {
    e.preventDefault();
    setIsSmsConsentOpen(true);
  }

  function handleConsentAccepted() {
    setIsSmsConsentOpen(false);
    navigate("/login?signup=1");
  }

  return (
    <>
      <footer className="bg-stone-950 text-stone-400 py-16 border-t border-stone-800/50">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">

            {/* Brand */}
            <div className="md:col-span-1">
              <Link to="/" className="flex items-center gap-2 mb-6 group">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-stone-800 shadow-lg group-hover:scale-105 transition-transform overflow-hidden p-1">
                  <img src="/favicon.png" alt="Logo" className="w-full h-full object-contain" />
                </div>
                <div className="flex flex-col">
                  <span className="font-bold text-lg text-white leading-none">AI Front Desk</span>
                  <span className="text-[10px] font-bold text-stone-600 uppercase tracking-widest mt-0.5">Helper</span>
                </div>
              </Link>
              <p className="text-sm leading-relaxed text-stone-500">
                The intelligent phone assistant for home service companies. Stop losing
                leads to voicemail and start booking more jobs.
              </p>
            </div>

            {/* Product */}
            <div>
              <h4 className="text-white font-semibold mb-6">Product</h4>
              <ul className="space-y-4 text-sm">
                <li><Link to="/#features" className="hover:text-white transition-colors">Features</Link></li>
                <li><Link to="/#how-it-works" className="hover:text-white transition-colors">How it works</Link></li>
                <li><Link to="/#pricing" className="hover:text-white transition-colors">Pricing</Link></li>
              </ul>
            </div>

            {/* Platform */}
            <div>
              <h4 className="text-white font-semibold mb-6">Platform</h4>
              <ul className="space-y-4 text-sm">
                <li>
                  <Link to="/login" className="hover:text-white transition-colors">
                    Dashboard Login
                  </Link>
                </li>
                <li>
                  {/* ── SMS CONSENT TRIGGER ── */}
                  <a
                    href="/login?signup=1"
                    onClick={handleGetStarted}
                    className="text-emerald-400 hover:text-emerald-300 transition-colors cursor-pointer"
                  >
                    Get Started
                  </a>
                </li>
              </ul>
            </div>

            {/* Legal */}
            <div>
              <h4 className="text-white font-semibold mb-6">Legal</h4>
              <ul className="space-y-4 text-sm">
                <li>
                  <Link to="/privacy-policy" className="hover:text-white transition-colors">
                    Privacy &amp; Messaging Policy
                  </Link>
                </li>
                <li>
                  <Link to="/terms" className="hover:text-white transition-colors">
                    Terms of Service
                  </Link>
                </li>
                <li>
                  <Link to="/cookie-policy" className="hover:text-white transition-colors">
                    Cookie Policy
                  </Link>
                </li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="text-white font-semibold mb-6">Contact</h4>
              <ul className="space-y-4 text-sm">
                <li className="flex items-center gap-3">
                  <Phone className="w-4 h-4 text-stone-600" />
                  <span>Support Line</span>
                </li>
                <li className="flex items-center gap-3 text-stone-500 italic">
                  <span>Available 24/7 via AI</span>
                </li>
                <li>
                  <a
                    href="mailto:drew@aifrontdeskhelper.com"
                    className="hover:text-white transition-colors"
                  >
                    drew@aifrontdeskhelper.com
                  </a>
                </li>
              </ul>
            </div>

          </div>

          <div className="pt-12 border-t border-stone-800 flex flex-col md:flex-row items-center justify-between gap-6">
            <div className="text-sm text-stone-600">
              © {new Date().getFullYear()} AI Front Desk Helper. All rights reserved.
            </div>
          </div>
        </div>
      </footer>

      {/* SMS Consent Modal */}
      <SmsConsentModal
        isOpen={isSmsConsentOpen}
        onClose={() => setIsSmsConsentOpen(false)}
        onAccept={handleConsentAccepted}
      />
    </>
  );
}

import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  getResellerPublicInfo,
  submitResellerPublicSignup,
} from "../api";

/**
 * Public self-signup page for a reseller's prospects.
 * URL: /reseller/:code/signup  (no auth)
 *
 * Flow:
 *   1. Fetch branded reseller info (name, logo, colors, accepting_signups)
 *   2. Render white-labeled signup form
 *   3. On submit, create customer tenant under reseller
 *   4. Show success + "check email" instructions
 *
 * Error states handled inline (reseller not found / at cap / inactive).
 */
export default function ResellerPublicSignup() {
  const { code } = useParams();
  const navigate = useNavigate();

  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [form, setForm] = useState({
    business_name: "",
    primary_email: "",
    phone: "",
  });
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(null);

  useEffect(() => {
    loadInfo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  async function loadInfo() {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await getResellerPublicInfo(code);
      setInfo(data);
    } catch (err) {
      setLoadError(err.message || "Failed to load signup page");
    } finally {
      setLoading(false);
    }
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validate() {
    if (!form.business_name.trim() || form.business_name.trim().length < 2) {
      return "Business name is required (at least 2 characters)";
    }
    if (form.business_name.trim().length > 100) {
      return "Business name must be 100 characters or less";
    }
    if (!form.primary_email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.primary_email)) {
      return "Please enter a valid email address";
    }
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    const err = validate();
    if (err) {
      setFormError(err);
      return;
    }
    setFormError(null);
    setSubmitting(true);
    try {
      const result = await submitResellerPublicSignup(code, {
        business_name: form.business_name.trim(),
        primary_email: form.primary_email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
      });
      setSuccess(result);
    } catch (err) {
      if (err.code === "EMAIL_EXISTS") {
        setFormError(
          "An account with this email already exists. Try logging in, or use a different email."
        );
      } else if (err.code === "RESELLER_AT_CAP") {
        setFormError(
          `${info?.reseller?.name || "This provider"} is not currently accepting new signups. Please contact them directly.`
        );
      } else if (err.code === "RESELLER_INACTIVE") {
        setFormError(
          `${info?.reseller?.name || "This provider"}'s account is not currently active.`
        );
      } else {
        setFormError(err.message || "Signup failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Branding extraction with sensible defaults
  const brandName = info?.reseller?.name || "AI Front Desk";
  const brandColor = info?.reseller?.brand_color || "#1a1a1a";
  const logoUrl = info?.reseller?.logo_url;
  const isWhiteLabel = info?.reseller?.brand_mode === "white_label";

  // ─── Render states ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="text-stone-400 text-sm">Loading...</div>
      </div>
    );
  }

  if (loadError || !info) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-6">
        <div className="max-w-md w-full text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-red-100 mb-4">
            <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">Signup link not found</h1>
          <p className="text-sm text-stone-500 mb-6">
            {loadError || "This signup link is invalid or no longer active. Please check the URL and try again."}
          </p>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="px-5 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
          >
            Go to homepage
          </button>
        </div>
      </div>
    );
  }

  if (info.inactive) {
    return (
      <BrandedShell brandName={brandName} brandColor={brandColor} logoUrl={logoUrl} isWhiteLabel={isWhiteLabel}>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-stone-900 mb-2">
            Signups paused
          </h1>
          <p className="text-sm text-stone-500">
            {brandName} isn't currently accepting new signups. Please contact them directly.
          </p>
        </div>
      </BrandedShell>
    );
  }

  if (info.at_cap) {
    return (
      <BrandedShell brandName={brandName} brandColor={brandColor} logoUrl={logoUrl} isWhiteLabel={isWhiteLabel}>
        <div className="text-center">
          <h1 className="text-2xl font-bold text-stone-900 mb-2">
            At capacity
          </h1>
          <p className="text-sm text-stone-500">
            {brandName} is at capacity and can't accept new customers right now. Please check back soon or reach out directly.
          </p>
        </div>
      </BrandedShell>
    );
  }

  if (success) {
    return (
      <BrandedShell brandName={brandName} brandColor={brandColor} logoUrl={logoUrl} isWhiteLabel={isWhiteLabel}>
        <div className="text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-4" style={{ backgroundColor: `${brandColor}15` }}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24" style={{ color: brandColor }}>
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-stone-900 mb-2">
            Welcome aboard!
          </h1>
          <p className="text-sm text-stone-500 mb-6">
            Your account has been created. Check your email ({success.customer?.primary_email}) for a message from {brandName} to set your password and log in.
          </p>
          <div className="rounded-lg bg-stone-50 border border-stone-200 p-4 text-left text-xs text-stone-600">
            <div className="font-bold text-stone-900 mb-2">What happens next?</div>
            <ol className="space-y-1 list-decimal list-inside">
              <li>Check your inbox for a welcome email (may take a minute)</li>
              <li>Click the link to set your password</li>
              <li>Log in to your new dashboard</li>
            </ol>
          </div>
          <button
            type="button"
            onClick={() => navigate("/")}
            className="mt-6 text-sm font-semibold text-stone-500 hover:text-stone-900"
          >
            Go to login page
          </button>
        </div>
      </BrandedShell>
    );
  }

  // Main signup form
  return (
    <BrandedShell brandName={brandName} brandColor={brandColor} logoUrl={logoUrl} isWhiteLabel={isWhiteLabel}>
      <div>
        <h1 className="text-2xl font-bold text-stone-900 mb-2 text-center">
          Get started with {brandName}
        </h1>
        <p className="text-sm text-stone-500 mb-6 text-center">
          Tell us about your business and we'll set you up in seconds.
        </p>

        {formError && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
            {formError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">
              Business name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.business_name}
              onChange={(e) => updateField("business_name", e.target.value)}
              placeholder="Acme Plumbing Co."
              className="w-full px-3 py-2.5 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2"
              style={{ "--tw-ring-color": brandColor }}
              maxLength={100}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">
              Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={form.primary_email}
              onChange={(e) => updateField("primary_email", e.target.value)}
              placeholder="owner@acmeplumbing.com"
              className="w-full px-3 py-2.5 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2"
              style={{ "--tw-ring-color": brandColor }}
              disabled={submitting}
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">
              Phone <span className="text-stone-400 font-normal normal-case">· Optional</span>
            </label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => updateField("phone", e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full px-3 py-2.5 text-sm border border-stone-300 rounded-lg focus:outline-none focus:ring-2"
              style={{ "--tw-ring-color": brandColor }}
              disabled={submitting}
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full px-4 py-3 text-sm font-bold text-white rounded-lg transition-opacity disabled:opacity-60 disabled:cursor-wait"
            style={{ backgroundColor: brandColor }}
          >
            {submitting ? "Creating your account..." : "Create my account"}
          </button>
        </form>

        <p className="text-[10px] text-stone-400 text-center mt-4">
          By signing up, you agree to {brandName}'s terms of service and privacy policy.
        </p>
      </div>
    </BrandedShell>
  );
}

/**
 * Branded page shell — logo/name header + centered white card.
 * Falls back to text-only "AI Front Desk" header when no logo is set.
 * For true white-label resellers, no "powered by" footer is shown.
 */
function BrandedShell({ brandName, brandColor, logoUrl, isWhiteLabel, children }) {
  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      <header className="px-6 py-5 border-b border-stone-200 bg-white">
        <div className="max-w-md mx-auto flex items-center justify-center">
          {logoUrl ? (
            <img src={logoUrl} alt={brandName} className="h-8 w-auto" />
          ) : (
            <div className="text-lg font-bold" style={{ color: brandColor }}>
              {brandName}
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="max-w-md w-full">
          <div className="rounded-2xl bg-white border border-stone-200 p-8 shadow-sm">
            {children}
          </div>
        </div>
      </main>

      {!isWhiteLabel && (
        <footer className="px-6 py-4 text-center text-[10px] text-stone-400">
          Powered by AI Front Desk Helper
        </footer>
      )}
    </div>
  );
}

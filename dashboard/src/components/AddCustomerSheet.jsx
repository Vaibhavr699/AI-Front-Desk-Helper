import React, { useState, useEffect } from "react";
import {
  previewAddResellerCustomer,
  createResellerCustomer,
} from "../api";

/**
 * 3-step right-slide sheet to add a customer tenant under the current reseller.
 * Mirrors AddLocationSheet pattern: preview -> form -> review -> submit.
 *
 * Props:
 *   open      - boolean, show/hide
 *   onClose   - () => void, close handler
 *   onCreated - (customer) => void, fires after successful create
 *   onUpgrade - () => void, fires when user clicks upgrade CTA at cap
 */
export default function AddCustomerSheet({ open, onClose, onCreated, onUpgrade }) {
  const [step, setStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [form, setForm] = useState({
    business_name: "",
    primary_email: "",
    phone: "",
    plan: "basic",
    brand_mode_inherit: true,
  });

  useEffect(() => {
    if (open) {
      setStep(1);
      setError(null);
      setPreviewData(null);
      setForm({
        business_name: "",
        primary_email: "",
        phone: "",
        plan: "growth",
        brand_mode_inherit: true,
      });
      runPreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function runPreview() {
    setLoading(true);
    setError(null);
    try {
      const data = await previewAddResellerCustomer();
      setPreviewData(data);
    } catch (err) {
      setError(err.message || "Failed to check availability");
    } finally {
      setLoading(false);
    }
  }

  function updateField(field, value) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function validateStep2() {
    if (!form.business_name.trim() || form.business_name.trim().length < 2) {
      return "Business name is required (at least 2 characters)";
    }
    if (!form.primary_email.trim()) return "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.primary_email)) {
      return "Please enter a valid email address";
    }
    return null;
  }

  async function handleCreate() {
    setLoading(true);
    setError(null);
    try {
      const payload = {
        name: form.business_name.trim(),
        primary_email: form.primary_email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        plan: form.plan,
        brand_mode_inherit: form.brand_mode_inherit,
      };
      const result = await createResellerCustomer(payload);
      onCreated?.(result.customer);
      onClose?.();
    } catch (err) {
      setError(err.message || "Failed to add customer");
    } finally {
      setLoading(false);
    }
  }

  const atCap = previewData && previewData.can_add === false;
  const canAdvanceStep1 = previewData && previewData.can_add === true;

  return (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-black/40 transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      <div
        className={`absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-2xl transition-transform duration-300 ease-out ${open ? "translate-x-0" : "translate-x-full"} flex flex-col`}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-stone-200">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">
              Step {step} of 3
            </div>
            <h2 className="text-xl font-bold text-stone-900 mt-0.5">
              {step === 1 && "Check availability"}
              {step === 2 && "Customer details"}
              {step === 3 && "Review"}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-6">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
              {error}
            </div>
          )}

          {step === 1 && (
            <>
              {loading && !previewData && (
                <div className="flex items-center justify-center py-12 text-stone-400 text-sm">
                  Checking your plan...
                </div>
              )}

              {previewData && !atCap && (
                <div>
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 p-5 mb-5">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                        Ready to add
                      </span>
                    </div>
                    <div className="text-sm text-stone-700">
                      <span className="font-semibold">
                        {previewData.customer_limit === null
                          ? "Unlimited slots"
                          : `${previewData.slots_remaining} of ${previewData.customer_limit} slots available`}
                      </span>{" "}
                      on your {previewData.tier_name} plan.
                    </div>
                  </div>
                  <p className="text-sm text-stone-500">
                    Fill in the customer's business details on the next step. They'll
                    receive a welcome email to set their password and log in.
                  </p>
                </div>
              )}

              {previewData && atCap && (
                <div>
                  <div className="rounded-2xl bg-red-50 border border-red-200 p-5 mb-5">
                    <div className="flex items-center gap-2 mb-2">
                      <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-red-700">
                        At capacity
                      </span>
                    </div>
                    <div className="text-sm text-stone-700 mb-2">
                      You've used <span className="font-semibold">{previewData.current} of {previewData.limit}</span> customer slots on the {previewData.tier} plan.
                    </div>
                    <div className="text-sm text-stone-600">
                      {previewData.next_tier
                        ? `Upgrade to ${previewData.next_tier} to add more customers.`
                        : "You're on the highest tier — contact support for options."}
                    </div>
                  </div>
                  {previewData.next_tier && (
                    <button
                      type="button"
                      onClick={() => {
                        onUpgrade?.();
                        onClose?.();
                      }}
                      className="w-full px-4 py-3 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
                    >
                      Upgrade to {previewData.next_tier}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <Field label="Business name" required>
                <input
                  type="text"
                  value={form.business_name}
                  onChange={(e) => updateField("business_name", e.target.value)}
                  placeholder="Acme Plumbing Co."
                  className="w-full px-3 py-2.5 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
                  maxLength={100}
                />
              </Field>

              <Field label="Primary email" required>
                <input
                  type="email"
                  value={form.primary_email}
                  onChange={(e) => updateField("primary_email", e.target.value)}
                  placeholder="owner@acmeplumbing.com"
                  className="w-full px-3 py-2.5 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
                />
              </Field>

              <Field label="Phone" hint="Optional">
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField("phone", e.target.value)}
                  placeholder="(555) 123-4567"
                  className="w-full px-3 py-2.5 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900"
                />
              </Field>

              <Field label="Plan">
                <select
                  value={form.plan}
                  onChange={(e) => updateField("plan", e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-stone-300 rounded-lg focus:outline-none focus:border-stone-900 focus:ring-1 focus:ring-stone-900 bg-white"
                >
                  <option value="basic">Basic</option>
                  <option value="pro">Pro</option>
                  <option value="elite">Elite</option>
                </select>
              </Field>

              <div className="pt-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.brand_mode_inherit}
                    onChange={(e) => updateField("brand_mode_inherit", e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-stone-300 text-stone-900 focus:ring-stone-900"
                  />
                  <div>
                    <div className="text-sm font-semibold text-stone-900">Inherit my brand</div>
                    <div className="text-xs text-stone-500 mt-0.5">
                      Customer's dashboard will show your brand (logo, colors). Uncheck to give them the default AI Front Desk branding.
                    </div>
                  </div>
                </label>
              </div>
            </div>
          )}

          {step === 3 && (
            <div>
              <div className="rounded-2xl bg-stone-50 border border-stone-200 p-5 mb-4 space-y-3">
                <ReviewRow label="Business" value={form.business_name} />
                <ReviewRow label="Email" value={form.primary_email} />
                {form.phone && <ReviewRow label="Phone" value={form.phone} />}
                <ReviewRow label="Plan" value={capitalize(form.plan)} />
                <ReviewRow
                  label="Branding"
                  value={form.brand_mode_inherit ? "Inherits your brand" : "Default AI Front Desk"}
                />
              </div>
              <div className="rounded-lg bg-blue-50 border border-blue-200 px-3 py-2.5 text-xs text-blue-800">
                <span className="font-semibold">What happens next:</span>{" "}
                {form.primary_email} will receive a welcome email to set their password
                and log in. You'll see them in your customer list immediately.
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-stone-200 flex items-center gap-2">
          {step === 1 && (
            <button
              type="button"
              onClick={() => {
                if (!canAdvanceStep1) return;
                setStep(2);
              }}
              disabled={loading || !canAdvanceStep1}
              className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 disabled:bg-stone-300 disabled:cursor-not-allowed rounded-lg transition-colors"
            >
              {loading ? "Checking..." : "Continue"}
            </button>
          )}

          {step === 2 && (
            <>
              <button
                type="button"
                onClick={() => setStep(1)}
                className="px-4 py-2.5 text-sm font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => {
                  const err = validateStep2();
                  if (err) {
                    setError(err);
                    return;
                  }
                  setError(null);
                  setStep(3);
                }}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors"
              >
                Review
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <button
                type="button"
                onClick={() => setStep(2)}
                disabled={loading}
                className="px-4 py-2.5 text-sm font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-60 rounded-lg transition-colors"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 disabled:bg-stone-400 disabled:cursor-wait rounded-lg transition-colors"
              >
                {loading ? "Creating..." : "Create customer"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, required, children }) {
  return (
    <div>
      <label className="flex items-center gap-2 text-xs font-bold text-stone-700 uppercase tracking-wider mb-1.5">
        {label}
        {required && <span className="text-red-500">*</span>}
        {hint && !required && <span className="text-stone-400 font-normal normal-case">· {hint}</span>}
      </label>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }) {
  return (
    <div className="flex items-start justify-between text-sm">
      <span className="text-stone-500">{label}</span>
      <span className="font-semibold text-stone-900 text-right ml-4">{value}</span>
    </div>
  );
}

function capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

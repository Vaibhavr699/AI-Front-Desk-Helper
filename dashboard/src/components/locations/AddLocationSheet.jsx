import React, { useState, useEffect, useCallback } from "react";
import { previewLocation, createLocation } from "../../api/locations";

/**
 * Add Location sheet — slides in from right.
 *
 * Steps:
 *   1. billing       → pick parent_pays vs self_pays (skipped for operating_hq, defaults to parent_pays)
 *   2. details       → name, plan, franchisee_email (if self_pays)
 *   3. preview       → call /preview, show prorated breakdown, "Confirm & Add"
 *   4. result        → success or error state
 *
 * Closes via Escape, clicking backdrop, or the X button.
 * Locks body scroll while open.
 */
export default function AddLocationSheet({
  open,
  onClose,
  onAdded,
  parentTenant,
}) {
  const [step, setStep] = useState("billing");
  const [billingResponsibility, setBillingResponsibility] = useState("parent_pays");
  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [plan, setPlan] = useState("pro");
  const [franchiseeEmail, setFranchiseeEmail] = useState("");
  const [preview, setPreview] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [resultData, setResultData] = useState(null);

  const isRollupOnly = parentTenant?.parent_mode === "rollup_only";

  // Reset state when sheet opens/closes
  useEffect(() => {
    if (open) {
      setStep(isRollupOnly ? "billing" : "details");
      setBillingResponsibility(isRollupOnly ? "parent_pays" : "parent_pays");
      setName("");
      setCompanyName("");
      setPlan("pro");
      setFranchiseeEmail("");
      setPreview(null);
      setPreviewLoading(false);
      setSubmitting(false);
      setErrorMsg(null);
      setResultData(null);
    }
  }, [open, isRollupOnly]);

  // Lock body scroll while open
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  // Escape closes
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape") onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  const fetchPreview = useCallback(async () => {
    if (!parentTenant?.id) return;
    setPreviewLoading(true);
    setErrorMsg(null);
    try {
      const data = await previewLocation(parentTenant.id, {
        billing_responsibility: billingResponsibility,
        plan,
      });
      setPreview(data);
    } catch (err) {
      console.error("[AddLocationSheet] preview error:", err);
      setErrorMsg(err.message || "Couldn't load preview");
      setPreview(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [parentTenant?.id, billingResponsibility, plan]);

  // Auto-fetch preview when entering preview step
  useEffect(() => {
    if (step === "preview" && !preview && !previewLoading) {
      fetchPreview();
    }
  }, [step, preview, previewLoading, fetchPreview]);

  const handleNext = () => {
    setErrorMsg(null);
    if (step === "billing") {
      setStep("details");
    } else if (step === "details") {
      // Validate before moving on
      if (!name.trim()) {
        setErrorMsg("Location name is required");
        return;
      }
      if (billingResponsibility === "self_pays") {
        const email = franchiseeEmail.trim().toLowerCase();
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          setErrorMsg("Valid franchisee email is required for self-pays locations");
          return;
        }
      }
      setStep("preview");
    }
  };

  const handleBack = () => {
    setErrorMsg(null);
    if (step === "details") setStep(isRollupOnly ? "billing" : "details");
    else if (step === "preview") setStep("details");
  };

  const handleConfirm = async () => {
    if (!parentTenant?.id) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const body = {
        name: name.trim(),
        company_name: (companyName || name).trim(),
        billing_responsibility: billingResponsibility,
        plan,
      };
      if (billingResponsibility === "self_pays") {
        body.franchisee_email = franchiseeEmail.trim().toLowerCase();
      }
      const data = await createLocation(parentTenant.id, body);
      setResultData(data);
      setStep("result");
      // Notify parent so it can refetch the roster
      onAdded?.(data);
    } catch (err) {
      console.error("[AddLocationSheet] create error:", err);
      setErrorMsg(err.message || "Failed to create location");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={onClose}
      />

      {/* Sheet */}
      <div
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[480px] bg-white z-50 shadow-2xl flex flex-col animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-location-title"
      >
        {/* Header */}
        <div className="shrink-0 px-6 py-5 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h2 id="add-location-title" className="text-lg font-bold text-stone-900">
              {step === "result" ? "Done!" : "Add Location"}
            </h2>
            {step !== "result" && (
              <p className="text-xs text-stone-500 mt-0.5">
                {step === "billing" && "Step 1 of 3 — Who pays?"}
                {step === "details" && "Step 2 of 3 — Location details"}
                {step === "preview" && "Step 3 of 3 — Review billing"}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 -mr-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-6">
          {step === "billing" && (
            <BillingStep
              value={billingResponsibility}
              onChange={setBillingResponsibility}
            />
          )}
          {step === "details" && (
            <DetailsStep
              name={name}
              setName={setName}
              companyName={companyName}
              setCompanyName={setCompanyName}
              plan={plan}
              setPlan={setPlan}
              billingResponsibility={billingResponsibility}
              franchiseeEmail={franchiseeEmail}
              setFranchiseeEmail={setFranchiseeEmail}
              parentMode={parentTenant?.parent_mode}
            />
          )}
          {step === "preview" && (
            <PreviewStep
              loading={previewLoading}
              preview={preview}
              billingResponsibility={billingResponsibility}
              locationName={companyName || name}
              franchiseeEmail={franchiseeEmail}
              onRetry={fetchPreview}
              error={errorMsg}
            />
          )}
          {step === "result" && (
            <ResultStep
              billingResponsibility={billingResponsibility}
              resultData={resultData}
              locationName={companyName || name}
              franchiseeEmail={franchiseeEmail}
            />
          )}

          {step !== "preview" && step !== "result" && errorMsg && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {errorMsg}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 px-6 py-4 border-t border-stone-200 bg-stone-50">
          {step === "billing" && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2.5 text-sm font-bold text-stone-600 hover:text-stone-900 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl transition-colors"
              >
                Continue
              </button>
            </div>
          )}

          {step === "details" && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={isRollupOnly ? handleBack : onClose}
                className="px-4 py-2.5 text-sm font-bold text-stone-600 hover:text-stone-900 transition-colors"
              >
                {isRollupOnly ? "Back" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl transition-colors"
              >
                Continue
              </button>
            </div>
          )}

          {step === "preview" && (
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="px-4 py-2.5 text-sm font-bold text-stone-600 hover:text-stone-900 transition-colors disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={submitting || previewLoading || !preview}
                className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
              >
                {submitting && (
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                    <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
                  </svg>
                )}
                {submitting ? "Creating…" : billingResponsibility === "self_pays" ? "Send Invite" : "Confirm & Add"}
              </button>
            </div>
          )}

          {step === "result" && (
            <button
              type="button"
              onClick={onClose}
              className="w-full px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl transition-colors"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </>
  );
}

// ── Step 1: Billing ────────────────────────────────────────────────────────
function BillingStep({ value, onChange }) {
  return (
    <div>
      <p className="text-sm text-stone-500 mb-5">
        Decide who covers this location's monthly subscription. You can mix and match — some locations
        billed to you, others billed to the franchisee directly.
      </p>

      <div className="space-y-3">
        <BillingOption
          checked={value === "parent_pays"}
          onChange={() => onChange("parent_pays")}
          title="Corporate pays"
          subtitle="Added as a line item on your subscription"
          desc="You pay for this location's plan each month. Best for company-owned franchisees or when you're providing the AI front desk as a corporate benefit."
        />
        <BillingOption
          checked={value === "self_pays"}
          onChange={() => onChange("self_pays")}
          title="Franchisee pays"
          subtitle="Send invite link, franchisee enters their own card"
          desc="The franchisee gets an email invite. They pick their own plan and complete their own checkout. Their subscription is independent from yours."
        />
      </div>
    </div>
  );
}

function BillingOption({ checked, onChange, title, subtitle, desc }) {
  return (
    <button
      type="button"
      onClick={onChange}
      className={`w-full text-left rounded-xl border-2 p-4 transition-all ${
        checked
          ? "border-stone-900 bg-stone-50 shadow-sm"
          : "border-stone-200 bg-white hover:border-stone-300"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`shrink-0 w-5 h-5 rounded-full border-2 mt-0.5 transition-all ${
            checked ? "border-stone-900 bg-stone-900" : "border-stone-300 bg-white"
          }`}
        >
          {checked && (
            <svg className="w-full h-full text-white" fill="currentColor" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="4" />
            </svg>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-0.5">
            <span className="text-sm font-bold text-stone-900">{title}</span>
          </div>
          <p className="text-xs text-stone-500 mb-2">{subtitle}</p>
          <p className="text-xs text-stone-600 leading-relaxed">{desc}</p>
        </div>
      </div>
    </button>
  );
}

// ── Step 2: Details ────────────────────────────────────────────────────────
function DetailsStep({
  name,
  setName,
  companyName,
  setCompanyName,
  plan,
  setPlan,
  billingResponsibility,
  franchiseeEmail,
  setFranchiseeEmail,
  parentMode,
}) {
  const isSelfPays = billingResponsibility === "self_pays";

  return (
    <div className="space-y-5">
      <Field
        label="Location name"
        sublabel="What you'll see in the dashboard (e.g. 'Lincoln Branch')"
        required
      >
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Lincoln Branch"
          className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 outline-none transition-all"
        />
      </Field>

      <Field
        label="Public-facing company name"
        sublabel="Optional — what customers see (defaults to location name)"
      >
        <input
          type="text"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="e.g. Gladiators Painting — Lincoln"
          className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 outline-none transition-all"
        />
      </Field>

      <Field
        label={isSelfPays ? "Suggested plan for franchisee" : "Plan"}
        sublabel={
          isSelfPays
            ? "Franchisee can change this on their checkout page"
            : parentMode === "rollup_only"
            ? "Plan rate the franchisee will get"
            : "You'll be billed 50% of your plan rate, regardless of this selection"
        }
      >
        <PlanSelect value={plan} onChange={setPlan} />
      </Field>

      {isSelfPays && (
        <Field
          label="Franchisee email"
          sublabel="Where the invite link gets sent. Can't be changed once sent."
          required
        >
          <input
            type="email"
            value={franchiseeEmail}
            onChange={(e) => setFranchiseeEmail(e.target.value)}
            placeholder="owner@franchisee-business.com"
            className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 outline-none transition-all"
          />
        </Field>
      )}
    </div>
  );
}

function Field({ label, sublabel, required, children }) {
  return (
    <div>
      <label className="block text-xs font-bold text-stone-700 uppercase tracking-wider mb-1">
        {label}
        {required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {sublabel && <p className="text-xs text-stone-500 mb-2">{sublabel}</p>}
      {children}
    </div>
  );
}

function PlanSelect({ value, onChange }) {
  const plans = [
    { id: "basic", name: "Basic", price: "$297/mo" },
    { id: "pro", name: "Pro", price: "$497/mo" },
    { id: "elite", name: "Elite", price: "$997/mo" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {plans.map((p) => (
        <button
          key={p.id}
          type="button"
          onClick={() => onChange(p.id)}
          className={`px-3 py-3 text-center rounded-xl border-2 transition-all ${
            value === p.id
              ? "border-stone-900 bg-stone-50"
              : "border-stone-200 bg-white hover:border-stone-300"
          }`}
        >
          <div className="text-sm font-bold text-stone-900">{p.name}</div>
          <div className="text-[10px] font-semibold text-stone-500 mt-0.5">{p.price}</div>
        </button>
      ))}
    </div>
  );
}

// ── Step 3: Preview ────────────────────────────────────────────────────────
function PreviewStep({ loading, preview, billingResponsibility, locationName, franchiseeEmail, onRetry, error }) {
  if (loading) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl bg-stone-100 h-24 animate-pulse" />
        <div className="rounded-xl bg-stone-100 h-32 animate-pulse" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-200 bg-red-50 p-4">
        <div className="text-sm font-bold text-red-900 mb-1">Couldn't load preview</div>
        <div className="text-sm text-red-700 mb-3">{error}</div>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 text-xs font-bold text-red-700 bg-white border border-red-200 hover:bg-red-100 rounded-lg transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  if (!preview) return null;

  const p = preview.preview || {};
  const isSelfPays = billingResponsibility === "self_pays";

  if (isSelfPays) {
    return (
      <div className="space-y-4">
        <div className="rounded-2xl bg-amber-50 border border-amber-200 p-5">
          <div className="text-xs font-bold text-amber-700 uppercase tracking-wider mb-2">
            What happens next
          </div>
          <p className="text-sm text-stone-700 leading-relaxed">
            We'll send an invite to <span className="font-semibold">{franchiseeEmail}</span> with a
            secure link. The franchisee picks their plan, enters their own payment method, and gets
            access to a dashboard branded under your franchise.
          </p>
        </div>

        <div className="rounded-2xl border border-stone-200 p-5 space-y-3">
          <Row label="Location" value={locationName || "—"} />
          <Row label="Billing" value="Franchisee pays directly" />
          <Row label="Your monthly cost" value="$0.00" valueClass="text-emerald-600" />
          <Row label="Invite expires" value="14 days" />
        </div>
      </div>
    );
  }

  // parent_pays preview
  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-stone-900 to-stone-800 text-white p-5">
        <div className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-2">
          Charged today (prorated)
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black tracking-tight">
            {formatMoneyCents(p.proratedTodayCents)}
          </span>
        </div>
        <p className="text-xs text-stone-400 mt-2">
          Through your current billing period ending {formatDate(p.currentPeriodEnd)}
        </p>
      </div>

      <div className="rounded-2xl border border-stone-200 p-5 space-y-3">
        <Row label="Location" value={locationName || "—"} />
        <Row
          label="Recurring location cost"
          value={`${formatMoneyCents(p.locationRateCents)} /mo`}
        />
        <Row
          label="Next charge"
          value={formatDate(p.nextChargeDate)}
        />
        <div className="pt-3 border-t border-stone-100">
          <Row
            label="Your new total recurring"
            value={`${formatMoneyCents(p.newRecurringMonthlyCents)} /mo`}
            valueClass="text-stone-900 font-bold"
            labelClass="font-bold text-stone-900"
          />
        </div>
      </div>
    </div>
  );
}

function Row({ label, value, labelClass = "", valueClass = "" }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-sm text-stone-500 ${labelClass}`}>{label}</span>
      <span className={`text-sm text-stone-900 ${valueClass}`}>{value}</span>
    </div>
  );
}

// ── Step 4: Result ─────────────────────────────────────────────────────────
function ResultStep({ billingResponsibility, resultData, locationName, franchiseeEmail }) {
  const isSelfPays = billingResponsibility === "self_pays";

  if (isSelfPays) {
    return (
      <div className="text-center py-4">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-100 text-amber-600 mb-4">
          <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        </div>
        <h3 className="text-lg font-bold text-stone-900 mb-1">Invite sent</h3>
        <p className="text-sm text-stone-500 mb-6">
          We sent an invite to <span className="font-semibold text-stone-700">{franchiseeEmail}</span>.
          They'll appear in your roster as "Awaiting franchisee" until they complete checkout.
        </p>
        <div className="rounded-xl bg-stone-50 border border-stone-200 px-4 py-3 text-left text-xs text-stone-600">
          <div className="font-bold text-stone-700 mb-1">Invite expires in 14 days</div>
          You can resend the invite from the location card if it expires.
        </div>
      </div>
    );
  }

  return (
    <div className="text-center py-4">
      <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 mb-4">
        <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h3 className="text-lg font-bold text-stone-900 mb-1">{locationName} is live</h3>
      <p className="text-sm text-stone-500 mb-6">
        Your billing was updated. The location is active immediately and ready to be configured.
      </p>
      {resultData?.preview?.proratedTodayCents != null && (
        <div className="rounded-xl bg-stone-50 border border-stone-200 px-4 py-3 text-left text-xs text-stone-600">
          <div className="flex justify-between mb-1">
            <span>Charged today</span>
            <span className="font-bold text-stone-900">
              {formatMoneyCents(resultData.preview.proratedTodayCents)}
            </span>
          </div>
          <div className="flex justify-between">
            <span>Next charge</span>
            <span className="font-bold text-stone-900">
              {formatDate(resultData.preview.nextChargeDate)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatMoneyCents(cents) {
  if (cents == null || isNaN(cents)) return "$0.00";
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDate(isoString) {
  if (!isoString) return "—";
  try {
    return new Date(isoString).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

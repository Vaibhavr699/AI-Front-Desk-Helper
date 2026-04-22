import React, { useState, useEffect } from "react";
import { updateLocation } from "../../api/locations";
import { getUser } from "../../api";

/**
 * Edit Location dialog — name, public name, plan, optional rate overrides (superadmin only).
 *
 * For owner/admin: shows name, company_name, plan
 * For superadmin: ALSO shows rate override fields (locations_monthly_rate_cents,
 *   locations_annual_rate_cents) — useful for negotiated deals.
 *
 * On save, calls PATCH /tenants/:parentId/locations/:childId.
 * If rate or plan changes, backend sends a rate-change notice email automatically.
 */
export default function EditLocationDialog({
  open,
  onClose,
  onUpdated,
  parentTenant,
  location,
}) {
  const user = getUser();
  const isSuperAdmin = !!user?.is_super_admin;

  const [name, setName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [plan, setPlan] = useState("pro");
  const [monthlyOverride, setMonthlyOverride] = useState("");
  const [annualOverride, setAnnualOverride] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Sync state from location whenever dialog opens
  useEffect(() => {
    if (open && location) {
      setName(location.name || "");
      setCompanyName(location.company_name || "");
      setPlan(location.plan || "pro");
      setMonthlyOverride(
        location.locations_monthly_rate_cents != null
          ? (location.locations_monthly_rate_cents / 100).toFixed(2)
          : ""
      );
      setAnnualOverride(
        location.locations_annual_rate_cents != null
          ? (location.locations_annual_rate_cents / 100).toFixed(2)
          : ""
      );
      setSubmitting(false);
      setError(null);
    }
  }, [open, location]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === "Escape" && !submitting) onClose?.();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, submitting]);

  if (!open || !location) return null;

  const handleSave = async () => {
    if (!parentTenant?.id) return;
    setSubmitting(true);
    setError(null);
    try {
      const body = {};
      if (name.trim() !== (location.name || "")) body.name = name.trim();
      if (companyName.trim() !== (location.company_name || "")) {
        body.company_name = companyName.trim();
      }
      if (plan !== location.plan) body.plan = plan;

      // Rate override fields — only send if superadmin actually changed them
      if (isSuperAdmin) {
        const newMonthly = monthlyOverride.trim() === "" ? null : Math.round(parseFloat(monthlyOverride) * 100);
        const newAnnual = annualOverride.trim() === "" ? null : Math.round(parseFloat(annualOverride) * 100);
        if (newMonthly !== location.locations_monthly_rate_cents) {
          body.locations_monthly_rate_cents = newMonthly;
        }
        if (newAnnual !== location.locations_annual_rate_cents) {
          body.locations_annual_rate_cents = newAnnual;
        }
      }

      if (Object.keys(body).length === 0) {
        // Nothing changed
        onClose?.();
        return;
      }

      const data = await updateLocation(parentTenant.id, location.id, body);
      onUpdated?.(data);
      onClose?.();
    } catch (err) {
      console.error("[EditLocationDialog] error:", err);
      setError(err.message || "Failed to update location");
    } finally {
      setSubmitting(false);
    }
  };

  const locationLabel = location.company_name || location.name || "Location";

  return (
    <>
      <div
        className="fixed inset-0 bg-stone-900/50 backdrop-blur-sm z-40 animate-in fade-in duration-200"
        onClick={() => !submitting && onClose?.()}
      />
      <div
        className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-2xl shadow-2xl z-50 animate-in fade-in zoom-in-95 duration-200 mx-4 max-h-[90vh] flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-location-title"
      >
        <div className="shrink-0 px-6 py-5 border-b border-stone-200 flex items-center justify-between">
          <div>
            <h3 id="edit-location-title" className="text-lg font-bold text-stone-900">
              Edit {locationLabel}
            </h3>
            <p className="text-xs text-stone-500 mt-0.5">
              Changes apply immediately. Rate changes trigger a notice email to admins.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="p-2 -mr-2 text-stone-500 hover:text-stone-900 hover:bg-stone-100 rounded-lg transition-colors disabled:opacity-50"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <Field label="Location name" required>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={submitting}
              className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 outline-none transition-all disabled:bg-stone-50"
            />
          </Field>

          <Field
            label="Public-facing company name"
            sublabel="What customers see (defaults to location name if empty)"
          >
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              disabled={submitting}
              className="w-full px-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 outline-none transition-all disabled:bg-stone-50"
            />
          </Field>

          <Field
            label="Plan"
            sublabel={
              location.billing_responsibility === "self_pays"
                ? "Changing the plan won't affect this self-pays franchisee. They control their own billing."
                : parentTenant?.parent_mode === "rollup_only"
                ? "Plan rate the franchisee will be billed"
                : "Per-location billing is 50% of your plan rate, regardless of this selection"
            }
          >
            <PlanSelect value={plan} onChange={setPlan} disabled={submitting} />
          </Field>

          {isSuperAdmin && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-4 space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold text-amber-800 uppercase tracking-wider">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                Superadmin overrides
              </div>
              <p className="text-xs text-amber-700 leading-relaxed">
                These override the calculated rate. Leave blank to use the default 50%-of-parent calculation.
                Setting a custom rate triggers a 30-day notice email if it's an increase.
              </p>

              <Field label="Monthly rate override" sublabel="Dollars per month (e.g. 199.00)">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={monthlyOverride}
                    onChange={(e) => setMonthlyOverride(e.target.value)}
                    placeholder="(default)"
                    disabled={submitting}
                    className="w-full pl-8 pr-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 outline-none transition-all disabled:bg-stone-50 bg-white"
                  />
                </div>
              </Field>

              <Field label="Annual rate override" sublabel="Total annual cents — e.g. 2388.00 = $199/mo annual">
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-stone-400">$</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={annualOverride}
                    onChange={(e) => setAnnualOverride(e.target.value)}
                    placeholder="(default)"
                    disabled={submitting}
                    className="w-full pl-8 pr-4 py-2.5 text-sm border border-stone-200 rounded-xl focus:border-stone-900 focus:ring-2 focus:ring-stone-900/10 outline-none transition-all disabled:bg-stone-50 bg-white"
                  />
                </div>
              </Field>
            </div>
          )}

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="shrink-0 px-6 py-4 border-t border-stone-200 bg-stone-50 rounded-b-2xl flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2.5 text-sm font-bold text-stone-600 hover:text-stone-900 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={submitting || !name.trim()}
            className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
          >
            {submitting && (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.25" strokeWidth="4" />
                <path d="M4 12a8 8 0 018-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              </svg>
            )}
            {submitting ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </>
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

function PlanSelect({ value, onChange, disabled }) {
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
          onClick={() => !disabled && onChange(p.id)}
          disabled={disabled}
          className={`px-3 py-3 text-center rounded-xl border-2 transition-all disabled:opacity-50 ${
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

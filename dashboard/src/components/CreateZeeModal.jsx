import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Mail, DollarSign, Network, X, Copy, CheckCircle2 } from "lucide-react";
import { LumaSpin } from "./ui/luma-spin";
import { createFranchiseZee, listHqTenants } from "../api";

/**
 * Superadmin-only modal to create a franchise zee under an existing HQ.
 *
 * Apr 29, 2026 — Phase 6 Franchise.
 * Mirrors CreateResellerModal flow:
 *   1. Form: HQ + Company Name + Owner Email + (optional) Monthly Override
 *   2. Submit → POST /api/admin/tenants/franchise-zee
 *   3. Backend creates tenant (plan='franchise', brand_mode='white_label',
 *      outbound gates OFF in plan_overrides.addons) + owner user + sends
 *      password-set invite email
 *   4. Success screen shows the zee's identity + invite_link for manual copy
 *
 * No public signup link — zees are admin-provisioned only. HQ admin can flip
 * outbound gates per-zee from the HQ Locations tab after creation.
 */
export default function CreateZeeModal({ isOpen, onClose, onCreated }) {
  const [form, setForm] = useState({
    hq_tenant_id: "",
    company_name: "",
    owner_email: "",
    monthly_dollars: "",
  });
  const [hqTenants, setHqTenants] = useState([]);
  const [hqLoading, setHqLoading] = useState(false);
  const [hqLoadError, setHqLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(null);

  // Load HQ list on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setHqLoading(true);
    setHqLoadError(null);
    listHqTenants()
      .then((tenants) => {
        if (cancelled) return;
        setHqTenants(tenants || []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[CreateZeeModal] listHqTenants failed:", err.message);
        setHqLoadError(err.message || "Failed to load HQ list");
      })
      .finally(() => {
        if (!cancelled) setHqLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  function reset() {
    setForm({
      hq_tenant_id: "",
      company_name: "",
      owner_email: "",
      monthly_dollars: "",
    });
    setError(null);
    setResult(null);
    setCopied(null);
    setLoading(false);
  }

  function handleClose() {
    if (result) onCreated?.(result);
    reset();
    onClose?.();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    if (!form.hq_tenant_id) {
      return setError("Select an HQ parent");
    }
    if (!form.company_name.trim() || form.company_name.trim().length < 2) {
      return setError("Company name must be at least 2 characters");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.owner_email)) {
      return setError("Please enter a valid email address");
    }

    let monthly_override_cents = null;
    if (form.monthly_dollars.trim() !== "") {
      const parsed = parseFloat(form.monthly_dollars);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return setError("Monthly override must be a non-negative number");
      }
      monthly_override_cents = Math.round(parsed * 100);
    }

    setLoading(true);
    try {
      const data = await createFranchiseZee({
        hq_tenant_id: form.hq_tenant_id,
        company_name: form.company_name.trim(),
        owner_email: form.owner_email.trim().toLowerCase(),
        monthly_override_cents,
      });
      setResult(data);
      // Don't call onCreated here — it triggers Admin.loadData which sets
      // loading=true and unmounts this modal, wiping the success screen.
      // Fire onCreated on close instead.
    } catch (err) {
      setError(err.message || "Failed to create zee");
    } finally {
      setLoading(false);
    }
  }

  function copyToClipboard(text, key) {
    navigator.clipboard?.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-md w-full overflow-hidden"
          >
            {/* SUCCESS STATE */}
            {result ? (
              <div className="p-8">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-emerald-100/50">
                  <CheckCircle2 size={32} />
                </div>
                <h3 className="text-xl font-black text-slate-900 text-center mb-2">
                  Zee created!
                </h3>
                <p className="text-sm text-slate-500 text-center font-medium leading-relaxed mb-6">
                  <strong className="text-slate-900">{result.tenant.name}</strong> is provisioned under <strong className="text-slate-900">{result.hq?.name || "HQ"}</strong>. An invite email has been sent to the owner.
                </p>

                <div className="space-y-3 mb-6">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                      Zee Tenant ID
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono font-bold text-slate-900 truncate">
                        {result.tenant.id}
                      </code>
                      <button
                        onClick={() => copyToClipboard(result.tenant.id, "id")}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-200 transition-colors shrink-0"
                      >
                        {copied === "id" ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                      Slug
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm font-mono font-bold text-slate-900">
                        {result.tenant.slug}
                      </code>
                      <button
                        onClick={() => copyToClipboard(result.tenant.slug, "slug")}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-200 transition-colors shrink-0"
                      >
                        {copied === "slug" ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>

                  {result.invite_link && (
                    <div className="p-3 bg-amber-50/60 rounded-xl border border-amber-200">
                      <div className="text-[10px] font-black text-amber-900 uppercase tracking-widest mb-1.5">
                        Owner Password-Set Link
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="flex-1 text-xs font-mono text-amber-900 truncate">
                          {result.invite_link}
                        </code>
                        <button
                          onClick={() => copyToClipboard(result.invite_link, "invite")}
                          className="p-1.5 rounded-lg text-amber-600 hover:text-amber-900 hover:bg-amber-100 transition-colors shrink-0"
                        >
                          {copied === "invite" ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
                        </button>
                      </div>
                      <div className="text-[10px] text-amber-700 mt-1.5">
                        Share only if the email fails. Expires in 48h.
                      </div>
                    </div>
                  )}
                </div>

                <div className="mb-6 p-3 bg-indigo-50/60 rounded-xl border border-indigo-100">
                  <div className="text-[10px] font-black text-indigo-900 uppercase tracking-widest mb-1.5">
                    Defaults Applied
                  </div>
                  <ul className="text-[11px] text-indigo-900/80 font-medium space-y-0.5">
                    <li>• brand_mode: white_label (inherits HQ chrome)</li>
                    <li>• outbound followup / lists / daily-max: OFF</li>
                  </ul>
                  <div className="text-[10px] text-indigo-700 mt-2">
                    Toggle outbound gates per-zee from the HQ Locations tab.
                  </div>
                </div>

                <button
                  onClick={handleClose}
                  className="w-full bg-slate-900 hover:bg-black text-white py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-xl shadow-slate-900/10"
                >
                  Done
                </button>
              </div>
            ) : (
              /* FORM STATE */
              <form onSubmit={handleSubmit} className="p-8">
                <div className="flex items-start justify-between mb-6">
                  <div className="w-16 h-16 bg-orange-50 text-orange-500 rounded-2xl flex items-center justify-center shadow-sm border border-orange-100/50">
                    <Network size={32} />
                  </div>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <h3 className="text-xl font-black text-slate-900 mb-2">Create Franchise Zee</h3>
                <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">
                  Provisions a new zee under an existing HQ. The owner receives an invite email to set their password and log in.
                </p>

                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600">
                    {error}
                  </div>
                )}

                <div className="space-y-4 mb-6">
                  {/* HQ selector */}
                  <div>
                    <label className="block text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1.5">
                      HQ Parent
                    </label>
                    {hqLoadError ? (
                      <>
                        <div className="relative">
                          <Network size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            required
                            placeholder="HQ tenant UUID"
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
                            value={form.hq_tenant_id}
                            onChange={(e) => setForm({ ...form, hq_tenant_id: e.target.value })}
                            disabled={loading}
                          />
                        </div>
                        <div className="text-[10px] text-amber-700 mt-1.5 font-bold">
                          HQ list unavailable — paste UUID manually.
                        </div>
                      </>
                    ) : hqLoading ? (
                      <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl">
                        <LumaSpin className="w-4 h-4 border-slate-400" />
                        <span className="text-sm text-slate-500 font-medium">Loading HQs…</span>
                      </div>
                    ) : hqTenants.length === 0 ? (
                      <>
                        <div className="relative">
                          <Network size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            required
                            placeholder="HQ tenant UUID"
                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm font-mono focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
                            value={form.hq_tenant_id}
                            onChange={(e) => setForm({ ...form, hq_tenant_id: e.target.value })}
                            disabled={loading}
                          />
                        </div>
                        <div className="text-[10px] text-slate-500 mt-1.5 font-medium">
                          No HQ tenants found. Set parent_mode='operating_hq' on a tenant first.
                        </div>
                      </>
                    ) : (
                      <div className="relative">
                        <Network size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none z-10" />
                        <select
                          required
                          className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all font-medium appearance-none"
                          value={form.hq_tenant_id}
                          onChange={(e) => setForm({ ...form, hq_tenant_id: e.target.value })}
                          disabled={loading}
                        >
                          <option value="">— Select HQ —</option>
                         {hqTenants.map((t) => (
                          <option key={t.id} value={t.id}>
                          {t.company_name || t.name} ({t.plan})
                        </option>
                      ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* Company name */}
                  <div>
                    <label className="block text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1.5">
                      Zee Company Name
                    </label>
                    <div className="relative">
                      <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        autoFocus
                        type="text"
                        required
                        placeholder="e.g. Groovy Hues — Omaha"
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all font-medium"
                        value={form.company_name}
                        onChange={(e) => setForm({ ...form, company_name: e.target.value })}
                        maxLength={100}
                        disabled={loading}
                      />
                    </div>
                  </div>

                  {/* Owner email */}
                  <div>
                    <label className="block text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1.5">
                      Owner Email
                    </label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        required
                        placeholder="owner@example.com"
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all font-medium"
                        value={form.owner_email}
                        onChange={(e) => setForm({ ...form, owner_email: e.target.value })}
                        disabled={loading}
                      />
                    </div>
                  </div>

                  {/* Monthly override (optional) */}
                  <div>
                    <label className="block text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1.5">
                      Monthly Override <span className="text-slate-400 font-bold normal-case tracking-normal">(optional, USD)</span>
                    </label>
                    <div className="relative">
                      <DollarSign size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        placeholder="225.00"
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all font-medium"
                        value={form.monthly_dollars}
                        onChange={(e) => setForm({ ...form, monthly_dollars: e.target.value })}
                        disabled={loading}
                      />
                    </div>
                    <div className="text-[10px] text-slate-500 mt-1.5 font-medium">
                      Leave blank for franchise tier default. Groovy Hues = 225.
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-slate-900 hover:bg-black text-white py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-xl shadow-slate-900/10 flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {loading && <LumaSpin className="w-4 h-4 border-white" />}
                    {loading ? "Creating..." : "Create Zee"}
                  </button>
                  <button
                    type="button"
                    onClick={handleClose}
                    disabled={loading}
                    className="w-full bg-white text-slate-400 hover:text-slate-600 font-bold text-xs py-2 transition-all uppercase tracking-wide"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

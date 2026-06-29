import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Mail, Layers, X, Copy, CheckCircle2 } from "lucide-react";
import { LumaSpin } from "./ui/luma-spin";
import { createResellerTenant } from "../api";

/**
 * Superadmin-only modal to create a new reseller tenant.
 *
 * Flow:
 *   1. Form: Name + Owner Email + Tier (starter/growth/scale)
 *   2. Submit → POST /api/admin/tenants/reseller
 *   3. Backend creates tenant + user + sends password-set invite email
 *   4. Success screen shows signup_link (reseller's public URL to share)
 *      and invite_link (password-set link for the owner)
 */
export default function CreateResellerModal({ isOpen, onClose, onCreated }) {
  const [form, setForm] = useState({ name: "", owner_email: "", tier: "starter" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(null);

  function reset() {
    setForm({ name: "", owner_email: "", tier: "starter" });
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

    if (!form.name.trim() || form.name.trim().length < 2) {
      return setError("Name must be at least 2 characters");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.owner_email)) {
      return setError("Please enter a valid email address");
    }

    setLoading(true);
    try {
     const data = await createResellerTenant({
  name: form.name.trim(),
  owner_email: form.owner_email.trim().toLowerCase(),
  tier: form.tier,
});
setResult(data);
// Don't call onCreated here — it triggers Admin.loadData which sets loading=true
// and unmounts this modal, wiping the success screen. Fire onCreated on close instead.
    } catch (err) {
      setError(err.message || "Failed to create reseller");
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
                  Reseller created!
                </h3>
                <p className="text-sm text-slate-500 text-center font-medium leading-relaxed mb-6">
                  <strong className="text-slate-900">{result.tenant.name}</strong> is active. An invite email has been sent to <strong>{result.tenant.primary_email}</strong>.
                </p>

                <div className="space-y-3 mb-6">
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                      Reseller Code
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-sm font-mono font-bold text-slate-900">
                        {result.tenant.reseller_code}
                      </code>
                      <button
                        onClick={() => copyToClipboard(result.tenant.reseller_code, "code")}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-200 transition-colors"
                      >
                        {copied === "code" ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>

                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                    <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1.5">
                      Public Signup Link
                    </div>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono text-slate-700 truncate">
                        {result.signup_link}
                      </code>
                      <button
                        onClick={() => copyToClipboard(result.signup_link, "signup")}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-200 transition-colors shrink-0"
                      >
                        {copied === "signup" ? <CheckCircle2 size={14} className="text-emerald-600" /> : <Copy size={14} />}
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
                  <div className="w-16 h-16 bg-indigo-50 text-indigo-500 rounded-2xl flex items-center justify-center shadow-sm border border-indigo-100/50">
                    <Layers size={32} />
                  </div>
                  <button
                    type="button"
                    onClick={handleClose}
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>

                <h3 className="text-xl font-black text-slate-900 mb-2">Create Reseller</h3>
                <p className="text-sm text-slate-500 font-medium leading-relaxed mb-6">
                  Provisions a new reseller account. The owner receives an invite email to set their password and log in.
                </p>

                {error && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-100 rounded-xl text-xs font-bold text-red-600">
                    {error}
                  </div>
                )}

                <div className="space-y-4 mb-6">
                  <div>
                    <label className="block text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1.5">
                      Reseller Name
                    </label>
                    <div className="relative">
                      <Building2 size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        autoFocus
                        type="text"
                        required
                        placeholder="e.g. Omaha Marketing Agency"
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all font-medium"
                        value={form.name}
                        onChange={(e) => setForm({ ...form, name: e.target.value })}
                        maxLength={100}
                        disabled={loading}
                      />
                    </div>
                  </div>

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

                  <div>
                    <label className="block text-[10px] font-black text-slate-700 uppercase tracking-widest mb-1.5">
                      Tier
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { id: "starter", label: "Starter", price: "$497/mo", limit: "10" },
                        { id: "growth", label: "Growth", price: "$1,497/mo", limit: "50" },
                        { id: "scale", label: "Scale", price: "$3,997/mo", limit: "∞" },
                      ].map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setForm({ ...form, tier: t.id })}
                          disabled={loading}
                          className={`p-3 rounded-xl border-2 transition-all text-left ${
                            form.tier === t.id
                              ? "border-slate-900 bg-white shadow-sm"
                              : "border-slate-200 bg-white hover:border-slate-300"
                          }`}
                        >
                          <div className="text-xs font-black text-slate-900">{t.label}</div>
                          <div className="text-[10px] text-slate-500 font-bold mt-0.5">{t.price}</div>
                          <div className="text-[10px] text-slate-400 mt-0.5">{t.limit} customers</div>
                        </button>
                      ))}
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
                    {loading ? "Creating..." : "Create Reseller"}
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

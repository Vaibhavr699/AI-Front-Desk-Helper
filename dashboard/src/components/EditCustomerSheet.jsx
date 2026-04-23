import React, { useState, useEffect } from "react";
import { updateResellerCustomer } from "../api";

/**
 * Edit modal for an existing reseller customer. Lets the reseller change
 * the customer's name, email, phone, and plan in-place. Hits PATCH
 * /api/reseller/customers/:id.
 *
 * Companion to AddCustomerSheet (which handles new customer creation).
 * Kept as a separate component because the workflows diverge: AddCustomerSheet
 * has plan-cap preview math + 3-step wizard, EditCustomerSheet is a single
 * inline form on an existing record.
 */
export default function EditCustomerSheet({ open, customer, onClose, onSaved }) {
  const [form, setForm] = useState({ name: "", primary_email: "", phone: "", plan: "growth" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Reset form when a different customer is opened
  useEffect(() => {
    if (customer) {
      setForm({
        name: customer.name || "",
        primary_email: customer.primary_email || "",
        phone: customer.phone || "",
        plan: customer.plan || "growth",
      });
      setError(null);
    }
  }, [customer]);

  if (!open || !customer) return null;

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateResellerCustomer(customer.id, {
        name: form.name.trim(),
        primary_email: form.primary_email.trim(),
        phone: form.phone.trim() || null,
        plan: form.plan,
      });
      onSaved?.(updated.customer || updated);
      onClose?.();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-stone-200 px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400">Edit customer</div>
            <h2 className="text-lg font-bold text-stone-900">{customer.name}</h2>
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

        <div className="p-6 space-y-5">
          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-stone-600 uppercase tracking-wider mb-1.5">Business name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full px-4 py-2.5 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:ring-4 focus:ring-stone-200 focus:border-stone-400 outline-none transition-all"
              placeholder="Customer business name"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-600 uppercase tracking-wider mb-1.5">Email</label>
            <input
              type="email"
              value={form.primary_email}
              onChange={(e) => setForm({ ...form, primary_email: e.target.value })}
              className="w-full px-4 py-2.5 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:ring-4 focus:ring-stone-200 focus:border-stone-400 outline-none transition-all"
              placeholder="customer@example.com"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-600 uppercase tracking-wider mb-1.5">Phone</label>
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              className="w-full px-4 py-2.5 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:ring-4 focus:ring-stone-200 focus:border-stone-400 outline-none transition-all"
              placeholder="+1 (555) 123-4567"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-stone-600 uppercase tracking-wider mb-1.5">Plan</label>
            <select
              value={form.plan}
              onChange={(e) => setForm({ ...form, plan: e.target.value })}
              className="w-full px-4 py-2.5 text-sm bg-stone-50 border border-stone-200 rounded-lg focus:ring-4 focus:ring-stone-200 focus:border-stone-400 outline-none transition-all"
            >
              <option value="basic">Basic</option>
              <option value="pro">Pro</option>
              <option value="elite">Elite</option>
            </select>
          </div>
        </div>

        <div className="sticky bottom-0 bg-white border-t border-stone-200 px-6 py-4 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="flex-1 px-4 py-2.5 text-sm font-bold text-stone-700 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !form.name.trim()}
            className="flex-1 px-4 py-2.5 text-sm font-bold text-white bg-stone-900 hover:bg-stone-800 rounded-lg transition-colors disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </>
  );
}

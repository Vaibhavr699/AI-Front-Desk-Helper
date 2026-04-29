// dashboard/src/components/CreateZeeModal.jsx
//
// Apr 29, 2026 — Phase 6 Franchise.
// Superadmin modal for creating a franchise zee under an existing HQ.
// Mirrors CreateResellerModal pattern. Posts to
// POST /api/admin/tenants/franchise-zee.
//
// Usage:
//   <CreateZeeModal
//     isOpen={isOpen}
//     onClose={() => setIsOpen(false)}
//     onSuccess={(zee) => { ... }}
//   />

import React, { useState, useEffect } from "react";
import { createFranchiseZee, listHqTenants } from "../api";

export default function CreateZeeModal({ isOpen, onClose, onSuccess }) {
  const [hqTenants, setHqTenants] = useState([]);
  const [hqLoading, setHqLoading] = useState(false);
  const [hqLoadError, setHqLoadError] = useState(null);

  const [hqTenantId, setHqTenantId] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [monthlyDollars, setMonthlyDollars] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [inviteLink, setInviteLink] = useState(null);

  // Load HQ list on open
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setHqLoading(true);
    setHqLoadError(null);
    listHqTenants()
      .then((data) => {
        if (cancelled) return;
        setHqTenants(data.tenants || []);
      })
      .catch((err) => {
        if (cancelled) return;
        // Graceful degradation — fall back to UUID text input
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

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      setHqTenantId("");
      setCompanyName("");
      setOwnerEmail("");
      setMonthlyDollars("");
      setError(null);
      setInviteLink(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit() {
    setError(null);
    setInviteLink(null);

    // Client-side validation
    if (!hqTenantId.trim()) {
      setError("Select an HQ");
      return;
    }
    if (!companyName.trim() || companyName.trim().length < 2) {
      setError("Company name is required (min 2 chars)");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail.trim())) {
      setError("Valid owner email required");
      return;
    }

    let monthlyOverrideCents = null;
    if (monthlyDollars.trim() !== "") {
      const parsed = parseFloat(monthlyDollars);
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError("Monthly override must be a non-negative number");
        return;
      }
      monthlyOverrideCents = Math.round(parsed * 100);
    }

    setSubmitting(true);
    try {
      const result = await createFranchiseZee({
        hq_tenant_id: hqTenantId.trim(),
        company_name: companyName.trim(),
        owner_email: ownerEmail.trim().toLowerCase(),
        monthly_override_cents: monthlyOverrideCents,
      });

      // Show invite link briefly so admin can copy if email failed
      setInviteLink(result.invite_link || null);

      if (typeof onSuccess === "function") {
        onSuccess(result.tenant);
      }

      // Auto-close after 2.5s if invite link shown, else immediate
      if (result.invite_link) {
        setTimeout(() => onClose(), 2500);
      } else {
        onClose();
      }
    } catch (err) {
      setError(err.message || "Failed to create zee");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Create Franchise Zee
          </h2>
          <button
            onClick={onClose}
            disabled={submitting}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none disabled:opacity-50"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* HQ selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              HQ Parent <span className="text-red-500">*</span>
            </label>
            {hqLoadError ? (
              <>
                <input
                  type="text"
                  value={hqTenantId}
                  onChange={(e) => setHqTenantId(e.target.value)}
                  placeholder="HQ tenant UUID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  disabled={submitting}
                />
                <p className="text-xs text-amber-600 mt-1">
                  HQ list unavailable — paste UUID manually.
                </p>
              </>
            ) : hqLoading ? (
              <div className="text-sm text-gray-500 py-2">Loading HQs…</div>
            ) : hqTenants.length === 0 ? (
              <>
                <input
                  type="text"
                  value={hqTenantId}
                  onChange={(e) => setHqTenantId(e.target.value)}
                  placeholder="HQ tenant UUID"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  disabled={submitting}
                />
                <p className="text-xs text-gray-500 mt-1">
                  No HQ tenants found. Set parent_mode='operating_hq' on a
                  tenant first.
                </p>
              </>
            ) : (
              <select
                value={hqTenantId}
                onChange={(e) => setHqTenantId(e.target.value)}
                disabled={submitting}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white"
              >
                <option value="">— Select HQ —</option>
                {hqTenants.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.company_name || t.name} ({t.parent_mode})
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Company name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Zee Company Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Groovy Hues — Omaha"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={submitting}
              maxLength={100}
            />
          </div>

          {/* Owner email */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Owner Email <span className="text-red-500">*</span>
            </label>
            <input
              type="email"
              value={ownerEmail}
              onChange={(e) => setOwnerEmail(e.target.value)}
              placeholder="owner@example.com"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              disabled={submitting}
            />
            <p className="text-xs text-gray-500 mt-1">
              Receives password-set invite (48h expiry).
            </p>
          </div>

          {/* Monthly override */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Monthly Override (USD)
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                $
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={monthlyDollars}
                onChange={(e) => setMonthlyDollars(e.target.value)}
                placeholder="225.00"
                className="w-full pl-7 pr-3 py-2 border border-gray-300 rounded-md text-sm"
                disabled={submitting}
              />
            </div>
            <p className="text-xs text-gray-500 mt-1">
              Leave blank for franchise tier default. Groovy Hues = 225.
            </p>
          </div>

          {/* Defaults note */}
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3 text-xs text-blue-900">
            <strong>Defaults:</strong> brand_mode=white_label, outbound
            followup/lists/daily-max OFF. Toggle per-zee from HQ Locations
            tab after creation.
          </div>

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">
              {error}
            </div>
          )}

          {/* Invite link (post-success) */}
          {inviteLink && (
            <div className="bg-green-50 border border-green-200 rounded-md p-3 text-xs">
              <div className="font-medium text-green-900 mb-1">
                Created. Invite link (copy if email failed):
              </div>
              <code className="block text-green-800 break-all bg-white p-2 rounded border border-green-100">
                {inviteLink}
              </code>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-200 flex items-center justify-end gap-2 bg-gray-50 rounded-b-lg">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 text-sm font-medium text-white bg-orange-600 border border-transparent rounded-md hover:bg-orange-700 disabled:opacity-50"
          >
            {submitting ? "Creating…" : "Create Zee"}
          </button>
        </div>
      </div>
    </div>
  );
}

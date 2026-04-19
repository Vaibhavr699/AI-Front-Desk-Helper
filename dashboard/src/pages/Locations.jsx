import React from "react";

/**
 * Locations page — F1 stub
 *
 * Real roster page (cards, costs, add/remove/edit) ships in F2.
 * For now this just confirms the route + sidebar gating works.
 */
export default function Locations({ tenantId }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-stone-900">Locations</h1>
        <p className="text-sm text-stone-500 mt-1">
          Manage your franchise locations and per-site billing
        </p>
      </div>

      <div className="rounded-2xl border-2 border-dashed border-stone-300 bg-stone-50/50 p-12 text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-stone-200 text-stone-500 mb-4">
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M3 21V9l4-3 4 3v12M3 21h8M3 21H1m10 0h2m0 0V11l5-3 5 3v10m-10 0h10m0 0h2"
            />
          </svg>
        </div>
        <h2 className="text-lg font-semibold text-stone-900 mb-1">
          Locations roster coming next
        </h2>
        <p className="text-sm text-stone-500 max-w-md mx-auto">
          Sidebar gating is working — you can see this page because your tenant
          is on a Pro+ plan or HQ tier. Full roster, billing breakdown, and add
          flow ship in the next deploy.
        </p>
        <p className="text-xs text-stone-400 mt-6">
          Tenant: <span className="font-mono">{tenantId || "—"}</span>
        </p>
      </div>
    </div>
  );
}

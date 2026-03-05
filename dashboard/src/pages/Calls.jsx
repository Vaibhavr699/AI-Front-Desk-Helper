import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getCalls } from "../api";

export default function Calls({ tenantId }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    getCalls(tenantId)
      .then((data) => setCalls(data.calls || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId) {
    return (
      <div className="px-0">
        <p className="text-stone-500 text-sm sm:text-base">Select a business to view calls.</p>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="px-0">
        <div className="animate-pulse text-stone-500 text-sm">Loading calls…</div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-0">
        <p className="text-red-600 text-sm sm:text-base">{error}</p>
      </div>
    );
  }

  return (
    <div className="px-0">
      <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-4 sm:mb-6">
        Calls
      </h1>
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200">
            <thead>
              <tr>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  From
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden sm:table-cell">
                  Time
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden md:table-cell">
                  Disposition
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                  <span className="sr-only">View</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {calls.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 sm:px-6 text-center text-sm text-stone-500">
                    No calls yet.
                  </td>
                </tr>
              ) : (
                calls.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50/80">
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-900 whitespace-nowrap">
                      {c.from_number || "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 whitespace-nowrap hidden sm:table-cell">
                      {new Date(c.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600">
                      {c.status || "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 hidden md:table-cell">
                      {c.transferred ? "Transferred" : c.disposition || "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-right">
                      <Link
                        to={`/calls/${c.id}`}
                        className="text-sm font-medium text-brand-600 hover:text-brand-700"
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

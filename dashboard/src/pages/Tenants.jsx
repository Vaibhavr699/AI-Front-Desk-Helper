import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getTenants } from "../api";

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getTenants()
      .then((data) => setTenants(data.tenants || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="px-0">
        <div className="animate-pulse text-stone-500 text-sm">Loading businesses…</div>
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
        Businesses
      </h1>
      <p className="text-sm text-stone-500 mb-4">
        All businesses on the platform. Select one in the header to view its calls, bookings, and settings.
      </p>
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200">
            <thead>
              <tr>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Name
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden sm:table-cell">
                  Company
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Phone numbers
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {tenants.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 sm:px-6 text-center text-sm text-stone-500">
                    No businesses yet.
                  </td>
                </tr>
              ) : (
                tenants.map((t) => {
                  const phones = (t.phones || []).filter(Boolean);
                  return (
                    <tr key={t.id} className="hover:bg-stone-50/80">
                      <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm font-medium text-stone-900">
                        {t.name || t.slug || "—"}
                      </td>
                      <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 hidden sm:table-cell">
                        {t.company_name || "—"}
                      </td>
                      <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600">
                        {phones.length > 0 ? (
                          <span className="font-mono text-xs">
                            {phones.map((p) => p.phone).join(", ")}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-right">
                        <Link
                          to="/settings"
                          state={{ switchTenantId: t.id }}
                          className="text-sm font-medium text-brand-600 hover:text-brand-700"
                        >
                          Settings
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

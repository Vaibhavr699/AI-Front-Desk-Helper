import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getCalls, getBookings, getMetrics, getTenant, getPlans } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";

export default function Dashboard({ tenantId, tenants = [], onTenantChange }) {
  const [recentCalls, setRecentCalls] = useState([]);
  const [bookingsCount, setBookingsCount] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) {
      setLoading(false);
      return;
    }
    Promise.all([
      getCalls(tenantId, { limit: 5 }),
      getBookings(tenantId),
      getMetrics(tenantId),
      getTenant(tenantId),
    ])
      .then(([callsRes, bookingsRes, metricsRes, tenantData]) => {
        setRecentCalls(callsRes.calls || []);
        setBookingsCount((bookingsRes.bookings || []).length);
        setMetrics(metricsRes);
        setTenant(tenantData);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId]);

  useEffect(() => {
    getPlans().then((res) => setPlans(res.plans || [])).catch(() => setPlans([]));
  }, []);

  if (!tenantId) {
    return (
      <div className="px-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-2">Home</h1>
        <p className="text-sm text-stone-500 mb-6">Select a business to see the overview.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {(tenants || []).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTenantChange?.(t.id)}
              className="text-left bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 hover:border-stone-300 hover:bg-stone-50/80 transition-colors"
            >
              <p className="font-medium text-stone-900">{t.company_name || t.name}</p>
              <p className="text-sm text-stone-500 mt-1">Select to view dashboard</p>
            </button>
          ))}
        </div>
        {(!tenants || tenants.length === 0) && (
          <p className="text-stone-500 text-sm sm:text-base">No businesses yet. Create one from the Businesses page.</p>
        )}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="px-0 flex items-center justify-center py-20">
        <LumaSpin />
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

  const hasPlan = tenant?.plan != null && String(tenant.plan).trim() !== "";
  const pricingPlans = plans.length ? plans : [
    { id: "basic", name: "Basic", priceMonthly: 29, whoItIsFor: "Small ops" },
    { id: "pro", name: "Pro", priceMonthly: 79, whoItIsFor: "Growing teams" },
    { id: "elite", name: "Elite", priceMonthly: 199, whoItIsFor: "Scaling companies" },
  ];

  return (
    <div className="px-0">
      <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-2">Home</h1>
      <p className="text-sm text-stone-500 mb-6">Overview for the selected business.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex flex-col">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l2.27-2.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
            </div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Total Calls</p>
          </div>
          <p className="text-2xl font-bold text-stone-900">
            {metrics?.total_calls ?? "—"}
          </p>
          <p className="text-xs text-stone-400 mt-1">Last 30 days</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex flex-col">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-green-50 text-green-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            </div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Booking %</p>
          </div>
          <p className="text-2xl font-bold text-stone-900">
            {metrics?.booked_pct != null ? metrics.booked_pct + "%" : "—"}
          </p>
          <p className="text-xs text-stone-400 mt-1">{metrics?.booked_count ?? 0} jobs booked</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex flex-col">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-stone-100 text-stone-900">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>
            </div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Revenue (AI)</p>
          </div>
          <p className="text-2xl font-bold text-stone-900">
            {metrics?.revenue_cents != null ? `$${(metrics.revenue_cents / 100).toLocaleString()}` : "—"}
          </p>
          <p className="text-xs text-stone-400 mt-1">From AI bookings</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex flex-col">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 rounded-lg bg-purple-50 text-purple-600">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>
            </div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">AI vs Human</p>
          </div>
          <p className="text-2xl font-bold text-stone-900">
            {metrics?.total_calls ? `${Math.round(((metrics.total_calls - metrics.transferred_count) / metrics.total_calls) * 100)}/${Math.round((metrics.transferred_count / metrics.total_calls) * 100)}` : "—"}
          </p>
          <p className="text-xs text-stone-400 mt-1">% split</p>
        </div>

        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex flex-col">
          <div className="flex items-center gap-3 mb-2">
            <div className={`p-2 rounded-lg ${tenant?.follow_up_enabled ? "bg-amber-50 text-amber-600" : "bg-stone-50 text-stone-400"}`}>
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
            </div>
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Follow-Ups</p>
          </div>
          <p className={`text-2xl font-bold ${tenant?.follow_up_enabled ? "text-stone-900" : "text-stone-400"}`}>
            {tenant?.follow_up_enabled ? "Active" : "Disabled"}
          </p>
          <p className="text-xs text-stone-400 mt-1">Automated System</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="px-4 py-3 sm:px-6 border-b border-stone-200 flex items-center justify-between">
          <h2 className="text-base font-medium text-stone-900">Recent calls</h2>
          <Link to="/calls" className="text-sm font-medium text-brand-600 hover:text-brand-700">
            View all
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200">
            <thead>
              <tr>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  From
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Time
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">
                  Status
                </th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider">
                  <span className="sr-only">View</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {recentCalls.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 sm:px-6 text-center text-sm text-stone-500">
                    No calls yet.
                  </td>
                </tr>
              ) : (
                recentCalls.map((c) => (
                  <tr key={c.id} className="hover:bg-stone-50/80">
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-900">
                      {c.from_number || "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 whitespace-nowrap">
                      {new Date(c.started_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600">
                      {c.transferred ? "Transferred" : c.disposition || c.status || "—"}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-right">
                      <Link
                        to={"/calls/" + c.id}
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

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getCalls, getBookings, getMetrics, getTenant, getPlans } from "../api";
import { Loading } from "../components";
import { LumaSpin } from "../components/ui/luma-spin";

export default function Dashboard({ tenantId }) {
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
        <p className="text-stone-500 text-sm sm:text-base">Select a business to see the home overview.</p>
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
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5">
          <p className="text-2xl sm:text-3xl font-semibold text-stone-900">
            {metrics?.total_calls ?? "—"}
          </p>
          <p className="text-sm text-stone-500 mt-1">Calls (30d)</p>
          <Link to="/metrics" className="text-sm font-medium text-brand-600 hover:text-brand-700 mt-2 inline-block">
            View metrics
          </Link>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5">
          <p className="text-2xl sm:text-3xl font-semibold text-stone-900">
            {metrics?.booked_pct != null ? metrics.booked_pct + "%" : "—"}
          </p>
          <p className="text-sm text-stone-500 mt-1">Booked</p>
          <Link to="/metrics" className="text-sm font-medium text-brand-600 hover:text-brand-700 mt-2 inline-block">
            View metrics
          </Link>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5">
          <p className="text-2xl sm:text-3xl font-semibold text-stone-900">
            {bookingsCount != null ? bookingsCount : "—"}
          </p>
          <p className="text-sm text-stone-500 mt-1">Total bookings</p>
          <Link to="/bookings" className="text-sm font-medium text-brand-600 hover:text-brand-700 mt-2 inline-block">
            View bookings
          </Link>
        </div>
        <div className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5">
          <p className="text-2xl sm:text-3xl font-semibold text-stone-900 capitalize">
            {tenant?.plan ?? "—"}
          </p>
          <p className="text-sm text-stone-500 mt-1">Current plan</p>
          <Link to="/plans" className="text-sm font-medium text-brand-600 hover:text-brand-700 mt-2 inline-block">
            View plans & pricing
          </Link>
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

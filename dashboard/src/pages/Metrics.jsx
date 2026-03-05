import { useState, useEffect } from "react";
import { getMetrics } from "../api";

export default function Metrics({ tenantId }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    getMetrics(tenantId).then(setMetrics).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId) return <div className="px-0"><p className="text-stone-500 text-sm sm:text-base">Select a business to view metrics.</p></div>;
  if (loading) return <div className="px-0"><div className="animate-pulse text-stone-500 text-sm">Loading metrics…</div></div>;
  if (error) return <div className="px-0"><p className="text-red-600 text-sm sm:text-base">{error}</p></div>;
  if (!metrics) return null;

  const cards = [
    { value: metrics.total_calls, label: "Total calls" },
    { value: `${metrics.booked_pct}%`, label: "Booked" },
    { value: `${metrics.transferred_pct}%`, label: "Transferred" },
    { value: metrics.ai_handled_count, label: "Handled by assistant" },
    { value: `$${(metrics.revenue_cents / 100).toFixed(2)}`, label: "Revenue (from bookings)" },
  ];

  return (
    <div className="px-0">
      <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-2">Metrics</h1>
      <p className="text-sm text-stone-500 mb-6">Last 30 days</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5">
            <p className="text-2xl sm:text-3xl font-semibold text-stone-900">{card.value}</p>
            <p className="text-sm text-stone-500 mt-1">{card.label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

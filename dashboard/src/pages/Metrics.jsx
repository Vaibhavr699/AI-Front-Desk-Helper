import { useState, useEffect } from "react";
import { getMetrics } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";

export default function Metrics({ tenantId }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    getMetrics(tenantId).then(setMetrics).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [tenantId]);

  if (!tenantId) return <div className="px-0"><p className="text-stone-500 text-sm sm:text-base">Select a business to view metrics.</p></div>;
  if (loading) return <div className="px-0 flex items-center justify-center py-20"><LumaSpin /></div>;
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
        {[
          { label: "Total Calls", value: metrics.total_calls, icon: "Phone", color: "text-blue-600", bg: "bg-blue-50" },
          { label: "Booking %", value: `${metrics.booked_pct}%`, icon: "CheckCircle", color: "text-green-600", bg: "bg-green-50" },
          { label: "Revenue (AI)", value: `$${(metrics.revenue_cents / 100).toLocaleString()}`, icon: "DollarSign", color: "text-stone-900", bg: "bg-stone-100" },
          { label: "AI vs Human", value: `${Math.round(((metrics.total_calls - metrics.transferred_count) / metrics.total_calls) * 100)}/${Math.round((metrics.transferred_count / metrics.total_calls) * 100)}`, icon: "Bot", color: "text-purple-600", bg: "bg-purple-50" },
          { label: "Follow-Ups", value: "Active", icon: "Zap", color: "text-amber-500", bg: "bg-amber-50" },
        ].map((card) => (
          <div key={card.label} className="bg-white rounded-xl border border-stone-200 shadow-sm p-4 sm:p-5 flex flex-col">
            <div className="flex items-center gap-3 mb-2">
              <div className={`p-2 rounded-lg ${card.bg} ${card.color}`}>
                {card.icon === "Phone" && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l2.27-2.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>}
                {card.icon === "CheckCircle" && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>}
                {card.icon === "DollarSign" && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
                {card.icon === "Bot" && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2" /><circle cx="12" cy="5" r="2" /><path d="M12 7v4" /><line x1="8" y1="16" x2="8" y2="16" /><line x1="16" y1="16" x2="16" y2="16" /></svg>}
                {card.icon === "Zap" && <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>}
              </div>
              <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">{card.label}</p>
            </div>
            <p className="text-2xl sm:text-3xl font-semibold text-stone-900">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

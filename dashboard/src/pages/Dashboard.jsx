import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getCalls, getBookings, getMetrics, getTenant, getPlans, getActivityFeed, getSalesWins } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";

export default function Dashboard({ tenantId, tenants = [], onTenantChange }) {
  const [recentCalls, setRecentCalls] = useState([]);
  const [salesWins, setSalesWins] = useState([]);
  const [bookingsCount, setBookingsCount] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [tenant, setTenant] = useState(null);
  const [activityFeed, setActivityFeed] = useState([]);
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showGuide, setShowGuide] = useState(false);

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
      getActivityFeed(tenantId),
      getSalesWins(tenantId),
    ])
      .then(([callsRes, bookingsRes, metricsRes, tenantData, feedRes, winsRes]) => {
        setRecentCalls(callsRes.calls || []);
        setBookingsCount((bookingsRes.bookings || []).length);
        setMetrics(metricsRes);
        setTenant(tenantData);
        setActivityFeed(feedRes.feed || []);
        setSalesWins(winsRes.sales_wins || []);
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
    <div className="px-0 space-y-8 pb-12">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">Command Center</h1>
      </header>

      {/* TODAY SECTION */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-6 bg-brand-500 rounded-full" />
          <h2 className="text-lg font-semibold text-stone-900">Today</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatWidget
            title="Calls Answered"
            value={metrics?.today?.calls}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l2.27-2.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>}
            color="bg-blue-50 text-blue-600"
          />
          <StatWidget
            title="Sales Wins"
            value={metrics?.today?.recovered}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>}
            color="bg-emerald-50 text-emerald-600"
            subtitle="Engines success"
          />
          <StatWidget
            title="Leads Captured"
            value={metrics?.today?.leads}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>}
            color="bg-purple-50 text-purple-600"
          />
          <StatWidget
            title="Booked"
            value={metrics?.today?.booked}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>}
            color="bg-amber-50 text-amber-600"
            subtitle="Appointments today"
          />
        </div>
      </section>

      {/* PIPELINE SECTION */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-6 bg-emerald-500 rounded-full" />
          <h2 className="text-lg font-semibold text-stone-900">Pipeline Value</h2>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatWidget
            title="Open Estimates"
            value={metrics?.pipeline?.open_estimates}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><polyline points="10 9 9 9 8 9" /></svg>}
            color="bg-stone-100 text-stone-600"
          />
          <StatWidget
            title="Jobs Scheduled"
            value={metrics?.pipeline?.jobs_scheduled}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>}
            color="bg-blue-50 text-blue-600"
          />
          <StatWidget
            title="Pipeline Value (AI Estimated)"
            value={metrics?.pipeline?.estimated_revenue != null ? `$${(metrics.pipeline.estimated_revenue / 100).toLocaleString()}` : "—"}
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
            color="bg-emerald-50 text-emerald-600"
          />
          <StatWidget
            title="Confirmed Revenue (DripJobs)"
            value={
              metrics?.pipeline?.actual_revenue != null && metrics.pipeline.actual_revenue > 0 ? (
                `$${(metrics.pipeline.actual_revenue / 100).toLocaleString()}`
              ) : (
                <div className="flex flex-col">
                  <span className="text-[14px] leading-tight font-black text-stone-900">$0</span>
                  <button 
                    onClick={() => setShowGuide(true)}
                    className="text-[9px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded mt-1 hover:bg-emerald-100 transition-all uppercase tracking-widest w-fit"
                  >
                    Setup tracking →
                  </button>
                </div>
              )
            }
            icon={<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" /></svg>}
            color="bg-indigo-50 text-indigo-600"
          />
        </div>
      </section>

      {showGuide && <ZapierGuideModal onClose={() => setShowGuide(false)} />}

      {/* FEED & SALES WINS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Sales Wins */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
            <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
              Sales Wins
            </h2>
            <Link to="/follow-ups" className="text-xs font-bold text-brand-600 hover:text-brand-700 uppercase tracking-widest">
              View Engines
            </Link>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            {salesWins.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center">
                <div className="w-12 h-12 rounded-full bg-stone-50 flex items-center justify-center mb-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" strokeWidth="2"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>
                </div>
                <p className="text-sm text-stone-400">No conversions recorded recently.</p>
              </div>
            ) : (
              salesWins.map((win) => (
                <div key={win.id} className="flex items-center justify-between p-4 rounded-xl border border-stone-100 bg-stone-50/30 hover:bg-stone-50 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-600 font-bold text-sm">
                      {win.contact_name?.[0] || "L"}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-stone-900">{win.contact_name}</p>
                      <p className="text-xs text-stone-500">{win.contact_phone}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700">
                      Converted
                    </span>
                    <p className="text-[10px] text-stone-400 mt-1">
                      {new Date(win.updated_at).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Live Activity Feed */}
        <section className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden flex flex-col h-[500px]">
          <div className="px-6 py-4 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
            <h2 className="text-base font-bold text-stone-900 flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
              Live Activity Feed
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {activityFeed.length === 0 ? (
              <p className="text-sm text-stone-400 text-center py-10">Waiting for activity...</p>
            ) : (
              activityFeed.map((event, i) => (
                <div key={event.id || i} className="flex gap-4 group">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 ${getEventColor(event.type)}`}>
                      {getEventInitial(event.type)}
                    </div>
                    {i < activityFeed.length - 1 && <div className="w-0.5 flex-1 bg-stone-100 my-1" />}
                  </div>
                  <div className="pb-2">
                    <p className="text-sm text-stone-900 font-medium leading-snug group-hover:text-brand-600 transition-colors">
                      {event.text}
                    </p>
                    <p className="text-xs text-stone-400 mt-1 uppercase tracking-wider font-semibold">
                      {new Date(event.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      {/* RECENT CALLS SECTION */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-6 bg-blue-500 rounded-full" />
          <h2 className="text-lg font-semibold text-stone-900">Recent Conversational Activity</h2>
        </div>
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-stone-100">
              <thead>
                <tr className="bg-stone-50/30">
                  <th className="px-6 py-3 text-left text-[10px] font-bold text-stone-400 uppercase tracking-widest">From</th>
                  <th className="px-6 py-3 text-left text-[10px] font-bold text-stone-400 uppercase tracking-widest">Time</th>
                  <th className="px-6 py-3 text-left text-[10px] font-bold text-stone-400 uppercase tracking-widest">Status</th>
                  <th className="relative px-6 py-3"><span className="sr-only">View</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {recentCalls.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-10 text-center text-sm text-stone-400">No calls recorded.</td>
                  </tr>
                ) : (
                  recentCalls.map((c) => (
                    <tr key={c.id} className="hover:bg-stone-50/50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-stone-900">{c.from_number || "—"}</td>
                      <td className="px-6 py-4 text-xs text-stone-500 whitespace-nowrap">
                        {new Date(c.started_at).toLocaleDateString([], { month: 'short', day: 'numeric' })} · {new Date(c.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${c.transferred ? "bg-amber-50 text-amber-700" : (c.disposition === 'booked' ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-600")}`}>
                          {c.transferred ? "Transferred" : (c.disposition || "Handled")}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <Link to={"/calls/" + c.id} className="p-2 rounded-lg hover:bg-stone-100 text-stone-400 hover:text-stone-900 transition-colors inline-block">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

function StatWidget({ title, value, icon, color, subtitle }) {
  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5 hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2.5 rounded-xl ${color}`}>
          {icon}
        </div>
        {subtitle && <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{subtitle}</span>}
      </div>
      <div>
        <p className="text-xs font-semibold text-stone-500 uppercase tracking-widest mb-1">{title}</p>
        <p className="text-3xl font-bold text-stone-900 tracking-tight">
          {value ?? "—"}
        </p>
      </div>
    </div>
  );
}

function getEventColor(type) {
  switch (type) {
    case 'call': return 'bg-blue-50 text-blue-600 border-blue-100';
    case 'booking': return 'bg-emerald-50 text-emerald-600 border-emerald-100';
    case 'recovery': return 'bg-amber-50 text-amber-600 border-amber-100';
    case 'follow_up': return 'bg-purple-50 text-purple-600 border-purple-100';
    default: return 'bg-stone-50 text-stone-600 border-stone-100';
  }
}

function getEventInitial(type) {
  switch (type) {
    case 'call': return 'C';
    case 'booking': return 'B';
    case 'recovery': return 'R';
    case 'follow_up': return 'F';
    default: return 'E';
  }
}

function ZapierGuideModal({ onClose }) {
  const [copied, setCopied] = useState(false);
  const webhookUrl = "https://ai-front-desk-backend.onrender.com/api/webhooks/crm/estimate-sent";

  const handleCopy = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm" onClick={onClose}></div>
      <div className="relative bg-white rounded-3xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
         <div className="p-6 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h2 className="text-lg font-black text-gray-900 tracking-tight leading-none">Setup Revenue Tracking</h2>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mt-1">Connect DripJobs or your CRM via Zapier</p>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center text-gray-400 hover:bg-gray-100 transition-colors">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
         </div>
         
         <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6 text-left">
            <section>
               <h3 className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                 <div className="w-4 h-4 bg-orange-500 rounded text-white flex items-center justify-center text-[9px]">1</div>
                 Step 1: Create Your Zap
               </h3>
               <p className="text-[11px] text-gray-500 leading-relaxed mb-3 text-left">
                 Use the <strong>"Webhooks by Zapier"</strong> app as your action. Set the event to <strong>POST</strong> and use this endpoint:
               </p>
               <div className="bg-gray-50 p-3 rounded-lg font-mono text-[10px] text-gray-600 border border-gray-100 flex items-center justify-between group">
                  <span className="truncate">{webhookUrl}</span>
                  <button 
                    onClick={handleCopy}
                    className="text-[9px] font-black text-blue-600 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity uppercase"
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
               </div>
            </section>

            <section>
               <h3 className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                 <div className="w-4 h-4 bg-orange-500 rounded text-white flex items-center justify-center text-[9px]">2</div>
                 Step 2: Map the Data
               </h3>
               <p className="text-[11px] text-gray-500 leading-relaxed mb-3 text-left">
                 In the <strong>Action → Data</strong> section, enter these keys on the left and select the matching fields from your CRM on the right. 
               </p>
               <div className="bg-gray-900 rounded-lg p-5 text-emerald-400 font-mono text-[10px] leading-relaxed text-left border-l-4 border-emerald-500 shadow-xl">
                  <div className="flex justify-between border-b border-gray-800 pb-2 mb-2 text-gray-500 uppercase font-bold text-[9px] tracking-widest">
                    <span>Key (Type this in)</span>
                    <span>Value (Select from CRM)</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-gray-300">api_key</span>
                    <span>YOUR_API_KEY</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-gray-300">contact_name</span>
                    <span className="text-emerald-500 italic">"First Name" + "Last Name"</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-gray-300">contact_phone</span>
                    <span className="text-emerald-500 italic">"Phone Number"</span>
                  </div>
                  <div className="flex justify-between py-1">
                    <span className="text-gray-300">estimated_revenue_cents</span>
                    <span className="text-emerald-500 italic">"Total Price"</span>
                  </div>
               </div>
               
               <div className="mt-3 p-3 bg-rose-50 border border-rose-100 rounded-xl">
                 <p className="text-[10px] font-black text-rose-700 uppercase tracking-widest mb-1 flex items-center gap-1">
                   <AlertCircle size={10} /> Common Mapping Error
                 </p>
                 <p className="text-[10px] text-rose-600 leading-relaxed">
                   <strong>Do not</strong> map more than one field into the revenue box. Zapier will combine them (e.g. "$1200NewStage") which the system cannot process. Select only the numeric total.
                 </p>
               </div>
            </section>

            <section className="bg-emerald-50/50 p-4 rounded-2xl border border-emerald-100">
               <h3 className="text-[10px] font-black text-emerald-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                 <div className="w-4 h-4 bg-emerald-500 rounded text-white flex items-center justify-center text-[9px]">3</div>
                 Final Step: Tracking "Confirmed Revenue"
               </h3>
               <p className="text-[11px] text-emerald-800 leading-relaxed mb-3">
                 To see money show up in your <strong>"Confirmed Revenue"</strong> card, create a <strong>second Zap</strong> that triggers when a job is marked as "Won" or "Completed" in your CRM. Use this endpoint:
               </p>
               <div className="bg-white p-3 rounded-lg font-mono text-[10px] text-emerald-700 border border-emerald-100 mb-3 select-all">
                  https://ai-front-desk-backend.onrender.com/api/webhooks/crm/job-won
               </div>
               <p className="text-[11px] text-emerald-800 leading-relaxed">
                 Map the same fields (Phone and Total) as you did in Step 2. This will move the lead from "Pipeline" to "Confirmed".
               </p>
            </section>

            <section>
               <h3 className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                 <div className="w-4 h-4 bg-orange-500 rounded text-white flex items-center justify-center text-[9px]">4</div>
                 Step 4: Add Authorization
               </h3>
               <p className="text-[11px] text-gray-500 leading-relaxed mb-3 text-left">
                 Add your API key (found in <span className="font-bold text-gray-900">Settings → Integrations</span>) as a Header:
               </p>
               <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                  <div className="flex justify-between text-[9px] font-black text-gray-400 uppercase tracking-widest mb-1.5">
                     <span>Header Name</span>
                     <span>Value</span>
                  </div>
                  <div className="flex justify-between font-mono text-[10px] text-gray-700">
                     <span>Authorization</span>
                     <span className="text-blue-600 font-bold">Bearer YOUR_API_KEY</span>
                  </div>
               </div>
            </section>

            <div className="bg-blue-50 border border-blue-50 rounded-xl p-4 flex gap-3 text-left">
               <div className="w-5 h-5 bg-blue-100 rounded-full flex items-center justify-center text-blue-600 shrink-0">
                 <span className="text-[10px] font-black">!</span>
               </div>
               <div className="text-[10px] text-blue-800 leading-relaxed">
                 <strong className="block mb-0.5">PRO-TIP: REVENUE IN CENTS</strong>
                 Our system tracks revenue in cents to ensure precision. If your job total is $1,500.00, send <strong>150000</strong>. You can use Zapier Formatter to multiply the dollar total by 100.
               </div>
            </div>
         </div>

         <div className="p-6 bg-gray-50 border-t border-gray-100 flex justify-end">
            <button 
              onClick={onClose}
              className="px-5 py-2.5 bg-gray-900 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:opacity-90 transition-opacity shadow-lg shadow-gray-200"
            >
              Done, Let's track some ROI
            </button>
         </div>
      </div>
    </div>
  );
}

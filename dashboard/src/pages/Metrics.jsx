import React, { useState, useEffect } from "react";
import { getMetrics } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { 
  CheckCircle2, 
  AlertCircle,
  ArrowUpRight,
  PhoneCall,
  MessageSquare,
  Facebook,
  Mail,
  Zap,
  Activity,
  Globe,
  TrendingUp,
  CreditCard,
  Target
} from "lucide-react";

import { MetricHero } from "../components/metrics/MetricHero";
import { ModernKpiCard } from "../components/metrics/ModernKpiCard";
import { OutcomeBar } from "../components/metrics/OutcomeBar";
import { InsightBar } from "../components/metrics/InsightBar";

// Global Helpers
const formatPrice = (c) => `$${Math.round(c/100).toLocaleString()}`;
const getTrend = (c, cT, p, pT) => {
  if (!cT || !pT) return "0%";
  const diff = Math.round(((c/cT)*100) - ((p/pT)*100));
  return `${diff >= 0 ? '+' : ''}${diff}%`;
};

export default function Metrics({ tenantId }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [timeRange, setTimeRange] = useState('30d');

  useEffect(() => {
    if (!tenantId) return;
    loadMetrics();
  }, [tenantId, timeRange]);

  const loadMetrics = async () => {
    if (metrics) setIsRefreshing(true);
    else setLoading(true);
    try {
      const data = await getMetrics(tenantId, timeRange);
      setMetrics(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  };

  if (!tenantId) return <div className="flex flex-col items-center justify-center h-96 p-10 text-center"><Target className="text-gray-200 mb-4" size={48}/><h2 className="text-lg font-bold text-gray-400 uppercase tracking-widest">Select business center to begin</h2></div>;
  if (loading) return <div className="flex items-center justify-center h-[70vh]"><LumaSpin /></div>;
  if (error) return <div className="m-8 p-6 bg-rose-50 border border-rose-100 rounded-xl flex items-center gap-4 text-rose-700 shadow-sm"><AlertCircle /> <div><h3 className="font-bold uppercase text-xs tracking-widest">Failed to load data</h3><p className="text-sm opacity-80">{error}</p></div></div>;
  if (!metrics) return null;

  const ai = metrics.ai || {};
  const aiPrev = metrics.aiPrev || {};
  const pipeline = metrics.pipeline || {};
  const dm = metrics.metrics || {};

  const callsHandled = ai.calls_handled || 0;
  const callsHandledPrev = aiPrev.calls_handled || 0;
  const booked = ai.calls_booked || 0;
  const followup = ai.calls_followup || 0;
  const transferred = ai.calls_transferred || 0;
  const hungup = ai.calls_hung_up || 0;
  const confused = ai.calls_confused || 0;

  const actualRev = pipeline.actual_revenue || 0;
  const estimatedRev = pipeline.estimated_revenue || 0;
  const revPerCall = callsHandled > 0 ? Math.round(((actualRev + estimatedRev) / 100) / callsHandled) : 0;
  const lostPotential = Math.round((callsHandled * 0.35) * revPerCall * 100);

  const bookingRate = callsHandled > 0 ? Math.round((booked / callsHandled) * 100) : 0;
  const bookingRatePrev = aiPrev.calls_handled > 0 ? Math.round((aiPrev.calls_booked / aiPrev.calls_handled) * 100) : 0;

  const commonProps = {
    ai, aiPrev, pipeline, dm, 
    callsHandled, callsHandledPrev,
    booked, followup, transferred, hungup, confused,
    bookingRate, bookingRatePrev,
    actualRev, estimatedRev, lostPotential, timeRange,
    getTrend, formatPrice
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8 py-8 animate-in fade-in duration-500">
      
      {/* High-Fidelity Header */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 pb-6 border-b border-gray-100">
        <div className="flex items-center gap-6">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Business Metrics</h1>
          <div className="flex items-center gap-1 p-1 bg-gray-100/80 rounded-lg">
            {['today', '7d', '30d', '90d', 'all'].map(r => (
              <button key={r} onClick={() => setTimeRange(r)} className={`px-4 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${timeRange === r ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>{r==='all'?'All time':r}</button>
            ))}
          </div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <div className="px-3 py-1 bg-gray-50 rounded-full border border-gray-100 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
            Updated real-time
          </div>
          <div className="text-sm font-bold text-gray-900 pr-2">
            {metrics.isRollup ? 'All Locations' : (metrics.location_breakdown?.[0]?.name || 'Current Branch')}
          </div>
        </div>
      </div>

      <MetricHero revPerCall={revPerCall} callsHandled={callsHandled} confirmedRevenue={actualRev} lostWithoutAi={lostPotential} />


        {/* Dynamic Insight Banners */}
        <div className="space-y-4 pt-2">
          {hungup > 0 && (
            <InsightBar 
              type={ (hungup/Math.max(callsHandled,1)) > 0.1 ? "error" : "success" }
              title={`Hung-up rate is ${Math.round((hungup/Math.max(callsHandled,1))*100)}% — ${ (hungup/Math.max(callsHandled,1)) > 0.1 ? "above 10% target" : "within optimal range" }`}
              description={`${hungup} callers hung up without resolution this month. ${ ai.hung_up_30s > (hungup/2) ? "Most hung-up calls lasted under 30 seconds — suggesting the AI greeting or first response is confusing callers. Review the AI instructions and welcome message. Consider A/B testing a different opening line." : "Pattern suggests callers are dropping later in the conversation. Review AI instructions." }`}
            />
          )}
          <InsightBar 
            type={ (confused/Math.max(callsHandled,1)) > 0.05 ? "warning" : "success" }
            title={`Confusion rate is ${Math.round((confused/Math.max(callsHandled,1))*100)}% — ${ (confused/Math.max(callsHandled,1)) > 0.05 ? "requires attention" : "excellent" }`}
            description={`Only ${confused} calls showed confusion signals this month. ${ (confused/Math.max(callsHandled,1)) > 0.05 ? "AI may need more clear training data." : "AI is understanding callers clearly. No action needed." }`}
          />
        </div>
      {metrics.isRollup && (
        <section className="space-y-3 pt-4">
          <SectionTitle title="Network Locations" />
          <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
             <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-gray-50/50 border-b border-gray-200/60 font-bold text-gray-500 text-[10px] uppercase tracking-wider">
                    <tr><th className="px-6 py-4">Business Location</th><th className="px-4 py-4 text-right">Volume</th><th className="px-4 py-4 text-right">Success</th><th className="px-6 py-4 text-right">Confirmed Revenue</th></tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {metrics.location_breakdown?.map((l, i) => (
                      <tr key={l.id} className="hover:bg-gray-50/30 transition-colors group">
                        <td className="px-6 py-4 flex items-center gap-3">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-[10px] ${i%2===0?'bg-blue-50 text-blue-600':'bg-orange-50 text-orange-600'}`}>{l.name.substring(0,2)}</div>
                          <span className="font-bold text-gray-700">{l.name}</span>
                        </td>
                        <td className="px-4 py-4 text-right font-mono font-medium">{l.calls} calls</td>
                        <td className="px-4 py-4 text-right font-bold text-emerald-600">{l.rate}%</td>
                        <td className="px-6 py-4 text-right font-bold text-gray-900">${Math.round(l.revenue/100).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
          </div>
        </section>
      )}

      {/* KPI GRID */}
      <section className="space-y-3 pt-2">
        <SectionTitle title="Primary KPIs" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-6">
           <ModernKpiCard label="Calls Answered" value={callsHandled.toLocaleString()} trendValue={`${Math.abs(callsHandled - callsHandledPrev)}`} trendLabel="vs last month" trendDirection={(callsHandled - callsHandledPrev) >= 0 ? 'up' : 'down'} topBadge="+18%" />
           <ModernKpiCard label="Booking Rate" value={`${bookingRate}%`} trendLabel="Industry avg 25%" trendDirection="neutral" topBadge="+6pts" />
           <ModernKpiCard label="Est. Acceptance Rate" value={`${pipeline.close_rate || 0}%`} trendLabel="Target 60%" trendDirection="neutral" topBadge="Target 60%" topBadgeColor="text-orange-700 bg-orange-50 border-orange-100" />
           <ModernKpiCard label="Active Follow-ups" value={pipeline.open_estimates || 34} trendLabel="AI working background" topBadge="Active" topBadgeColor="text-blue-700 bg-blue-50 border-blue-100" />
           <ModernKpiCard label="No-show Rate" value="7%" trendLabel="Target under 10%" topBadge="Great" topBadgeColor="text-emerald-700 bg-emerald-50 border-emerald-100" />
        </div>
      </section>

      {/* AI Breakdown */}
      <section className="space-y-3 pt-4">
        <SectionTitle title="AI Performance Breakdown" />
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           <PerformanceCard label="AI Success Rate" value={`${Math.round(((booked + followup)/Math.max(callsHandled,1))*100)}%`} sub="Booked + follow-up needed" color="text-emerald-600" />
           <PerformanceCard label="Failure Rate" value={`${Math.round(((hungup + confused)/Math.max(callsHandled,1))*100)}%`} sub="Hung up + confused" color="text-rose-600" />
           <PerformanceCard label="Transfer Rate" value={`${Math.round((transferred/Math.max(callsHandled,1))*100)}%`} sub="Caller requested human" color="text-blue-600" />
        </div>



        <div className="space-y-4 pt-4">
          <SectionTitle title="Call outcome breakdown" />
          <div className="bg-white border border-gray-200/60 rounded-xl shadow-sm overflow-hidden">
             <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/10">
                <div className="flex gap-8 text-[10px] font-bold text-gray-400 uppercase leading-none ml-auto">
                   <span>Count</span> <span>% Weight</span> <span className="w-16 text-right">Trend</span>
                </div>
             </div>
             <div className="p-6 space-y-5">
                <OutcomeBar dotColor="bg-emerald-500" color="bg-emerald-500" label="Booked" count={booked} pct={Math.round((booked/Math.max(callsHandled,1))*100)} trend={getTrend(booked, callsHandled, aiPrev.calls_booked||0, callsHandledPrev)} subtext="appointments" />
                <OutcomeBar dotColor="bg-orange-500" color="bg-orange-500" label="Follow-up needed" count={followup} pct={Math.round((followup/Math.max(callsHandled,1))*100)} trend="0%" />
                <OutcomeBar dotColor="bg-blue-500" color="bg-blue-500" label="Transferred" count={transferred} pct={Math.round((transferred/Math.max(callsHandled,1))*100)} trend="0%" />
             </div>
          </div>
        </div>
      </section>

      {/* Tables Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-12">
         <div className="space-y-4">
            <SectionTitle title="Lead Source Analysis" />
            <div className="bg-white border border-gray-200/60 rounded-xl p-6 shadow-sm min-h-[400px]">
               <div className="overflow-x-auto">
                 <SourceTable 
                   headers={['Source', 'Leads', 'Won', 'Rate', 'Value']} 
                   rows={dm.sources?.length > 0 ? dm.sources.map(s=>({...s, label: s.label, won: s.booked, value: formatPrice(s.revenue), rate: `${s.rate}%`})) : []} 
                 />
                 {!dm.sources?.length && <div className="h-40 flex items-center justify-center text-xs font-bold text-gray-400 uppercase">Awaiting source data...</div>}
               </div>
            </div>
         </div>
         <div className="space-y-4 flex flex-col">
            <SectionTitle title="Revenue Tracking" />
            <div className="bg-white border border-gray-200/60 rounded-xl p-6 shadow-sm flex-1 flex flex-col justify-between">
               <div className="space-y-6 py-4">
                 <RevRow label="Booked (Pipeline)" color="bg-blue-500" value={formatPrice(estimatedRev)} />
                 <RevRow label="Collected (Actual)" color="bg-emerald-500" value={formatPrice(actualRev)} />
                 <RevRow label="Lost (Abandonment)" color="bg-rose-500" value={formatPrice(lostPotential)} />
               </div>
               <div className="pt-6 border-t border-gray-100 flex justify-between items-center text-gray-900">
                 <span className="text-[11px] font-bold uppercase">Consolidated Pipeline</span>
                 <span className="text-xl font-bold font-mono tracking-tighter">{formatPrice(actualRev + estimatedRev)}</span>
               </div>
            </div>
         </div>
      </div>
    </div>
  );
}

function SectionTitle({ title }) {
  return (
    <div className="flex items-center gap-3 py-1">
      <div className="w-1 h-3.5 bg-orange-500 rounded-full shadow-sm"></div>
      <h2 className="text-xs font-bold text-gray-900 uppercase tracking-widest leading-none">{title}</h2>
    </div>
  );
}

function PerformanceCard({ label, value, sub, color }) {
  return (
    <div className="bg-white border border-gray-200/60 rounded-xl p-6 shadow-sm flex flex-col justify-between h-36 border-t-4 border-t-gray-100 hover:border-t-orange-500 transition-all duration-300 group">
      <div>
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1.5">{label}</div>
        <div className={`text-3xl font-bold ${color} tracking-tighter leading-none mb-1 group-hover:scale-[1.02] origin-left transition-transform`}>{value}</div>
        <div className="text-[10px] font-medium text-gray-400 uppercase tracking-tight">{sub}</div>
      </div>
      <div className="w-fit px-2 py-0.5 rounded-full bg-gray-50 text-[9px] font-bold text-gray-400 uppercase tracking-widest ring-1 ring-gray-100 font-sans">Analytics Active</div>
    </div>
  );
}

function Funnel_Row({ label, count, total, u, color }) {
  const pct = total > 0 ? Math.round((count/total)*100) : 0;
  return (
    <div className="flex items-center gap-4">
      <div className="w-24 text-[10px] font-bold text-gray-600 uppercase shrink-0 leading-none">{label}</div>
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden relative">
        <div className={`h-full ${color || 'bg-gray-900'} transition-all duration-1000`} style={{ width: `${pct}%` }}></div>
      </div>
      <div className="text-[11px] font-bold text-gray-900 w-8 text-right font-mono">{pct}%</div>
    </div>
  );
}

function RevRow({ label, color, value }) {
  return (
    <div className="flex items-center justify-between group">
      <div className="flex items-center gap-3">
        <div className={`w-2.5 h-2.5 rounded-full ${color} shadow-sm group-hover:scale-110 transition-transform`}></div>
        <span className="text-[13px] font-bold text-gray-600">{label}</span>
      </div>
      <span className="text-[15px] font-bold text-gray-900 font-mono tracking-tight">{value}</span>
    </div>
  );
}

function SourceTable({ headers, rows }) {
  return (
    <table className="w-full text-left text-[11px] font-mono whitespace-nowrap">
      <thead>
        <tr className="text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-100 font-bold">
          {headers.map((h, i) => <th key={i} className={`pb-3 ${i>0?'text-right':''}`}>{h}</th>)}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-50">
        {rows.map((r, i) => (
          <tr key={i} className="hover:bg-gray-50/20 transition-colors">
            <td className="py-3 font-bold text-gray-700 flex items-center gap-2">
               <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>{r.label}
            </td>
            <td className="py-3 text-right font-bold text-gray-900">{r.leads}</td>
            <td className="py-3 text-right font-bold text-gray-600">{r.won || r.booked}</td>
            <td className="py-3 text-right font-bold text-emerald-600">{r.rate}</td>
            <td className="py-3 text-right font-bold text-gray-900">{r.value || r.revenue}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

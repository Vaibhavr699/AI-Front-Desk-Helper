import React, { useState, useEffect, useMemo } from "react";
import { getMetrics } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { 
  TrendingUp, 
  Users, 
  Target, 
  DollarSign, 
  Bot, 
  PhoneCall, 
  ArrowUpRight, 
  ArrowDownRight,
  PieChart as PieIcon,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  Clock,
  Mail,
  MessageCircle,
  UserPlus,
  Timer,
  Activity,
  Smartphone,
  Phone
} from "lucide-react";

/**
 * Custom SVG Pie Chart
 */
const PieChart = ({ data, size = 200 }) => {
  if (!data || !Array.isArray(data)) return null;

  const isNewSchema = data.some(item => item.hasOwnProperty('value'));
  const total = data.reduce((sum, item) => sum + (item.leads || item.value || 0), 0);
  let cumulativePercent = 0;

  const getCoordinatesForPercent = (percent) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  const colors = ["#3b82f6", "#10b981", "#f59e0b", "#f87171", "#8b5cf6", "#6366f1"];

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="-1 -1 2 2" className="transform -rotate-90 w-full h-full">
        {data.map((item, i) => {
          if (total === 0) return null;
          const value = item.leads || item.value || 0;
          const [startX, startY] = getCoordinatesForPercent(cumulativePercent);
          cumulativePercent += value / total;
          const [endX, endY] = getCoordinatesForPercent(cumulativePercent);
          const largeArcFlag = value / total > 0.5 ? 1 : 0;
          const pathData = [
            `M ${startX} ${startY}`,
            `A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY}`,
            `L 0 0`,
          ].join(" ");
          return <path key={i} d={pathData} fill={colors[i % colors.length]} className="hover:opacity-80 transition-opacity" />;
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
        <div className="w-3/5 h-3/5 bg-white rounded-full flex items-center justify-center shadow-lg border border-gray-50">
          <div className="text-center">
            <div className="text-xl font-black text-gray-900 leading-none">{total}</div>
            <div className="text-[8px] text-gray-400 font-black tracking-widest mt-1 uppercase">TOTAL</div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Custom SVG Bar Chart
 */
const BarChart = ({ data }) => {
  if (!data || !Array.isArray(data)) return null;
  const maxVal = Math.max(...data.map(d => Math.max(d.leads || 0, d.bookings || 0, 5)));
  
  return (
    <div className="w-full h-[200px] flex items-end gap-2 pt-4 px-2">
      {data.map((item, i) => {
        const leadHeight = Math.max(((item.leads || 0) / maxVal) * 100, 2); // Min 2% for visibility
        const bookingHeight = Math.max(((item.bookings || 0) / maxVal) * 100, 2);
        const dateObj = new Date(item.date);
        const label = isNaN(dateObj.getTime()) ? "?" : dateObj.toLocaleDateString('en-US', { weekday: 'short' });

        return (
          <div key={i} className="flex-1 flex flex-col items-center h-full group">
            {/* Bars Container - explicit height allows % child height to work robustly */}
            <div className="relative w-full h-[160px] flex items-end justify-center gap-1 border-b border-gray-100">
              {/* Tooltip on hover */}
              <div className="absolute -top-12 left-1/2 -translate-x-1/2 bg-gray-900 text-white text-[10px] p-2 rounded shadow-xl opacity-0 group-hover:opacity-100 transition-opacity z-10 whitespace-nowrap pointer-events-none">
                {item.leads || 0} Leads<br/>{item.bookings || 0} Bookings
              </div>
              
              <div 
                className="w-2.5 sm:w-4 bg-blue-500 rounded-t-sm transition-all shadow-sm"
                style={{ height: `${leadHeight}%` }}
              ></div>
              <div 
                className="w-2.5 sm:w-4 bg-green-500 rounded-t-sm transition-all shadow-sm"
                style={{ height: `${bookingHeight}%` }}
              ></div>
            </div>
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-tighter mt-3">{label}</span>
          </div>
        );
      })}
    </div>
  );
};

export default function Metrics({ tenantId }) {
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
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

  if (!tenantId) return <div className="p-10 text-center text-gray-500 font-medium">Select a business to view analytics.</div>;
  if (loading) return <div className="flex items-center justify-center h-96"><LumaSpin /></div>;
  if (error) return <div className="p-8 text-red-500 flex items-center gap-2 font-medium bg-red-50 rounded-xl border border-red-100"><AlertCircle size={20}/> {error}</div>;
  if (!metrics) return null;

  const isNewSchema = metrics.isRollup || (metrics.sales && metrics.ai);

  if (!isNewSchema) {
    return (
      <div className="p-10 text-center text-gray-500 font-medium">
        <AlertCircle className="mx-auto mb-4 text-amber-500" size={48} />
        <h2 className="text-xl font-bold text-gray-900 mb-2">Metrics Update in Progress</h2>
        <p>The system is currently refreshing your data source.</p>
        <button 
          onClick={loadMetrics}
          className="mt-6 px-4 py-2 bg-primary text-stone-900 rounded-lg font-bold shadow-sm hover:opacity-90 transition-opacity"
        >
          REFRESH NOW
        </button>
      </div>
    );
  }

  if (metrics.isRollup) {
    return (
      <div className={isRefreshing ? "opacity-50 transition-opacity pointer-events-none" : "transition-opacity"}>
         <HQRollupDashboard metrics={metrics} />
      </div>
    );
  }

  const ai = metrics.ai || {};
  const aiPrev = metrics.aiPrev || {};
  const sales = metrics.sales || {};
  const pipeline = metrics.pipeline || {};

  const callsHandled = ai.calls_handled || 0;
  const callTrend = callsHandled - (aiPrev.calls_handled || 0);

  const callsBooked = ai.calls_booked || 0;
  const callsFollowup = ai.calls_followup || 0;
  const callsTransferred = ai.calls_transferred || 0;
  const callsHungUp = ai.calls_hung_up || 0;
  const callsConfused = ai.calls_confused || 0;
  const callsSpam = ai.calls_spam || 0;

  const successRate = callsHandled > 0 ? Math.round(((callsBooked + callsFollowup) / callsHandled) * 100) : 0;
  const failureRate = callsHandled > 0 ? Math.round(((callsHungUp + callsConfused) / callsHandled) * 100) : 0;
  const transferRate = callsHandled > 0 ? Math.round((callsTransferred / callsHandled) * 100) : 0;

  const confirmedRevenueActual = pipeline.actual_revenue || 0;
  const estimatedRevenuePotential = pipeline.estimated_revenue || 0;
  const totalTrackedRevenue = confirmedRevenueActual + estimatedRevenuePotential;
  
  const revPerCall = callsHandled > 0 ? Math.round((totalTrackedRevenue / 100) / callsHandled) : 0;
  const lostWithoutAi = Math.round((callsHandled * 0.4) * revPerCall);

  const bookingRate = callsHandled > 0 ? Math.round((callsBooked / callsHandled) * 100) : 0;
  const activeFollowups = pipeline.open_estimates || 0;

  const totalLeads = sales.leads_generated || 0;
  const estSent = sales.estimates_accepted || 0;
  const apptsBooked = ai.appointments_booked || 0;
  const jobsWonConfirmed = pipeline.confirmed_jobs || 0;

  const estimatedRevenue = pipeline.estimated_revenue || 0;
  const lostRev = pipeline.lost_revenue || 0;
  const topRevenueTotal = confirmedRevenueActual + estimatedRevenue + lostRev;

  const hungUpTotal = callsHungUp || 1;
  const hu10pct = Math.round(((ai.hung_up_10s || 0) / hungUpTotal) * 100) || 0;
  const hu30pct = Math.round(((ai.hung_up_30s || 0) / hungUpTotal) * 100) || 0;
  const hu60pct = Math.round(((ai.hung_up_60s || 0) / hungUpTotal) * 100) || 0;

  const confuses = [
    { label: '"Can you repeat that?"', count: ai.confused_repeat || 0, resolved: 'Yes', resColor: 'text-emerald-500 bg-emerald-50' },
    { label: '"I don\'t understand"', count: ai.confused_understand || 0, resolved: 'Partial', resColor: 'text-orange-500 bg-orange-50' },
    { label: '"What did you say?"', count: ai.confused_what_say || 0, resolved: 'Yes', resColor: 'text-emerald-500 bg-emerald-50' },
    { label: '"Huh?" / "What?"', count: ai.confused_huh || 0, resolved: 'No — hung up', resColor: 'text-rose-500 bg-rose-50' }
  ].filter(c => c.count > 0 || c.label === '"Can you repeat that?"').sort((a,b) => b.count - a.count);

  const getBarWidth = (val) => callsHandled > 0 ? `${(val / callsHandled) * 100}%` : '0%';
  const getPct = (val) => callsHandled > 0 ? Math.round((val / callsHandled) * 100) : 0;

  return (
    <div className={`space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-12 ${isRefreshing ? 'opacity-60 grayscale-[0.2] transition-all' : 'transition-all'}`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Business Metrics</h1>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-200 border border-gray-300 rounded-xl p-1 gap-1">
             {['today', '7d', '30d', '90d'].map((range) => (
                <button 
                  key={range}
                  onClick={() => setTimeRange(range)}
                  disabled={isRefreshing}
                  className={`px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${timeRange === range ? 'bg-white text-gray-900 shadow-lg shadow-gray-200/50' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {range}
                </button>
             ))}
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 ml-4 bg-white border border-gray-200 rounded-xl shadow-sm text-[10px] font-black text-gray-400 uppercase tracking-widest">
            <div className={`w-1.5 h-1.5 rounded-full ${isRefreshing ? 'bg-amber-400' : 'bg-emerald-500 animate-pulse'}`}></div>
            {isRefreshing ? 'syncing...' : 'Real-time'}
          </div>
        </div>
      </div>

      {/* Hero Banner */}
      <div className="bg-[#1a1816] rounded-2xl p-8 text-white flex flex-col md:flex-row md:items-center justify-between shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 opacity-10 pointer-events-none translate-x-1/4 -translate-y-1/4">
          <DollarSign size={300} />
        </div>
        <div className="relative z-10 mb-6 md:mb-0">
          <h3 className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] mb-2">REVENUE PER CALL ANSWERED — YOUR #1 ROI METRIC</h3>
          <div className="text-6xl font-black text-[#ff6a00] tracking-tighter leading-none mb-3">${revPerCall}</div>
          <p className="text-sm font-medium text-white/70">Every call the AI answers is worth ${revPerCall} in confirmed + estimated revenue</p>
        </div>
        <div className="relative z-10 flex flex-wrap gap-8 md:gap-14">
           <div>
             <div className="text-xl font-black">{callsHandled}</div>
             <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mt-1">Calls answered</div>
           </div>
           <div>
             <div className="text-xl font-black">${Math.round(estimatedRevenuePotential/100).toLocaleString()}</div>
             <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mt-1">Pipeline value (AI Est)</div>
           </div>
           <div>
             <div className="text-xl font-black text-emerald-400">
                {confirmedRevenueActual > 0 
                  ? `$${Math.round(confirmedRevenueActual/100).toLocaleString()}` 
                  : "$0"}
             </div>
             <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mt-1">Confirmed revenue</div>
             {confirmedRevenueActual === 0 && (
                <button 
                  onClick={() => setShowGuide(true)}
                  className="text-[8px] font-black text-emerald-400 bg-emerald-400/10 px-2 py-1 rounded mt-2 hover:bg-emerald-400/20 transition-all uppercase tracking-widest"
                >
                  Setup tracking →
                </button>
             )}
           </div>
           <div>
             <div className="text-xl font-black text-rose-400">${lostWithoutAi.toLocaleString()}</div>
             <div className="text-[10px] font-bold text-white/50 uppercase tracking-widest mt-1">Lost value without AI</div>
           </div>
        </div>
      </div>

      {/* Primary KPIs */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-orange-500 rounded-full" />
          <h2 className="text-xs font-black text-gray-900 uppercase tracking-widest">Primary KPIs</h2>
          <div className="ml-auto text-[10px] font-bold text-gray-400 uppercase tracking-widest">Last 30 days</div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-4">
           <KpiCard 
             label="Calls Answered" 
             value={callsHandled} 
             trend={`${callTrend > 0 ? '+' : ''}${callTrend} vs last month`} 
             trendColor={callTrend >= 0 ? "text-emerald-500 bg-emerald-50" : "text-rose-500 bg-rose-50"}
             topBadge={callTrend > 0 ? `+${Math.round((callTrend/(aiPrev.calls_handled || 1))*100)}%` : null}
           />
           <KpiCard 
             label="Booking Rate" 
             value={`${bookingRate}%`} 
             trend="Industry avg 25%" 
             trendColor="text-gray-400"
             topBadge="+6pts"
           />
           <KpiCard 
             label="Est. Acceptance Rate" 
             value={`${sales.close_rate || 0}%`} 
             trend="+3pts vs last month"
             trendColor="text-emerald-500"
             topBadge="Target 60%"
             topBadgeColor="text-orange-600 bg-orange-50"
           />
           <KpiCard 
             label="Active Follow-ups" 
             value={activeFollowups} 
             trend="AI working background" 
             trendColor="text-gray-400"
             topBadge="Active"
             topBadgeColor="text-blue-600 bg-blue-50"
           />
           <KpiCard 
             label="No-show rate" 
             value="7%" 
             trend="Target under 10%" 
             trendColor="text-gray-400"
             topBadge="Great"
             topBadgeColor="text-emerald-600 bg-emerald-50"
           />
        </div>
      </div>

      {/* AI Performance Breakdown */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-1 h-4 bg-gray-900 rounded-full" />
          <h2 className="text-xs font-black text-gray-900 uppercase tracking-widest">AI Performance Breakdown</h2>
          <div className="ml-auto text-[10px] font-bold text-gray-400 uppercase tracking-widest">How every call ended — last 30 days</div>
        </div>
        
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#fafffb] border border-emerald-100 rounded-2xl p-6 shadow-sm flex flex-col justify-between h-[140px]">
            <div>
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">AI Success Rate</div>
              <div className="text-3xl font-black text-emerald-600 tracking-tight">{successRate}%</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase mt-1">Booked + follow-up needed</div>
            </div>
            <div className="text-xs font-bold text-emerald-700 flex items-center gap-1.5"><CheckCircle2 size={14}/> Healthy — target 70%+</div>
          </div>

          <div className="bg-[#fffcfc] border border-rose-100 rounded-2xl p-6 shadow-sm flex flex-col justify-between h-[140px]">
            <div>
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Failure Rate</div>
              <div className="text-3xl font-black text-rose-600 tracking-tight">{failureRate}%</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase mt-1">Hung up + confused</div>
            </div>
            <div className="text-xs font-bold text-rose-700 flex items-center gap-1.5"><AlertCircle size={14}/> Watch — target under 10%</div>
          </div>

          <div className="bg-[#f9fbff] border border-blue-100 rounded-2xl p-6 shadow-sm flex flex-col justify-between h-[140px]">
             <div>
              <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Transfer Rate</div>
              <div className="text-3xl font-black text-blue-600 tracking-tight">{transferRate}%</div>
              <div className="text-[10px] font-bold text-gray-500 uppercase mt-1">Caller requested human</div>
            </div>
             <div className="text-xs font-bold text-blue-700 flex items-center gap-1.5"><ArrowUpRight size={14}/> Normal — mostly positive</div>
          </div>
        </div>

        {/* AI Performance Alerts */}
        <div className="space-y-3 mb-8">
           {failureRate > 10 ? (
             <div className="flex items-start gap-4 p-4 rounded-xl border border-rose-200 bg-rose-50/50">
                <div className="w-4 h-4 mt-0.5 rounded-full shadow-[inset_0_-2px_0_rgba(0,0,0,0.1)] bg-rose-500 shrink-0"></div>
                <div>
                   <h4 className="text-sm font-bold text-rose-800">Hung-up / Failure rate is {failureRate}% — above 10% target</h4>
                   <p className="text-xs font-medium text-rose-700 mt-0.5">{(callsHungUp+callsConfused)} callers hung up without resolution this month. Suggests the AI greeting or first response may temporarily confuse callers. Consider A/B testing a different opening line in Settings.</p>
                </div>
             </div>
           ) : (
             <div className="flex items-start gap-4 p-4 rounded-xl border border-emerald-200 bg-emerald-50/50">
                <div className="w-4 h-4 mt-0.5 rounded-full shadow-[inset_0_-2px_0_rgba(0,0,0,0.1)] bg-emerald-500 shrink-0"></div>
                <div>
                   <h4 className="text-sm font-bold text-emerald-800">Failure rate is {failureRate}% — excellent</h4>
                   <p className="text-xs font-medium text-emerald-700 mt-0.5">Only {(callsHungUp+callsConfused)} calls failed this month. AI is understanding callers clearly. No action needed.</p>
                </div>
             </div>
           )}
        </div>

        {/* Call Outcome Progress Bars */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-end justify-between bg-gray-50/50">
            <div>
              <h3 className="text-sm font-bold text-gray-900">Call outcome breakdown</h3>
              <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5">{callsHandled} total calls — what happened on each one</p>
            </div>
            <div className="text-[10px] font-bold text-gray-400 uppercase">Count · % of total · vs last month</div>
          </div>
          <div className="p-6 space-y-6">
             <OutcomeRow color="bg-[#10b981]" dot="bg-emerald-500" label="Booked" count={callsBooked} pct={getPct(callsBooked)} width={getBarWidth(callsBooked)} text="calls booked an appointment" />
             <OutcomeRow color="bg-[#f97316]" dot="bg-orange-500" label="Follow-up needed" count={callsFollowup} pct={getPct(callsFollowup)} width={getBarWidth(callsFollowup)} text="calls" />
             <OutcomeRow color="bg-[#3b82f6]" dot="bg-blue-500" label="Transferred" count={callsTransferred} pct={getPct(callsTransferred)} width={getBarWidth(callsTransferred)} text="calls" />
             <OutcomeRow color="bg-[#ef4444]" dot="bg-rose-500" label="Hung up" count={callsHungUp} pct={getPct(callsHungUp)} width={getBarWidth(callsHungUp)} text="calls (< 60s)" />
             <OutcomeRow color="bg-[#facc15]" dot="bg-yellow-400" label="Confused" count={callsConfused} pct={getPct(callsConfused)} width={getBarWidth(callsConfused)} text="calls" />
             <OutcomeRow color="bg-[#64748b]" dot="bg-slate-500" label="Spam / Other" count={callsSpam} pct={getPct(callsSpam)} width={getBarWidth(callsSpam)} text="calls" />
          </div>
        </div>

        {/* Analysis Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-8">
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <h3 className="text-sm font-bold text-gray-900">Hung-up call analysis</h3>
            <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5 mb-6">When in the call did they hang up?</p>
            <div className="space-y-4 mb-6">
              <AnalysisRow label="Under 10 seconds" count={ai.hung_up_10s||0} pct={hu10pct} color="bg-rose-400" />
              <AnalysisRow label="10–30 seconds" count={ai.hung_up_30s||0} pct={hu30pct} color="bg-rose-400" />
              <AnalysisRow label="30+ seconds" count={ai.hung_up_60s||0} pct={hu60pct} color="bg-rose-400" />
            </div>
            <p className="text-xs text-gray-500 font-medium leading-relaxed">
              {hu10pct + hu30pct}% of hung-up calls ended in the first 30 seconds. This points to the <strong className="text-gray-700">greeting or AI voice</strong> as the issue — not the conversation itself. Try updating the welcome message in Settings.
            </p>
          </div>
          
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
            <h3 className="text-sm font-bold text-gray-900">Confused call triggers</h3>
            <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5 mb-6">What phrases caused confusion — last 30 days</p>
            <div className="overflow-hidden mb-6">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-100 text-[9px] font-black text-gray-400 uppercase tracking-widest">
                    <td className="pb-3">Trigger Phrase Detected</td>
                    <td className="pb-3 text-right">Count</td>
                    <td className="pb-3 text-right">Resolved?</td>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {confuses.slice(0,4).map((c, i) => (
                    <tr key={i}>
                      <td className="py-3 font-bold text-gray-700">{c.label}</td>
                      <td className="py-3 text-right font-black text-gray-900">{c.count}</td>
                      <td className="py-3 text-right">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${c.resColor}`}>{c.resolved}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-gray-500 font-medium">
              Most confusion is recoverable. Only {callsConfused} confused calls led to hang-ups. AI is handling confusion well overall — {callsHandled > 0 ? Math.round(((callsHungUp+callsConfused)/callsHandled)*100) : 0}% rate is excellent.
            </p>
          </div>
        </div>
      </div>

        {/* Revenue & Funnel */}
        <div className="mt-8">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 bg-orange-500 rounded-full" />
            <h2 className="text-xs font-black text-gray-900 uppercase tracking-widest">Revenue</h2>
            <div className="ml-auto text-[10px] font-bold text-gray-400 uppercase tracking-widest">Pipeline vs Confirmed vs Lost</div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 flex flex-col justify-between">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Revenue Breakdown</h3>
                <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5 mb-8">Estimated pipeline and actual confirmed</p>
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-blue-500"></div>
                      <span className="text-sm font-medium text-gray-600">Pipeline — booked, not done yet</span>
                    </div>
                    <span className="text-sm font-black text-blue-600">${Math.round(estimatedRevenue/100).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                      <span className="text-sm font-medium text-gray-600">Confirmed — actual from DripJobs</span>
                    </div>
                    <span className="text-sm font-black text-emerald-600">${Math.round(confirmedRevenueActual/100).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                      <span className="text-sm font-medium text-gray-600">Lost — cancelled bookings</span>
                    </div>
                    <span className="text-sm font-black text-rose-500">-${Math.round(lostRev/100).toLocaleString()}</span>
                  </div>
                </div>
              </div>
              <div className="mt-8 pt-4 border-t border-gray-100 flex items-center justify-between">
                <span className="text-sm font-black text-gray-900">Total pipeline value</span>
                <span className="text-lg font-black text-gray-900">${Math.round(topRevenueTotal/100).toLocaleString()}</span>
              </div>
            </div>
            
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
               <h3 className="text-sm font-bold text-gray-900">Conversion Funnel</h3>
               <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5 mb-6">Call to confirmed job</p>
               <div className="space-y-4">
                 <FunnelRow label="Calls answered" max={callsHandled} count={callsHandled} color="bg-gray-900" labelText="calls" />
                 <FunnelRow label="Leads captured" max={callsHandled} count={totalLeads} color="bg-slate-700" labelText="leads" />
                 <FunnelRow label="Estimates sent" max={callsHandled} count={estSent} color="bg-[#ea580c]" labelText="sent" />
                 <FunnelRow label="Booked appt" max={callsHandled} count={apptsBooked} color="bg-[#f97316]" labelText="booked" />
                 <FunnelRow label="Job confirmed" max={callsHandled} count={jobsWonConfirmed} color="bg-[#10b981]" labelText="won" />
                </div>
             </div>
          </div>
        </div>

        {/* Lead Source Analysis */}
        <div className="mt-12">
          <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 bg-orange-500 rounded-full" />
            <h2 className="text-xs font-black text-gray-900 uppercase tracking-widest">Lead Source Analysis</h2>
            <div className="ml-auto text-[10px] font-bold text-gray-400 uppercase tracking-widest">Marketing source + contact method</div>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
               <h3 className="text-sm font-bold text-gray-900">By Marketing Source</h3>
               <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5 mb-6">Which channel drove the lead — tracked by phone number</p>
               <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-[9px] font-black text-gray-400 uppercase tracking-widest">
                       <td className="pb-3">Source</td>
                       <td className="pb-3 text-right">Leads</td>
                       <td className="pb-3 text-right">Booked</td>
                       <td className="pb-3 text-right">Rate</td>
                       <td className="pb-3 text-right">Revenue</td>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(metrics.metrics?.sources || []).map((s, i) => (
                      <tr key={i}>
                        <td className="py-3 flex items-center gap-2 font-bold text-gray-700">
                           <div className="w-2 h-2 rounded-full" style={{ backgroundColor: ["#3b82f6", "#10b981", "#f97316", "#3b82f6", "#f97316", "#94a3b8"][i % 6] }}></div>
                           {s.label}
                        </td>
                        <td className="py-3 text-right font-black text-gray-900">{s.leads}</td>
                        <td className="py-3 text-right font-bold text-gray-700">{s.booked}</td>
                        <td className="py-3 text-right font-black text-emerald-600">{s.rate}%</td>
                        <td className="py-3 text-right font-black text-gray-900">${(s.revenue/100).toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-900 font-black text-gray-900">
                       <td className="py-3">Total</td>
                       <td className="py-3 text-right">{(metrics.metrics?.sources || []).reduce((a,b)=>a+b.leads, 0)}</td>
                       <td className="py-3 text-right">{(metrics.metrics?.sources || []).reduce((a,b)=>a+b.booked, 0)}</td>
                       <td className="py-3 text-right text-emerald-600">{Math.round(((metrics.metrics?.sources || []).reduce((a,b)=>a+b.booked, 0) / Math.max((metrics.metrics?.sources || []).reduce((a,b)=>a+b.leads, 0), 1)) * 100)}%</td>
                       <td className="py-3 text-right">${((metrics.metrics?.sources || []).reduce((a,b)=>a+b.revenue, 0) / 100).toLocaleString()}</td>
                    </tr>
                  </tbody>
               </table>
            </div>

            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6">
               <h3 className="text-sm font-bold text-gray-900">By Contact Method</h3>
               <p className="text-[10px] font-bold text-gray-400 uppercase mt-0.5 mb-6">How they reached you</p>
               <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-gray-100 text-[9px] font-black text-gray-400 uppercase tracking-widest">
                       <td className="pb-3">Method</td>
                       <td className="pb-3 text-right">Actions</td>
                       <td className="pb-3 text-right">Booked</td>
                       <td className="pb-3 text-right">Rate</td>
                       <td className="pb-3 text-right">Revenue</td>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {(metrics.metrics?.methods || []).map((m, i) => (
                      <tr key={i}>
                        <td className="py-3 flex items-center gap-2 font-bold text-gray-700">
                           {m.label === 'Phone call' && <Phone size={12} className="text-gray-400" />}
                           {m.label === 'SMS follow-up' && <MessageCircle size={12} className="text-gray-400" />}
                           {m.label === 'Website chat' && <bot size={12} className="text-gray-400" />}
                           {m.label === 'Email' && <Mail size={12} className="text-gray-400" />}
                           {m.label}
                        </td>
                        <td className="py-3 text-right font-black text-gray-900">{m.leads}</td>
                        <td className="py-3 text-right font-bold text-gray-700">{m.booked}</td>
                        <td className="py-3 text-right font-black text-emerald-600">{m.rate}%</td>
                        <td className="py-3 text-right font-black text-gray-900">${(m.revenue/100).toLocaleString()}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-gray-900 font-black text-gray-900">
                       <td className="py-3">Total</td>
                       <td className="py-3 text-right">{(metrics.metrics?.methods || []).reduce((a,b)=>a+b.leads, 0)}</td>
                       <td className="py-3 text-right">{(metrics.metrics?.methods || []).reduce((a,b)=>a+b.booked, 0)}</td>
                       <td className="py-3 text-right text-emerald-600">{Math.round(((metrics.metrics?.methods || []).reduce((a,b)=>a+b.booked, 0) / Math.max((metrics.metrics?.methods || []).reduce((a,b)=>a+b.leads, 0), 1)) * 100)}%</td>
                       <td className="py-3 text-right">${((metrics.metrics?.methods || []).reduce((a,b)=>a+b.revenue, 0) / 100).toLocaleString()}</td>
                    </tr>
                  </tbody>
               </table>
            </div>
          </div>
        </div>

        {/* Operational Metrics */}
        <div className="mt-12">
           <div className="flex items-center gap-2 mb-4">
            <div className="w-1 h-4 bg-gray-900 rounded-full" />
            <h2 className="text-xs font-black text-gray-900 uppercase tracking-widest">Operational Metrics</h2>
          </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
             <OperationalCard label="Missed calls recovered" value={metrics.metrics?.ops?.recovered_count || 0} sub="Would've gone to voicemail" badge="Working" badgeColor="bg-emerald-50 text-emerald-600" />
             <OperationalCard label="Avg time to book" value={`${metrics.metrics?.ops?.avg_time_to_book || 0}min`} sub="First call to booked" topValue="" />
             <OperationalCard label="Follow-up conversion" value={`${metrics.metrics?.ops?.followup_conv || 0}%`} sub="Leads won by follow-up" badge="+22%" badgeColor="bg-orange-50 text-orange-600" />
             <OperationalCard label="Avg job value" value={`$${(metrics.metrics?.ops?.avg_job_value || 0 / 100).toLocaleString()}`} sub="From completed jobs" topValue="" valueColor="text-emerald-600" />
          </div>
        </div>
        
        <div className="flex items-center justify-center gap-2 mt-16 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
           <span>AI Front Desk Helper</span>
           <span className="w-1 h-1 rounded-full bg-gray-300"></span>
           <span>Business Metrics</span>
           <span className="w-1 h-1 rounded-full bg-gray-300"></span>
           <span>Real-time data · April 2026</span>
        </div>

        {showGuide && <ZapierGuideModal onClose={() => setShowGuide(false)} />}
      </div>
  );
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
         
         <div className="p-6 max-h-[70vh] overflow-y-auto space-y-6">
            <section>
               <h3 className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                 <div className="w-4 h-4 bg-orange-500 rounded text-white flex items-center justify-center text-[9px]">1</div>
                 Step 1: Create Your Zap
               </h3>
               <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
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
               <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
                 In the <strong>Data</strong> section, map your CRM fields to these values. We use the phone number to automatically match the revenue to the correct call.
               </p>
               <div className="bg-gray-900 rounded-lg p-5 text-emerald-400 font-mono text-[10px] leading-relaxed">
                  {`{\n`}
                  {`  "api_key": "YOUR_API_KEY",\n`}
                  {`  "contact_name": "Customer Name",\n`}
                  {`  "contact_phone": "Customer Phone",\n`}
                  {`  "estimated_revenue_cents": 150000,\n`}
                  {`  "lead_source": "DripJobs Update"\n`}
                  {`}`}
               </div>
            </section>

            <section>
               <h3 className="text-[10px] font-black text-gray-900 uppercase tracking-widest mb-3 flex items-center gap-2">
                 <div className="w-4 h-4 bg-orange-500 rounded text-white flex items-center justify-center text-[9px]">3</div>
                 Step 3: Add Authorization
               </h3>
               <p className="text-[11px] text-gray-500 leading-relaxed mb-3">
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

            <div className="bg-blue-50 border border-blue-50 rounded-xl p-4 flex gap-3">
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

function KpiCard({ label, value, trend, trendColor, topBadge, topBadgeColor = "text-emerald-700 bg-emerald-50" }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-5 shadow-sm relative pt-10 hover:shadow-md transition-shadow">
       {topBadge && (
         <div className={`absolute top-4 left-5 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${topBadgeColor}`}>
           {topBadge}
         </div>
       )}
       <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">{label}</div>
       <div className="text-3xl font-black text-[#ff6a00] tracking-tight mb-2">{value}</div>
       <div className={`text-[10px] font-bold ${trendColor}`}>
         {trend}
       </div>
    </div>
  );
}

function OutcomeRow({ color, dot, label, count, pct, width, text }) {
  return (
    <div className="flex items-center gap-6 group">
       <div className="w-[140px] flex items-center gap-3 shrink-0">
         <div className={`w-3 h-3 rounded-full shadow-[inset_0_-1px_0_rgba(0,0,0,0.1)] ${dot}`}></div>
         <span className="text-xs font-bold text-gray-700">{label}</span>
       </div>
       <div className="flex-1 flex items-center gap-2">
         <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
            {count > 0 && (
              <div className={`h-full ${color} rounded px-3 py-1 flex items-center text-[10px] font-bold text-white whitespace-nowrap`} style={{ width }}>
                 {pct > 5 && `${count} ${text}`}
              </div>
            )}
         </div>
       </div>
       <div className="w-[120px] flex items-center justify-between shrink-0 pl-4">
         <span className="text-sm font-black text-gray-900 w-8">{count}</span>
         <span className="text-xs font-medium text-gray-500 w-10 text-right">{pct}%</span>
         <span className="text-[10px] font-black text-gray-400 w-12 text-right opacity-0 group-hover:opacity-100 transition-opacity">—</span>
       </div>
    </div>
  );
}

function OperationalCard({ label, value, sub, badge, badgeColor, valueColor = "text-gray-900" }) {
  return (
    <div className="bg-white border border-gray-200 rounded-2xl p-6 shadow-sm flex flex-col justify-between group hover:shadow-md transition-shadow">
       <div className="flex flex-col gap-1 mb-4">
         {badge && <div className={`w-fit px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${badgeColor}`}>{badge}</div>}
         <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{label}</div>
       </div>
       <div>
         <div className={`text-3xl font-black tracking-tight ${valueColor}`}>{value}</div>
         <div className="text-[10px] font-bold text-gray-400 uppercase mt-1">{sub}</div>
       </div>
    </div>
  );
}

function AnalysisRow({ label, count, pct, color }) {
  return (
    <div className="flex items-center gap-4">
      <div className="w-24 text-xs font-medium text-gray-700 shrink-0">{label}</div>
      <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden flex items-center">
        {count > 0 && <div className={`h-full ${color} rounded px-3 flex items-center text-[10px] font-bold text-white`} style={{ width: Math.max(pct, 5) + '%' }}>{count} calls</div>}
      </div>
      <div className="w-20 text-right flex items-center justify-between shrink-0 pl-2">
         <span className="text-sm font-black text-rose-600 w-6">{count}</span>
         <span className="text-[10px] font-bold text-gray-400 w-8 text-right">{pct}%</span>
      </div>
    </div>
  );
}

function FunnelRow({ label, count, max, color, labelText }) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="flex items-center gap-4">
       <div className="w-24 text-xs font-medium text-gray-600 text-right shrink-0">{label}</div>
       <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
         {count > 0 && <div className={`h-full ${color} rounded px-3 flex items-center text-[10px] font-bold text-white whitespace-nowrap overflow-hidden`} style={{ width: Math.max(pct, 5) + '%' }}>{count} {labelText}</div>}
       </div>
       <div className="w-10 text-right shrink-0 text-sm font-black text-gray-900">{pct}%</div>
    </div>
  );
}

/**
 * HQ Rollup Dashboard - Specialized view for Franchisors
 */
function HQRollupDashboard({ metrics }) {
  const { totals, location_breakdown, insights, trends } = metrics;
  
  return (
    <div className="bg-[#f9f8f3] -mx-4 -mt-4 p-8 min-h-screen space-y-8 animate-in fade-in duration-700">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">HQ Rollup Dashboard</h1>
          <p className="text-gray-500 font-medium">Aggregated performance across all {location_breakdown.length} branches</p>
        </div>
        <div className="hidden sm:flex items-center gap-3">
          <div className="px-4 py-2 bg-white border border-gray-200 rounded-xl shadow-sm text-xs font-black text-gray-400 tracking-widest uppercase">
            PERIOD: LAST 30 DAYS
          </div>
          <div className="px-4 py-2 bg-emerald-50 text-emerald-700 rounded-xl font-black text-xs tracking-widest uppercase">
            PORTFOLIO VIEW
          </div>
        </div>
      </div>

      {/* HQ Top Level Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
        <HqStatCard 
          label="Total Calls" 
          value={totals.calls.toLocaleString()} 
          trend={totals.calls_trend} 
          subtext="answered by AI"
        />
        <HqStatCard 
          label="Avg Booking Rate" 
          value={`${totals.booking_rate}%`} 
          trend={totals.booking_rate_trend} 
          subtext="conversion efficiency"
        />
        <HqStatCard 
          label="Pipeline Value (AI Estimated)" 
          value={`$${(totals.revenue / 100).toLocaleString()}`} 
          trend={totals.revenue_trend} 
          subtext="Based on AI job estimates — actual revenue updates we will need a DripJobs Zap 3 is configured for complete jobs or invoiced"
        />
        <HqStatCard 
          label="Confirmed Revenue (DripJobs)" 
          value={metrics.pipeline?.actual_revenue != null ? `$${(metrics.pipeline.actual_revenue / 100).toLocaleString()}` : "$0"}
          subtext={
            metrics.pipeline?.actual_revenue != null 
              ? "total from completed jobs" 
              : <span>— <a href="/settings" className="text-emerald-600 hover:underline font-extrabold hover:text-emerald-700">connect DripJobs</a> to track real revenue</span>
          }
          isNeutral
        />
        <HqStatCard 
          label="Leads in Pipeline" 
          value={totals.open_leads} 
          subtext={`${totals.leads_needing_followup} need follow-up`}
          isNeutral
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Comparative Location Breakdown */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-sm font-black text-gray-900 uppercase tracking-widest">Location Breakdown</h2>
            <div className="text-[10px] font-bold text-gray-400">SORTED BY PERFORMANCE</div>
          </div>
          <div className="space-y-3">
            {location_breakdown.map((loc, idx) => (
              <HqLocationRow key={loc.id} loc={loc} index={idx} />
            ))}
          </div>
        </div>

        {/* Portfolio Charts */}
        <div className="space-y-8">
           {/* Calls Stacked Bar Chart */}
           <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
             <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-6">Calls by location</h3>
             <div className="space-y-4">
                {location_breakdown.slice(0, 5).map(loc => {
                  const total = loc.calls;
                  const booked = loc.bookings;
                  const bookedWidth = total > 0 ? (booked / total) * 100 : 0;
                  return (
                    <div key={loc.id} className="space-y-1">
                      <div className="flex justify-between text-[10px] font-black text-gray-600 uppercase">
                        <span>{loc.name}</span>
                        <span>{total} calls</span>
                      </div>
                      <div className="h-3 bg-gray-100 rounded-full overflow-hidden flex shadow-inner">
                        <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${bookedWidth}%` }}></div>
                        <div className="h-full bg-orange-400/30 transition-all duration-1000" style={{ width: `${100 - bookedWidth}%` }}></div>
                      </div>
                    </div>
                  );
                })}
             </div>
             <div className="flex items-center gap-4 mt-6 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> BOOKED</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-orange-400/30"></span> NOT BOOKED</div>
             </div>
           </div>

           {/* Revenue Simple Bar Chart */}
           <div className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
             <h3 className="text-xs font-black text-gray-900 uppercase tracking-widest mb-6">Revenue tracked by location</h3>
             <div className="flex items-end gap-3 h-[180px] pt-4">
               {location_breakdown.slice(0, 5).map((loc, i) => {
                 const maxRev = Math.max(...location_breakdown.map(l => l.revenue), 1);
                 const height = (loc.revenue / maxRev) * 100;
                 return (
                   <div key={loc.id} className="flex-1 flex flex-col items-center h-full group">
                     <div className="relative w-full h-full flex flex-col justify-end">
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity bg-gray-900 text-white text-[8px] font-bold px-1.5 py-0.5 rounded pointer-events-none">
                          ${Math.round(loc.revenue/100)}
                        </div>
                        <div 
                          className={`w-full rounded-t-lg transition-all duration-1000 ${i === 0 ? 'bg-emerald-500' : 'bg-stone-200'}`} 
                          style={{ height: `${Math.max(height, 5)}%` }}
                        ></div>
                     </div>
                   </div>
                 );
               })}
             </div>
             <div className="flex justify-between mt-4 text-[8px] font-black text-gray-400 uppercase tracking-tighter">
               {location_breakdown.slice(0, 5).map(loc => (
                 <div key={loc.id} className="truncate w-8 text-center">{loc.name.split(' ')[0]}</div>
               ))}
             </div>
           </div>
        </div>
      </div>

      {/* Insights Section */}
      <div className="bg-[#fffcf0] border border-[#f5eecb] rounded-3xl p-8 space-y-6">
        <div className="flex items-center gap-1.5 text-xs font-black text-gray-900 uppercase tracking-[0.2em]">
          <AlertCircle size={16} className="text-orange-500" />
          Locations needing attention
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
           {insights.length > 0 ? insights.slice(0, 6).map(insight => (
             <div key={insight.id} className="flex justify-between items-center group">
               <div className="flex items-center gap-3">
                 <div className="w-1.5 h-1.5 bg-orange-400 rounded-full"></div>
                 <span className="text-sm font-bold text-gray-800">{insight.text}</span>
               </div>
               <a href={insight.link} className="text-[10px] font-black text-emerald-600 uppercase border-b-2 border-emerald-100 hover:border-emerald-600 transition-all">{insight.action}</a>
             </div>
           )) : (
             <div className="col-span-full py-4 text-sm font-bold text-gray-400 text-center italic">
               No critical performance issues detected across locations.
             </div>
           )}
        </div>
      </div>
    </div>
  );
}

function HqStatCard({ label, value, trend, subtext, isNeutral }) {
  const isPositive = trend >= 0;
  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-8 space-y-4 hover:shadow-md transition-all">
      <div className="flex items-start justify-between">
        <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-[0.1em]">{label}</h4>
        {!isNeutral && (
          <div className={`px-2 py-0.5 rounded-full text-[9px] font-black tracking-widest ${isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>
            {isPositive ? '+' : ''}{trend}% vs last mo
          </div>
        )}
      </div>
      <div className="space-y-1">
        <div className="text-4xl font-black text-gray-900 tracking-tight">{value}</div>
        <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{subtext}</div>
      </div>
    </div>
  );
}

function HqLocationRow({ loc, index }) {
  const performanceColor = loc.rate >= 45 ? 'bg-emerald-500' : loc.rate >= 35 ? 'bg-orange-400' : 'bg-rose-500';
  const performanceLabel = loc.rate >= 45 ? 'Top' : loc.rate >= 35 ? 'Mid' : 'Low';
  
  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 group hover:border-emerald-200 transition-all">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex items-center gap-4 min-w-[200px]">
          <div className={`w-3 h-3 rounded-full ${index % 3 === 0 ? 'bg-emerald-600' : index % 3 === 1 ? 'bg-teal-500' : 'bg-amber-400'} shadow-sm`}></div>
          <div>
            <div className="text-sm font-black text-gray-900 leading-none mb-1">{loc.name}</div>
            <div className="text-[10px] font-bold text-gray-400 uppercase">{loc.city}{loc.state ? `, ${loc.state}` : ''}</div>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-2 md:grid-cols-4 gap-4 px-4">
          <div>
            <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Calls</div>
            <div className="text-sm font-black text-gray-800">{loc.calls}</div>
          </div>
          <div>
            <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Rate</div>
            <div className="text-sm font-black text-gray-800">{loc.rate}%</div>
          </div>
          <div>
            <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Revenue</div>
            <div className="text-sm font-black text-gray-800">${Math.round(loc.revenue/100).toLocaleString()}</div>
          </div>
          <div>
            <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Open leads</div>
            <div className="text-sm font-black text-gray-800">{loc.openLeads}</div>
          </div>
        </div>

        <div className="flex items-center gap-4 min-w-[140px] justify-end">
          <div className="text-right">
            <div className="text-[9px] font-black text-gray-400 uppercase mb-1">Performance</div>
            <div className="flex items-center gap-2">
               <div className="w-16 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                 <div className={`h-full ${performanceColor} transition-all duration-1000`} style={{ width: `${loc.rate}%` }}></div>
               </div>
               <span className="text-[10px] font-black text-gray-600 uppercase">{performanceLabel}</span>
            </div>
          </div>
          <a href={`/?tenantId=${loc.id}`} className="p-2 bg-gray-50 rounded-xl text-gray-400 group-hover:text-emerald-500 transition-colors">
            <ArrowUpRight size={18} />
          </a>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon, color, trend }) {
  const isPositive = trend?.startsWith('+') ?? true;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md transition-all group">
      <div className="flex justify-between items-start mb-4">
        <div className={`p-2.5 rounded-xl ${color} shadow-sm group-hover:scale-110 transition-transform`}>
          {icon}
        </div>
        <div className={`flex items-center gap-0.5 text-[10px] font-bold px-2 py-0.5 rounded-full ${isPositive ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
          {isPositive ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
          {trend}
        </div>
      </div>
      <h4 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">{label}</h4>
      <p className="text-2xl font-bold text-gray-900 tracking-tight">{value}</p>
    </div>
  );
}

function AiMetric({ label, value, icon }) {
  return (
    <div className="space-y-4 flex-1">
      <div className="flex items-center gap-2 text-white/40 text-[10px] font-black uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="text-3xl font-black tracking-tight">{value}</div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full w-2/3"></div>
      </div>
    </div>
  );
}

function NurturingStat({ label, value, icon }) {
  return (
    <div className="p-4 rounded-2xl border border-gray-100 bg-gray-50/50 hover:bg-white transition-colors group shadow-sm hover:shadow">
      <div className="flex items-center gap-2 text-gray-400 text-[9px] font-black uppercase tracking-wider mb-2 group-hover:text-primary transition-colors">
        {icon}
        {label}
      </div>
      <div className="text-xl font-black text-gray-900">{value}</div>
    </div>
  );
}

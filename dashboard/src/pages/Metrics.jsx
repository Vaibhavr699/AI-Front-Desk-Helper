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
  UserPlus
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
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    loadMetrics();
  }, [tenantId]);

  const loadMetrics = async () => {
    setLoading(true);
    try {
      const data = await getMetrics(tenantId);
      setMetrics(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
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
    return <HQRollupDashboard metrics={metrics} />;
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Business Metrics</h1>
          <p className="text-sm text-gray-500">Comprehensive overview for the last 30 days</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 rounded-lg shadow-sm text-xs font-bold text-gray-600">
          <Clock size={14} className="text-primary" />
          UPDATED REAL-TIME
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Leads Generated" value={metrics.sales?.leads_generated ?? 0} icon={<Users size={20} />} color="bg-blue-50 text-blue-600" trend="+12%" />
        <StatCard label="Close Rate" value={`${metrics.sales?.close_rate ?? 0}%`} icon={<Target size={20} />} color="bg-purple-50 text-purple-600" trend="+5%" />
        <StatCard label="Estimates Accepted" value={metrics.sales?.estimates_accepted ?? 0} icon={<CheckCircle2 size={20} />} color="bg-green-50 text-green-600" trend="+8%" />
        <StatCard label="Revenue (Est)" value={`$${((metrics.sales?.revenue_booked ?? 0) / 100).toLocaleString()}`} icon={<DollarSign size={20} />} color="bg-gray-900 text-white" trend="+24%" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Acquisition Trends</h3>
              <p className="text-xs text-gray-400 font-medium">Leads vs Bookings (L7 Days)</p>
            </div>
            <div className="flex items-center gap-4 text-[10px] font-bold">
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-500"></span> LEADS</div>
              <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-green-500"></span> BOOKINGS</div>
            </div>
          </div>
          <BarChart data={metrics.trends} />
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col h-full">
          <div className="flex justify-between items-start mb-6">
            <div>
              <h3 className="text-sm font-bold text-gray-900 tracking-tight">Lead attribution</h3>
              <p className="text-xs text-gray-400 font-medium">Distribution by channel</p>
            </div>
            <div className="px-2 py-1 bg-gray-50 border border-gray-100 rounded text-[10px] font-bold text-gray-500 uppercase tracking-wider">30 days</div>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-6 mb-8">
            <div className="shrink-0"><PieChart data={metrics.sources} size={130} /></div>
            <div className="flex-1 w-full space-y-3">
              {(metrics.sources || []).slice(0, 4).map((s, i) => (
                <div key={i} className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                       <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ["#3b82f6", "#10b981", "#f59e0b", "#f87171", "#8b5cf6", "#6366f1"][i % 6] }}></span>
                       <span className="text-xs font-bold text-gray-700">{s.label}</span>
                    </div>
                    <div className="text-xs font-bold text-gray-900">{s.leads} LDS</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <hr className="border-gray-100 mb-6" />
          <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">REVENUE BY SOURCE</h4>
          <div className="overflow-hidden border border-gray-100 rounded-xl">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50/50 border-b border-gray-100">
                  <th className="px-4 py-2.5 text-[9px] font-black text-gray-400 uppercase tracking-tighter">Source</th>
                  <th className="px-4 py-2.5 text-[9px] font-black text-gray-400 uppercase tracking-tighter text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(metrics.sources || []).map((s, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3 text-xs font-bold text-gray-900">{s.label}</td>
                    <td className="px-4 py-3 text-xs font-black text-gray-900 text-right">${((s.revenue || 0) / 100).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {metrics.nurturing != null && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
          <div className="flex items-center gap-3 mb-6">
             <div className="p-2 bg-emerald-100 rounded-lg text-emerald-700"><UserPlus size={24} /></div>
             <div>
               <h2 className="text-xl font-bold text-gray-900">Nurturing & Referrals</h2>
               <p className="text-gray-500 text-sm">Campaign touches and referral outcomes</p>
             </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-4">
             <NurturingStat label="Emails sent" value={metrics.nurturing.emails_sent} icon={<Mail size={16} />} />
             <NurturingStat label="SMS sent" value={metrics.nurturing.sms_sent ?? 0} icon={<MessageCircle size={16} />} />
             <NurturingStat label="AI calls" value={metrics.nurturing.ai_calls_made ?? 0} icon={<PhoneCall size={16} />} />
             <NurturingStat label="Replies" value={metrics.nurturing.customer_replies ?? 0} icon={<MessageCircle size={16} />} />
             <NurturingStat label="Referrals" value={metrics.nurturing.referrals_generated} icon={<UserPlus size={16} />} />
             <NurturingStat label="Booked (ref)" value={metrics.nurturing.appointments_booked ?? 0} icon={<CheckCircle2 size={16} />} />
             <NurturingStat label="Revenue" value={metrics.nurturing.estimated_revenue != null ? `$${(metrics.nurturing.estimated_revenue / 100).toLocaleString()}` : "—"} icon={<DollarSign size={16} />} />
          </div>
        </div>
      )}

      <div className="bg-gray-900 rounded-2xl p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10"><Bot size={120} /></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-primary rounded-lg text-stone-900"><Bot size={24} /></div>
            <div>
              <h2 className="text-xl font-bold">AI Intelligence Performance</h2>
              <p className="text-white/60 text-sm">Efficiency metrics</p>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8">
            <AiMetric label="Calls Answered" value={metrics.ai?.calls_handled ?? 0} icon={<PhoneCall size={18} />} />
            <AiMetric label="AI Success Rate" value={`${metrics.ai?.ai_success_rate ?? 0}%`} icon={<TrendingUp size={18} />} />
            <AiMetric label="Booked by AI" value={metrics.ai?.appointments_booked ?? 0} icon={<CheckCircle2 size={18} />} />
            <AiMetric label="Missed Calls Recovered" value={metrics.ai?.missed_calls_recovered ?? 0} icon={<ArrowUpRight size={18} />} />
          </div>
        </div>
      </div>
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
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
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
          label="Revenue Tracked" 
          value={`$${(totals.revenue / 100).toLocaleString()}`} 
          trend={totals.revenue_trend} 
          subtext="total from bookings"
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

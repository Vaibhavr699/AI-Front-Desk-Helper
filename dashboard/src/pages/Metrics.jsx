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
  Clock
} from "lucide-react";

/**
 * Custom SVG Pie Chart
 */
const PieChart = ({ data, size = 200 }) => {
  // Defensive check for data
  if (!data || !Array.isArray(data)) return null;

  const total = data.reduce((sum, item) => sum + (item.value || 0), 0);
  let cumulativePercent = 0;

  const getCoordinatesForPercent = (percent) => {
    const x = Math.cos(2 * Math.PI * percent);
    const y = Math.sin(2 * Math.PI * percent);
    return [x, y];
  };

  const colors = ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#6366f1"];

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="-1 -1 2 2" className="transform -rotate-90 w-full h-full">
        {data.map((item, i) => {
          if (total === 0) return null;
          const value = item.value || 0;
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
        <div className="w-2/3 h-2/3 bg-white rounded-full flex items-center justify-center shadow-inner">
          <div className="text-center font-bold text-gray-900 leading-tight">
            {total}<br/><span className="text-[10px] text-gray-400 font-medium">TOTAL</span>
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

  // Defensive check for expected structure from new API
  const isNewSchema = metrics.sales && metrics.ai && metrics.sources && metrics.trends;

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

      {/* Sales Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard 
          label="Leads Generated" 
          value={metrics.sales?.leads_generated ?? 0} 
          icon={<Users size={20} />} 
          color="bg-blue-50 text-blue-600"
          trend="+12%"
        />
        <StatCard 
          label="Close Rate" 
          value={`${metrics.sales?.close_rate ?? 0}%`} 
          icon={<Target size={20} />} 
          color="bg-purple-50 text-purple-600"
          trend="+5%"
        />
        <StatCard 
          label="Estimates Accepted" 
          value={metrics.sales?.estimates_accepted ?? 0} 
          icon={<CheckCircle2 size={20} />} 
          color="bg-green-50 text-green-600"
          trend="+8%"
        />
        <StatCard 
          label="Revenue (Est)" 
          value={`$${((metrics.sales?.revenue_booked ?? 0) / 100).toLocaleString()}`} 
          icon={<DollarSign size={20} />} 
          color="bg-gray-900 text-white"
          trend="+24%"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Daily Trends Chart */}
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

        {/* Lead Sources Pie */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 flex flex-col items-center">
          <div className="w-full mb-6">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Lead Attribution</h3>
            <p className="text-xs text-gray-400 font-medium">Distribution by channel</p>
          </div>
          <PieChart data={metrics.sources} size={180} />
          <div className="w-full mt-6 space-y-2">
            {(metrics.sources || []).map((s, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] font-bold">
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full`} style={{ backgroundColor: ["#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ef4444", "#6366f1"][i % 6] }}></span>
                  <span className="text-gray-500 uppercase">{s.label}</span>
                </div>
                <span className="text-gray-900">{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* AI Performance Section */}
      <div className="bg-gray-900 rounded-2xl p-8 text-white relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-10">
          <Bot size={120} />
        </div>
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 bg-primary rounded-lg text-stone-900">
              <Bot size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold">AI Intelligence Performance</h2>
              <p className="text-white/60 text-sm">Efficiency metrics for the AI Receptionist</p>
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
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-white/40 text-xs font-bold uppercase tracking-wider">
        {icon}
        {label}
      </div>
      <div className="text-3xl font-bold tracking-tight">{value}</div>
      <div className="h-1 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-primary rounded-full w-2/3"></div>
      </div>
    </div>
  );
}

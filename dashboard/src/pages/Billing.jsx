import React, { useState, useEffect } from "react";
import { getUsage, openBillingPortal } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { 
  CreditCard, 
  AlertTriangle, 
  TrendingUp, 
  Zap, 
  Phone, 
  MessageSquare, 
  BarChart3,
  ChevronRight,
  Info
} from "lucide-react";

export default function Billing({ tenantId }) {
  const [usage, setUsage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    loadUsage();
  }, [tenantId]);

  const loadUsage = async () => {
    setLoading(true);
    try {
      const data = await getUsage(tenantId);
      setUsage(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleManageSubscription = async () => {
    if (!tenantId) return;
    try {
      const result = await openBillingPortal(tenantId);
      if (result.url) {
        window.open(result.url, "_blank");
      }
    } catch (e) {
      setError("Failed to open billing portal: " + e.message);
    }
  };

  if (!tenantId) return <div className="p-10 text-center text-gray-500 font-medium">Select a business to view usage and billing.</div>;
  if (loading) return <div className="flex items-center justify-center h-96"><LumaSpin /></div>;
  if (error) return <div className="p-8 text-red-500 bg-red-50 rounded-xl border border-red-100">{error}</div>;
  if (!usage) return null;

  const minPercent = Math.min((usage.current.minutes / usage.limits.minutes) * 100, 100);
  const smsPercent = Math.min((usage.current.sms / usage.limits.sms) * 100, 100);

  const getStatusColor = (percent) => {
    if (percent >= 100) return "bg-red-500";
    if (percent >= 90) return "bg-amber-500";
    if (percent >= 75) return "bg-amber-400";
    return "bg-blue-600";
  };

  const getStatusBg = (percent) => {
    if (percent >= 100) return "bg-red-50";
    if (percent >= 90) return "bg-amber-50";
    return "bg-stone-50";
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Usage & Billing</h1>
          <p className="text-sm text-gray-500">Current month usage for the <span className="capitalize font-bold text-gray-700">{usage.plan}</span> plan</p>
        </div>
        <button 
          onClick={handleManageSubscription}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl shadow-lg shadow-gray-200 text-sm font-bold hover:bg-gray-800 transition-colors active:scale-95"
        >
          <CreditCard size={18} className="text-primary" />
          MANAGE STRIPE
        </button>
      </div>

      {/* Usage Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Minutes Usage */}
        <UsageCard 
          icon={<Phone size={20} />}
          label="AI Voice Minutes"
          current={usage.current.minutes}
          limit={usage.limits.minutes}
          percent={minPercent}
          color={getStatusColor(minPercent)}
          bg={getStatusBg(minPercent)}
        />
        {/* SMS Usage */}
        <UsageCard 
          icon={<MessageSquare size={20} />}
          label="AI SMS Messages"
          current={usage.current.sms}
          limit={usage.limits.sms}
          percent={smsPercent}
          color={getStatusColor(smsPercent)}
          bg={getStatusBg(smsPercent)}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Overage Tracker */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider flex items-center gap-2">
              <Zap size={16} className="text-amber-500" />
              Overage Tracker
            </h3>
            {usage.overage.totalCost > 0 && (
              <span className="px-2.5 py-1 bg-red-50 text-red-600 text-[10px] font-bold rounded-full border border-red-100">
                ACTION REQUIRED
              </span>
            )}
          </div>
          <div className="p-0 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-gray-50/50 text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4">Resource</th>
                  <th className="px-6 py-4">Extra Units</th>
                  <th className="px-6 py-4">Unit Rate</th>
                  <th className="px-6 py-4 text-right">Estimated Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                <OverageRow 
                  label="Extra Minutes" 
                  units={usage.overage.extraMinutes} 
                  rate="$0.30/min" 
                  cost={`$${usage.overage.costMinutes.toFixed(2)}`} 
                />
                <OverageRow 
                  label="Extra Texts" 
                  units={usage.overage.extraSms} 
                  rate="$0.10/sms" 
                  cost={`$${usage.overage.costSms.toFixed(2)}`} 
                />
                <tr className="bg-gray-900 text-white">
                  <td colSpan="3" className="px-6 py-4 font-bold text-sm">Total Extra Charges</td>
                  <td className="px-6 py-4 text-right font-bold text-lg text-primary">${usage.overage.totalCost.toFixed(2)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Monthly Projection */}
        <div className="bg-gradient-to-br from-indigo-600 to-indigo-800 rounded-3xl p-6 text-white shadow-xl shadow-indigo-100 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-8">
              <div className="p-2.5 bg-white/10 rounded-xl backdrop-blur-md">
                <TrendingUp size={24} className="text-primary" />
              </div>
              <div className="text-[10px] font-bold px-2 py-1 bg-emerald-500/20 text-emerald-300 rounded-full border border-emerald-500/30">
                PROJECTION
              </div>
            </div>
            <h3 className="text-lg font-bold mb-2">Month-End Estimate</h3>
            <p className="text-white/60 text-xs leading-relaxed mb-8">Based on your current consumption rate, we project your final usage to be:</p>
            
            <div className="space-y-6">
              <div className="flex justify-between items-end border-b border-white/10 pb-4">
                <div className="text-xs font-medium text-white/50 uppercase tracking-wider">Minutes</div>
                <div className="text-2xl font-bold">{usage.projection.minutes.toLocaleString()}</div>
              </div>
              <div className="flex justify-between items-end border-b border-white/10 pb-4">
                <div className="text-xs font-medium text-white/50 uppercase tracking-wider">SMS</div>
                <div className="text-2xl font-bold">{usage.projection.sms.toLocaleString()}</div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-white/20">
            <div className="flex justify-between items-center">
              <span className="text-xs font-bold text-white/60">EST. OVERAGE</span>
              <span className="text-3xl font-bold text-primary">${usage.projection.overageCost.toFixed(2)}</span>
            </div>
            <p className="text-[10px] text-white/40 mt-3 flex items-center gap-1">
              <Info size={10} />
              Estimated based on {new Date().getDate()} days of activity.
            </p>
          </div>
        </div>
      </div>

      {/* Automation Alerts */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
        <div className="flex items-center gap-4 mb-8">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 flex items-center justify-center text-amber-500">
            <Zap size={24} />
          </div>
          <div>
            <h3 className="text-xl font-bold text-gray-900">Alerts</h3>
            <p className="text-sm text-gray-500">Get notified before you hit limits and start overages.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <ThresholdToggle percent={75} label="Usage Warning" description="Sent via SMS/Email at 75% capacity." checked={true} />
          <ThresholdToggle percent={90} label="Usage Alert" description="Sent at 90% capacity. Critical notice." checked={true} />
          <ThresholdToggle percent={100} label="Overage Notice" description="Sent when limit is reached." checked={false} />
        </div>
      </div>
    </div>
  );
}

function UsageCard({ icon, label, current, limit, percent, color, bg }) {
  return (
    <div className={`p-8 rounded-3xl border border-gray-100 shadow-sm transition-all hover:shadow-md ${bg}`}>
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white shadow-sm flex items-center justify-center text-gray-900 border border-gray-50">
            {icon}
          </div>
          <div>
            <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest">{label}</h4>
            <div className="flex items-baseline gap-1.5 mt-0.5">
              <span className="text-3xl font-bold text-gray-900">{current.toLocaleString()}</span>
              <span className="text-sm font-bold text-gray-400">/ {limit.toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className={`text-sm font-black px-3 py-1.5 rounded-xl inline-block ${percent >= 90 ? 'text-red-600 bg-red-100/50' : 'text-gray-900 bg-white shadow-sm border border-gray-100'}`}>
            {Math.round(percent)}%
          </div>
        </div>
      </div>

      <div className="relative h-3 bg-gray-200/50 rounded-full overflow-hidden backdrop-blur-sm border border-gray-100/50">
        <div 
          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ease-out ${color} shadow-lg`}
          style={{ width: `${percent}%` }}
        ></div>
        {percent > 90 && <div className="absolute top-0 right-0 h-full w-20 bg-gradient-to-l from-red-500/20 to-transparent"></div>}
      </div>
    </div>
  );
}

function OverageRow({ label, units, rate, cost }) {
  return (
    <tr className="hover:bg-gray-50/50 transition-colors">
      <td className="px-6 py-4">
        <div className="text-sm font-bold text-gray-900">{label}</div>
      </td>
      <td className="px-6 py-4">
        <span className={`text-xs font-bold px-2 py-1 rounded-lg ${units > 0 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-400'}`}>
          {units}
        </span>
      </td>
      <td className="px-6 py-4 text-xs font-medium text-gray-500">{rate}</td>
      <td className="px-6 py-4 text-right font-bold text-sm text-gray-900">{cost}</td>
    </tr>
  );
}

function ThresholdToggle({ percent, label, description, checked }) {
  return (
    <div className={`p-6 rounded-2xl border transition-all ${checked ? 'border-indigo-100 bg-indigo-50/20' : 'border-gray-100 bg-white opacity-60'}`}>
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs font-black text-indigo-600 uppercase tracking-tighter">{percent}% LIMIT</span>
        <div className={`w-10 h-5 rounded-full relative transition-colors cursor-pointer ${checked ? 'bg-indigo-500' : 'bg-gray-200'}`}>
           <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all ${checked ? 'right-1' : 'left-1'}`}></div>
        </div>
      </div>
      <h5 className="font-bold text-gray-900 mb-1">{label}</h5>
      <p className="text-[10px] text-gray-500 leading-relaxed font-medium">{description}</p>
    </div>
  );
}

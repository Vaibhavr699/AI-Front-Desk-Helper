import React, { useState, useEffect } from "react";
import { useOutletContext, useNavigate } from "react-router-dom";
import { get, post, patch } from "../api";
import { 
  Rocket, Package, Search, Plus, Play, Pause, MoreVertical, 
  CheckCircle2, XCircle, Clock, AlertCircle, ShoppingCart, 
  Users, Activity, Zap, TrendingUp, ArrowRight, BarChart2, 
  Pencil, MessageSquare, Info, Trash2, Award
} from "lucide-react";
import { Button } from "../components/ui/button";
import CampaignCreator from "../components/outbound/CampaignCreator";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/ui/Toast";

export default function Outbound({ tenantId }) {
  const navigate = useNavigate();
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [showCreator, setShowCreator] = useState(false);
  const [usage, setUsage] = useState(null);
  const [stripeConfig, setStripeConfig] = useState(null);

  useEffect(() => {
    fetchCampaigns();
    fetchBalance();
    fetchStripeConfig();
  }, [tenantId]);

  async function fetchStripeConfig() {
    try {
      const res = await get("/api/stripe/config");
      setStripeConfig(res);
      console.log("[Stripe] Dynamic config loaded:", res);
    } catch (e) {
      console.error("[Stripe] Failed to load config:", e);
    }
  }

  async function fetchBalance() {
    try {
      const res = await get("/api/billing/usage", { tenantId });
      setUsage(res);
    } catch (e) {
      console.error(e);
    }
  }

  async function fetchCampaigns() {
    try {
      const res = await get("/api/outbound/campaigns", { tenantId });
      setCampaigns(res || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  if (activeCampaign) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.2 }}
      >
        <TrackingBoard 
          campaignId={activeCampaign} 
          onBack={() => setActiveCampaign(null)} 
          tenantId={tenantId} 
        />
      </motion.div>
    );
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-8 min-h-screen font-sans antialiased text-stone-900">
     {/* SaaS Grade Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Outbound Campaigns</h1>
          <p className="text-stone-500 text-sm mt-1">Manage and track your automated AI outreach.</p>
        </div>
        
        <Button 
          className="bg-brand-600 hover:bg-brand-700 text-white gap-2 px-5 py-2.5 rounded-lg shadow-sm font-medium transition-all"
          onClick={() => setShowCreator(true)}
        >
          <Plus className="w-4 h-4" /> 
          New Campaign
        </Button>
      </div>

      {/* Tab bar — links back to Call Intelligence Center + across tabs */}
      <div className="flex gap-2 border-b border-stone-200 overflow-x-auto">
        <button
          onClick={() => navigate("/calls")}
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-stone-500 hover:text-stone-700 -mb-px transition-all whitespace-nowrap"
        >
          Inbound Calls
        </button>
        <button
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-brand-600 text-brand-600 -mb-px transition-all whitespace-nowrap"
        >
          Outbound Campaigns
        </button>
        <button
          onClick={() => navigate("/outreach-log")}
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-stone-500 hover:text-stone-700 -mb-px transition-all whitespace-nowrap"
        >
          AI Outreach Log
        </button>
        <button
          onClick={() => navigate("/voicemails")}
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-stone-500 hover:text-stone-700 -mb-px transition-all whitespace-nowrap"
        >
          Voicemails
        </button>
      </div>

      <AnimatePresence>
        {showCreator && (
          <CampaignCreator 
            tenantId={tenantId} 
            onClose={() => setShowCreator(false)} 
            onCreated={(newC) => {
              setCampaigns([newC, ...campaigns]);
              setActiveCampaign(newC.id);
            }} 
          />
        )}
      </AnimatePresence>

      {/* Grid: Global Stats Hub */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <StatCard 
          label="Total Bookings" 
          value={campaigns.reduce((acc, c) => acc + (c.booked_count || 0), 0)} 
          icon={CheckCircle2} 
          color="text-emerald-600" 
          bg="bg-emerald-50/50" 
        />
        <StatCard 
          label="AI Call Volume" 
          value={campaigns.reduce((acc, c) => acc + (c.calls_made || 0), 0).toLocaleString()} 
          icon={Activity} 
          color="text-blue-600" 
          bg="bg-blue-50/50" 
        />
        <StatCard 
          label="Calling Credits" 
          value={( (usage?.limits?.minutes || 0) - (usage?.current?.minutes || 0) + (usage?.current?.bundle_minutes_balance || 0) + (usage?.current?.extra_minutes_balance || 0) ).toLocaleString()} 
          icon={Clock} 
          color="text-brand-600" 
          bg="bg-brand-50/50" 
        />
        <StatCard 
          label="Registry Size" 
          value={campaigns.reduce((acc, c) => acc + (c.total_contacts || 0), 0).toLocaleString()} 
          icon={Users} 
          color="text-stone-600" 
          bg="bg-stone-50/50" 
        />
        <StatCard 
          label="Performance" 
          value={`${Math.round((campaigns.reduce((acc, c) => acc + (c.booked_count || 0), 0) / (campaigns.reduce((acc, c) => acc + (c.total_contacts || 1), 0) || 1)) * 100)}%`} 
          icon={TrendingUp} 
          color="text-brand-600" 
          bg="bg-brand-50/50" 
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Main List */}
        <div className="xl:col-span-2 space-y-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold text-stone-400 uppercase tracking-widest">Active Campaigns</h3>
          </div>

          {loading ? (
             <div className="h-64 flex items-center justify-center bg-white border border-stone-200 rounded-xl animate-pulse text-stone-300">Syncing data...</div>
          ) : campaigns.length === 0 ? (
            <EmptyState onAdd={() => setShowCreator(true)} />
          ) : (
            <div className="bg-white border border-stone-200 rounded-xl overflow-hidden shadow-sm">
              <table className="w-full text-left">
                <thead>
                  <tr className="bg-stone-50/50 text-[10px] font-bold text-stone-400 uppercase tracking-widest border-b border-stone-100">
                    <th className="px-6 py-4">Campaign Name</th>
                    <th className="px-6 py-4">Intelligence</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Contacts</th>
                    <th className="px-6 py-4 text-right">Progress</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {campaigns.map((c) => (
                    <tr 
                      key={c.id} 
                      className="hover:bg-stone-50/30 transition-colors group cursor-pointer"
                      onClick={() => setActiveCampaign(c.id)}
                    >
                      <td className="px-6 py-4">
                        <div className="font-semibold text-stone-900 group-hover:text-brand-600 transition-colors">{c.name}</div>
                        <div className="text-[10px] text-stone-400 mt-0.5">Created {new Date(c.created_at).toLocaleDateString()}</div>
                      </td>
                      <td className="px-6 py-4 text-sm capitalize font-medium text-stone-600">{c.mode} Flow</td>
                      <td className="px-6 py-4">
                        <StatusBadge status={c.status} />
                      </td>
                      <td className="px-6 py-4 text-sm font-medium">{c.total_contacts || 0}</td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex flex-col items-end gap-1.5">
                          <div className="text-[10px] font-bold text-stone-500">{Math.round(((c.calls_made || 0) / (c.total_contacts || 1)) * 100)}%</div>
                          <div className="w-20 h-1.5 bg-stone-100 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-brand-500 rounded-full" 
                              style={{ width: `${Math.round(((c.calls_made || 0) / (c.total_contacts || 1)) * 100)}%` }} 
                            />
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Pricing Bundles - Minimal SaaS Grade */}
        <div className="xl:col-span-1 space-y-4">
          <div className="flex items-center justify-between px-1">
             <h3 className="text-sm font-bold text-stone-400 uppercase tracking-widest">Pricing Bundles</h3>
          </div>
          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-6">
            
            {/* Mission Credits: Unified Tracker */}
            <div className="p-6 bg-stone-900 rounded-2xl relative overflow-hidden group shadow-xl">
               <div className="relative z-10 space-y-5">
                 <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black text-stone-500 uppercase tracking-widest">Mission Credits Hub</span>
                    <div className="px-2 py-0.5 bg-brand-500 text-[8px] font-black text-white rounded uppercase tracking-widest">{usage?.plan || 'PRO'} PLAN</div>
                 </div>
                 
                 <div className="space-y-4">
                   <div className="flex flex-col">
                     <div className="text-3xl font-black text-white tracking-tighter leading-none">
                       { ((usage?.limits?.minutes || 0) - (usage?.current?.minutes || 0) + (usage?.current?.bundle_minutes_balance || 0)).toLocaleString() }
                       <span className="text-xs text-stone-500 ml-2 font-bold uppercase tracking-tight">Available Min</span>
                     </div>
                   </div>

                   {/* Plan Allotment Bar - Used / Total Style */}
                   <div className="space-y-1.5">
                     <div className="flex items-center justify-between text-[10px] font-bold">
                       <span className="text-stone-400 capitalize">{usage?.plan || 'Plan'} Monthly Usage</span>
                       <span className="text-white">{usage?.current?.minutes || 0} / {usage?.limits?.minutes || 0} used</span>
                     </div>
                     <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                       <motion.div 
                         initial={{ width: 0 }}
                         animate={{ width: `${Math.min(100, ((usage?.current?.minutes || 0) / (usage?.limits?.minutes || 1) * 100))}%` }}
                         className="h-full bg-brand-500 rounded-full"
                       />
                     </div>
                   </div>

                   {/* Extra Bundles Hook */}
                   <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/10 group-hover:border-brand-500/30 transition-all">
                     <div className="flex items-center gap-2">
                        <Package className="w-3.5 h-3.5 text-orange-400" />
                        <span className="text-[10px] font-bold text-stone-400 uppercase tracking-tight">Extra Bundle Credits</span>
                     </div>
                     <span className="text-xs font-black text-white">+{usage?.current?.bundle_minutes_balance || 0} <span className="text-[9px] text-stone-500">Min</span></span>
                   </div>
                 </div>
               </div>
            </div>

            <div className="space-y-3">
              <BundleCard minutes={500} price={99} tenantId={tenantId} priceId={stripeConfig?.bundle_500} />
              <BundleCard minutes={1500} price={249} tenantId={tenantId} priceId={stripeConfig?.bundle_1500} isPopular />
              <BundleCard minutes={3000} price={499} tenantId={tenantId} priceId={stripeConfig?.bundle_3000} />
            </div>

            <div className="p-4 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-3">
              <AlertCircle className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <p className="text-[10px] text-blue-800 leading-relaxed font-medium">For enterprise volume or annual custom commitments, please contact our support team.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, icon: Icon, color, bg }) {
  return (
    <div className="bg-white p-5 border border-stone-200 rounded-xl shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${bg} ${color}`}>
          <Icon className="w-4 h-4" />
        </div>
        <div className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">{label}</div>
      </div>
      <div className="mt-3 text-2xl font-bold text-stone-900">{value}</div>
    </div>
  );
}

function BundleCard({ minutes, price, tenantId, priceId, isPopular }) {
  const [loading, setLoading] = useState(false);
  const { error } = useToast();

    async function handleBuy() {
    setLoading(true);
    console.log("[Stripe] Attempting checkout for minutes:", minutes, "with Price ID:", priceId);
    try {
      if (!priceId) {
        throw new Error("Stripe Price ID is missing. Check environment variables.");
      }
      const res = await post("/api/stripe/checkout-bundle", { 
        minutes, 
        price_id: priceId, 
        tenantId,
        return_url: window.location.href.split('?')[0] 
      });
      if (res.url) {
        window.location.href = res.url;
      } else {
        throw new Error("No URL returned");
      }
    } catch (e) {
      console.error(e);
      error("Stripe Checkout failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button 
      onClick={handleBuy}
      disabled={loading}
      className={`w-full flex items-center cursor-pointer justify-between p-4 rounded-xl border transition-all text-left group ${isPopular ? 'border-brand-500 bg-brand-50/30' : 'border-stone-200 hover:border-brand-300 hover:bg-stone-50/50'}`}
    >
      <div>
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-stone-900">{minutes.toLocaleString()} Min</span>
          {isPopular && <span className="bg-brand-500 text-white text-[8px] px-2 py-0.5 rounded-full font-black uppercase">Popular</span>}
        </div>
        <div className="text-[10px] text-stone-500 font-medium mt-0.5 capitalize">prepaid bundle</div>
      </div>
      <div className="flex items-center gap-3 font-semibold">
        <div className="text-lg font-bold text-stone-900">${price}</div>
        <div className={`p-1.5 rounded-full ${isPopular ? 'bg-brand-500 text-white' : 'bg-stone-100 text-stone-400 group-hover:bg-brand-500 group-hover:text-white'} transition-colors`}>
          <ArrowRight className="w-3.5 h-3.5" />
        </div>
      </div>
    </button>
  );
}

function StatusBadge({ status }) {
  const styles = {
    active: "bg-green-50 text-green-700 border-green-100",
    paused: "bg-stone-50 text-stone-600 border-stone-200",
    completed: "bg-brand-50 text-brand-700 border-brand-100",
    draft: "bg-stone-50 text-stone-400 border-stone-200",
    booked: "bg-emerald-50 text-emerald-700 border-emerald-100",
    no_answer: "bg-orange-50 text-orange-700 border-orange-100",
    follow_up: "bg-blue-50 text-blue-700 border-blue-100",
    dnc: "bg-red-50 text-red-700 border-red-100",
    failed: "bg-stone-50 text-stone-500 border-stone-200"
  };
  const labelMap = {
    booked: "Booked",
    no_answer: "No Answer",
    follow_up: "Follow Up",
    dnc: "DNC",
    active: "Active",
    paused: "Paused",
    completed: "Completed"
  };
  return (
    <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border inline-flex items-center gap-1.5 ${styles[status] || styles.draft}`}>
      {status === 'active' && <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />}
      {labelMap[status] || status}
    </div>
  );
}

function TranscriptViewer({ transcript, onClose }) {
  if (!transcript) return null;
  return (
    <motion.div 
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      className="fixed inset-y-0 right-0 w-[450px] bg-white border-l border-stone-200 shadow-2xl z-50 flex flex-col"
    >
      <div className="p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
         <div className="flex items-center gap-3">
            <div className="p-2 bg-white border border-stone-200 rounded-lg shadow-sm">
               <MessageSquare className="w-4 h-4 text-brand-500" />
            </div>
            <h3 className="text-sm font-bold text-stone-900 tracking-tight uppercase tracking-wider">AI Conversation Log</h3>
         </div>
         <button onClick={onClose} className="p-2 hover:bg-stone-200 rounded-lg transition-colors">
            <XCircle className="w-5 h-5 text-stone-400" />
         </button>
      </div>
      <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-white">
        {typeof transcript === 'string' ? (
           transcript.split('\n').filter(Boolean).map((line, idx) => (
             <div key={idx} className={`flex flex-col ${line.startsWith('User:') ? 'items-end' : 'items-start'}`}>
                <div className={`max-w-[85%] rounded-2xl p-4 text-[13px] leading-relaxed shadow-sm border ${
                   line.startsWith('User:') 
                     ? 'bg-stone-50 border-stone-100 text-stone-800 rounded-tr-none' 
                     : 'bg-brand-50 border-brand-100 text-brand-900 rounded-tl-none'
                }`}>
                   <span className="font-black opacity-30 text-[9px] uppercase tracking-widest block mb-1">
                      {line.startsWith('User:') ? 'Customer' : 'AI Assistant'}
                   </span>
                   {line.replace(/^(User:|Assistant:)\s*/, '')}
                </div>
             </div>
           ))
        ) : (
           <div className="text-stone-400 italic text-sm py-20 text-center font-medium">Transcript data format not recognized.</div>
        )}
      </div>
    </motion.div>
  );
}

function ScriptScoreboard({ scripts, isAuto }) {
   const [selectedViewScript, setSelectedViewScript] = useState(null);
   if (!isAuto || !scripts || scripts.length === 0) return null;
   
   const active = scripts.filter(s => s.status === 'active').sort((a,b) => b.performance_pct - a.performance_pct);
   const retired = scripts.filter(s => s.status === 'retired');

   return (
     <>
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
          <div className="md:col-span-8 bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/30 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Award className="w-4 h-4 text-brand-500" />
                  <h3 className="text-xs font-bold text-stone-900 uppercase tracking-widest">Active Evolution scripts</h3>
                </div>
            </div>
            <div className="divide-y divide-stone-100">
                {active.map((s, i) => (
                  <div 
                    key={s.id} 
                    className="p-4 hover:bg-stone-50/50 transition-colors flex items-center gap-4 cursor-pointer group"
                    onClick={() => setSelectedViewScript(s)}
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-black text-sm ${i === 0 ? 'bg-amber-100 text-amber-700' : 'bg-stone-100 text-stone-500'}`}>
                        {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[12px] font-medium text-stone-700 line-clamp-1 italic group-hover:text-stone-900 transition-colors">"{s.content}"</p>
                        <div className="flex items-center gap-3 mt-1">
                          <div className="h-1 flex-1 bg-stone-100 rounded-full overflow-hidden">
                              <div className="h-full bg-brand-500" style={{ width: `${s.performance_pct}%` }} />
                          </div>
                          <span className="text-[10px] font-black text-brand-600">{s.performance_pct}% <span className="text-stone-400 font-bold ml-0.5">CONV</span></span>
                        </div>
                    </div>
                  </div>
                ))}
            </div>
          </div>
          <div className="md:col-span-4 bg-stone-50 border border-stone-200 rounded-2xl p-6 shadow-sm flex flex-col">
            <div className="flex items-center gap-2 mb-4 border-b border-stone-200 pb-3">
                <Trash2 className="w-4 h-4 text-stone-400" />
                <h3 className="text-xs font-bold text-stone-500 uppercase tracking-widest">Retired versions</h3>
            </div>
            <div className="flex-1 overflow-y-auto space-y-3">
                {retired.length > 0 ? retired.map(s => (
                  <div 
                    key={s.id} 
                    className="p-3 bg-white border border-stone-200 rounded-xl opacity-60 hover:opacity-100 transition-all cursor-pointer"
                    onClick={() => setSelectedViewScript(s)}
                  >
                    <p className="text-[10px] text-stone-500 line-clamp-2 italic mb-2">"{s.content}"</p>
                    <div className="flex items-center justify-between text-[9px] font-bold text-stone-400">
                        <span>ELIMINATED</span>
                        <span className="text-stone-300 font-black">{s.performance_pct}%</span>
                    </div>
                  </div>
                )) : (
                  <div className="flex flex-col items-center justify-center h-full opacity-20">
                    <Info className="w-6 h-6 mb-2" />
                    <span className="text-[9px] font-bold uppercase tracking-widest text-center">No retired scripts yet</span>
                  </div>
                )}
            </div>
          </div>
      </div>

      <AnimatePresence>
        {selectedViewScript && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedViewScript(null)}
              className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="relative bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden border border-stone-200 flex flex-col"
            >
              <div className="px-8 py-6 border-b border-stone-100 flex items-center justify-between bg-stone-50/50">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${selectedViewScript.status === 'active' ? 'bg-amber-50 text-amber-600' : 'bg-stone-100 text-stone-500'}`}>
                    <Award className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-stone-900 uppercase tracking-widest">Script variation</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                       <StatusBadge status={selectedViewScript.status} />
                       <span className="text-[10px] font-black text-brand-600 italic">{selectedViewScript.performance_pct}% Conversion</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelectedViewScript(null)} className="p-2 hover:bg-stone-200 rounded-xl transition-colors">
                  <XCircle className="w-5 h-5 text-stone-400" />
                </button>
              </div>
              <div className="p-8">
                <div className="p-6 bg-stone-50 rounded-2xl border border-stone-100 shadow-inner relative">
                  <p className="text-base text-stone-700 leading-relaxed font-medium italic">
                    "{selectedViewScript.content}"
                  </p>
                  <div className="absolute -top-3 -left-2 text-4xl text-stone-200 font-serif">“</div>
                  <div className="absolute -bottom-8 -right-2 text-4xl text-stone-200 font-serif">”</div>
                </div>
                
                <div className="mt-10 flex items-center justify-between p-4 bg-brand-50/50 rounded-xl border border-brand-100">
                   <div className="flex items-center gap-3">
                      <Zap className="w-4 h-4 text-brand-500" />
                      <span className="text-[11px] font-bold text-brand-900 uppercase tracking-tight">AI Strategy Insight</span>
                   </div>
                   <span className="text-[10px] text-brand-700 font-medium">Auto-evolved from Champion variation</span>
                </div>
              </div>
              <div className="px-8 py-4 bg-stone-50 border-t border-stone-100 flex justify-end">
                <Button 
                  onClick={() => setSelectedViewScript(null)}
                  className="bg-stone-900 text-white px-8 h-10 rounded-xl text-[11px] font-bold"
                >
                  Close View
                </Button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
     </>
   );
}

function EmptyState({ onAdd }) {
  return (
    <div className="bg-white border-2 border-dashed border-stone-200 rounded-2xl p-16 text-center shadow-sm">
      <div className="w-12 h-12 bg-stone-50 rounded-full flex items-center justify-center mx-auto mb-6 text-stone-300">
        <Rocket className="w-6 h-6" />
      </div>
      <h3 className="text-base font-bold text-stone-900 mb-2">Launch your first campaign</h3>
      <p className="text-stone-500 text-sm max-w-xs mx-auto mb-8">AI-driven outbound flows that convert your lead lists into booked appointments.</p>
      <Button className="bg-stone-900 hover:bg-stone-800 text-white px-8 h-12 rounded-xl text-sm font-bold" onClick={onAdd}>
         Get Started
      </Button>
    </div>
  );
}

function TrackingBoard({ campaignId, onBack, tenantId }) {
  const [data, setData] = useState(null);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [editedPrompt, setEditedPrompt] = useState("");
  const [selectedAudio, setSelectedAudio] = useState(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [selectedTranscript, setSelectedTranscript] = useState(null);
  const { success, error } = useToast();

  const handlePlayAudio = async (recordingId, name) => {
    if (!recordingId) {
       error("Recording not found");
       return;
    }
    
    setIsPlayingAudio(true);
    try {
      const resp = await axios.get(`/api/recordings/${recordingId}/audio`, {
        responseType: 'blob'
      });
      const blobUrl = URL.createObjectURL(resp.data);
      setSelectedAudio({ url: blobUrl, name: name || "Call Recording" });
    } catch (e) {
      console.error("[Audio] Fetch failed:", e);
      error("Failed to load call recording");
    } finally {
      setIsPlayingAudio(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [campaignId]);

  async function fetchData() {
    try {
      const [board, contactList] = await Promise.all([
        get(`/api/outbound/campaigns/${campaignId}`, { tenantId }),
        get(`/api/outbound/campaigns/${campaignId}/contacts`, { tenantId })
      ]);
      setData(board);
      setContacts(contactList || []);
      setEditedPrompt(board?.campaign?.prompt_description || "");
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleStatus() {
    setActionLoading(true);
    const endpoint = data.campaign.status === 'active' ? 'pause' : 'resume';
    try {
      await post(`/api/outbound/campaigns/${campaignId}/${endpoint}`, { tenantId });
      await fetchData();
      success(`Campaign ${data.campaign.status === 'active' ? 'paused' : 'resumed'} successfully.`);
    } catch (e) {
      error("Mission state update failed.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleUpdatePrompt() {
    if (!editedPrompt.trim()) return;
    setActionLoading(true);
    try {
      await patch(`/api/outbound/campaigns/${campaignId}`, { 
        prompt_description: editedPrompt,
        tenantId 
      });
      await fetchData();
      setIsEditingPrompt(false);
      success("AI Instruction set updated correctly.");
    } catch (e) {
      error("Failed to update AI logic.");
    } finally {
      setActionLoading(false);
    }
  }

  if (loading || !data) return <div className="p-24 text-center text-stone-400 font-bold uppercase tracking-widest text-[10px] animate-pulse">Syncing Mission Profile...</div>;

  const total = contacts.length || 1;
  const booked = data.statusCounts.booked || 0;
  const winRate = Math.round((booked / total) * 100);

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6 font-sans">
      {/* Header / Breadcrumb */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-stone-100 pb-6">
        <div className="flex items-center gap-4">
          <button 
            onClick={onBack}
            className="p-2 bg-white border border-stone-200 rounded-lg text-stone-400 hover:text-stone-900 transition-all shadow-sm hover:shadow-md"
          >
            <ArrowRight className="w-4 h-4 rotate-180" />
          </button>
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold text-stone-400 uppercase tracking-widest mb-1">
              <Rocket className="w-3 h-3" />
              <span>Outbound Mission</span>
            </div>
            <h1 className="text-xl font-bold text-stone-900 tracking-tight">{data.campaign.name}</h1>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden md:flex flex-col items-end mr-4">
             <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Status</span>
             <StatusBadge status={data.campaign.status} />
          </div>
          <Button 
            className={`px-6 h-10 rounded-lg font-bold shadow-sm transition-all text-sm ${
              data.campaign.status === 'active' 
                ? 'bg-stone-200 text-stone-600 hover:bg-stone-400/50 border border-stone-300' 
                : 'bg-brand-600 text-white hover:bg-brand-800'
            }`}
            onClick={handleToggleStatus}
            disabled={actionLoading}
          >
            {data.campaign.status === 'active' ? (
              <><Pause className="w-3.5 h-3.5 mr-2" /> Pause Campaign</>
            ) : (
              <><Play className="w-3.5 h-3.5 mr-2" /> Resume Campaign</>
            )}
          </Button>
        </div>
      </div>

      {/* High-Impact Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <MiniStatCard label="Live Registry" value={contacts.length} icon={Users} color="text-brand-600" />
        <MiniStatCard label="Success Rate" value={`${winRate}%`} icon={Zap} color="text-amber-500" />
        <MiniStatCard label="AI Conversations" value={data.statusCounts.contacted || 0} icon={Activity} color="text-blue-600" />
        <MiniStatCard label="Goal Conversion" value={booked} icon={CheckCircle2} color="text-emerald-600" />
      </div>

      {/* NEW: Script Evolution Scoreboard */}
      <ScriptScoreboard scripts={data.scripts} isAuto={data.campaign.mode === 'auto'} />

      <div className="space-y-8">
        {/* Row 1: High-Level Tracking (Controls + Performance Side-by-Side) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
           <div className="bg-white border border-stone-200 rounded-3xl p-8 shadow-sm flex flex-col justify-between group hover:border-brand-200 transition-all">
              <div className="flex items-center justify-between border-b border-stone-100 pb-5 mb-6">
                 <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-brand-50 text-brand-600 rounded-2xl">
                       <Zap className="w-5 h-5 fill-current" />
                    </div>
                    <h3 className="text-sm font-black text-stone-900 uppercase tracking-widest">Mission Controls</h3>
                 </div>
                 <div className="w-4 h-4 rounded-full bg-brand-500 animate-pulse border-4 border-brand-100" />
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-6">
                 <ConfigRow label="Intelligence Mode" value={`${data.campaign.mode === 'auto' ? 'Auto-Scripted A/B' : 'Manual Instruction'}`} icon={Zap} />
                 <ConfigRow label="Active Window" value={`${data.campaign.calling_hours_start.substring(0, 5)} - ${data.campaign.calling_hours_end.substring(0, 5)}`} icon={Clock} />
                 <ConfigRow label="Dial Attempts" value={`${data.campaign.max_attempts} max per contact`} icon={Activity} />
              </div>

              {data.campaign.mode !== 'auto' && (
                <div className="pt-6 border-t border-stone-100">
                   <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">Base Instruction</span>
                      <button onClick={() => setIsEditingPrompt(true)} className="p-2 hover:bg-stone-100 rounded-xl transition-colors">
                        <Pencil className="w-4 h-4 text-brand-600" />
                      </button>
                   </div>
                   <div className="p-5 bg-stone-50 border border-stone-100 rounded-2xl text-sm text-stone-600 leading-relaxed italic shadow-inner">
                      "{data.campaign.prompt_description}"
                   </div>
                </div>
              )}
           </div>

           <div className="bg-stone-900 rounded-3xl p-8 shadow-2xl relative overflow-hidden group">
              <div className="relative z-10 h-full flex flex-col">
                 <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                       <div className="p-2.5 bg-white/10 text-white rounded-2xl">
                          <BarChart2 className="w-5 h-5" />
                       </div>
                       <h3 className="text-sm font-black text-stone-400 uppercase tracking-widest">Mission Performance</h3>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-brand-500 text-[10px] font-black text-white rounded-full uppercase tracking-tighter shadow-lg shadow-brand-500/30">
                       <Activity className="w-3 h-3" />
                       Real-time sync
                    </div>
                 </div>

                 <div className="space-y-8 mt-auto">
                    <div>
                       <div className="flex items-center justify-between text-[11px] font-black text-stone-500 mb-3 uppercase tracking-widest">
                          <span>Outreach Efficiency</span>
                          <span className="text-white text-base">{winRate}%</span>
                       </div>
                       <div className="h-2.5 bg-white/10 rounded-full overflow-hidden p-0.5">
                          <motion.div 
                             initial={{ width: 0 }}
                             animate={{ width: `${winRate}%` }}
                             className="h-full bg-brand-500 rounded-full shadow-[0_0_15px_rgba(235,53,60,0.5)]"
                          />
                       </div>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
                       <div className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all cursor-default">
                          <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Bookings</div>
                          <div className="text-2xl font-black text-white leading-none">{booked}</div>
                       </div>
                       <div className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all cursor-default">
                          <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Engaged</div>
                          <div className="text-2xl font-black text-white leading-none">{data.statusCounts.contacted || 0}</div>
                       </div>
                       <div className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all cursor-default">
                          <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Reached</div>
                          <div className="text-2xl font-black text-white leading-none">{data.statusCounts.no_answer + data.statusCounts.contacted || 0}</div>
                       </div>
                       <div className="p-4 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all cursor-default">
                          <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest mb-1.5">Evolution</div>
                          <div className="text-2xl font-black text-brand-500 leading-none">v{Math.floor((data.campaign.calls_made || 0) / 50) + 1}</div>
                       </div>
                    </div>
                 </div>
              </div>
              <div className="absolute top-0 right-0 w-64 h-64 bg-brand-500/10 blur-[100px] pointer-events-none" />
              <div className="absolute -bottom-20 -left-20 w-80 h-80 bg-brand-500/5 blur-[120px] pointer-events-none" />
           </div>
        </div>

        {/* Row 2: Main Content - Lead Registry (Full Width) */}
        <div className="w-full space-y-6">
          <div className="bg-white border border-stone-200 rounded-2xl shadow-sm overflow-hidden min-h-[600px] flex flex-col">
            <div className="px-6 py-4 border-b border-stone-100 bg-stone-50/30 flex items-center justify-between">
               <div className="flex items-center gap-2">
                 <h3 className="text-sm font-bold text-stone-900 tracking-tight">Active Lead Flow</h3>
                 <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
               </div>
               <div className="flex items-center gap-4">
                  <div className="relative group">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
                    <input 
                      type="text" 
                      placeholder="Filter contacts..." 
                      className="pl-9 pr-4 py-1.5 bg-white border border-stone-200 rounded-lg text-xs focus:ring-1 focus:ring-brand-500 outline-none w-48 transition-all"
                    />
                  </div>
               </div>
            </div>
            
            <div className="overflow-x-auto flex-grow">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead>
                  <tr className="bg-stone-50/50 text-[10px] font-bold text-stone-400 uppercase tracking-widest border-b border-stone-100">
                    <th className="px-6 py-4">Lead Information</th>
                    <th className="px-6 py-4">Current Stage</th>
                    <th className="px-6 py-4">Script Used</th>
                    <th className="px-6 py-4">Dial Attempts</th>
                    <th className="px-6 py-4 text-right">Activity Hub</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-50">
                  {contacts.map((contact) => (
                    <tr key={contact.id} className="hover:bg-stone-50/50 transition-all group">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-[10px] font-bold text-stone-500 uppercase">
                            {contact.name ? contact.name.substring(0, 2) : "UN"}
                          </div>
                          <div>
                            <div className="font-bold text-stone-900">{contact.name || "UNIDENTIFIED"}</div>
                            <div className="text-[10px] text-stone-400 font-medium tracking-tight mt-0.5">{contact.phone}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <StatusBadge status={contact.status} />
                      </td>
                      <td className="px-6 py-4 max-w-[220px]">
                        {contact.script_content ? (
                           <div className="flex flex-col gap-1.5 group-hover:bg-stone-50 transition-all rounded-lg">
                              <div className="flex items-center gap-1.5">
                                 <span className="px-1.5 py-0.5 bg-brand-100 text-brand-700 text-[8px] font-black rounded uppercase tracking-tighter shrink-0 border border-brand-200">Var {String.fromCharCode(64 + (data.scripts.findIndex(s => s.content === contact.script_content) + 1) || 1)}</span>
                                 <span className="text-[9px] font-bold text-stone-400 uppercase tracking-widest">Active Script</span>
                              </div>
                              <div className="text-[11px] text-stone-600 italic line-clamp-1 group-hover:line-clamp-none transition-all">
                                "{contact.script_content}"
                              </div>
                           </div>
                        ) : (
                           <div className="flex items-center gap-2 opacity-40">
                              <Pencil className="w-3 h-3 text-stone-400" />
                              <span className="text-[10px] font-bold text-stone-400 uppercase tracking-widest">Initial Context</span>
                           </div>
                        )}
                      </td>
                      <td className="px-6 py-4 font-mono text-[11px] font-bold text-stone-500">
                        <div className="flex items-center gap-1.5">
                           <div className="flex gap-0.5">
                              {[1,2,3].map(step => (
                                <div key={step} className={`w-3 h-1 rounded-full ${step <= (contact.attempts || 0) ? 'bg-brand-500' : 'bg-stone-100'}`} />
                              ))}
                           </div>
                           <span className="opacity-60">{contact.attempts || 0}/3</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        <div className="flex items-center justify-end gap-2.5">
                           {contact.transcript && (
                             <motion.button 
                                whileHover={{ scale: 1.05, backgroundColor: '#f5f5f4' }}
                                whileTap={{ scale: 0.95 }}
                                onClick={() => setSelectedTranscript(contact.transcript)}
                                className="h-8 px-3 flex items-center gap-2 bg-white text-stone-600 rounded-xl border border-stone-200 hover:text-brand-600 hover:border-brand-200 transition-all shadow-sm"
                             >
                                <MessageSquare className="w-3.5 h-3.5" />
                                <span className="text-[10px] font-bold uppercase tracking-tight">Transcript</span>
                             </motion.button>
                           )}

                          {contact.recording_id ? (
                            <motion.button 
                               whileHover={{ scale: 1.05 }}
                               whileTap={{ scale: 0.95 }}
                               disabled={isPlayingAudio}
                               onClick={(e) => {
                                 e.stopPropagation();
                                 handlePlayAudio(contact.recording_id, contact.name || contact.phone);
                               }}
                               className={`h-8 px-4 inline-flex items-center gap-2 rounded-xl border shadow-sm font-black text-[10px] uppercase tracking-tight transition-all ${
                                  isPlayingAudio ? 'bg-stone-50 text-stone-400 border-stone-200' : 'bg-brand-600 text-white border-brand-500 hover:bg-brand-700'
                               }`}
                            >
                               {isPlayingAudio ? (
                                 <Activity className="w-3.5 h-3.5 animate-pulse" />
                               ) : (
                                 <Play className="w-3.5 h-3.5 fill-current" />
                               )}
                               {isPlayingAudio ? "Loading..." : "Listen recording"}
                            </motion.button>
                          ) : (
                             <div className="px-3 py-1 bg-stone-50 border border-stone-100 rounded-lg text-stone-300 flex items-center gap-2">
                                <span className="text-[9px] font-bold uppercase tracking-widest">No Audio</span>
                             </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {contacts.length === 0 && (
                    <tr>
                      <td colSpan="5" className="px-6 py-32 text-center">
                        <div className="flex flex-col items-center gap-3 opacity-20">
                          <Users className="w-8 h-8" />
                          <span className="text-sm font-bold uppercase tracking-widest">No candidates found in registry</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {selectedAudio && (
          <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50">
            <motion.div 
               initial={{ y: 100, opacity: 0 }}
               animate={{ y: 0, opacity: 1 }}
               exit={{ y: 100, opacity: 0 }}
               className="bg-stone-900 text-white rounded-2xl p-4 shadow-2xl border border-white/10 w-[400px] flex items-center gap-4"
            >
               <div className="w-10 h-10 rounded-full bg-brand-500 flex items-center justify-center shrink-0">
                  <Activity className="w-5 h-5 text-white animate-pulse" />
               </div>
               <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-bold text-stone-500 uppercase tracking-widest leading-none mb-1">Recording playback</div>
                  <div className="text-sm font-bold truncate">{selectedAudio.name}</div>
                  <audio 
                    src={selectedAudio.url} 
                    autoPlay 
                    controls 
                    className="h-8 mt-2 w-full brightness-0 invert opacity-60 hover:opacity-100 transition-opacity" 
                  />
               </div>
               <button 
                onClick={() => setSelectedAudio(null)}
                className="p-2 hover:bg-white/10 rounded-lg transition-colors self-start"
               >
                 <XCircle className="w-4 h-4 text-stone-500" />
               </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedTranscript && (
          <>
            <div className="fixed inset-0 bg-stone-900/40 backdrop-blur-sm z-[45]" onClick={() => setSelectedTranscript(null)} />
            <TranscriptViewer 
              transcript={selectedTranscript} 
              onClose={() => setSelectedTranscript(null)} 
            />
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

function MiniStatCard({ label, value, icon: Icon, color }) {
  return (
    <div className="bg-white p-4 border border-stone-200 rounded-xl shadow-sm flex items-center gap-4">
      <div className={`p-2.5 rounded-lg bg-stone-50 ${color}`}>
        <Icon className="w-4 h-4 shadow-sm" />
      </div>
      <div>
        <div className="text-[9px] font-bold text-stone-400 uppercase tracking-widest leading-none mb-1.5">{label}</div>
        <div className="text-lg font-black text-stone-900 leading-none">{value}</div>
      </div>
    </div>
  );
}

function ConfigRow({ label, value, icon: Icon }) {
  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 p-1 bg-stone-50 rounded text-stone-400">
        <Icon className="w-3 h-3" />
      </div>
      <div>
        <div className="text-[9px] font-bold text-stone-400 uppercase tracking-tight leading-none mb-0.5">{label}</div>
        <div className="text-[11px] font-bold text-stone-700 leading-tight">{value}</div>
      </div>
    </div>
  );
}

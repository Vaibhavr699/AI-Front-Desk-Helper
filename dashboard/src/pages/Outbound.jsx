import React, { useState, useEffect } from "react";
import { useOutletContext } from "react-router-dom";
import { get, post, patch } from "../api";
import { 
  Rocket, Package, Search, Plus, Play, Pause, MoreVertical, 
  CheckCircle2, XCircle, Clock, AlertCircle, ShoppingCart, 
  Users, Activity, Zap, TrendingUp, ArrowRight, BarChart2, 
  Pencil
} from "lucide-react";
import { Button } from "../components/ui/button";
import CampaignCreator from "../components/outbound/CampaignCreator";
import { motion, AnimatePresence } from "framer-motion";
import { useToast } from "../components/ui/Toast";

export default function Outbound({ tenantId }) {
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeCampaign, setActiveCampaign] = useState(null);
  const [showCreator, setShowCreator] = useState(false);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    fetchCampaigns();
    fetchBalance();
  }, [tenantId]);

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
              <BundleCard minutes={500} price={99} tenantId={tenantId} onBuy={fetchBalance} />
              <BundleCard minutes={1500} price={249} tenantId={tenantId} onBuy={fetchBalance} isPopular />
              <BundleCard minutes={3000} price={499} tenantId={tenantId} onBuy={fetchBalance} />
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

function BundleCard({ minutes, price, tenantId, onBuy, isPopular }) {
  const [loading, setLoading] = useState(false);
  const { success, error } = useToast();

  async function handleBuy() {
    setLoading(true);
    try {
      await post("/api/outbound/purchase-bundle", { minutes, amount: price, tenantId });
      onBuy();
      success(`${minutes.toLocaleString()} Min added to your mission balance.`);
    } catch (e) {
      error("Transaction failed. Check network.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button 
      onClick={handleBuy}
      disabled={loading}
      className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left group ${isPopular ? 'border-brand-500 bg-brand-50/30' : 'border-stone-200 hover:border-brand-300 hover:bg-stone-50/50'}`}
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
    draft: "bg-stone-50 text-stone-400 border-stone-200"
  };
  return (
    <div className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border inline-flex items-center gap-1.5 ${styles[status]}`}>
      {status === 'active' && <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />}
      {status}
    </div>
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
  const { success, error } = useToast();

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

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Main Content: Lead Registry */}
        <div className="xl:col-span-9 space-y-6">
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
                    <th className="px-6 py-4">Dial Attempts</th>
                    <th className="px-6 py-4">Last Activity</th>
                    <th className="px-6 py-4 text-right">Call Audio</th>
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
                        <StatusBadge status={contact.status === 'pending' || contact.status === 'contacted' ? 'active' : contact.status} />
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
                      <td className="px-6 py-4 text-[11px] text-stone-500">
                        {contact.last_attempt_at ? (
                          <div className="flex flex-col">
                            <span className="font-bold text-stone-700">{new Date(contact.last_attempt_at).toLocaleDateString()}</span>
                            <span className="opacity-60">{new Date(contact.last_attempt_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                          </div>
                        ) : (
                           <span className="text-stone-300 italic tracking-tight font-medium">Pending initial dial</span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {contact.last_call_id ? (
                          <motion.button 
                             whileHover={{ scale: 1.05 }}
                             whileTap={{ scale: 0.95 }}
                             className="inline-flex items-center gap-2 px-3 py-1.5 bg-brand-50 text-brand-600 rounded-lg border border-brand-100 hover:bg-brand-600 hover:text-white transition-all shadow-sm font-bold text-[10px] uppercase"
                          >
                             <Play className="w-3 h-3 fill-current" />
                             Play
                          </motion.button>
                        ) : (
                           <span className="text-[9px] font-bold text-stone-300 uppercase tracking-widest mr-4">No Data</span>
                        )}
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

        {/* Sidebar: Mission Control */}
        <div className="xl:col-span-3 space-y-6">
          {data.campaign.mode === 'auto' ? (
            <div className="bg-stone-900 rounded-2xl p-6 shadow-xl space-y-6 relative overflow-hidden">
              <h3 className="text-[10px] font-black text-stone-500 uppercase tracking-[0.2em] relative z-10">Mission Scripting</h3>
              <div className="space-y-4 relative z-10">
                {data.scripts.length > 0 ? (
                  data.scripts.map((s, i) => (
                    <div key={s.id} className="p-5 bg-white/5 border border-white/10 rounded-xl space-y-4 hover:border-brand-500/30 transition-all cursor-default group">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                           <span className="w-5 h-5 rounded bg-brand-500/20 text-brand-400 flex items-center justify-center text-[10px] font-black">{String.fromCharCode(65 + i)}</span>
                           <span className="text-[9px] font-bold text-stone-400 uppercase tracking-widest">VARIATION</span>
                        </div>
                        {i === 0 && <span className="px-1.5 py-0.5 bg-brand-500 text-[8px] font-black text-white rounded uppercase tracking-widest">Champion</span>}
                      </div>
                      <p className="text-[12px] text-stone-300 leading-relaxed italic group-hover:text-white transition-colors line-clamp-3">
                        "{s.content}"
                      </p>
                      <div className="pt-2 border-t border-white/5 flex items-center justify-between">
                        <span className="text-[9px] font-bold text-stone-500 uppercase tracking-widest leading-none">Effectiveness</span>
                        <span className="text-xs font-black text-brand-400 italic">{s.performance_pct || 0}%</span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-[10px] text-stone-600 font-bold uppercase tracking-widest py-10 text-center border border-white/5 rounded-xl">
                    Generating Scripts...
                  </div>
                )}
              </div>
              <div className="absolute top-0 right-0 w-32 h-32 bg-brand-500/10 blur-[60px] pointer-events-none" />
            </div>
          ) : (
            <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <BarChart2 className="w-4 h-4 text-brand-500" />
                  <h3 className="text-[10px] font-black text-stone-400 uppercase tracking-[0.15em]">Primary Instruction</h3>
                </div>
                {!isEditingPrompt && (
                   <button 
                    onClick={() => setIsEditingPrompt(true)}
                    className="text-[9px] font-bold text-stone-400 hover:text-brand-600 uppercase tracking-widest transition-colors flex items-center gap-1"
                   >
                     <Pencil className="w-5 h-5" />
                   </button>
                )}
              </div>
              
              {isEditingPrompt ? (
                <div className="space-y-3">
                  <textarea 
                    value={editedPrompt}
                    onChange={(e) => setEditedPrompt(e.target.value)}
                    className="w-full min-h-[140px] p-3 text-[11px] bg-stone-50 border border-stone-200 rounded-xl focus:ring-1 focus:ring-brand-500 outline-none leading-relaxed text-stone-600 font-medium"
                    placeholder="Enter new AI instructions..."
                  />
                  <div className="flex items-center gap-2">
                    <Button 
                      className="flex-1 bg-brand-600 text-white h-8 text-[10px] font-bold rounded-lg shadow-sm"
                      onClick={handleUpdatePrompt}
                      disabled={actionLoading}
                    >
                      {actionLoading ? "Saving..." : "Save Changes"}
                    </Button>
                    <button 
                      onClick={() => {
                        setIsEditingPrompt(false);
                        setEditedPrompt(data.campaign.prompt_description);
                      }}
                      className="px-3 h-8 text-[10px] font-bold text-stone-400 hover:text-stone-900 transition-colors uppercase tracking-widest"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-stone-50 rounded-xl border border-stone-100 italic text-stone-600 text-xs leading-relaxed">
                  "{data.campaign.prompt_description}"
                </div>
              )}
            </div>
          )}

          <div className="bg-white border border-stone-200 rounded-2xl p-6 shadow-sm space-y-6">
            <h3 className="text-[10px] font-bold text-stone-400 uppercase tracking-widest border-b border-stone-50 pb-4">Configuration Data</h3>
            <div className="space-y-4">
               <ConfigRow label="Intelligence Mode" value={`${data.campaign.mode === 'auto' ? 'Auto-Scripted A/B' : 'Manual Instruction'}`} icon={Zap} />
               <ConfigRow label="Registry Status" value="Live Ingestion Active" icon={Activity} />
               <ConfigRow label="Active Window" value={`${data.campaign.calling_hours_start.substring(0, 5)} - ${data.campaign.calling_hours_end.substring(0, 5)}`} icon={Clock} />
            </div>
          </div>
        </div>
      </div>
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

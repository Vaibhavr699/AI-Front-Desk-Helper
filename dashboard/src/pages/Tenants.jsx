import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { 
  getTenants, 
  updateTenant, 
  resetApiKey 
} from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { 
  Building2, 
  Globe, 
  Phone, 
  Shield, 
  ChevronRight, 
  Search, 
  Plus, 
  MoreVertical,
  Settings,
  X,
  Bot,
  Calendar,
  Zap,
  Facebook,
  Key,
  CheckCircle2,
  AlertCircle
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = () => {
    setLoading(true);
    getTenants()
      .then((data) => setTenants(data.tenants || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const handleEditClick = (tenant) => {
    setSelectedTenant({ ...tenant });
    setIsEditing(true);
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!selectedTenant) return;
    setSaveLoading(true);
    try {
      await updateTenant(selectedTenant.id, selectedTenant);
      await fetchTenants();
      setIsEditing(false);
      setSelectedTenant(null);
    } catch (err) {
      console.error("Failed to save tenant:", err);
    } finally {
      setSaveLoading(false);
    }
  };

  const filteredTenants = tenants.filter(t => 
    (t.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.company_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
    (t.slug || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading && tenants.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <LumaSpin />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight flex items-center gap-3">
            <Building2 className="text-blue-600" size={32} />
            Businesses
          </h1>
          <p className="text-gray-500 mt-1 max-w-xl">
            SaaS Management Console. Monitor, configure, and manage all business profiles on the AI Front Desk platform.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative group">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400 group-focus-within:text-blue-500 transition-colors">
              <Search size={18} />
            </div>
            <input
              type="text"
              placeholder="Search businesses..."
              className="pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent w-full md:w-64 transition-all shadow-sm"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 shadow-lg shadow-blue-100 transition-all active:scale-95">
            <Plus size={18} />
            ADD BUSINESS
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {/* Stats Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-sm font-medium text-gray-500 mb-1">Total Businesses</div>
          <div className="text-2xl font-bold text-gray-900">{tenants.length}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-sm font-medium text-gray-500 mb-1">Active Subscriptions</div>
          <div className="text-2xl font-bold text-green-600">{tenants.filter(t => t.plan !== 'free').length}</div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-sm font-medium text-gray-500 mb-1">Managed Numbers</div>
          <div className="text-2xl font-bold text-blue-600">
            {tenants.reduce((acc, t) => acc + (t.phones?.length || 0), 0)}
          </div>
        </div>
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="text-sm font-medium text-gray-500 mb-1">Avg. AI Sessions/Day</div>
          <div className="text-2xl font-bold text-purple-600">142</div>
        </div>
      </div>

      {/* Grid View */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTenants.length === 0 ? (
          <div className="col-span-full py-20 text-center">
            <div className="bg-gray-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 className="text-gray-300" size={40} />
            </div>
            <h3 className="text-xl font-bold text-gray-900">No businesses found</h3>
            <p className="text-gray-500">Try adjusting your search query or add a new business.</p>
          </div>
        ) : (
          filteredTenants.map((t) => (
            <motion.div
              layout
              key={t.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white rounded-3xl border border-gray-100 shadow-sm hover:shadow-xl hover:shadow-gray-200/50 transition-all group relative overflow-hidden flex flex-col"
            >
              {/* Top Banner / Color Coding */}
              <div className={`h-2 w-full ${t.plan === 'elite' ? 'bg-purple-500' : t.plan === 'pro' ? 'bg-blue-500' : 'bg-gray-300'}`} />
              
              <div className="p-6 flex-1">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-gray-900 group-hover:text-blue-600 transition-colors uppercase tracking-tight">
                      {t.name || t.slug}
                    </h3>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-400 mt-0.5">
                      <span className="capitalize">{t.plan || 'basic'} Plan</span>
                      <span>•</span>
                      <span>{t.timezone || 'UTC'}</span>
                    </div>
                  </div>
                  <div className="bg-gray-50 p-2 rounded-xl group-hover:bg-blue-50 transition-colors cursor-pointer" onClick={() => handleEditClick(t)}>
                    <Settings className="text-gray-400 group-hover:text-blue-500" size={20} />
                  </div>
                </div>

                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <Building2 size={16} className="text-gray-400" />
                    <span className="truncate">{t.company_name || "No company name"}</span>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-gray-600">
                    <Phone size={16} className="text-gray-400" />
                    <span className="font-mono">
                      {t.phones?.[0]?.phone || "No phone linked"}
                    </span>
                  </div>
                  {t.website && (
                    <div className="flex items-center gap-3 text-sm text-gray-600">
                      <Globe size={16} className="text-gray-400" />
                      <a href={t.website} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline truncate">
                        {t.website.replace(/^https?:\/\//, '')}
                      </a>
                    </div>
                  )}
                </div>

                {/* Integration Badges */}
                <div className="flex flex-wrap gap-2 pt-4 border-t border-gray-50">
                  <IntegrationBadge active={t.has_twilio_credentials} icon={<Zap size={12}/>} name="Twilio" />
                  <IntegrationBadge active={t.google_calendar_linked} icon={<Calendar size={12}/>} name="Google" />
                  <IntegrationBadge active={!!t.facebook_page_id} icon={<Facebook size={12}/>} name="FB" />
                  <IntegrationBadge active={!!t.crm_webhook_url} icon={<Shield size={12}/>} name="CRM" />
                  <IntegrationBadge active={!!t.zapier_webhook_url} icon={<Zap size={12}/>} name="Zapier" />
                </div>
              </div>

              {/* Footer Action */}
              <div className="px-6 py-4 bg-gray-50/50 flex items-center justify-between">
                <Link
                  to="/settings"
                  state={{ switchTenantId: t.id }}
                  className="text-sm font-bold text-gray-600 hover:text-blue-600 flex items-center gap-1 transition-colors"
                >
                  Manage Console
                  <ChevronRight size={16} />
                </Link>
                <div className="flex -space-x-2">
                   {[1,2,3].map(i => (
                     <div key={i} className="w-8 h-8 rounded-full border-2 border-white bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-500 uppercase">
                       {String.fromCharCode(64 + Math.floor(Math.random() * 26))}
                     </div>
                   ))}
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Business Profile Modal / Sidebar */}
      <AnimatePresence>
        {isEditing && (
          <div className="fixed inset-0 z-50 flex items-center justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEditing(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="relative w-full max-w-2xl h-full bg-white shadow-2xl flex flex-col"
            >
              <div className="p-6 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <div>
                  <h2 className="text-2xl font-black text-gray-900 flex items-center gap-3">
                    <Building2 className="text-blue-600" />
                    EDIT PROFILE
                  </h2>
                  <p className="text-sm text-gray-500 font-medium">{selectedTenant?.slug}</p>
                </div>
                <button
                  onClick={() => setIsEditing(false)}
                  className="p-2 hover:bg-gray-100 rounded-full transition-colors"
                >
                  <X size={24} className="text-gray-400" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                <form id="tenant-form" onSubmit={handleSave} className="space-y-8">
                  {/* Business Info Section */}
                  <div>
                    <h3 className="text-sm font-bold text-blue-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                       <Building2 size={16} />
                       Core Business Details
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700">Display Name</label>
                        <input
                          type="text"
                          className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium"
                          value={selectedTenant?.name || ""}
                          onChange={(e) => setSelectedTenant({...selectedTenant, name: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700">Legal Company Name</label>
                        <input
                          type="text"
                          className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium"
                          value={selectedTenant?.company_name || ""}
                          onChange={(e) => setSelectedTenant({...selectedTenant, company_name: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700">Website URL</label>
                        <input
                          type="url"
                          placeholder="https://example.com"
                          className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium"
                          value={selectedTenant?.website || ""}
                          onChange={(e) => setSelectedTenant({...selectedTenant, website: e.target.value})}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700">Timezone</label>
                        <select
                          className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium"
                          value={selectedTenant?.timezone || "America/Chicago"}
                          onChange={(e) => setSelectedTenant({...selectedTenant, timezone: e.target.value})}
                        >
                          <option value="America/Chicago">America/Chicago (CST)</option>
                          <option value="America/New_York">America/New_York (EST)</option>
                          <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                          <option value="Europe/London">Europe/London (GMT)</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* AI & Voice Section */}
                  <div className="pt-8 border-t border-gray-100">
                    <h3 className="text-sm font-bold text-purple-600 uppercase tracking-widest mb-4 flex items-center gap-2">
                       <Bot size={16} />
                       AI & Identity
                    </h3>
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700">AI Welcome Script</label>
                        <textarea
                          rows={2}
                          className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium resize-none"
                          value={selectedTenant?.welcome_message || ""}
                          onChange={(e) => setSelectedTenant({...selectedTenant, welcome_message: e.target.value})}
                        />
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-gray-700">Voice Model</label>
                          <select
                            className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium"
                            value={selectedTenant?.voice_model || "gpt-4o-realtime-preview-2024-12-17"}
                            onChange={(e) => setSelectedTenant({...selectedTenant, voice_model: e.target.value})}
                          >
                            <option value="gpt-4o-realtime-preview-2024-12-17">GPT-4o Realtime</option>
                            <option value="gpt-4o-realtime-preview">GPT-4o Preview</option>
                            <option value="gpt-realtime-ultra">Experimental Ultra</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-bold text-gray-700">Response Tone</label>
                          <select
                            className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium"
                            value={selectedTenant?.tone_of_voice || "professional"}
                            onChange={(e) => setSelectedTenant({...selectedTenant, tone_of_voice: e.target.value})}
                          >
                            <option value="professional">Professional</option>
                            <option value="friendly">Friendly & Casual</option>
                            <option value="luxury">Luxury & Formal</option>
                            <option value="authoritative">Authoritative</option>
                          </select>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-bold text-gray-700">Core AI Instructions</label>
                        <textarea
                          rows={5}
                          className="w-full px-4 py-3 bg-gray-50 border border-transparent rounded-xl focus:bg-white focus:border-blue-500 focus:ring-4 focus:ring-blue-50 transition-all font-medium font-mono text-sm leading-relaxed"
                          value={selectedTenant?.instructions || ""}
                          onChange={(e) => setSelectedTenant({...selectedTenant, instructions: e.target.value})}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Integration Status (Read-Only/Quick Check) */}
                  <div className="pt-8 border-t border-gray-100">
                    <h3 className="text-sm font-bold text-gray-500 uppercase tracking-widest mb-4 flex items-center gap-2">
                       <Zap size={16} />
                       Integrations Health
                    </h3>
                    <div className="grid grid-cols-2 gap-4">
                      <StatusCard label="Twilio" active={selectedTenant?.has_twilio_credentials} />
                      <StatusCard label="G-Calendar" active={selectedTenant?.google_calendar_linked} />
                      <StatusCard label="Facebook" active={!!selectedTenant?.facebook_page_id} />
                      <StatusCard label="CRM Sync" active={!!selectedTenant?.crm_webhook_url} />
                    </div>
                  </div>
                </form>
              </div>

              <div className="p-8 border-t border-gray-100 bg-gray-50 flex items-center gap-4">
                <button
                  type="submit"
                  form="tenant-form"
                  disabled={saveLoading}
                  className="flex-1 bg-gray-900 hover:bg-black text-white py-4 rounded-2xl font-bold transition-all shadow-xl shadow-gray-200 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {saveLoading && <LumaSpin className="w-5 h-5 border-white" />}
                  SAVE CHANGES
                </button>
                <button
                  type="button"
                  onClick={() => setIsEditing(false)}
                  className="px-8 py-4 bg-white border border-gray-200 text-gray-600 rounded-2xl font-bold hover:bg-gray-50 transition-all"
                >
                  CANCEL
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IntegrationBadge({ active, icon, name }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold uppercase tracking-tight transition-colors ${
      active 
        ? 'bg-green-50 text-green-600 border border-green-100' 
        : 'bg-gray-50 text-gray-400 border border-transparent grayscale'
    }`}>
      {icon}
      <span>{name}</span>
    </div>
  );
}

function StatusCard({ label, active }) {
  return (
    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl">
      <span className="text-sm font-bold text-gray-700">{label}</span>
      {active ? (
        <div className="flex items-center gap-1.5 text-green-600 text-xs font-bold">
           <CheckCircle2 size={16} />
           ACTIVE
        </div>
      ) : (
        <div className="flex items-center gap-1.5 text-gray-400 text-xs font-bold">
           <AlertCircle size={16} />
           INACTIVE
        </div>
      )}
    </div>
  );
}

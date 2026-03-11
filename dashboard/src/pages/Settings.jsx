import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { 
  getTenant, 
  updateTenant, 
  getPhoneNumbers, 
  addPhoneNumber, 
  deletePhoneNumber,
  resetApiKey 
} from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { 
  Bot, 
  Clock, 
  Link as LinkIcon, 
  Shield, 
  Save, 
  RefreshCw, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  AlertCircle,
  Phone,
  MessageSquare,
  Globe,
  Settings as SettingsIcon,
  ChevronRight,
  ExternalLink,
  Zap
} from "lucide-react";

const TENANT_STORAGE_KEY = "tenantId";

const TABS = [
  { id: "ai", label: "AI Behavior", icon: Bot },
  { id: "hours", label: "Business Hours", icon: Clock },
  { id: "integrations", label: "Integrations", icon: LinkIcon },
  { id: "security", label: "Security & API", icon: Shield },
];

export default function Settings({ tenantId }) {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("ai");

  // Form states
  const [form, setForm] = useState({
    welcome_message: "",
    instructions: "",
    tone_of_voice: "professional",
    transfer_numbers_raw: "",
    transfer_sms_brief: "",
    crm_webhook_url: "",
    zapier_webhook_url: "",
    follow_up_enabled: true,
    afterhours_behavior: "voicemail",
    business_hours: {},
    objection_handling: {
      price: "",
      thinking: "",
      spouse: ""
    },
    twilio_account_sid: "",
    twilio_auth_token: "",
    facebook_page_id: "",
    facebook_page_access_token: ""
  });

  // Phone numbers state
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [phonesLoading, setPhonesLoading] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");

  const loadTenant = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const t = await getTenant(tenantId);
      setTenant(t);
      setForm({
        welcome_message: t.welcome_message || "",
        instructions: t.instructions || "",
        tone_of_voice: t.tone_of_voice || "professional",
        transfer_numbers_raw: Array.isArray(t.transfer_numbers) ? t.transfer_numbers.join(", ") : "",
        transfer_sms_brief: t.transfer_sms_brief || "",
        crm_webhook_url: t.crm_webhook_url || "",
        zapier_webhook_url: t.zapier_webhook_url || "",
        follow_up_enabled: t.follow_up_enabled !== false,
        afterhours_behavior: t.afterhours_behavior || "voicemail",
        business_hours: t.business_hours || {
          monday: { open: "08:00", close: "17:00", closed: false },
          tuesday: { open: "08:00", close: "17:00", closed: false },
          wednesday: { open: "08:00", close: "17:00", closed: false },
          thursday: { open: "08:00", close: "17:00", closed: false },
          friday: { open: "08:00", close: "17:00", closed: false },
          saturday: { open: "09:00", close: "13:00", closed: true },
          sunday: { open: "09:00", close: "13:00", closed: true },
        },
        objection_handling: t.objection_handling_config || {
          price: "",
          thinking: "",
          spouse: ""
        },
        twilio_account_sid: "",
        twilio_auth_token: "",
        facebook_page_id: t.facebook_page_id || "",
        facebook_page_access_token: ""
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const loadPhones = async () => {
    if (!tenantId) return;
    setPhonesLoading(true);
    try {
      const data = await getPhoneNumbers(tenantId);
      setPhoneNumbers(data.phone_numbers || []);
    } catch (e) {
      console.error(e);
    } finally {
      setPhonesLoading(false);
    }
  };

  useEffect(() => {
    loadTenant();
    loadPhones();
  }, [tenantId]);

  const handleUpdateForm = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };

  const handleUpdateOpeningHours = (day, field, value) => {
    setForm(prev => ({
      ...prev,
      business_hours: {
        ...prev.business_hours,
        [day]: { ...prev.business_hours[day], [field]: value }
      }
    }));
  };

  const handleUpdateObjection = (type, value) => {
    setForm(prev => ({
      ...prev,
      objection_handling: { ...prev.objection_handling, [type]: value }
    }));
  };

  const handleAddPhone = async (e) => {
    e.preventDefault();
    if (!newPhone.trim()) return;
    setPhoneError("");
    try {
      await addPhoneNumber(tenantId, newPhone.trim());
      setNewPhone("");
      loadPhones();
    } catch (err) {
      setPhoneError(err.message);
    }
  };

  const handleDeletePhone = async (phoneId) => {
    if (!confirm("Remove this phone number?")) return;
    try {
      await deletePhoneNumber(phoneId);
      loadPhones();
    } catch (err) {
      setPhoneError(err.message);
    }
  };

  const handleResetKey = async () => {
    if (!confirm("Reset API Key? Any existing integrations using the old key will break.")) return;
    try {
      const res = await resetApiKey(tenantId);
      setTenant(prev => ({ ...prev, api_key_masked: res.api_key.substring(0, 4) + "..." + res.api_key.slice(-4) }));
      setMessage("API Key reset successfully. New key generated.");
    } catch (e) {
      setError(e.message);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    
    const transfer_numbers = form.transfer_numbers_raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => (s.startsWith("+") ? s : `+1${s.replace(/\D/g, "").slice(-10)}`));

    const payload = {
      welcome_message: form.welcome_message || null,
      instructions: form.instructions || null,
      tone_of_voice: form.tone_of_voice,
      transfer_numbers,
      transfer_sms_brief: form.transfer_sms_brief || null,
      crm_webhook_url: form.crm_webhook_url || null,
      zapier_webhook_url: form.zapier_webhook_url || null,
      follow_up_enabled: form.follow_up_enabled,
      afterhours_behavior: form.afterhours_behavior,
      business_hours: form.business_hours,
      objection_handling_config: form.objection_handling,
      facebook_page_id: form.facebook_page_id.trim() || null,
    };

    if (form.facebook_page_access_token) payload.facebook_page_access_token = form.facebook_page_access_token;
    if (form.twilio_account_sid.trim()) payload.twilio_account_sid = form.twilio_account_sid.trim();
    if (form.twilio_auth_token) payload.twilio_auth_token = form.twilio_auth_token;

    try {
      const updated = await updateTenant(tenantId, payload);
      setTenant(updated);
      setMessage("Settings saved successfully.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh]">
        <LumaSpin size="xl" />
        <p className="mt-4 text-gray-500 font-medium animate-pulse">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight flex items-center gap-3">
            <SettingsIcon className="text-primary w-8 h-8" />
            System Settings
          </h1>
          <p className="text-gray-500 mt-2 text-lg">
            Configure {tenant?.company_name || tenant?.name}'s AI behavior and integrations.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/tenants" className="text-sm font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1 transition-colors px-4 py-2 rounded-xl bg-gray-100/50 hover:bg-gray-100">
            Switch Business
          </Link>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="flex items-center gap-2 bg-gray-900 text-white px-6 py-2.5 rounded-xl font-bold shadow-lg shadow-gray-200 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-50"
          >
            {saving ? <RefreshCw className="animate-spin w-4 h-4" /> : <Save className="w-4 h-4 text-primary" />}
            {saving ? "SAVING..." : "SAVE CHANGES"}
          </button>
        </div>
      </div>

      {/* Notifications */}
      {message && (
        <div className="mb-6 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-center gap-3 text-emerald-800 animate-in fade-in slide-in-from-top-4 duration-300">
          <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
          <span className="font-medium">{message}</span>
        </div>
      )}
      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-800 animate-in fade-in slide-in-from-top-4 duration-300">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0" />
          <span className="font-medium">{error}</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Tabs Sidebar */}
        <aside className="lg:w-64 shrink-0">
          <nav className="flex flex-row lg:flex-col gap-1 p-1 bg-gray-100/50 rounded-2xl md:p-1.5 lg:bg-transparent lg:p-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-xl transition-all flex-1 lg:flex-none justify-center lg:justify-start ${
                  activeTab === tab.id
                    ? "bg-white text-gray-900 shadow-sm ring-1 ring-gray-200"
                    : "text-gray-500 hover:text-gray-700 hover:bg-gray-50"
                }`}
              >
                <tab.icon className={`w-5 h-5 ${activeTab === tab.id ? "text-primary" : "text-gray-400"}`} />
                <span className="hidden md:inline">{tab.label}</span>
              </button>
            ))}
          </nav>
        </aside>

        {/* Content Area */}
        <main className="flex-1 bg-white rounded-3xl border border-gray-100 shadow-xl shadow-gray-100/50 p-6 md:p-8 min-h-[500px] animate-in fade-in slide-in-from-right-4 duration-500">
          {activeTab === "ai" && (
            <div className="space-y-8 max-w-4xl">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <Bot className="text-primary w-5 h-5" />
                  AI Receptionist Behavior
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="col-span-1">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Tone of Voice</label>
                    <select
                      value={form.tone_of_voice}
                      onChange={(e) => handleUpdateForm("tone_of_voice", e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent transition-all outline-none font-medium"
                    >
                      <option value="professional">Professional & Polished</option>
                      <option value="friendly">Friendly & Casual</option>
                      <option value="luxury">Luxury & High-end</option>
                      <option value="authoritative">Direct & Authoritative</option>
                    </select>
                  </div>
                  <div className="col-span-1">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Welcome Message</label>
                    <textarea
                      value={form.welcome_message}
                      onChange={(e) => handleUpdateForm("welcome_message", e.target.value)}
                      rows={2}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary transition-all outline-none font-medium"
                      placeholder="e.g. Thanks for calling Gladiators Painting..."
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Detailed AI Instructions</label>
                    <textarea
                      value={form.instructions}
                      onChange={(e) => handleUpdateForm("instructions", e.target.value)}
                      rows={6}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary transition-all outline-none font-medium leading-relaxed"
                      placeholder="Detailed prompts for the AI behavior..."
                    />
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-gray-100">
                <h3 className="text-lg font-bold text-gray-900 mb-4 flex items-center gap-2">
                  <MessageSquare className="text-blue-500 w-5 h-5" />
                  Objection Handling
                </h3>
                <p className="text-sm text-gray-500 mb-6">Define how the AI should respond when a lead hesitates.</p>
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-widest pl-1">If Price is "Too High"</label>
                    <textarea
                      value={form.objection_handling.price}
                      onChange={(e) => handleUpdateObjection("price", e.target.value)}
                      rows={2}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:ring-2 focus:ring-primary transition-all"
                      placeholder="Script for price objections..."
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-widest pl-1">If they "Need to Think"</label>
                    <textarea
                      value={form.objection_handling.thinking}
                      onChange={(e) => handleUpdateObjection("thinking", e.target.value)}
                      rows={2}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:ring-2 focus:ring-primary transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-400 mb-1 uppercase tracking-widest pl-1">If they "Need to Talk to Spouse"</label>
                    <textarea
                      value={form.objection_handling.spouse}
                      onChange={(e) => handleUpdateObjection("spouse", e.target.value)}
                      rows={2}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-medium focus:ring-2 focus:ring-primary transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "hours" && (
            <div className="space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <Clock className="text-primary w-5 h-5" />
                    Business Hours
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">AI behavior will change automatically based on these hours.</p>
                </div>
                <div className="px-4 py-2 bg-primary/10 rounded-xl">
                  <span className="text-sm font-bold text-primary">{tenant?.timezone || "America/Chicago"} Time</span>
                </div>
              </div>

              <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                <div className="space-y-4">
                  {Object.entries(form.business_hours).map(([day, config]) => (
                    <div key={day} className="flex items-center justify-between gap-4 py-1">
                      <div className="w-28">
                        <span className="text-sm font-bold text-gray-700 capitalize">{day}</span>
                      </div>
                      <div className="flex-1 flex items-center gap-4">
                        {!config.closed ? (
                          <div className="flex items-center gap-2">
                            <input
                              type="time"
                              value={config.open || "08:00"}
                              onChange={(e) => handleUpdateOpeningHours(day, "open", e.target.value)}
                              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-bold"
                            />
                            <span className="text-gray-400 font-bold">—</span>
                            <input
                              type="time"
                              value={config.close || "17:00"}
                              onChange={(e) => handleUpdateOpeningHours(day, "close", e.target.value)}
                              className="px-3 py-1.5 bg-white border border-gray-200 rounded-lg text-sm font-bold"
                            />
                          </div>
                        ) : (
                          <span className="text-sm text-gray-400 font-bold italic">Closed All Day</span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleUpdateOpeningHours(day, "closed", !config.closed)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-tight transition-all border ${
                          config.closed 
                            ? "bg-red-50 text-red-600 border-red-100" 
                            : "bg-emerald-50 text-emerald-600 border-emerald-100"
                        }`}
                      >
                        {config.closed ? "Closed" : "Open"}
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-6 border-t border-gray-100">
                <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">After-Hours Behavior</label>
                <select
                  value={form.afterhours_behavior}
                  onChange={(e) => handleUpdateForm("afterhours_behavior", e.target.value)}
                  className="w-full md:w-64 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:border-transparent outline-none font-bold"
                >
                  <option value="voicemail">AI Out-of-Office Greeting</option>
                  <option value="transfer">Transfer to Live Agent</option>
                  <option value="sms">Send SMS Notification</option>
                </select>
                <p className="text-xs text-gray-500 mt-2 italic">Note: Transfer only works if a transfer number is configured.</p>
              </div>
            </div>
          )}

          {activeTab === "integrations" && (
            <div className="space-y-10">
              {/* Twilio */}
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <Phone className="text-primary w-5 h-5" />
                  Voice & SMS (Twilio)
                </h2>
                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                  <div className="space-y-6">
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Transfer Numbers</label>
                      <input
                        type="text"
                        value={form.transfer_numbers_raw}
                        onChange={(e) => handleUpdateForm("transfer_numbers_raw", e.target.value)}
                        placeholder="e.g. +14025551234, +14025555678"
                        className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-medium"
                      />
                      <p className="text-xs text-gray-500 mt-2">Comma-separated. Where calls go when human transfer is requested.</p>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Account SID</label>
                        <input
                          type="text"
                          value={form.twilio_account_sid}
                          onChange={(e) => handleUpdateForm("twilio_account_sid", e.target.value)}
                          placeholder={tenant?.twilio_account_sid_masked || "ACxxxxxxxxxx"}
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-mono text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Auth Token</label>
                        <input
                          type="password"
                          value={form.twilio_auth_token}
                          onChange={(e) => handleUpdateForm("twilio_auth_token", e.target.value)}
                          placeholder="••••••••••••••••"
                          className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Webhooks */}
              <div className="pt-6 border-t border-gray-100">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <Zap className="text-yellow-500 w-5 h-5" />
                  Webhooks & CRM
                </h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Zapier Webhook</label>
                    <div className="flex gap-2">
                       <input
                        type="url"
                        value={form.zapier_webhook_url}
                        onChange={(e) => handleUpdateForm("zapier_webhook_url", e.target.value)}
                        placeholder="https://hooks.zapier.com/..."
                        className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs"
                      />
                      <button className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
                        <ExternalLink className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Alternate CRM URL</label>
                    <input
                      type="url"
                      value={form.crm_webhook_url}
                      onChange={(e) => handleUpdateForm("crm_webhook_url", e.target.value)}
                      className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs"
                    />
                  </div>
                </div>
              </div>

              {/* Facebook */}
              <div className="pt-6 border-t border-gray-100">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2 text-[#1877F2]">
                   <Globe className="w-5 h-5" />
                   Facebook Messenger
                </h2>
                <div className="bg-[#1877F2]/5 rounded-2xl p-6 border border-[#1877F2]/10 space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-[#1877F2] mb-2 uppercase tracking-wide">Page ID</label>
                    <input
                      type="text"
                      value={form.facebook_page_id}
                      onChange={(e) => handleUpdateForm("facebook_page_id", e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-[#1877F2]/20 rounded-xl font-mono text-xs focus:ring-[#1877F2]"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-[#1877F2] mb-2 uppercase tracking-wide">Page Token</label>
                    <input
                      type="password"
                      value={form.facebook_page_access_token}
                      onChange={(e) => handleUpdateForm("facebook_page_access_token", e.target.value)}
                      className="w-full px-4 py-3 bg-white border border-[#1877F2]/20 rounded-xl font-mono text-xs focus:ring-[#1877F2]"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "security" && (
            <div className="space-y-10">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <Shield className="text-primary w-5 h-5" />
                  Business Access & API
                </h2>
                
                {/* <div className="bg-gray-900 rounded-3xl p-8 text-white shadow-2xl shadow-gray-200 relative overflow-hidden group">
                  <div className="absolute top-0 right-0 p-8 transform translate-x-4 -translate-y-4 opacity-10 group-hover:scale-110 transition-transform duration-700">
                    <Shield size={160} />
                  </div>
                  
                  <h3 className="text-lg font-bold mb-2 flex items-center gap-2">
                    <CheckCircle2 className="text-primary w-5 h-5" />
                    Advanced Security Active
                  </h3>
                  <p className="text-gray-400 text-sm mb-8 max-w-md">Your business API key is encrypted at rest and masked here for your protection.</p>
                  
                  <div className="space-y-6">
                    <div>
                      <label className="block text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-3">Your Secret API Key</label>
                      <div className="flex flex-col sm:flex-row items-center gap-4">
                        <div className="flex-1 w-full bg-white/5 border border-white/10 rounded-2xl px-6 py-4 font-mono text-xl tracking-widest text-primary flex items-center justify-between">
                          <span>{tenant?.api_key_masked || "•••• •••• •••• ••••"}</span>
                        </div>
                        <button
                          onClick={handleResetKey}
                          className="px-6 py-4 bg-primary text-gray-900 font-black rounded-2xl hover:bg-yellow-400 transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap"
                        >
                          <RefreshCw className="w-5 h-5" />
                          ROTATE KEY
                        </button>
                      </div>
                    </div>
                  </div>
                </div> */}
              </div>

              <div className="pt-10 border-t border-gray-100">
                <h3 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <Phone className="text-primary w-5 h-5" />
                  Linked Phone Numbers
                </h3>
                
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                  {phoneNumbers.map((pn) => (
                    <div key={pn.id} className="p-4 bg-gray-50 border border-gray-100 rounded-2xl flex items-center justify-between group hover:border-primary/30 transition-all">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-white border border-gray-200 flex items-center justify-center">
                          <Phone size={18} className="text-primary" />
                        </div>
                        <div>
                          <p className="font-bold text-gray-900">{pn.phone}</p>
                          {pn.is_primary && <span className="text-[10px] font-black text-primary uppercase">Primary Number</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDeletePhone(pn.id)}
                        className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-50 hover:text-red-500 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                  
                  <div className="p-4 border-2 border-dashed border-gray-200 rounded-2xl flex flex-col gap-3">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide">Add New Forwarder</p>
                    <div className="flex gap-2">
                      <input
                        type="tel"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                        placeholder="+1..."
                        className="flex-1 px-3 py-2 bg-gray-100/50 border-none rounded-xl text-sm font-bold focus:ring-1 focus:ring-primary"
                      />
                      <button onClick={handleAddPhone} className="p-2 bg-gray-900 text-white rounded-xl hover:bg-gray-800 transition-all">
                        <Plus size={18} />
                      </button>
                    </div>
                    {phoneError && <p className="text-[10px] text-red-500 font-bold">{phoneError}</p>}
                  </div>
                </div>

                <div className="mt-8 p-6 bg-blue-50 border border-blue-100 rounded-3xl">
                  <h4 className="font-bold text-blue-900 mb-3 flex items-center gap-2">
                    <LinkIcon className="w-4 h-4" />
                    Setup Instructions
                  </h4>
                  <p className="text-sm text-blue-800/80 mb-4 font-medium leading-relaxed">
                    Forward your primary business line to your active forwarder displayed above.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="bg-white/50 p-3 rounded-xl border border-blue-100">
                      <p className="text-xs font-black text-blue-900 mb-1">AT&T / VERIZON</p>
                      <p className="text-xs font-medium text-blue-800">Dial <span className="font-bold">*72</span> then the forwarder number</p>
                    </div>
                    <div className="bg-white/50 p-3 rounded-xl border border-blue-100">
                      <p className="text-xs font-black text-blue-900 mb-1">T-MOBILE</p>
                      <p className="text-xs font-medium text-blue-800">Settings → Calls → Always Forward</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  getTenant,
  updateTenant,
  getPhoneNumbers,
  addPhoneNumber,
  deletePhoneNumber,
  getAvailableNumbers,
  getSubscriptionStatus,
  updatePhoneNumber
} from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { ConfirmationModal } from "../components/ConfirmationModal";
import {
  Bot,
  Clock,
  Link as LinkIcon,
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
  Zap,
  BookOpen,
  Search,
  Star,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Facebook,
  Lock
} from "lucide-react";

const TENANT_STORAGE_KEY = "tenantId";

const TABS = [
  { id: "numbers", label: "Phone & voice", icon: Phone },
  { id: "ai", label: "AI behavior", icon: Bot },
  { id: "knowledge", label: "Knowledge base", icon: BookOpen },
  { id: "hours", label: "Business hours", icon: Clock },
  { id: "integrations", label: "Integrations", icon: LinkIcon },
];

export default function Settings({ tenantId }) {
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("numbers");

  // Form states
  const [form, setForm] = useState({
    welcome_message: "",
    instructions: "",
    tone_of_voice: "professional",
    transfer_numbers_raw: "",
    transfer_sms_brief: "",
    crm_webhook_url: "",
    crm_type: "webhook",
    zapier_webhook_url: "",
    follow_up_enabled: true,
    afterhours_behavior: "voicemail",
    business_hours: {},
    objection_handling: [], // up to 5: { trigger: string, script: string }
    twilio_account_sid: "",
    twilio_auth_token: "",
    facebook_page_id: "",
    facebook_page_access_token: "",
    faqs: []
  });

  // Phone numbers state
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [phonesLoading, setPhonesLoading] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newPhoneIsPrimary, setNewPhoneIsPrimary] = useState(false);
  const [phoneError, setPhoneError] = useState("");

  // Provision number state
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [availableNumbers, setAvailableNumbers] = useState([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [areaCode, setAreaCode] = useState("");
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionMessage, setProvisionMessage] = useState("");

  // Facebook integration steps (tooltip / expandable)
  const [showFbSteps, setShowFbSteps] = useState(false);

  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState({
    isOpen: false,
    title: "",
    message: "",
    onConfirm: () => { },
    loading: false
  });

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
        crm_type: t.crm_type || "webhook",
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
        objection_handling: (() => {
          const oh = t.objection_handling_config;
          if (Array.isArray(oh) && oh.length) return oh.slice(0, 5).map(c => ({ trigger: c.trigger || "", script: c.script || "" }));
          if (oh && typeof oh === "object") {
            const arr = [];
            if (oh.price) arr.push({ trigger: "Price / too high", script: oh.price });
            if (oh.thinking) arr.push({ trigger: "Need to think about it", script: oh.thinking });
            if (oh.spouse) arr.push({ trigger: "Talk to spouse or partner", script: oh.spouse });
            return arr;
          }
          return [];
        })(),
        twilio_account_sid: "",
        twilio_auth_token: "",
        facebook_page_id: t.facebook_page_id || "",
        facebook_page_access_token: "",
        faqs: Array.isArray(t.faqs) ? t.faqs : []
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
    if (tenantId) {
      getSubscriptionStatus(tenantId)
        .then((s) => setSubscriptionStatus(s))
        .catch(() => {});
    }
  }, [tenantId]);

  const hasActiveSub = subscriptionStatus && ["active", "trialing"].includes(subscriptionStatus.subscription_status);

  const fetchAvailableNumbers = async (code = "") => {
    setLoadingNumbers(true);
    setProvisionMessage("");
    try {
      const res = await getAvailableNumbers(code);
      setAvailableNumbers(res.numbers || []);
      if (res.numbers?.length > 0) setSelectedNumber(res.numbers[0].phoneNumber);
      else setSelectedNumber(null);
    } catch (err) {
      setProvisionMessage("Failed to fetch numbers. Try a different area code.");
      setAvailableNumbers([]);
    } finally {
      setLoadingNumbers(false);
    }
  };

  const handleProvisionNumber = async () => {
    if (!selectedNumber) return;
    setProvisionLoading(true);
    setProvisionMessage("");
    try {
      await addPhoneNumber({ tenant_id: tenantId, phone: selectedNumber });
      setProvisionMessage("Number provisioned successfully!");
      setAvailableNumbers([]);
      setSelectedNumber(null);
      setAreaCode("");
      await loadPhones();
    } catch (err) {
      setProvisionMessage(`Error: ${err.message}`);
    } finally {
      setProvisionLoading(false);
    }
  };

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

  const MAX_OBJECTION_CASES = 5;

  const handleAddObjectionCase = () => {
    setForm(prev => ({
      ...prev,
      objection_handling: prev.objection_handling.length < MAX_OBJECTION_CASES
        ? [...prev.objection_handling, { trigger: "", script: "" }]
        : prev.objection_handling
    }));
  };

  const handleUpdateObjectionCase = (index, field, value) => {
    setForm(prev => {
      const next = [...prev.objection_handling];
      if (!next[index]) return prev;
      next[index] = { ...next[index], [field]: value };
      return { ...prev, objection_handling: next };
    });
  };

  const handleRemoveObjectionCase = (index) => {
    setForm(prev => ({
      ...prev,
      objection_handling: prev.objection_handling.filter((_, i) => i !== index)
    }));
  };

  const handleAddFaq = () => {
    setForm(prev => ({
      ...prev,
      faqs: [...prev.faqs, { question: "", answer: "" }]
    }));
  };

  const handleUpdateFaq = (index, field, value) => {
    const newFaqs = [...form.faqs];
    newFaqs[index][field] = value;
    setForm(prev => ({ ...prev, faqs: newFaqs }));
  };

  const handleRemoveFaq = (index) => {
    setForm(prev => ({
      ...prev,
      faqs: prev.faqs.filter((_, i) => i !== index)
    }));
  };

  const handleAddPhone = async () => {
    setPhoneError("");
    if (!newPhone) return;
    try {
      await addPhoneNumber({
        tenant_id: tenantId,
        phone: newPhone,
        is_primary: newPhoneIsPrimary
      });
      setNewPhone("");
      setNewPhoneIsPrimary(false);
      loadPhones();
    } catch (err) {
      setPhoneError(err.message);
    }
  };

  const handleDeletePhone = async (phoneId) => {
    setConfirmModal({
      isOpen: true,
      title: "Remove Phone Number?",
      message: "Are you sure you want to remove this phone number? You won't be able to receive calls on this number anymore.",
      onConfirm: async () => {
        setConfirmModal(prev => ({ ...prev, loading: true }));
        try {
          await deletePhoneNumber(phoneId);
          loadPhones();
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          setPhoneError(err.message);
        } finally {
          setConfirmModal(prev => ({ ...prev, loading: false }));
        }
      }
    });
  };

  const handleSetPrimary = async (phoneId) => {
    try {
      await updatePhoneNumber(phoneId, { is_primary: true });
      loadPhones();
    } catch (err) {
      setPhoneError(err.message);
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
      crm_type: form.crm_type || "webhook",
      zapier_webhook_url: form.zapier_webhook_url || null,
      follow_up_enabled: form.follow_up_enabled,
      afterhours_behavior: form.afterhours_behavior,
      business_hours: form.business_hours,
      objection_handling_config: form.objection_handling,
      facebook_page_id: form.facebook_page_id.trim() || null,
      faqs: form.faqs.filter(f => f.question.trim() && f.answer.trim())
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
                className={`flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-xl transition-all flex-1 lg:flex-none justify-center lg:justify-start ${activeTab === tab.id
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
        <main className="flex-1 bg-white rounded-2xl border border-gray-200/80 shadow-sm p-6 md:p-8 min-h-[500px]">
          {activeTab === "numbers" && (
            <div className="space-y-10 max-w-4xl">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1">Phone numbers</h2>
                <p className="text-sm text-gray-500 mb-6">Manage AI lines and business numbers. Incoming calls to an AI line are answered by your assistant.</p>

                {!hasActiveSub ? (
                  <div className="p-6 border border-gray-200 rounded-xl bg-gray-50 text-center">
                    <Lock className="w-10 h-10 text-gray-400 mx-auto mb-3" />
                    <p className="text-sm font-medium text-gray-900 mb-1">Subscription required</p>
                    <p className="text-xs text-gray-500 mb-4">Add a plan to provision a dedicated AI phone line.</p>
                    <Link to="/billing" className="inline-flex px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                      View plans
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="mb-6">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">Get a new AI line</h3>
                      <div className="flex flex-wrap gap-2 items-center">
                        <input
                          type="text"
                          placeholder="Area code (e.g. 415)"
                          value={areaCode}
                          onChange={(e) => setAreaCode(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchAvailableNumbers(areaCode); } }}
                          className="w-28 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300"
                          maxLength={3}
                        />
                        <button
                          type="button"
                          onClick={() => fetchAvailableNumbers(areaCode)}
                          disabled={loadingNumbers}
                          className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
                        >
                          {loadingNumbers ? <LumaSpin className="w-4 h-4 border-white" /> : <Search size={16} />}
                          Search
                        </button>
                      </div>
                      {availableNumbers.length > 0 && (
                        <div className="mt-3 max-h-48 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
                          {availableNumbers.map((num) => (
                            <label
                              key={num.phoneNumber}
                              className={`flex items-center p-3 cursor-pointer ${selectedNumber === num.phoneNumber ? "bg-gray-100" : "hover:bg-gray-50"}`}
                            >
                              <input
                                type="radio"
                                name="provision_number"
                                value={num.phoneNumber}
                                checked={selectedNumber === num.phoneNumber}
                                onChange={() => setSelectedNumber(num.phoneNumber)}
                                className="h-4 w-4 text-gray-900 border-gray-300"
                              />
                              <span className="ml-3 text-sm font-medium text-gray-900">{num.friendlyName}</span>
                              {num.locality && num.region && (
                                <span className="ml-2 text-xs text-gray-500">{num.locality}, {num.region}</span>
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                      {availableNumbers.length > 0 && selectedNumber && (
                        <button
                          type="button"
                          onClick={handleProvisionNumber}
                          disabled={provisionLoading}
                          className="mt-3 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 flex items-center gap-2"
                        >
                          {provisionLoading && <LumaSpin className="w-4 h-4 border-white" />}
                          Add {selectedNumber}
                        </button>
                      )}
                      {provisionMessage && (
                        <p className={`mt-2 text-sm ${provisionMessage.startsWith("Error") ? "text-red-600" : "text-emerald-600"}`}>
                          {provisionMessage}
                        </p>
                      )}
                    </div>

                    <div className="border-t border-gray-200 pt-6">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">AI phone lines</h3>
                      <p className="text-xs text-gray-500 mb-4">Calls to these numbers are answered by your AI. Set one as primary for Twilio webhook and caller ID.</p>
                      <div className="space-y-3">
                        {phoneNumbers.filter(pn => pn.twilio_sid).length === 0 ? (
                          <p className="text-sm text-gray-500 py-4">No AI lines yet. Search and add one above.</p>
                        ) : (
                          phoneNumbers.filter(pn => pn.twilio_sid).map((pn) => (
                            <div key={pn.id} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg bg-white">
                              <div className="flex items-center gap-3">
                                <Phone size={18} className="text-gray-500" />
                                <div>
                                  <p className="font-medium text-gray-900">{pn.phone}</p>
                                  {pn.is_primary && <span className="text-xs text-gray-500">Primary</span>}
                                </div>
                              </div>
                              <div className="flex gap-1">
                                {!pn.is_primary && (
                                  <button type="button" onClick={() => handleSetPrimary(pn.id)} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg" title="Set as primary">
                                    <Star size={16} />
                                  </button>
                                )}
                                <button type="button" onClick={() => handleDeletePhone(pn.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-lg" title="Remove">
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="border-t border-gray-200 pt-6">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Business numbers</h3>
                      <p className="text-xs text-gray-500 mb-4">Numbers your customers already use. Forward them to an AI line so the assistant can answer.</p>
                      <div className="space-y-3">
                        {phoneNumbers.filter(pn => !pn.twilio_sid).map((pn) => (
                          <div key={pn.id} className={`flex items-center justify-between p-4 rounded-lg border ${pn.is_primary ? "border-amber-200 bg-amber-50/50" : "border-gray-200 bg-white"}`}>
                            <div className="flex items-center gap-3">
                              <Phone size={18} className="text-gray-500" />
                              <div>
                                <p className="font-medium text-gray-900">{pn.phone}</p>
                                {pn.is_primary && <span className="text-xs text-amber-700">Primary identity</span>}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              {!pn.is_primary && (
                                <button type="button" onClick={() => handleSetPrimary(pn.id)} className="p-2 text-gray-400 hover:text-gray-700 rounded-lg" title="Set as primary">
                                  <Star size={16} />
                                </button>
                              )}
                              <button type="button" onClick={() => handleDeletePhone(pn.id)} className="p-2 text-gray-400 hover:text-red-600 rounded-lg" title="Remove">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                        <div className="p-4 border border-dashed border-gray-200 rounded-lg">
                          <p className="text-xs font-medium text-gray-700 mb-2">Add business number</p>
                          <div className="flex gap-2">
                            <input
                              type="tel"
                              value={newPhone}
                              onChange={(e) => setNewPhone(e.target.value)}
                              placeholder="+1 555 000 0000"
                              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300"
                            />
                            <button type="button" onClick={handleAddPhone} className="px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 flex items-center gap-1">
                              <Plus size={16} /> Add
                            </button>
                          </div>
                          <label className="mt-2 flex items-center gap-2 cursor-pointer">
                            <input type="checkbox" checked={newPhoneIsPrimary} onChange={(e) => setNewPhoneIsPrimary(e.target.checked)} className="w-4 h-4 rounded border-gray-300 text-gray-900" />
                            <span className="text-xs text-gray-600">Set as primary identity</span>
                          </label>
                          {phoneError && <p className="mt-1 text-xs text-red-600">{phoneError}</p>}
                        </div>
                      </div>
                    </div>

                    <div className="border-t border-gray-200 mt-8 pt-6 p-4 bg-sky-50 rounded-lg">
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">Forward your main line</h3>
                      <p className="text-xs text-gray-600 mb-3">Forward busy/no-answer from your primary business number to your AI line so no call is missed.</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                        <div className="p-3 bg-white/80 border border-sky-100 rounded-lg">
                          <p className="font-medium text-gray-900 mb-0.5">AT&T / Verizon</p>
                          <p className="text-gray-600">Dial *72, then your AI line number.</p>
                        </div>
                        <div className="p-3 bg-white/80 border border-sky-100 rounded-lg">
                          <p className="font-medium text-gray-900 mb-0.5">T-Mobile</p>
                          <p className="text-gray-600">Settings → Calls → Call forwarding.</p>
                        </div>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

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
                  Objection handling
                </h3>
                <p className="text-sm text-gray-500 mb-4">When the caller says something that matches a trigger, the assistant uses the script you provide. Add up to 5 cases.</p>
                <div className="space-y-4">
                  {form.objection_handling.map((case_, index) => (
                    <div key={index} className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-medium text-gray-500">Case {index + 1}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveObjectionCase(index)}
                          className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">When the caller says (trigger)</label>
                        <input
                          type="text"
                          value={case_.trigger}
                          onChange={(e) => handleUpdateObjectionCase(index, "trigger", e.target.value)}
                          placeholder="e.g. price is too high, need to think, talk to my spouse"
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">How the AI should respond (script)</label>
                        <textarea
                          value={case_.script}
                          onChange={(e) => handleUpdateObjectionCase(index, "script", e.target.value)}
                          rows={2}
                          placeholder="Brief response the assistant should use in this situation."
                          className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-primary focus:border-transparent"
                        />
                      </div>
                    </div>
                  ))}
                  {form.objection_handling.length < MAX_OBJECTION_CASES && (
                    <button
                      type="button"
                      onClick={handleAddObjectionCase}
                      className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:border-primary hover:text-primary transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                      Add objection case
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === "knowledge" && (
            <div className="space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <BookOpen className="text-primary w-5 h-5" />
                    Knowledge Base (FAQs)
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    Add specific questions and answers the AI should know how to handle.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleAddFaq}
                  className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-xl text-sm font-bold hover:bg-gray-800 transition-all"
                >
                  <Plus className="w-4 h-4 text-primary" />
                  ADD QUESTION
                </button>
              </div>

              <div className="space-y-4">
                {form.faqs.length === 0 ? (
                  <div className="py-12 border-2 border-dashed border-gray-100 rounded-3xl flex flex-col items-center justify-center text-center">
                    <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4">
                      <MessageSquare className="w-8 h-8 text-gray-200" />
                    </div>
                    <p className="text-gray-400 font-medium max-w-xs">
                      No custom FAQs yet. Add common questions your customers ask to improve AI accuracy.
                    </p>
                  </div>
                ) : (
                  form.faqs.map((faq, index) => (
                    <div
                      key={index}
                      className="p-6 bg-gray-50 border border-gray-100 rounded-3xl space-y-4 relative group hover:border-primary/20 transition-all"
                    >
                      <button
                        onClick={() => handleRemoveFaq(index)}
                        className="absolute top-4 right-4 p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                      >
                        <Trash2 size={16} />
                      </button>

                      <div className="grid grid-cols-1 gap-4">
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 pl-1">Question</label>
                          <input
                            type="text"
                            value={faq.question}
                            onChange={(e) => handleUpdateFaq(index, "question", e.target.value)}
                            placeholder="e.g. Do you offer emergency services?"
                            className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-bold focus:ring-2 focus:ring-primary outline-none transition-all"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 pl-1">Answer</label>
                          <textarea
                            value={faq.answer}
                            onChange={(e) => handleUpdateFaq(index, "answer", e.target.value)}
                            placeholder="Detailed answer for the AI..."
                            rows={3}
                            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-primary outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {form.faqs.length > 0 && (
                <div className="p-4 bg-primary/5 border border-primary/10 rounded-2xl">
                  <p className="text-xs text-primary font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-3 h-3" />
                    The AI will use these answers to respond to callers when they ask related questions.
                  </p>
                </div>
              )}
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
                        className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-tight transition-all border ${config.closed
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
                <div className="space-y-5">
                  {/* CRM Platform Selector */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">CRM Platform</label>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { value: "dripjobs", label: "DripJobs", color: "bg-blue-500" },
                        { value: "jobber", label: "Jobber", color: "bg-emerald-500" },
                        { value: "housecall", label: "HouseCall Pro", color: "bg-orange-500" },
                        { value: "webhook", label: "Other / Zapier", color: "bg-gray-500" },
                      ].map((crm) => (
                        <button
                          key={crm.value}
                          type="button"
                          onClick={() => handleUpdateForm("crm_type", crm.value)}
                          className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all text-center ${
                            form.crm_type === crm.value
                              ? "border-gray-900 bg-gray-900 text-white shadow-lg scale-[1.02]"
                              : "border-gray-200 bg-gray-50 text-gray-600 hover:border-gray-300 hover:bg-gray-100"
                          }`}
                        >
                          <div className={`w-8 h-8 rounded-xl ${form.crm_type === crm.value ? "bg-white/20" : crm.color + "/10"} flex items-center justify-center`}>
                            <Zap className={`w-4 h-4 ${form.crm_type === crm.value ? "text-white" : crm.color.replace("bg-", "text-")}`} />
                          </div>
                          <span className="text-xs font-black uppercase tracking-wide">{crm.label}</span>
                          {form.crm_type === crm.value && (
                            <CheckCircle2 className="absolute top-2 right-2 w-4 h-4 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-gray-500 mt-2 italic">Select your CRM so we can tailor the webhook payload for best results.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">CRM Webhook URL</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={form.crm_webhook_url}
                        onChange={(e) => handleUpdateForm("crm_webhook_url", e.target.value)}
                        placeholder="https://hooks.zapier.com/..."
                        className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs"
                      />
                      <button className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors">
                        <ExternalLink className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Paste your Zapier Catch Hook URL or direct CRM webhook here.</p>
                  </div>
                </div>
              </div>

              {/* Facebook */}
              <div className="pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between gap-4 mb-4">
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2 text-[#1877F2]">
                    <Facebook className="w-5 h-5" />
                    Facebook Messenger
                  </h2>
                  <button
                    type="button"
                    onClick={() => setShowFbSteps(!showFbSteps)}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-[#1877F2] hover:bg-[#1877F2]/10 rounded-xl transition-colors"
                    aria-expanded={showFbSteps}
                  >
                    <HelpCircle className="w-4 h-4" />
                    {showFbSteps ? "Hide steps" : "How to connect"}
                    {showFbSteps ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {showFbSteps && (
                  <div className="mb-6 p-6 bg-[#1877F2]/5 border border-[#1877F2]/20 rounded-2xl space-y-4 text-sm">
                    <h3 className="font-bold text-gray-900 flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-[#1877F2]" />
                      Facebook integration steps
                    </h3>
                    <ol className="list-decimal list-inside space-y-3 text-gray-700">
                      <li>
                        <strong>Create or use a Meta App</strong> — Go to{" "}
                        <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener noreferrer" className="text-[#1877F2] underline hover:no-underline">
                          developers.facebook.com/apps
                        </a>
                        , create an app (or select existing), then add the <strong>Messenger</strong> product to the app.
                      </li>
                      <li>
                        <strong>Select product → Page</strong> — In the left sidebar, open <strong>Messenger</strong>, then under "Messenger" go to <strong>Settings</strong>. Under "Select a Page", choose the Facebook Page you want the AI to reply on (you need <strong>Page Admin</strong> access). Connect the Page if it isn’t linked yet.
                      </li>
                      <li>
                        <strong>Publish your app</strong> — Make sure your app is <strong>published</strong> (App Dashboard → App Review or App Settings). In development mode only app admins/testers can message; publishing allows your Page followers to use Messenger with the AI.
                      </li>
                      <li>
                        <strong>Set up the webhook</strong> — In Messenger → Settings, under "Webhooks", click "Add Callback URL". Use this exact URL:
                        <div className="mt-2 p-3 bg-white rounded-xl font-mono text-xs break-all border border-[#1877F2]/20">
                          https://ai-front-desk-backend.onrender.com/facebook-webhook
                        </div>
                        For <strong>Verify Token</strong>, enter a secret phrase (e.g. a random string). Your server must have the same value set in the <code className="bg-white/80 px-1 rounded">FACEBOOK_VERIFY_TOKEN</code> environment variable — ask your administrator if you don’t control the server.
                      </li>
                      <li>
                        <strong>Enable webhook fields</strong> — After adding the callback URL, click "Edit" next to the webhook and subscribe to these fields: <code className="bg-white/80 px-1 rounded">messages</code> and <code className="bg-white/80 px-1 rounded">messaging_postbacks</code>. Save.
                      </li>
                      <li>
                        <strong>Get Page ID & token</strong> — In Messenger → Settings you’ll see your <strong>Page ID</strong> (numeric). Under "Access Tokens", select your Page and generate a token with <code className="bg-white/80 px-1 rounded">pages_messaging</code> and <code className="bg-white/80 px-1 rounded">pages_manage_metadata</code>. Paste the Page ID and token in the fields below.
                      </li>
                      <li>
                        <strong>Save below</strong> — Enter your Page ID and Page Access Token in the form below and click Save. Messages to your Page will then be handled by the AI.
                      </li>
                    </ol>
                    <p className="text-xs text-gray-500 pt-2 border-t border-[#1877F2]/10">
                      Your backend must be deployed with <code>FACEBOOK_VERIFY_TOKEN</code> set; the same value is used in Meta&apos;s &quot;Verify Token&quot; field when adding the callback URL.
                    </p>
                    <h4 className="font-bold text-gray-900 mt-4 pt-4 border-t border-[#1877F2]/10">How Facebook messages show in your dashboard</h4>
                    <ul className="list-disc list-inside space-y-1.5 text-gray-700 text-sm">
                      <li>When someone messages your Page, the webhook receives it and the AI replies. Both the <strong>inbound</strong> (user) and <strong>outbound</strong> (AI) messages are saved to the database under your tenant.</li>
                      <li>Each Messenger user is stored as a <strong>lead</strong> (with a placeholder like <code className="bg-white/80 px-1 rounded">fb-123456789</code> until they share a real phone number).</li>
                      <li><strong>Conversations</strong> (sidebar) lists all leads and their latest activity. Use the <strong>facebook</strong> filter to see only Messenger threads. Click a row to open the timeline.</li>
                      <li>The <strong>timeline</strong> loads via <code className="bg-white/80 px-1 rounded">GET /api/conversations/:leadId/timeline</code> and shows every message (and any linked calls) with channel and direction (inbound/outbound).</li>
                    </ul>
                    <p className="text-xs text-gray-500 mt-2">
                      <strong>To confirm:</strong> Send a test message to your Facebook Page, then open Dashboard → Conversations, pick your tenant, filter by &quot;facebook&quot;, and open the new thread. You should see your message (inbound) and the AI reply (outbound). You can also check the browser Network tab for <code className="bg-white/80 px-1 rounded">/api/conversations</code> and <code className="bg-white/80 px-1 rounded">/api/conversations/&lt;id&gt;/timeline</code>.
                    </p>
                  </div>
                )}

                <div className="bg-[#1877F2]/5 rounded-2xl p-6 border border-[#1877F2]/10 space-y-4">
                  <div>
                    <label className="block text-sm font-bold text-[#1877F2] mb-2 uppercase tracking-wide">Page ID</label>
                    <input
                      type="text"
                      value={form.facebook_page_id}
                      onChange={(e) => handleUpdateForm("facebook_page_id", e.target.value)}
                      placeholder="e.g. 123456789012345"
                      className="w-full px-4 py-3 bg-white border border-[#1877F2]/20 rounded-xl font-mono text-xs focus:ring-[#1877F2]"
                    />
                    <p className="text-xs text-gray-500 mt-1">Numeric ID of your Facebook Page (from Meta for Developers → Messenger → your Page).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-[#1877F2] mb-2 uppercase tracking-wide">Page Access Token</label>
                    <input
                      type="password"
                      value={form.facebook_page_access_token}
                      onChange={(e) => handleUpdateForm("facebook_page_access_token", e.target.value)}
                      placeholder="Paste token from Meta App → Messenger → Access Tokens"
                      className="w-full px-4 py-3 bg-white border border-[#1877F2]/20 rounded-xl font-mono text-xs focus:ring-[#1877F2]"
                    />
                    <p className="text-xs text-gray-500 mt-1">Token with pages_messaging and pages_manage_metadata. Never share this token.</p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </main>
      </div>

      <ConfirmationModal
        isOpen={confirmModal.isOpen}
        onClose={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
        onConfirm={confirmModal.onConfirm}
        title={confirmModal.title}
        message={confirmModal.message}
        loading={confirmModal.loading}
      />
    </div>
  );
}

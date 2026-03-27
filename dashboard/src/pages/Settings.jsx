import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import googleCalendarLogo from "../assets/google-calendar-icon.svg";
import {
  getTenant,
  updateTenant,
  getPhoneNumbers,
  addPhoneNumber,
  deletePhoneNumber,
  getAvailableNumbers,
  getSubscriptionStatus,
  updatePhoneNumber,
  updateBooking,
  getFollowups,
  triggerFollowupSms,
  triggerFollowupCall,
  updateFollowupStatus,
  disconnectGoogleCalendar,
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
  Calendar,
  Lock,
  CalendarDays,
  UserPlus
} from "lucide-react";

const TENANT_STORAGE_KEY = "tenantId";

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const DEFAULT_CAMPAIGN_PLACEHOLDERS = {
  1: "interior_refresh",
  2: "pre_spring_planning",
  3: "exterior_season_opening",
  4: "spring_project_ideas",
  5: "summer_prep",
  6: "mid_year_refresh",
  7: "summer_projects",
  8: "back_to_school_touchups",
  9: "fall_projects",
  10: "holiday_prep",
  11: "year_end_projects",
  12: "year_in_review",
};


const MONTH_PLACEHOLDERS = {
  1: "e.g. New year refresh",
  2: "e.g. Pre-spring planning",
  3: "e.g. Exterior season kickoff",
  4: "e.g. Spring projects",
  5: "e.g. Summer prep",
  6: "e.g. Mid-year check-in",
  7: "e.g. Summer projects",
  8: "e.g. Back-to-school",
  9: "e.g. Fall projects",
  10: "e.g. Holiday prep",
  11: "e.g. Year-end projects",
  12: "e.g. Year in review",
};

const GoogleCalendarIcon = ({ className = "w-6 h-6" }) => (
  <img src={googleCalendarLogo} className={className} alt="Google Calendar" />
);

const TABS = [
  { id: "numbers", label: "Phone & voice", icon: Phone },
  { id: "ai", label: "AI behavior", icon: Bot },
  { id: "knowledge", label: "Knowledge base", icon: BookOpen },
  { id: "hours", label: "Business hours", icon: Clock },
  { id: "nurturing", label: "Nurturing & referrals", icon: UserPlus },
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
    google_calendar_linked: false,
    google_calendar_email: "",
    faqs: [],
    nurturing_enabled: false,
    referral_enabled: false,
    seasonal_campaigns_enabled: false,
    maintenance_reminder_months: 6,
    reengagement_reminder_months: 12,
    referral_request_days_after_service: 5,
    nurturing_campaign_calendar: {},
    maintenance_touchpoints: [{ months: 6, header: "" }],
    reengagement_touchpoints: [{ months: 12, header: "" }]
  });

  // Phone numbers state
  const [phoneNumbers, setPhoneNumbers] = useState([]);
  const [phonesLoading, setPhonesLoading] = useState(false);
  const [newPhone, setNewPhone] = useState("");
  const [newPhoneIsPrimary, setNewPhoneIsPrimary] = useState(false);
  const [newPhoneLabel, setNewPhoneLabel] = useState("Main Business");
  const [phoneError, setPhoneError] = useState("");

  // Provision number state
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  const [availableNumbers, setAvailableNumbers] = useState([]);
  const [loadingNumbers, setLoadingNumbers] = useState(false);
  const [selectedNumber, setSelectedNumber] = useState(null);
  const [areaCode, setAreaCode] = useState("");
  const [provisionLoading, setProvisionLoading] = useState(false);
  const [provisionMessage, setProvisionMessage] = useState("");
  const [suggestedNumbers, setSuggestedNumbers] = useState([]);

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
        google_calendar_linked: t.google_calendar_linked === true,
        google_calendar_email: t.google_calendar_email || "",
        faqs: Array.isArray(t.faqs) ? t.faqs : [],
        nurturing_enabled: t.nurturing_enabled === true,
        referral_enabled: t.referral_enabled === true,
        seasonal_campaigns_enabled: t.seasonal_campaigns_enabled === true,
        maintenance_reminder_months: t.maintenance_reminder_months ?? 6,
        reengagement_reminder_months: t.reengagement_reminder_months ?? 12,
        referral_request_days_after_service: t.referral_request_days_after_service ?? 5,
        nurturing_campaign_calendar: t.nurturing_campaign_calendar && typeof t.nurturing_campaign_calendar === "object"
          ? { ...t.nurturing_campaign_calendar }
          : {},
        maintenance_touchpoints: Array.isArray(t.maintenance_touchpoints) && t.maintenance_touchpoints.length > 0
          ? t.maintenance_touchpoints.slice(0, 3)
          : [{ months: t.maintenance_reminder_months ?? 6, header: "" }],
        reengagement_touchpoints: Array.isArray(t.reengagement_touchpoints) && t.reengagement_touchpoints.length > 0
          ? t.reengagement_touchpoints.slice(0, 3)
          : [{ months: t.reengagement_reminder_months ?? 12, header: "" }],
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchPhoneNumbers = async () => {
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

  const fetchSuggestedNumbers = async () => {
    try {
      const res = await getAvailableNumbers(""); // No area code = fetch unassigned owned
      const raw = res.numbers || res || [];
      const list = Array.isArray(raw) ? raw.filter(n => n.isOwned).map(n => ({
        phoneNumber: n.phoneNumber,
        friendlyName: n.friendlyName,
        locality: n.locality,
        region: n.region,
        isOwned: true
      })) : [];
      setSuggestedNumbers(list);
    } catch (e) {
      console.error("Suggested numbers fetch failed:", e);
    }
  };

  useEffect(() => {
    loadTenant();
    fetchPhoneNumbers();
    fetchSuggestedNumbers();
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
      const raw = res.numbers || res || [];
      const list = Array.isArray(raw) ? raw.map((n) => ({
        phoneNumber: n.phoneNumber || n.phone_number || n.phone || "",
        friendlyName: n.friendlyName || n.friendly_name || n.phoneNumber || n.phone_number || n.phone || "—",
        locality: n.locality || "",
        region: n.region || "",
      })).filter((n) => n.phoneNumber) : [];
      setAvailableNumbers(list);
      setSelectedNumber(list.length > 0 ? list[0] : null);
      if (list.length === 0 && !res.error) setProvisionMessage("no_numbers");
    } catch (err) {
      setProvisionMessage(err?.message || "Failed to fetch numbers. Try a different area code.");
      setAvailableNumbers([]);
      setSelectedNumber(null);
    } finally {
      setLoadingNumbers(false);
    }
  };

  const handleProvisionNumber = async () => {
    if (!selectedNumber) return;
    setProvisionLoading(true);
    setProvisionMessage("");
    try {
      // selectedNumber is now the object { phoneNumber, isOwned, ... }
      await addPhoneNumber({ 
        tenant_id: tenantId, 
        phone: selectedNumber.phoneNumber,
        is_owned: !!selectedNumber.isOwned,
        is_purchasable: true // Coming from the search/buy flow
      });
      setProvisionMessage("Number provisioned successfully!");
      setAvailableNumbers([]);
      setSelectedNumber(null);
      setAreaCode("");
      await fetchPhoneNumbers();
    } catch (err) {
      setProvisionMessage(`Error: ${err.message}`);
    } finally {
      setProvisionLoading(false);
    }
  };

  const handleManualAddPhone = () => {
    handleAddPhone({ is_owned: false, is_purchasable: false }); // Manual entry is always external or "owned elsewhere"
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
      const result = await addPhoneNumber({
        tenant_id: tenantId,
        phone: newPhone,
        is_primary: newPhoneIsPrimary,
        label: newPhoneLabel
      });
      setNewPhone("");
      setNewPhoneIsPrimary(false);
      setNewPhoneLabel("Main Business");

      if (result.webhook_configured) {
        setMessage(`Success! ${newPhone} added and configured as an AI phone line.`);
      } else {
        setMessage(`Number ${newPhone} added. (External business number)`);
      }

      fetchPhoneNumbers();
      // Clear success message after 5s
      setTimeout(() => setMessage(""), 5000);
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
          fetchPhoneNumbers();
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
      fetchPhoneNumbers();
    } catch (e) {
      console.error(e);
      setPhoneError("Failed to update primary status");
    }
  };

  const handleUpdateLabel = async (phoneId, label) => {
    try {
      await updatePhoneNumber(phoneId, { label });
      fetchPhoneNumbers();
    } catch (e) {
      console.error(e);
      setPhoneError("Failed to update label");
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
      faqs: form.faqs.filter(f => f.question.trim() && f.answer.trim()),
      nurturing_enabled: form.nurturing_enabled,
      referral_enabled: form.referral_enabled,
      seasonal_campaigns_enabled: form.seasonal_campaigns_enabled,
      maintenance_reminder_months: form.maintenance_reminder_months,
      reengagement_reminder_months: form.reengagement_reminder_months,
      referral_request_days_after_service: form.referral_request_days_after_service,
      nurturing_campaign_calendar: form.nurturing_campaign_calendar,
      maintenance_touchpoints: form.maintenance_touchpoints,
      reengagement_touchpoints: form.reengagement_touchpoints
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

  const handleFacebookSave = async () => {
    if (!tenantId) return;
    setSaving(true);
    setMessage(""); // Use setMessage for success
    setError("");
    try {
      await updateTenant(tenantId, {
        facebook_page_id: form.facebook_page_id,
        facebook_page_access_token: form.facebook_page_access_token,
      });
      setMessage("Facebook settings saved!"); // Use setMessage for success
      loadTenant();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleConnectCalendar = () => {
    if (!tenantId) return;
    // API_BASE is internal to api.js, but we need the backend URL here
    const backendUrl = (import.meta.env.VITE_API_URL || "").replace(/\/$/, "");
    window.location.href = `${backendUrl}/auth/google/calendar/initiate?tenantId=${tenantId}`;
  };

  const handleDisconnectCalendar = async () => {
    if (!tenantId) return;
    setSaving(true);
    try {
      await disconnectGoogleCalendar(tenantId);
      setMessage("Google Calendar disconnected."); // Use setMessage for success
      loadTenant();
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
            {TABS.filter((tab) => tab.id !== "nurturing" || tenant?.has_nurturing_referral).map((tab) => (
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
                    <div className="mb-6 p-4 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Phone className="w-5 h-5 text-blue-500" />
                        <div>
                          <p className="text-sm font-bold text-blue-900">Plan Usage: {phoneNumbers.length} / {tenant?.plan === 'elite' ? 5 : (tenant?.plan === 'pro' ? 3 : 1)} Numbers</p>
                          <p className="text-[10px] text-blue-600 font-bold uppercase tracking-wider">{tenant?.plan ? `${tenant.plan.toUpperCase()} PLAN` : 'BASIC PLAN'}</p>
                        </div>
                      </div>
                      {phoneNumbers.length >= (tenant?.plan === 'elite' ? 5 : (tenant?.plan === 'pro' ? 3 : 1)) && (
                        <Link to="/billing" className="text-[10px] font-black bg-blue-600 text-white px-3 py-1.5 rounded-lg uppercase tracking-widest hover:bg-blue-700 transition-all">
                          Upgrade for more
                        </Link>
                      )}
                    </div>

                    <div className="mb-10 p-8 bg-slate-50 border border-slate-100 rounded-[2.5rem] shadow-sm">
                      <div className="flex items-center gap-3 mb-6">
                        <div className="w-10 h-10 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-lg shadow-slate-200">
                          <Zap size={20} />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Get a new AI line</h3>
                          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Buy a new number or connect one you already own</p>
                        </div>
                      </div>

                      <div className="space-y-6">
                        {/* Option 1: Search & Buy / Ready to Connect */}
                        <div className="p-8 bg-white border border-slate-100 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all duration-500">
                          <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center text-white shadow-xl shadow-slate-900/20">
                              <Search size={24} />
                            </div>
                            <div>
                              <h3 className="text-lg font-black text-slate-900 tracking-tight">Search & Provision</h3>
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Find a new number or claim an unassigned one</p>
                            </div>
                          </div>

                          <div className="space-y-6">
                            <div className="flex gap-3">
                              <div className="relative flex-1">
                                <input
                                  type="text"
                                  placeholder="Area code (e.g. 415)"
                                  value={areaCode}
                                  onChange={(e) => setAreaCode(e.target.value)}
                                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); fetchAvailableNumbers(areaCode); } }}
                                  className="w-full px-4 py-2.5 bg-slate-50 border-none rounded-xl text-xs font-bold focus:ring-4 focus:ring-slate-900/5 transition-all placeholder:text-slate-300 shadow-sm"
                                  maxLength={3}
                                />
                              </div>
                                <button
                                  type="button"
                                  onClick={() => fetchAvailableNumbers(areaCode)}
                                  disabled={loadingNumbers || phoneNumbers.length >= (tenant?.plan === 'elite' ? 5 : (tenant?.plan === 'pro' ? 3 : 1))}
                                  className="px-6 py-2.5 bg-slate-900 text-white text-[10px] font-black rounded-xl hover:bg-black disabled:opacity-50 flex items-center gap-2 transition-all uppercase tracking-widest shadow-lg shadow-slate-900/10"
                                >
                                  {loadingNumbers ? <LumaSpin className="w-3.5 h-3.5 border-white" /> : <Search size={14} />}
                                  Find Numbers
                                </button>
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Attribute to Lead Source</label>
                                <select
                                  value={newPhoneLabel}
                                  onChange={(e) => setNewPhoneLabel(e.target.value)}
                                  className="w-full px-4 py-2.5 bg-slate-50 border-none rounded-xl text-xs font-bold focus:ring-4 focus:ring-slate-900/5 transition-all outline-none shadow-sm cursor-pointer"
                                >
                                  <option value="Google Ads">Google Ads</option>
                                  <option value="LSA">LSA (Google Local Service Ads)</option>
                                  <option value="Facebook">Facebook / Instagram Ads</option>
                                  <option value="YouTube Ads">YouTube Ads</option>
                                  <option value="Yelp">Yelp</option>
                                  <option value="Angi">Angi / HomeAdvisor</option>
                                  <option value="Thumbtack">Thumbtack</option>
                                  <option value="Houzz">Houzz</option>
                                  <option value="Website">Website (Direct)</option>
                                  <option value="Google Organic Search">Google Organic Search</option>
                                  <option value="Customer Referral/Repeat">Customer Referral/Repeat</option>
                                  <option value="Yard Sign/DoorHanger">Yard Sign/DoorHanger</option>
                                  <option value="Direct Mail">Direct Mail</option>
                                  <option value="Truck / Vehicle Branding">Truck / Vehicle Branding</option>
                                  <option value="Other">Other / Unknown</option>
                                </select>
                              </div>

                            {!loadingNumbers && availableNumbers.length === 0 && provisionMessage === "no_numbers" && (
                              <div className="p-5 rounded-2xl bg-amber-50 border border-amber-100/50 text-amber-800 animate-in fade-in slide-in-from-top-4">
                                <p className="text-xs font-black uppercase tracking-wider mb-1">No numbers found</p>
                                <p className="text-[11px] text-amber-600 font-bold leading-relaxed">We couldn't find any numbers for "{areaCode}". Try another area code like 212, 310, or 415.</p>
                              </div>
                            )}

                            {/* Suggested (Owned) Numbers - Premium Card In Card */}
                            {availableNumbers.length === 0 && !loadingNumbers && !provisionMessage && suggestedNumbers.length > 0 && (
                              <div className="animate-in fade-in slide-in-from-bottom-4 duration-700">
                                <div className="flex items-center gap-2 mb-4">
                                  <div className="h-[1px] flex-1 bg-slate-100"></div>
                                  <span className="text-[10px] font-black text-emerald-600 uppercase tracking-[0.2em] px-2">Ready to Connect</span>
                                  <div className="h-[1px] flex-1 bg-slate-100"></div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                  {suggestedNumbers.map((num) => (
                                    <label
                                      key={num.phoneNumber}
                                      className={`group relative flex flex-col p-4 cursor-pointer rounded-2xl border-2 transition-all duration-300 ${selectedNumber?.phoneNumber === num.phoneNumber ? "border-emerald-600 bg-emerald-50/30 ring-4 ring-emerald-600/5" : "border-slate-50 bg-slate-50/50 hover:border-slate-200"}`}
                                    >
                                      <input
                                        type="radio"
                                        name="provision_number_suggested"
                                        value={num.phoneNumber}
                                        checked={selectedNumber?.phoneNumber === num.phoneNumber}
                                        onChange={() => setSelectedNumber(num)}
                                        className="sr-only"
                                      />
                                      <div className="flex items-center justify-between mb-2">
                                        <span className="text-base font-black text-slate-900 tracking-tight">{num.friendlyName}</span>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selectedNumber?.phoneNumber === num.phoneNumber ? "border-emerald-600 bg-emerald-600" : "border-slate-300 bg-white"}`}>
                                          {selectedNumber?.phoneNumber === num.phoneNumber && <div className="w-2 h-2 rounded-full bg-white" />}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        <span className="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest rounded-md">In Account</span>
                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{num.locality || "Owned"}, {num.region}</span>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}

                            {availableNumbers.length > 0 && (
                              <div className="space-y-3 animate-in fade-in duration-500">
                                <div className="flex items-center gap-2 mb-2">
                                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Search Results</span>
                                  <div className="h-[1px] flex-1 bg-slate-100"></div>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-64 overflow-y-auto pr-2 custom-scrollbar">
                                  {availableNumbers.map((num) => (
                                    <label
                                      key={num.phoneNumber}
                                      className={`group flex flex-col p-4 cursor-pointer rounded-2xl border-2 transition-all duration-300 ${selectedNumber?.phoneNumber === num.phoneNumber ? "border-slate-900 bg-slate-50/50 ring-4 ring-slate-900/5" : "border-slate-50 bg-slate-50/30 hover:border-slate-200"}`}
                                    >
                                      <input
                                        type="radio"
                                        name="provision_number"
                                        value={num.phoneNumber}
                                        checked={selectedNumber?.phoneNumber === num.phoneNumber}
                                        onChange={() => setSelectedNumber(num)}
                                        className="sr-only"
                                      />
                                      <div className="flex items-center justify-between mb-1">
                                        <span className="text-base font-black text-slate-900 tracking-tight">{num.friendlyName}</span>
                                        <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${selectedNumber?.phoneNumber === num.phoneNumber ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white"}`}>
                                          {selectedNumber?.phoneNumber === num.phoneNumber && <div className="w-2 h-2 rounded-full bg-white" />}
                                        </div>
                                      </div>
                                      <div className="flex items-center gap-2 mt-1">
                                        {num.isOwned && <span className="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest rounded-md">In Account</span>}
                                        <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">{num.locality}, {num.region}</span>
                                      </div>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            )}

                            {(availableNumbers.length > 0 || (suggestedNumbers.length > 0 && !areaCode)) && selectedNumber && (
                              <button
                                type="button"
                                onClick={handleProvisionNumber}
                                disabled={provisionLoading}
                                className={`w-full py-3 text-white text-xs font-black rounded-xl disabled:opacity-50 flex items-center justify-center gap-2 transition-all uppercase tracking-[0.1em] shadow-xl hover:-translate-y-0.5 active:translate-y-0 ${selectedNumber?.isOwned ? "bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20" : "bg-slate-900 hover:bg-black shadow-slate-900/20"}`}
                              >
                                {provisionLoading ? <LumaSpin className="w-4 h-4 border-white" /> : <Phone size={16} />}
                                {selectedNumber?.isOwned ? "Connect " : "Purchase "} {selectedNumber?.phoneNumber}
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Option 2: Connect Existing Business Number - Separate Card */}
                        <div className="p-8 bg-slate-50/50 border border-slate-100 rounded-[2.5rem] shadow-sm hover:shadow-md transition-all duration-500 flex flex-col">
                          <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 rounded-2xl bg-white flex items-center justify-center text-slate-900 shadow-xl shadow-slate-200/50 border border-slate-100">
                              <Globe size={24} />
                            </div>
                            <div>
                              <h3 className="text-lg font-black text-slate-900 tracking-tight">External Forwarding</h3>
                              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-0.5">Connect a number from another provider</p>
                            </div>
                          </div>

                          <div className="flex-1 space-y-6">
                            <p className="text-xs text-slate-500 font-medium leading-relaxed bg-white/50 p-4 rounded-2xl border border-white">
                              Use this if you already have a business number elsewhere and want to forward its calls to your AI assistant.
                            </p>
                            
                            <div className="space-y-4">
                              <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Phone Number</label>
                                <input
                                  type="text"
                                  placeholder="+1 (555) 000-0000"
                                  value={newPhone}
                                  onChange={(e) => setNewPhone(e.target.value)}
                                  className="w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-xs font-bold focus:ring-4 focus:ring-slate-900/5 transition-all outline-none shadow-sm"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Lead Source</label>
                                <div className="relative group/select">
                                  <select
                                    value={newPhoneLabel}
                                    onChange={(e) => setNewPhoneLabel(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-white border border-slate-100 rounded-xl text-xs font-bold focus:ring-4 focus:ring-slate-900/5 transition-all outline-none appearance-none shadow-sm pr-10 cursor-pointer"
                                  >
                                    <option value="Google Ads">Google Ads</option>
                                    <option value="LSA">LSA (Google Local Service Ads)</option>
                                    <option value="Facebook">Facebook / Instagram Ads</option>
                                    <option value="YouTube Ads">YouTube Ads</option>
                                    <option value="Yelp">Yelp</option>
                                    <option value="Angi">Angi / HomeAdvisor</option>
                                    <option value="Thumbtack">Thumbtack</option>
                                    <option value="Houzz">Houzz</option>
                                    <option value="Website">Website (Direct)</option>
                                    <option value="Google Organic Search">Google Organic Search</option>
                                    <option value="Customer Referral/Repeat">Customer Referral/Repeat</option>
                                    <option value="Yard Sign/DoorHanger">Yard Sign/DoorHanger</option>
                                    <option value="Direct Mail">Direct Mail</option>
                                    <option value="Truck / Vehicle Branding">Truck / Vehicle Branding</option>
                                    <option value="Other">Other / Unknown</option>
                                  </select>
                                  <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400 group-hover/select:text-slate-600 transition-colors">
                                    <ChevronDown size={14} />
                                  </div>
                                </div>
                              </div>

                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={handleManualAddPhone}
                            disabled={phonesLoading || !newPhone}
                            className="w-full mt-6 py-3 bg-white border-2 border-slate-900 text-slate-900 text-xs font-black rounded-xl hover:bg-slate-900 hover:text-white disabled:opacity-50 transition-all uppercase tracking-[0.1em] flex items-center justify-center gap-2"
                          >
                            {phonesLoading ? <LumaSpin className="w-4 h-4 border-slate-900" /> : <Globe size={18} />}
                            {phoneNumbers.length >= (tenant?.plan === 'elite' ? 5 : (tenant?.plan === 'pro' ? 3 : 1)) ? "Plan Limit Reached" : "Register Number"}
                          </button>

                        </div>
                      </div>

                      {provisionMessage && provisionMessage !== "no_numbers" && (
                        <div className={`mt-6 p-4 rounded-2xl border ${provisionMessage.startsWith("Error") ? "bg-red-50 border-red-100 text-red-700" : "bg-emerald-50 border-emerald-100 text-emerald-700"} animate-in fade-in slide-in-from-top-2`}>
                           <p className="text-[11px] font-bold uppercase tracking-wide">{provisionMessage}</p>
                        </div>
                      )}
                      
                      {phoneError && (
                        <div className="mt-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-start gap-3 text-red-700 animate-in fade-in slide-in-from-top-2">
                          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                          <p className="text-[11px] font-bold uppercase tracking-wide leading-relaxed">{phoneError}</p>
                        </div>
                      )}

                      {message && message.includes("successfully") && (
                         <div className="mt-6 p-4 bg-emerald-50 border border-emerald-100 rounded-2xl flex items-start gap-3 text-emerald-700 animate-in fade-in slide-in-from-top-2">
                           <CheckCircle2 className="w-5 h-5 shrink-0 mt-0.5" />
                           <p className="text-[11px] font-bold uppercase tracking-wide leading-relaxed">{message}</p>
                         </div>
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
                                  <div className="flex items-center gap-2 mt-0.5">
                                    <select
                                      value={pn.lead_source || "Website"}
                                      onChange={(e) => handleUpdateLabel(pn.id, e.target.value)}
                                      className="text-[10px] font-black uppercase tracking-widest bg-gray-50 border-none rounded p-0 px-1 cursor-pointer hover:bg-gray-100"
                                    >
                                      <option value="Google Ads">Google Ads</option>
                                      <option value="LSA">LSA (Google Local Service Ads)</option>
                                      <option value="Facebook">Facebook / Instagram Ads</option>
                                      <option value="YouTube Ads">YouTube Ads</option>
                                      <option value="Yelp">Yelp</option>
                                      <option value="Angi">Angi / HomeAdvisor</option>
                                      <option value="Thumbtack">Thumbtack</option>
                                      <option value="Houzz">Houzz</option>
                                      <option value="Website">Website (Direct)</option>
                                      <option value="Google Organic Search">Google Organic Search</option>
                                      <option value="Customer Referral/Repeat">Customer Referral/Repeat</option>
                                      <option value="Yard Sign/DoorHanger">Yard Sign/DoorHanger</option>
                                      <option value="Direct Mail">Direct Mail</option>
                                      <option value="Truck / Vehicle Branding">Truck / Vehicle Branding</option>
                                      <option value="Other">Other / Unknown</option>
                                    </select>
                                    {pn.is_primary && <span className="text-[10px] text-primary font-black uppercase tracking-widest">Primary</span>}
                                  </div>
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

                    <div className="border-t border-gray-100 pt-8 mt-4">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-10 h-10 rounded-xl bg-slate-900 flex items-center justify-center text-white shadow-lg shadow-slate-200">
                          <Plus size={20} />
                        </div>
                        <div>
                          <h3 className="text-sm font-black text-slate-900 uppercase tracking-wider">Existing numbers</h3>
                          <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest">Connect your own hardware or Twilio lines</p>
                        </div>
                      </div>
                      
                      <div className="space-y-4">
                        {phoneNumbers.filter(pn => !pn.twilio_sid).map((pn) => (
                          <div key={pn.id} className={`group flex items-center justify-between p-4 rounded-2xl border transition-all ${pn.is_primary ? "border-slate-900 bg-slate-50 ring-1 ring-slate-900/5 shadow-sm" : "border-slate-100 bg-white hover:border-slate-200"}`}>
                            <div className="flex items-center gap-4">
                              <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${pn.is_primary ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-400 group-hover:bg-slate-100 group-hover:text-slate-600"}`}>
                                <Phone size={18} />
                              </div>
                              <div>
                                <div className="flex items-center gap-2">
                                  <p className="font-bold text-slate-900 text-sm tracking-tight">{pn.phone}</p>
                                  <select
                                      value={pn.lead_source || "Website"}
                                      onChange={(e) => handleUpdateLabel(pn.id, e.target.value)}
                                      className="px-2 py-0.5 bg-slate-100 text-slate-600 text-[9px] font-black uppercase tracking-widest rounded-md border border-slate-200 cursor-pointer"
                                    >
                                      <option value="Google Ads">Google Ads</option>
                                      <option value="LSA">LSA (Google Local Service Ads)</option>
                                      <option value="Facebook">Facebook / Instagram Ads</option>
                                      <option value="YouTube Ads">YouTube Ads</option>
                                      <option value="Yelp">Yelp</option>
                                      <option value="Angi">Angi / HomeAdvisor</option>
                                      <option value="Thumbtack">Thumbtack</option>
                                      <option value="Houzz">Houzz</option>
                                      <option value="Website">Website (Direct)</option>
                                      <option value="Google Organic Search">Google Organic Search</option>
                                      <option value="Customer Referral/Repeat">Customer Referral/Repeat</option>
                                      <option value="Yard Sign/DoorHanger">Yard Sign/DoorHanger</option>
                                      <option value="Direct Mail">Direct Mail</option>
                                      <option value="Truck / Vehicle Branding">Truck / Vehicle Branding</option>
                                      <option value="Other">Other / Unknown</option>
                                    </select>
                                </div>
                                {pn.is_primary ? (
                                  <div className="flex items-center gap-1.5 mt-0.5">
                                    <Shield size={10} className="text-slate-900" />
                                    <span className="text-[10px] text-slate-900 font-black uppercase tracking-widest">Primary identity</span>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">External number</span>
                                )}

                              </div>
                            </div>
                            <div className="flex gap-2">
                              {!pn.is_primary && (
                                <button type="button" onClick={() => handleSetPrimary(pn.id)} className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400 hover:text-slate-900 transition-colors" title="Set as primary">
                                  Set as Primary
                                </button>
                              )}
                              <button type="button" onClick={() => handleDeletePhone(pn.id)} className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all" title="Remove">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {phoneNumbers.some(pn => pn.twilio_sid) && (
                      <div className="mt-10 p-8 bg-slate-900 rounded-[2rem] text-white shadow-2xl shadow-slate-900/20 relative overflow-hidden group">
                        <div className="absolute top-0 right-0 p-8 text-white/5 group-hover:text-white/10 transition-colors">
                          <Zap size={120} weight="fill" />
                        </div>
                        
                        <div className="relative z-10">
                          <div className="flex items-center gap-2 mb-4">
                            <span className="px-3 py-1 bg-white/10 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-white/5">Configuration Guide</span>
                          </div>
                          <h3 className="text-xl font-black mb-2">Forward your main line</h3>
                          <p className="text-sm text-slate-400 font-medium mb-8 max-w-md italic">
                            Forward busy or no-answer calls from your <span className="text-slate-200 font-bold decoration-slate-500 underline underline-offset-4 decoration-2">{phoneNumbers.find(pn => pn.label === "Main Business")?.phone || "primary business number"}</span> to your dedicated AI line so no call ever goes unanswered.
                          </p>
                          
                          <div className="mb-8 p-4 bg-white/5 rounded-2xl border border-white/10 inline-flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-white">
                              <Phone size={16} />
                            </div>
                            <div>
                              <p className="text-[10px] text-slate-500 font-black uppercase tracking-widest mb-0.5">Your AI Line</p>
                              <p className="text-base font-black tracking-tighter">
                                {phoneNumbers.find(pn => pn.twilio_sid)?.phone || "Provisioned line"}
                              </p>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="p-5 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all">
                              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">AT&T / Verizon</p>
                              <p className="text-sm font-medium text-slate-200">Dial <span className="text-emerald-400 font-black">*72</span> followed by your AI line number.</p>
                            </div>
                            <div className="p-5 bg-white/5 border border-white/10 rounded-2xl hover:bg-white/10 transition-all">
                              <p className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2">T-Mobile / Others</p>
                              <p className="text-sm font-medium text-slate-200">Go to <span className="text-emerald-400 font-black">Settings → Call Forwarding</span> in your phone app.</p>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
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

              <div className="mt-12 pt-8 border-t border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <MessageSquare className="text-primary w-5 h-5" />
                  Website Chat Widget
                </h3>
                <p className="text-sm text-gray-500 mb-6 font-medium">
                  Add the AI chat widget to your website to handle leads, quotes, and bookings 24/7.
                </p>

                <div className="space-y-6">
                  {/* Script Tag */}
                  <div className="bg-gray-900 rounded-2xl p-6 shadow-xl border border-gray-800">
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-[10px] font-black text-primary uppercase tracking-[0.2em]">1. Install the Widget</span>
                      <span className="text-[10px] font-bold text-gray-500">PASTE BEFORE &lt;/BODY&gt;</span>
                    </div>
                    <code className="block p-4 bg-black/40 rounded-xl text-xs font-mono text-emerald-400 break-all border border-emerald-500/20">
                      {`<script src="https://ai-front-desk-backend.onrender.com/chat-widget.js" data-tenant-id="${tenant?.id}"></script>`}
                    </code>
                  </div>

                  {/* SMS Shortcut */}
                  <div className="bg-white rounded-2xl p-6 border-2 border-dashed border-gray-100">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                        <Phone className="w-5 h-5 text-emerald-600" />
                      </div>
                      <div>
                        <h4 className="font-bold text-gray-900">"Click-to-Text" Shortcut</h4>
                        <p className="text-xs text-gray-500 font-medium">Add a standalone button to your site that opens the customer's SMS app.</p>
                      </div>
                    </div>
                    
                    <div className="space-y-3">
                      <div className="flex flex-col gap-2">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest pl-1">HTML Example</label>
                        <code className="block p-3 bg-gray-50 rounded-xl text-[11px] font-mono text-gray-600 border border-gray-100">
                          {`<a href="sms:${tenant?.twilio_phone_number || "+1234567890"}" class="text-us-button">
  Text Us to Book
</a>`}
                        </code>
                      </div>
                      <p className="text-[10px] text-gray-400 font-medium italic">
                        * When clicked on mobile, this will open the phone's native messaging app with your business number pre-filled.
                      </p>
                    </div>
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

          {activeTab === "nurturing" && (
            <div className="space-y-10 max-w-4xl">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-1 flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-emerald-600" />
                  Nurturing & referral campaigns
                </h2>
                <p className="text-sm text-gray-500 mb-6">Post-service follow-ups, referral requests, maintenance reminders, and seasonal campaigns. Requires an Elite plan or add-on.</p>

                <div className="space-y-6">
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.nurturing_enabled}
                      onChange={(e) => handleUpdateForm("nurturing_enabled", e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-gray-900"
                    />
                    <span className="font-medium text-gray-900">Enable nurturing campaigns</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.referral_enabled}
                      onChange={(e) => handleUpdateForm("referral_enabled", e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-gray-900"
                    />
                    <span className="font-medium text-gray-900">Enable referral requests</span>
                  </label>
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.seasonal_campaigns_enabled}
                      onChange={(e) => handleUpdateForm("seasonal_campaigns_enabled", e.target.checked)}
                      className="w-4 h-4 rounded border-gray-300 text-gray-900"
                    />
                    <span className="font-medium text-gray-900">Enable seasonal campaigns</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-8">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Referral request (days after service)</label>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={form.referral_request_days_after_service}
                      onChange={(e) => handleUpdateForm("referral_request_days_after_service", parseInt(e.target.value, 10) || 5)}
                      className="w-full px-4 py-2 border border-gray-200 rounded-xl"
                    />
                  </div>
                </div>

                {/* ── Maintenance Touchpoints ── */}
                <div className="mt-10 pt-8 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                        🔧 Maintenance reminders
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">Up to 3 touchpoints. Set months to 0 to disable a touchpoint. Add a header/theme and the AI crafts the message.</p>
                    </div>
                    {form.maintenance_touchpoints.length < 3 && (
                      <button
                        type="button"
                        onClick={() => handleUpdateForm("maintenance_touchpoints", [...form.maintenance_touchpoints, { months: 0, header: "" }])}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add touchpoint
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    {form.maintenance_touchpoints.map((tp, idx) => (
                      <div key={idx} className="p-5 bg-gray-50 border border-gray-200 rounded-2xl relative group">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Touchpoint {idx + 1}</span>
                          {form.maintenance_touchpoints.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = form.maintenance_touchpoints.filter((_, i) => i !== idx);
                                handleUpdateForm("maintenance_touchpoints", next);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">Months after service</label>
                            <input
                              type="number"
                              min={0}
                              max={36}
                              value={tp.months}
                              onChange={(e) => {
                                const next = [...form.maintenance_touchpoints];
                                next[idx] = { ...next[idx], months: parseInt(e.target.value, 10) || 0 };
                                handleUpdateForm("maintenance_touchpoints", next);
                              }}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold"
                            />
                            {tp.months === 0 && <p className="text-[10px] text-amber-600 font-bold mt-1">Disabled (set &gt; 0 to activate)</p>}
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-gray-600 mb-1">Header / theme (AI uses this)</label>
                            <input
                              type="text"
                              value={tp.header}
                              onChange={(e) => {
                                const next = [...form.maintenance_touchpoints];
                                next[idx] = { ...next[idx], header: e.target.value };
                                handleUpdateForm("maintenance_touchpoints", next);
                              }}
                              placeholder="e.g. Spring AC Tune-Up, Annual Paint Touch-Up"
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm placeholder:text-gray-400"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* ── Re-Engagement Touchpoints ── */}
                <div className="mt-10 pt-8 border-t border-gray-200">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                        🔄 Re-engagement touchpoints
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">Up to 3 touchpoints for dormant customers. Set months to 0 to disable.</p>
                    </div>
                    {form.reengagement_touchpoints.length < 3 && (
                      <button
                        type="button"
                        onClick={() => handleUpdateForm("reengagement_touchpoints", [...form.reengagement_touchpoints, { months: 0, header: "" }])}
                        className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-blue-700 bg-blue-50 border border-blue-200 rounded-xl hover:bg-blue-100 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" /> Add touchpoint
                      </button>
                    )}
                  </div>
                  <div className="space-y-4">
                    {form.reengagement_touchpoints.map((tp, idx) => (
                      <div key={idx} className="p-5 bg-gray-50 border border-gray-200 rounded-2xl relative group">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-black text-gray-400 uppercase tracking-widest">Touchpoint {idx + 1}</span>
                          {form.reengagement_touchpoints.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                const next = form.reengagement_touchpoints.filter((_, i) => i !== idx);
                                handleUpdateForm("reengagement_touchpoints", next);
                              }}
                              className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label className="block text-xs font-bold text-gray-600 mb-1">Months after service</label>
                            <input
                              type="number"
                              min={0}
                              max={36}
                              value={tp.months}
                              onChange={(e) => {
                                const next = [...form.reengagement_touchpoints];
                                next[idx] = { ...next[idx], months: parseInt(e.target.value, 10) || 0 };
                                handleUpdateForm("reengagement_touchpoints", next);
                              }}
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-bold"
                            />
                            {tp.months === 0 && <p className="text-[10px] text-amber-600 font-bold mt-1">Disabled (set &gt; 0 to activate)</p>}
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-xs font-bold text-gray-600 mb-1">Header / theme (AI uses this)</label>
                            <input
                              type="text"
                              value={tp.header}
                              onChange={(e) => {
                                const next = [...form.reengagement_touchpoints];
                                next[idx] = { ...next[idx], header: e.target.value };
                                handleUpdateForm("reengagement_touchpoints", next);
                              }}
                              placeholder="e.g. We miss you!, Quick check-in"
                              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm placeholder:text-gray-400"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-8 pt-8 border-t border-gray-200">
                  <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
                    <div>
                      <h3 className="text-base font-bold text-gray-900 flex items-center gap-2">
                        <CalendarDays className="w-5 h-5 text-emerald-600" />
                        12-month campaign calendar
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">Give each month a short name so you can see which seasonal message was sent. Leave blank to use the default message.</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const next = { ...form.nurturing_campaign_calendar };
                        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach((m) => { next[String(m)] = DEFAULT_CAMPAIGN_PLACEHOLDERS[m]; });
                        handleUpdateForm("nurturing_campaign_calendar", next);
                      }}
                      className="px-4 py-2 text-sm font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition-colors"
                    >
                      Use painting example defaults
                    </button>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {MONTH_NAMES.map((name, i) => {
                      const monthNum = i + 1;
                      const key = String(monthNum);
                      const value = form.nurturing_campaign_calendar[key] ?? "";
                      const placeholder = MONTH_PLACEHOLDERS[monthNum] || "Optional campaign name";
                      return (
                        <div key={key} className="bg-gray-50/80 rounded-xl border border-gray-100 p-4">
                          <label className="block text-sm font-semibold text-gray-700 mb-2">{name}</label>
                          <input
                            type="text"
                            value={value}
                            onChange={(e) => {
                              const next = { ...form.nurturing_campaign_calendar };
                              const v = e.target.value.trim();
                              if (v) next[key] = v;
                              else delete next[key];
                              handleUpdateForm("nurturing_campaign_calendar", next);
                            }}
                            placeholder={placeholder}
                            className="w-full px-3 py-2.5 text-sm border border-gray-200 rounded-lg bg-white placeholder:text-gray-400 focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-colors"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
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
                        className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-gray-900/5 transition-all"
                      />
                      <button 
                        type="button"
                        onClick={() => window.open(form.crm_webhook_url, "_blank")}
                        disabled={!form.crm_webhook_url}
                        className="p-3 bg-gray-100 rounded-xl hover:bg-gray-200 transition-colors disabled:opacity-30"
                      >
                        <ExternalLink className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Data is sent here when a booking is created or call details are ready.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Secondary Zapier URL (Optional)</label>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={form.zapier_webhook_url}
                        onChange={(e) => handleUpdateForm("zapier_webhook_url", e.target.value)}
                        placeholder="https://hooks.zapier.com/..."
                        className="flex-1 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl font-mono text-xs focus:ring-2 focus:ring-gray-900/5 transition-all"
                      />
                    </div>
                    <p className="text-xs text-gray-500 mt-2">If provided, we will also send the same data to this second URL.</p>
                  </div>

                  <div className="mt-8 p-6 bg-blue-50/50 border border-blue-100 rounded-2xl">
                    <h3 className="text-sm font-bold text-blue-900 mb-2 flex items-center gap-2">
                      <Bot className="w-4 h-4" />
                      Inbound Webhook (Nurturing Flow)
                    </h3>
                    <p className="text-xs text-blue-700/80 mb-4 leading-relaxed">
                      Use this URL in Zapier to notify our system when a job is completed in your CRM. This triggers the follow-up/nurturing sequence.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 p-3 bg-white border border-blue-200 rounded-xl font-mono text-[10px] text-blue-900 break-all select-all">
                        {`${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/job-completed`.replace(/\/+$/, "")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/job-completed`.replace(/\/+$/, "");
                          navigator.clipboard.writeText(url);
                          setMessage("Inbound URL copied to clipboard!");
                        }}
                        className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
                        title="Copy to clipboard"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-4 space-y-2">
                      <p className="text-[10px] text-blue-600/70 font-bold uppercase tracking-wider">Required Header:</p>
                      <div className="p-2 bg-white/50 border border-blue-100 rounded-lg font-mono text-[9px] text-blue-800">
                        Authorization: Bearer [Your API Key]
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Google Calendar */}
              <div className="pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between gap-4 mb-6">
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <GoogleCalendarIcon className="w-6 h-6" />
                    Google Calendar
                  </h2>
                  {form.google_calendar_linked ? (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-bold border border-emerald-100">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      CONNECTED
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 text-gray-500 rounded-full text-xs font-bold border border-gray-100">
                      <Clock className="w-3.5 h-3.5" />
                      NOT CONNECTED
                    </div>
                  )}
                </div>

                <div className="bg-gray-50 border border-gray-200 rounded-2xl p-6">
                  {form.google_calendar_linked ? (
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                      <div className="flex items-center gap-4">
                        <div className="w-12 h-12 bg-white rounded-xl border border-gray-200 flex items-center justify-center shadow-sm">
                          <GoogleCalendarIcon className="w-7 h-7" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-gray-900">Connected to Google Calendar</p>
                          <p className="text-xs text-gray-500">{form.google_calendar_email || "Active association"}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleDisconnectCalendar}
                        className="px-6 py-2.5 bg-white border border-red-200 text-red-600 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-red-50 transition-all shadow-sm"
                      >
                        Disconnect
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
                      <div className="max-w-md">
                        <p className="text-sm font-bold text-gray-900 mb-1">Sync with your Google Calendar</p>
                        <p className="text-xs text-gray-500 leading-relaxed">
                          Allow the AI to check your availability in real-time and automatically book appointments on your calendar.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleConnectCalendar}
                        className="px-8 py-3 bg-white border-2 border-gray-200 font-bold text-xs uppercase tracking-widest rounded-xl hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm active:scale-95 flex items-center gap-3 text-gray-700"
                      >
                        <GoogleCalendarIcon className="w-5 h-5" />
                        Connect Google Calendar
                      </button>
                    </div>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-4 leading-relaxed">
                  Once connected, the AI will use your primary calendar to verify availability before confirming a booking with a customer.
                </p>
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

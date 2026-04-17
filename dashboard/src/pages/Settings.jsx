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
  createAddonNumberCheckout,
} from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { ConfirmationModal } from "../components/ConfirmationModal";
import Billing from "./Billing";
import Plans from "./Plans";
import { useToast } from "../components/ui/Toast";
import {
  Bot,
  Clock,
  Link as LinkIcon,
  Save,
  RefreshCw,
  Plus,
  Trash2,
  CreditCard,
  BarChart3,
  CheckCircle2,
  AlertCircle,
  Phone,
  MessageSquare,
  Globe,
  Settings as SettingsIcon,
  ChevronRight,
  ExternalLink,
  Zap,
  TrendingUp,
  DollarSign,
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
  UserPlus,
  User,
  AtSign,
  Mail,
  Mic2,
  Volume2
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
  <svg viewBox="0 0 122.88 122.88" className={className} xmlns="http://www.w3.org/2000/svg">
    <style dangerouslySetInnerHTML={{ __html: ".st0{fill:#188038;}.st1{fill:#1967D2;}.st2{fill:#1A73E8;}.st3{fill:#F72A25;}.st4{fill:#FBBC04;}.st5{fill:#FFFFFF;}.st6{fill:#34A853;}.st7{fill:#4285F4;}" }} />
    <g>
      <polygon className="st5" points="93.78,29.1 29.1,29.1 29.1,93.78 93.78,93.78 93.78,29.1" />
      <polygon className="st3" points="93.78,122.88 122.88,93.78 93.78,93.78 93.78,122.88" />
      <polygon className="st4" points="122.88,29.1 93.78,29.1 93.78,93.78 122.88,93.78 122.88,29.1" />
      <polygon className="st6" points="93.78,93.78 29.1,93.78 29.1,122.88 93.78,122.88 93.78,93.78" />
      <path className="st0" d="M0,93.78v19.4c0,5.36,4.34,9.7,9.7,9.7h19.4v-29.1H0L0,93.78z" />
      <path className="st1" d="M122.88,29.1V9.7c0-5.36-4.34-9.7-9.7-9.7h-19.4v29.1H122.88L122.88,29.1z" />
      <path className="st7" d="M93.78,0H9.7C4.34,0,0,4.34,0,9.7v84.08h29.1V29.1h64.67V0L93.78,0z" />
      <path className="st2" d="M42.37,79.27c-2.42-1.63-4.09-4.02-5-7.17l5.61-2.31c0.51,1.94,1.4,3.44,2.67,4.51 c1.26,1.07,2.8,1.59,4.59,1.59c1.84,0,3.41-0.56,4.73-1.67c1.32-1.12,1.98-2.54,1.98-4.26c0-1.76-0.7-3.2-2.09-4.32 c-1.39-1.12-3.14-1.67-5.22-1.67H46.4v-5.55h2.91c1.79,0,3.31-0.48,4.54-1.46c1.23-0.97,1.84-2.3,1.84-3.99 c0-1.5-0.55-2.7-1.65-3.6s-2.49-1.35-4.18-1.35c-1.65,0-2.96,0.44-3.93,1.32c-0.97,0.88-1.7,2-2.12,3.24l-5.55-2.31 c0.74-2.09,2.09-3.93,4.07-5.52c1.98-1.59,4.51-2.39,7.58-2.39c2.27,0,4.32,0.44,6.13,1.32c1.81,0.88,3.23,2.1,4.26,3.65 c1.03,1.56,1.54,3.31,1.54,5.25c0,1.98-0.48,3.65-1.43,5.03c-0.95,1.37-2.13,2.43-3.52,3.16v0.33c1.79,0.74,3.36,1.96,4.51,3.52 c1.17,1.58,1.76,3.46,1.76,5.66c0,2.2-0.56,4.16-1.67,5.88c-1.12,1.72-2.66,3.08-4.62,4.07c-1.96,0.99-4.17,1.49-6.62,1.49 C47.41,81.72,44.79,80.91,42.37,79.27L42.37,79.27L42.37,79.27z M76.83,51.43l-6.16,4.45l-3.08-4.67l11.05-7.97h4.24v37.6h-6.05 V51.43L76.83,51.43z" />
    </g>
  </svg>
);

const TABS = [
 { id: "numbers",      label: "Phone & voice",       icon: Phone      },
 { id: "ai",           label: "AI behavior",          icon: Bot        },
 { id: "knowledge",    label: "Knowledge base",       icon: BookOpen   },
 { id: "hours",        label: "Business hours",       icon: Clock      },
 { id: "nurturing",    label: "Nurturing & referrals", icon: UserPlus  },
 { id: "integrations", label: "Integrations",         icon: LinkIcon   },
 { id: "plans",        label: "Plans",                icon: CreditCard },
 { id: "billing",      label: "Usage & Billing",      icon: BarChart3  },
];

export default function Settings({ tenantId }) {
  const { success, error: toastError } = useToast();
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
    facebook_token_error: null,
    google_calendar_linked: false,
    google_calendar_email: "",
    faqs: [],
    inbound_voice: "shimmer",
    outbound_voice: "ash",
    outbound_instructions: "",
    outbound_agent_name: "Alex",
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
  const [buyAddonLoading, setBuyAddonLoading] = useState(false);

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
        facebook_page_access_token: "", // Never keep the actual token in form state
        facebook_token_masked: t.facebook_token_masked || null,
        facebook_token_error: t.facebook_token_error || null,
        google_calendar_linked: t.google_calendar_linked === true,
        google_calendar_email: t.google_calendar_email || "",
        faqs: Array.isArray(t.faqs) ? t.faqs : [],
        inbound_voice: t.inbound_voice || "shimmer",
        brand_color: t.brand_color || "#E8600A",
        outbound_voice: t.outbound_voice || "ash",
        outbound_instructions: t.outbound_instructions || "",
        outbound_agent_name: t.outbound_agent_name || "Alex",
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
      toastError(`Failed to load tenant: ${e.message}`);
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
        .catch(() => { });
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
      success("Number provisioned successfully!");
      setProvisionMessage("Number provisioned successfully!");
      setAvailableNumbers([]);
      setSelectedNumber(null);
      setAreaCode("");
      await fetchPhoneNumbers();
    } catch (err) {
      toastError(`Provisioning failed: ${err.message}`);
      setProvisionMessage(`Error: ${err.message}`);
    } finally {
      setProvisionLoading(false);
    }
  };

  const handleBuyAddonNumber = async () => {
    if (!tenantId) return;
    setBuyAddonLoading(true);
    try {
      const res = await createAddonNumberCheckout(tenantId);
      if (res.url) {
        window.location.href = res.url;
      }
    } catch (e) {
      toastError(`Failed to start checkout: ${e.message}`);
    } finally {
      setBuyAddonLoading(false);
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
        success(`${newPhone} added and configured!`);
        setMessage(`Success! ${newPhone} added and configured as an AI phone line.`);
      } else {
        success(`Number ${newPhone} added.`);
        setMessage(`Number ${newPhone} added. (External business number)`);
      }

      fetchPhoneNumbers();
      // Clear success message after 5s
      setTimeout(() => setMessage(""), 5000);
    } catch (err) {
      toastError(err.message);
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
          success("Number removed.");
          setConfirmModal(prev => ({ ...prev, isOpen: false }));
        } catch (err) {
          toastError(`Failed to delete number: ${err.message}`);
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
      success("Primary number set.");
      fetchPhoneNumbers();
    } catch (e) {
      console.error(e);
      toastError("Failed to update primary status");
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
      inbound_voice: form.inbound_voice || "shimmer",
      brand_color: form.brand_color || "#E8600A",
      outbound_voice: form.outbound_voice || "ash",
      outbound_instructions: form.outbound_instructions || null,
      outbound_agent_name: form.outbound_agent_name || "Alex",
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
      success("Settings saved successfully.");
      setMessage("Settings saved successfully.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toastError(`Save failed: ${e.message}`);
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
      success("Facebook settings saved!");
      setMessage("Facebook settings saved!"); // Use setMessage for success
      loadTenant();
    } catch (e) {
      toastError(e.message);
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
      success("Google Calendar disconnected.");
      setMessage("Google Calendar disconnected."); // Use setMessage for success
      loadTenant();
    } catch (e) {
      toastError(`Disconnect failed: ${e.message}`);
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
                    <Link to="/plans" className="inline-flex px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800">
                      View plans
                    </Link>
                  </div>
                ) : (
                  <>
                    <div className="mb-6 px-4 py-3 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-between flex-wrap gap-4 shadow-sm">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-blue-100 border border-blue-200 flex items-center justify-center text-blue-600 shadow-sm">
                          <Phone className="w-5 h-5 text-blue-500" />
                        </div>
                        <div>
                          <p className="text-sm font-bold text-blue-900 leading-none mb-1">
                            Plan Usage: <span className="text-blue-600">{phoneNumbers.length}</span> / <span className="text-stone-500">{(tenant?.plan === 'elite' ? 5 : (tenant?.plan === 'pro' ? 3 : 1)) + (tenant?.extra_numbers_count || 0)}</span> Numbers
                          </p>
                          <div className="flex items-center gap-2">
                             <p className="text-[10px] text-blue-600 font-black uppercase tracking-[0.05em]">{tenant?.plan ? `${tenant.plan.toUpperCase()} PLAN` : 'BASIC PLAN'}</p>
                             {tenant?.extra_numbers_count > 0 && (
                               <>
                                 <span className="w-1 h-1 rounded-full bg-blue-300"></span>
                                 <p className="text-[10px] text-blue-500 font-bold uppercase tracking-wider">{tenant.extra_numbers_count} Extra Purchased</p>
                               </>
                             )}
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-2">
                        <button
                          onClick={handleBuyAddonNumber}
                          disabled={buyAddonLoading}
                          className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-md shadow-blue-200 disabled:opacity-50"
                        >
                          {buyAddonLoading ? <RefreshCw className="animate-spin w-3 h-3" /> : <Plus className="w-3 h-3" />}
                          Buy Extra ($12/mo)
                        </button>
                        
                        {(tenant?.plan === 'basic' || tenant?.plan === 'pro') && (
                          <Link to="/plans" className="px-3 py-1.5 bg-white border border-blue-200 text-blue-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-blue-50 transition-all outline-none">
                            Upgrade Plan
                          </Link>
                        )}
                      </div>
                    </div>

                    <div className="mb-10 p-6 bg-slate-50 border border-slate-100 rounded-[1.5rem] shadow-sm">
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
                        <div className="p-6 bg-white border border-slate-100 rounded-[1.5rem] shadow-sm hover:shadow-md transition-all duration-500">
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
                                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs text-slate-600 font-bold focus:ring-4 focus:ring-slate-900/5 transition-all placeholder:text-slate-500 shadow-sm"
                                  maxLength={3}
                                />
                              </div>
                              <button
                                type="button"
                                onClick={() => fetchAvailableNumbers(areaCode)}
                                disabled={loadingNumbers || phoneNumbers.length >= ((tenant?.plan === 'elite' ? 5 : (tenant?.plan === 'pro' ? 3 : 1)) + (tenant?.extra_numbers_count || 0))}
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
                                className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-4 focus:ring-slate-900/5 transition-all outline-none shadow-sm cursor-pointer"
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
                                      className={`group relative flex flex-col p-4 cursor-pointer rounded-xl shadow-sm border-2 border-slate-500 transition-all duration-300 ${selectedNumber?.phoneNumber === num.phoneNumber ? "border-emerald-600 bg-emerald-50/30 ring-4 ring-emerald-600/5" : "border-slate-50 bg-slate-50/50 hover:border-slate-200"}`}
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
                                  className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-4 focus:ring-slate-900/5 transition-all outline-none shadow-sm placeholder:text-slate-500"
                                />
                              </div>

                              <div className="space-y-1.5">
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Lead Source</label>
                                <div className="relative group/select">
                                  <select
                                    value={newPhoneLabel}
                                    onChange={(e) => setNewPhoneLabel(e.target.value)}
                                    className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-4 focus:ring-slate-900/5 transition-all outline-none appearance-none shadow-sm pr-10 cursor-pointer"
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
                  <div className="col-span-2 mb-2">
  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">
    Brand Color
  </label>
  <div className="flex items-center gap-4">
    <input
      type="color"
      value={form.brand_color || "#E8600A"}
      onChange={(e) => handleUpdateForm("brand_color", e.target.value)}
      className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-1"
    />
    <input
      type="text"
      value={form.brand_color || "#E8600A"}
      onChange={(e) => handleUpdateForm("brand_color", e.target.value)}
      placeholder="#E8600A"
      className="w-36 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-primary/5 transition-all outline-none"
    />
    <div
      className="w-10 h-10 rounded-xl border border-slate-200 shadow-sm"
      style={{ background: form.brand_color || "#E8600A" }}
    />
    <p className="text-xs text-gray-400">Used for the chat widget on your website</p>
  </div>
</div>
                  <div className="col-span-1">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Tone of Voice</label>
                    <select
                      value={form.tone_of_voice}
                      onChange={(e) => handleUpdateForm("tone_of_voice", e.target.value)}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-primary/5 transition-all outline-none font-bold text-xs"
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
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-primary/5 transition-all outline-none font-medium placeholder:text-slate-500"
                      placeholder="e.g. Thanks for calling Gladiators Painting..."
                    />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Inbound Voice</label>
                    <div className="relative">
                      <Mic2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                      <select
                        value={form.inbound_voice}
                        onChange={(e) => handleUpdateForm("inbound_voice", e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-primary/5 transition-all outline-none font-bold text-xs appearance-none"
                      >
                         <option value="shimmer">Shimmer (Female - Default)</option>
                         <option value="coral">Coral (Female - Formal)</option>
                         <option value="verse">Verse (Female - Energetic)</option>
                         <option value="ash">Ash (Male - Deep)</option>
                         <option value="echo">Echo (Male - Calm)</option>
                         <option value="alloy">Alloy (Male - Neutral)</option>
                         <option value="ballad">Ballad (Male - Professional)</option>
                         <option value="sage">Sage (Male - Warm)</option>
                      </select>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Detailed AI Instructions</label>
                    <textarea
                      value={form.instructions}
                      onChange={(e) => handleUpdateForm("instructions", e.target.value)}
                      rows={6}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-primary/5 transition-all outline-none font-medium leading-relaxed placeholder:text-slate-500"
                      placeholder="Detailed prompts for the AI behavior..."
                    />
                  </div>
                </div>
              </div>

              <div className="pt-8 border-t border-gray-100">
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <ExternalLink className="text-blue-500 w-5 h-5" />
                  Outbound AI Agent
                </h2>
                <p className="text-sm text-gray-500 mb-6 italic bg-blue-50/50 p-4 rounded-xl border border-blue-100/50 leading-relaxed">
                  These instructions are used when your AI assistant calls or follows up with leads. Focus on outreach, professional follow-up, and engaging existing contacts.
                </p>
                <div className="space-y-6">
                  <div className="md:w-1/3">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">AI Caller Name</label>
                    <div className="relative">
                      <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                      <input 
                        type="text"
                        value={form.outbound_agent_name}
                        onChange={(e) => handleUpdateForm("outbound_agent_name", e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/5 transition-all outline-none font-bold text-xs"
                        placeholder="e.g. Alex, Sarah"
                      />
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 italic">Default name for outbound calls.</p>
                  </div>
                  <div className="md:w-1/3">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Outbound Voice</label>
                    <div className="relative">
                      <Volume2 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
                      <select
                        value={form.outbound_voice}
                        onChange={(e) => handleUpdateForm("outbound_voice", e.target.value)}
                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/5 transition-all outline-none font-bold text-xs appearance-none"
                      >
                         <option value="ash">Ash (Male - Deep)</option>
                         <option value="echo">Echo (Male - Calm)</option>
                         <option value="alloy">Alloy (Male - Neutral)</option>
                         <option value="ballad">Ballad (Male - Professional)</option>
                         <option value="sage">Sage (Male - Warm)</option>
                         <option value="shimmer">Shimmer (Female - Default)</option>
                         <option value="coral">Coral (Female - Formal)</option>
                         <option value="verse">Verse (Female - Energetic)</option>
                      </select>
                    </div>
                  </div>
                  <div className="col-span-2">
                    <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Outbound Personality & Instructions</label>
                    <textarea
                      value={form.outbound_instructions}
                      onChange={(e) => handleUpdateForm("outbound_instructions", e.target.value)}
                      rows={6}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-blue-500/5 transition-all outline-none font-medium leading-relaxed placeholder:text-slate-500"
                      placeholder="e.g. You are following up on an estimate request. Be proactive, polite, and try to find a time to connect..."
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
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-4 focus:ring-primary/5 transition-all placeholder:text-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">How the AI should respond (script)</label>
                        <textarea
                          value={case_.script}
                          onChange={(e) => handleUpdateObjectionCase(index, "script", e.target.value)}
                          rows={2}
                          placeholder="Brief response the assistant should use in this situation."
                          className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:ring-4 focus:ring-primary/5 transition-all placeholder:text-slate-500"
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
                            className="w-full px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold focus:ring-4 focus:ring-primary/5 outline-none transition-all placeholder:text-slate-500"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 pl-1">Answer</label>
                          <textarea
                            value={faq.answer}
                            onChange={(e) => handleUpdateFaq(index, "answer", e.target.value)}
                            placeholder="Detailed answer for the AI..."
                            rows={3}
                            className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-4 focus:ring-primary/5 outline-none transition-all placeholder:text-slate-500"
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
                              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold focus:ring-4 focus:ring-primary/5 transition-all"
                            />
                            <span className="text-gray-400 font-bold">—</span>
                            <input
                              type="time"
                              value={config.close || "17:00"}
                              onChange={(e) => handleUpdateOpeningHours(day, "close", e.target.value)}
                              className="px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold focus:ring-4 focus:ring-primary/5 transition-all"
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
                  className="w-full md:w-64 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-4 focus:ring-primary/5 transition-all outline-none font-bold text-xs"
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
                            className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-lg placeholder:text-slate-500 focus:ring-4 focus:ring-emerald-500/5 focus:border-emerald-500 transition-all font-medium"
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
               {/* Website Chat Widget Installation */}
              <div>
                <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <MessageSquare className="text-primary w-5 h-5" />
                    Website Chat Widget
                  </h2>
                  {tenant?.id && (
                    <a
                      href="https://www.gladiatorspainting.com/?widget_test=1"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-emerald-100 transition-colors"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Test Live Widget
                    </a>
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-6 font-medium leading-relaxed max-w-2xl">
                  Install this script on your website to let customers chat with your AI 24/7. Leads captured here flow straight into your dashboard and follow-up sequences.
                </p>

                {/* Script Tag with Copy Button */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 shadow-xl border border-slate-700 mb-6">
                  <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em]">1. Copy your script tag</span>
                    <button
                      type="button"
                      onClick={() => {
                        const snippet = `<script src="${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/chat-widget.js" data-tenant-id="${tenant?.id}" async></script>`;
                        navigator.clipboard.writeText(snippet);
                        success("Widget script copied to clipboard!");
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Copy Script
                    </button>
                  </div>
                  <code className="block p-4 bg-black/40 rounded-xl text-xs font-mono text-emerald-400 break-all border border-emerald-500/20 leading-relaxed">
                    {`<script src="${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/chat-widget.js" data-tenant-id="${tenant?.id}" async></script>`}
                  </code>
                  <p className="text-[10px] text-slate-400 font-medium italic mt-3 leading-relaxed">
                    💡 Paste this before your closing <code className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400">&lt;/body&gt;</code> tag, or inside <code className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400">&lt;head&gt;</code> (the <code className="bg-slate-800 px-1.5 py-0.5 rounded text-emerald-400">async</code> attribute prevents it from blocking page load).
                  </p>
                </div>

                {/* Send to Developer — PRIMARY install path */}
                <div className="mb-6">
                  <h3 className="text-sm font-bold text-gray-900 mb-3 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" />
                    2. Send everything to your web developer
                  </h3>
                  <div className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/20 rounded-2xl">
                    <p className="text-sm text-gray-700 leading-relaxed mb-4">
                      Don't install it yourself? This button copies a ready-to-forward email to your clipboard. It includes <strong>the chat widget script AND the Click-to-Text button snippet</strong>, platform-specific install steps, and clear instructions for your developer.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        // Derive the primary AI phone number (Twilio-provisioned, preferred)
                        const aiPhoneNumber =
                          phoneNumbers.find((p) => p.twilio_sid && p.is_primary)?.phone ||
                          phoneNumbers.find((p) => p.twilio_sid)?.phone ||
                          null;

                        const scriptTag = `<script src="${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/chat-widget.js" data-tenant-id="${tenant?.id}" async></script>`;

                        const clickToTextSnippet = aiPhoneNumber
                          ? `<a href="sms:${aiPhoneNumber}?&body=Hi%2C%20I%27d%20like%20to%20book%20an%20estimate" style="display:inline-block;padding:14px 28px;background:#10b981;color:#fff;font-weight:700;text-decoration:none;border-radius:12px;font-family:system-ui,sans-serif;box-shadow:0 4px 12px rgba(16,185,129,0.3);">💬 Text Us to Book</a>`
                          : `<!-- Add an AI phone number in Settings \u2192 Phone & Voice first to generate your Click-to-Text snippet -->`;

                        const companyName = tenant?.company_name || tenant?.name || "our business";

                        const emailBody = `Subject: Install our new AI chat widget + Click-to-Text button

Hi,

We just signed up for an AI assistant that handles customer questions, quotes, and bookings 24/7 on our website. I need you to install two things:

=== PART 1: CHAT WIDGET (bottom-right bubble on every page) ===

Please add this script tag to every page of ${companyName}'s website, inserted just before the closing </body> tag:

${scriptTag}

Alternative: the script can also go inside the <head> tag \u2014 the "async" attribute prevents it from blocking page load either way.

Platform-specific install paths:
\u2022 Webflow \u2192 Project Settings \u2192 Custom Code \u2192 Footer Code \u2192 Save & Publish
\u2022 WordPress \u2192 "Insert Headers and Footers" plugin \u2192 Footer \u2192 Save
\u2022 Wix \u2192 Settings \u2192 Custom Code \u2192 Add New Code \u2192 Apply to All Pages \u2192 Body End
\u2022 Shopify \u2192 Online Store \u2192 Themes \u2192 Edit Code \u2192 theme.liquid \u2192 before </body>
\u2022 Squarespace \u2192 Settings \u2192 Advanced \u2192 Code Injection \u2192 Footer \u2192 Save
\u2022 Custom HTML \u2192 paste before </body> on every page

Once installed, a chat bubble should appear in the bottom-right corner of every page.

=== PART 2: CLICK-TO-TEXT BUTTON (mobile-first book-by-text CTA) ===

${aiPhoneNumber ? `Please add this "Text Us to Book" button to our homepage (and any other pages where you'd like customers to book via SMS). It's mobile-optimized \u2014 when tapped on a phone, it opens the customer's messaging app pre-filled with a booking inquiry that routes directly to our AI.` : `This section requires an AI phone number setup first. Skip for now \u2014 we'll add this once that's configured.`}

${clickToTextSnippet}

You can style or resize it to match the site \u2014 the key attribute is the href value.

=== VERIFICATION ===

Once both are installed, please let me know so I can test from my end:
1. Chat bubble appears in bottom-right on every page
2. "Text Us to Book" button opens SMS app with correct number when tapped on mobile
3. Messages sent to either channel trigger an AI response

Thanks!`;

                        navigator.clipboard.writeText(emailBody);
                        success("Developer email copied to clipboard \u2014 paste it into your email app!");
                      }}
                      className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-primary text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all active:scale-95"
                    >
                      <Mail className="w-4 h-4" />
                      Copy Email for Developer
                    </button>
                    <p className="text-[10px] text-gray-500 italic mt-3 text-center">
                      The email contains both installs, platform-specific paths, and verification steps.
                    </p>
                  </div>
                </div>

                {/* Platform-Specific Guides \u2014 collapsed by default */}
                <details className="mb-6 group">
                  <summary className="cursor-pointer list-none flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-2xl hover:border-gray-300 transition-all">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-gray-500" />
                      <span className="text-sm font-bold text-gray-700">Installing it yourself? Platform-specific instructions</span>
                    </div>
                    <ChevronDown className="w-4 h-4 text-gray-400 group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-blue-500 text-white flex items-center justify-center text-xs font-black">W</div>
                        <span className="text-sm font-bold text-gray-900">Webflow</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Project Settings \u2192 <strong>Custom Code</strong> \u2192 Paste in <strong>Footer Code</strong> \u2192 Save & Publish.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-slate-700 text-white flex items-center justify-center text-xs font-black">W</div>
                        <span className="text-sm font-bold text-gray-900">WordPress</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Install the <strong>"Insert Headers and Footers"</strong> plugin \u2192 Paste in <strong>Footer</strong> \u2192 Save.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-black text-white flex items-center justify-center text-xs font-black">W</div>
                        <span className="text-sm font-bold text-gray-900">Wix</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Settings \u2192 <strong>Custom Code</strong> \u2192 Add New Code \u2192 Paste \u2192 Apply to All Pages \u2192 <strong>Place Code in Body - End</strong>.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-emerald-600 text-white flex items-center justify-center text-xs font-black">S</div>
                        <span className="text-sm font-bold text-gray-900">Shopify</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Online Store \u2192 Themes \u2192 <strong>Edit Code</strong> \u2192 <code className="bg-gray-100 px-1 rounded text-[10px]">theme.liquid</code> \u2192 Paste before <code className="bg-gray-100 px-1 rounded text-[10px]">&lt;/body&gt;</code>.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-slate-900 text-white flex items-center justify-center text-xs font-black">S</div>
                        <span className="text-sm font-bold text-gray-900">Squarespace</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Settings \u2192 Advanced \u2192 <strong>Code Injection</strong> \u2192 Paste in <strong>Footer</strong> \u2192 Save.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-gradient-to-br from-orange-500 to-red-500 text-white flex items-center justify-center text-xs font-black">&lt;/&gt;</div>
                        <span className="text-sm font-bold text-gray-900">Custom HTML</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Paste the script anywhere before your closing <code className="bg-gray-100 px-1 rounded text-[10px]">&lt;/body&gt;</code> tag on every page.
                      </p>
                    </div>
                  </div>
                </details>

                {/* Verification */}
                <div className="mb-6 p-5 bg-emerald-50/50 border border-emerald-100 rounded-2xl">
                  <h3 className="text-sm font-bold text-emerald-900 mb-2 flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4" />
                    3. Verify it's working
                  </h3>
                  <p className="text-xs text-emerald-800/80 leading-relaxed mb-3">
                    Open your website in a new tab after your developer finishes the install. You should see a chat bubble in the bottom-right corner within 2\u20133 seconds. Click it to test a message \u2014 the AI should respond using your tenant's settings. On mobile, tapping the "Text Us to Book" button should open your messaging app with the AI line pre-filled.
                  </p>
                  <p className="text-[11px] text-emerald-700/70 italic leading-relaxed">
                    \ud83d\udca1 Troubleshooting: if the widget doesn't appear, check the browser console for errors (F12). Most issues are caused by aggressive ad-blockers, HTTPS misconfigurations, or a missing <code className="bg-white/60 px-1 rounded">async</code> attribute.
                  </p>
                </div>

                {/* Click-to-Text Button \u2014 PROMOTED from "Bonus" to co-equal section */}
                <div className="bg-gradient-to-br from-emerald-50 to-emerald-50/30 border-2 border-emerald-200 rounded-2xl p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center">
                      <Phone className="w-5 h-5 text-emerald-600" />
                    </div>
                    <div>
                      <h4 className="font-bold text-emerald-900 flex items-center gap-2">
                        Click-to-Text Button
                        <span className="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest rounded-md">Mobile-First</span>
                      </h4>
                      <p className="text-xs text-emerald-800/70 font-medium">Website button that opens SMS app \u2192 messages route to your AI.</p>
                    </div>
                  </div>

                  <p className="text-sm text-gray-700 leading-relaxed mb-4">
                    Add a "Text Us to Book" button to your site. When a customer taps it on their phone, their messaging app opens pre-filled with a booking inquiry <strong>sent directly to your AI</strong>. The AI replies instantly, books appointments, and captures leads \u2014 just like the chat widget, but via SMS.
                  </p>

                  {/* How it works */}
                  <div className="mb-5 p-4 bg-white/70 border border-emerald-100 rounded-xl">
                    <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2">How it works</p>
                    <ol className="space-y-1.5 text-xs text-emerald-900">
                      <li className="flex gap-2"><span className="font-black text-emerald-600">1.</span> Customer taps "Text Us to Book" on your site (mobile)</li>
                      <li className="flex gap-2"><span className="font-black text-emerald-600">2.</span> Their messaging app opens with your AI's number pre-filled</li>
                      <li className="flex gap-2"><span className="font-black text-emerald-600">3.</span> The AI replies instantly and starts qualifying the lead</li>
                      <li className="flex gap-2"><span className="font-black text-emerald-600">4.</span> Conversation logs under Inbox \u2192 SMS in your dashboard</li>
                    </ol>
                  </div>

                  {/* Code snippet */}
                  <div className="space-y-2">
                    <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest">HTML snippet for your website</p>
                    {(() => {
                      const aiPhoneNumber =
                        phoneNumbers.find((p) => p.twilio_sid && p.is_primary)?.phone ||
                        phoneNumbers.find((p) => p.twilio_sid)?.phone ||
                        null;

                      if (!aiPhoneNumber) {
                        return (
                          <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl">
                            <div className="flex items-start gap-2">
                              <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                              <div>
                                <p className="text-xs font-bold text-amber-900 mb-1">AI phone number required</p>
                                <p className="text-[11px] text-amber-800 leading-relaxed">Set up an AI-provisioned phone line in the <strong>Phone & voice</strong> tab first. The Click-to-Text snippet will appear here automatically once your AI line is live.</p>
                              </div>
                            </div>
                          </div>
                        );
                      }

                      const snippet = `<a href="sms:${aiPhoneNumber}?&body=Hi%2C%20I%27d%20like%20to%20book%20an%20estimate" style="display:inline-block;padding:14px 28px;background:#10b981;color:#fff;font-weight:700;text-decoration:none;border-radius:12px;font-family:system-ui,sans-serif;box-shadow:0 4px 12px rgba(16,185,129,0.3);">\ud83d\udcac Text Us to Book</a>`;

                      return (
                        <div className="relative">
                          <code className="block p-4 pr-20 bg-white border border-emerald-100 rounded-xl text-[11px] font-mono text-gray-700 leading-relaxed break-all select-all">
                            {snippet}
                          </code>
                          <button
                            type="button"
                            onClick={() => {
                              navigator.clipboard.writeText(snippet);
                              success("Click-to-Text snippet copied!");
                            }}
                            className="absolute top-3 right-3 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest shadow-md transition-all active:scale-95"
                          >
                            Copy
                          </button>
                        </div>
                      );
                    })()}
                    <p className="text-[10px] text-gray-500 italic leading-relaxed pt-1">
                      \ud83d\udca1 The AI phone number is pulled from your primary AI line. Change it in the <strong>Phone & voice</strong> tab. Your developer can style or resize the button to match the site \u2014 the <code className="bg-gray-100 px-1 rounded text-[9px]">href</code> is the key.
                    </p>
                  </div>
                </div>
              </div>
      
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
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium focus:ring-4 focus:ring-slate-900/5 transition-all placeholder:text-slate-500"
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
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-slate-900/5 transition-all placeholder:text-slate-500"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Auth Token</label>
                        <input
                          type="password"
                          value={form.twilio_auth_token}
                          onChange={(e) => handleUpdateForm("twilio_auth_token", e.target.value)}
                          placeholder="••••••••••••••••"
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-slate-900/5 transition-all placeholder:text-slate-500"
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
                          className={`relative flex flex-col items-center gap-2 p-4 rounded-2xl border-2 transition-all text-center ${form.crm_type === crm.value
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
                        className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-slate-900/5 transition-all placeholder:text-slate-500"
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
                        className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-slate-900/5 transition-all placeholder:text-slate-500"
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
                      <div className="p-2 bg-white/50 border border-blue-100 rounded-lg font-mono text-[9px] text-blue-800 flex justify-between items-center">
                        <span>Authorization: Bearer <span className="font-bold text-blue-900">{tenant?.api_key || "Loading..."}</span></span>
                        <button
                          type="button"
                          onClick={() => {
                            if(tenant?.api_key) {
                              navigator.clipboard.writeText(tenant.api_key);
                              setMessage("API Key copied to clipboard!");
                            }
                          }}
                          className="px-2 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded text-[9px] font-bold transition-colors"
                        >
                          COPY KEY
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mt-4 p-6 bg-purple-50/50 border border-purple-100 rounded-2xl">
                    <h3 className="text-sm font-bold text-purple-900 mb-2 flex items-center gap-2">
                      <Bot className="w-4 h-4" />
                      Estimate Sent Webhook (Sales Recovery)
                    </h3>
                    <p className="text-xs text-purple-700/80 mb-4 leading-relaxed">
                      Use this URL in Zapier to notify our system when you send a proposal in your CRM (e.g. DripJobs). This automatically triggers the AI to chase the estimate.
                    </p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 p-3 bg-white border border-purple-200 rounded-xl font-mono text-[10px] text-purple-900 break-all select-all">
                        {`${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/estimate-sent`.replace(/\/+$/, "")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/estimate-sent`.replace(/\/+$/, "");
                          navigator.clipboard.writeText(url);
                          setMessage("Estimate Webhook URL copied to clipboard!");
                        }}
                        className="p-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors shadow-lg shadow-purple-600/20"
                        title="Copy to clipboard"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-4 space-y-2">
                      <p className="text-[10px] text-purple-600/70 font-bold uppercase tracking-wider">Required JSON Payload Body Key:</p>
                      <div className="p-2 bg-white/50 border border-purple-100 rounded-lg font-mono text-[9px] text-purple-800 flex justify-between items-center">
                        <span>"api_key": "<span className="font-bold text-purple-900">{tenant?.api_key || "Loading..."}</span>"</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Google Calendar */}
              <div className="pt-6 border-t border-gray-100">
                <div className="flex items-center justify-between gap-4 mb-2">
                  <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                    <GoogleCalendarIcon className="w-6 h-6" />
                    Google Calendar
                  </h2>
                  {form.google_calendar_linked ? (
                    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-700 rounded-full text-[10px] font-black tracking-widest border border-emerald-100 shadow-sm animate-pulse">
                      <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></span>
                      LIVE SYNC ACTIVE
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 px-3 py-1 bg-gray-50 text-gray-400 rounded-full text-[10px] font-black tracking-widest border border-gray-100 shadow-sm">
                      <span className="w-1.5 h-1.5 bg-gray-300 rounded-full"></span>
                      OFFLINE
                    </div>
                  )}
                </div>
                <p className="text-sm text-gray-500 mb-6 font-medium">Real-time availability sync and automated appointment scheduling.</p>

                <div className={`relative overflow-hidden rounded-3xl border-2 transition-all p-8 ${form.google_calendar_linked ? "bg-white border-emerald-100 shadow-xl shadow-emerald-500/5" : "bg-gray-50/50 border-dashed border-gray-200"}`}>
                  {form.google_calendar_linked && (
                    <div className="absolute top-0 right-0 p-8 opacity-[0.03] pointer-events-none">
                      <GoogleCalendarIcon className="w-32 h-32 rotate-12" />
                    </div>
                  )}

                  {form.google_calendar_linked ? (
                    <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
                      <div className="flex items-center gap-6">
                        <div className={`w-20 h-20 bg-white rounded-3xl shadow-xl border-2 flex items-center justify-center relative ${form.google_calendar_error === 'invalid_grant' ? 'border-red-100 bg-red-50/30' : 'border-emerald-100 bg-emerald-50/10'}`}>
                          <GoogleCalendarIcon className={`w-12 h-12 ${form.google_calendar_error === 'invalid_grant' ? 'opacity-40 grayscale' : ''}`} />
                          <div className={`absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full flex items-center justify-center border-4 border-white shadow-md ${form.google_calendar_error === 'invalid_grant' ? 'bg-red-500' : 'bg-emerald-500'} text-white`}>
                            {form.google_calendar_error === 'invalid_grant' ? <AlertCircle size={14} strokeWidth={3} /> : <CheckCircle2 size={14} strokeWidth={3} />}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1">
                          <h4 className={`text-xl font-black tracking-tight flex items-center gap-2 ${form.google_calendar_error === 'invalid_grant' ? 'text-red-600' : 'text-slate-900'}`}>
                            {form.google_calendar_error === "invalid_grant" ? "Connection Expired" : "Primary Calendar Connected"}
                          </h4>
                          {form.google_calendar_email && (
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border-2 transition-all w-fit ${form.google_calendar_error === 'invalid_grant' ? 'bg-red-50 border-red-100 text-red-600' : 'bg-slate-900 border-slate-800 text-white shadow-lg shadow-slate-200'}`}>
                              <Mail size={12} className={form.google_calendar_error === 'invalid_grant' ? 'text-red-400' : 'text-slate-400'} />
                              <span className="text-xs font-bold tracking-wide">{form.google_calendar_email}</span>
                            </div>
                          )}
                          <p className={`mt-1 text-[11px] font-bold flex items-center gap-2 uppercase tracking-[0.05em] ${form.google_calendar_error === 'invalid_grant' ? 'text-red-500' : 'text-slate-400'}`}>
                            {form.google_calendar_error === 'invalid_grant' ? (
                              <>
                                <AlertCircle size={12} />
                                Action Required: Re-connect to restore sync
                              </>
                            ) : (
                              <>
                                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-[pulse_2s_infinite]" />
                                Real-time availability sync active
                              </>
                            )}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-4 w-full md:w-auto">
                        {form.google_calendar_error === 'invalid_grant' && (
                          <button
                            type="button"
                            onClick={handleConnectCalendar}
                            className="flex-1 md:flex-none px-8 py-3.5 bg-red-600 text-white font-black text-[11px] uppercase tracking-[0.2em] rounded-2xl hover:bg-red-700 transition-all shadow-xl shadow-red-200 active:scale-95"
                          >
                            Reconnect
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={handleDisconnectCalendar}
                          className="flex-1 md:flex-none px-6 py-3.5 bg-white border-2 border-slate-100 text-slate-400 font-black text-[11px] uppercase tracking-[0.2em] rounded-2xl hover:text-red-600 hover:border-red-100 hover:bg-red-50 transition-all active:scale-95"
                        >
                          Disconnect
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col md:flex-row items-center justify-between gap-8 text-center md:text-left">
                      <div className="max-w-md">
                        <h4 className="text-lg font-bold text-gray-900 mb-2">Sync your business schedule</h4>
                        <p className="text-sm text-gray-500 leading-relaxed font-medium">
                          Connect your Google Calendar to allow the AI to check your real-time availability.
                          This prevents double bookings and ensures your customers only see times you are actually free.
                        </p>
                        <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-4">
                          <div className="flex items-center gap-2 text-[10px] font-bold text-emerald-600 uppercase tracking-tight bg-emerald-50 px-2 py-1 rounded-md">
                            <CheckCircle2 size={12} /> Real-time Sync
                          </div>
                          <div className="flex items-center gap-2 text-[10px] font-bold text-blue-600 uppercase tracking-tight bg-blue-50 px-2 py-1 rounded-md">
                            <CheckCircle2 size={12} /> Auto-Booking
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleConnectCalendar}
                        className="w-full md:w-auto px-10 py-4 bg-gray-900 text-white font-bold text-xs uppercase tracking-[0.2em] rounded-2xl hover:bg-black hover:scale-[1.02] active:scale-[0.98] transition-all shadow-xl shadow-gray-200 flex items-center justify-center gap-4 group"
                      >
                        <GoogleCalendarIcon className="w-5 h-5 group-hover:rotate-12 transition-transform" />
                        Connect Calendar
                      </button>
                    </div>
                  )}
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
                  {form.facebook_token_error === 'expired' && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 border-l-4 border-l-red-500 shadow-sm">
                      <AlertCircle className="w-5 h-5 text-red-600 mt-0.5 shrink-0" />
                      <div>
                        <h4 className="text-sm font-bold text-red-700">Facebook Session Expired</h4>
                        <p className="text-xs text-red-600 mt-1">
                          Your Page Access Token (Gladiator Painting) has expired. Meta requires tokens to be refreshed periodically. 
                          Generate a new token in Meta Developers and paste it below.
                        </p>
                      </div>
                    </div>
                  )}
                  <div>
                    <label className="block text-sm font-bold text-[#1877F2] mb-2 uppercase tracking-wide">Page ID</label>
                    <input
                      type="text"
                      value={form.facebook_page_id}
                      onChange={(e) => handleUpdateForm("facebook_page_id", e.target.value)}
                      placeholder="e.g. 123456789012345"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-[#1877F2]/5 placeholder:text-slate-500 transition-all font-bold"
                    />
                    <p className="text-xs text-gray-500 mt-1">Numeric ID of your Facebook Page (from Meta for Developers → Messenger → your Page).</p>
                  </div>
                  <div>
                    <label className="block text-sm font-bold text-[#1877F2] mb-2 uppercase tracking-wide">Page Access Token</label>
                    <input
                      type="password"
                      value={form.facebook_page_access_token}
                      onChange={(e) => handleUpdateForm("facebook_page_access_token", e.target.value)}
                      placeholder={form.facebook_token_masked ? "••••••••••••••••••••••••••••••••" : "Paste token from Meta App → Messenger → Access Tokens"}
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-[#1877F2]/5 placeholder:text-slate-500 transition-all font-bold"
                    />
                    <p className="text-xs text-gray-500 mt-1">Token with pages_messaging and pages_manage_metadata. Never share this token.</p>
                  </div>
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleFacebookSave}
                      disabled={saving}
                      className="w-full py-3 bg-[#1877F2] text-white rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-[#1164cc] transition-all disabled:opacity-50"
                    >
                      {saving ? <RefreshCw className="animate-spin w-4 h-4" /> : <Save className="w-4 h-4" />}
                      SAVE FACEBOOK SETTINGS
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
             {activeTab === "plans" && (
             <Plans tenantId={tenantId} />
          )}
          
           {activeTab === "billing" && (
           <Billing tenantId={tenantId} />
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

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
  X,
  ArrowRight,
  Crown,
  Copy as CopyIcon,
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
  Volume2,
  Palette,
  Image as ImageIcon,
  Building2,
  Shield,
  SlidersHorizontal,
  Power,
  PhoneForwarded,
  Mic,
  AlertTriangle,
  Calculator,
  MapPin,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════
// Max sizes for uploaded images. Logo is primary branding so gets 1MB.
// Favicon is tiny by nature (16x16 / 32x32 typical) but we share the
// same cap for simplicity — no tenant is realistically going to push
// a favicon near the limit.
// ═══════════════════════════════════════════════════════════════════
const MAX_IMAGE_BYTES = 1024 * 1024; // 1MB

// ═══════════════════════════════════════════════════════════════════
// WebhookGuideDrawer — reusable "How to connect" walkthrough
// Slides in from the right, shows field mapping + mock Zapier flow
// ═══════════════════════════════════════════════════════════════════
function WebhookGuideDrawer({ isOpen, onClose, webhook, onCopy }) {
  if (!webhook) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        className={`fixed inset-0 bg-black/50 backdrop-blur-sm z-40 transition-opacity duration-300 ${
          isOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />

      {/* Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-full max-w-xl bg-white shadow-2xl z-50 transform transition-transform duration-300 overflow-y-auto ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className={`sticky top-0 z-10 px-6 py-5 ${webhook.headerBg} border-b border-white/10 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <span className="text-2xl">{webhook.icon}</span>
            <div>
              <h2 className="text-lg font-black text-white tracking-tight">{webhook.title}</h2>
              <p className="text-xs text-white/70 font-medium">{webhook.subtitle}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 bg-white/10 hover:bg-white/20 rounded-xl text-white transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* What this does */}
          <section>
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2 flex items-center gap-2">
              🎯 What this Zap does
            </h3>
            <p className="text-sm text-gray-700 leading-relaxed">{webhook.purpose}</p>
          </section>

          {/* Fields to map */}
          <section>
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              📋 Fields to map in Zapier
            </h3>
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              In your Zapier "Webhooks by Zapier" action, map these exact field names in the JSON body to the DripJobs data (or your CRM's equivalent).
            </p>
            <div className="overflow-hidden rounded-xl border border-gray-200">
              <table className="w-full text-sm">
                <thead className={`${webhook.tableHeaderBg}`}>
                  <tr>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-white uppercase tracking-widest">Field Name</th>
                    <th className="px-4 py-2.5 text-left text-[10px] font-black text-white uppercase tracking-widest">Map From</th>
                  </tr>
                </thead>
                <tbody>
                  {webhook.fields.map((f, idx) => (
                    <tr key={idx} className={idx % 2 === 0 ? "bg-gray-50" : "bg-white"}>
                      <td className="px-4 py-3 font-mono text-xs font-bold text-gray-900">
                        "{f.name}"
                        {f.required && <span className="ml-1.5 text-[9px] font-black text-red-500 uppercase tracking-widest">Required</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600">{f.mapsFrom}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* Visual mockup of final Zap */}
          <section>
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              ✅ What a working Zap looks like
            </h3>
            <div className="p-5 bg-gray-50 border-2 border-dashed border-gray-200 rounded-2xl">
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest text-center mb-4">Your Zapier Flow</p>

              {/* Step 1 - Trigger */}
              <div className="flex items-stretch gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-xs font-black shrink-0">1</div>
                <div className="flex-1 p-3 bg-white border-2 border-orange-200 rounded-xl">
                  <p className="text-[10px] font-black text-orange-700 uppercase tracking-widest mb-1">Trigger</p>
                  <p className="text-sm font-bold text-gray-900">{webhook.mockup.trigger.app}</p>
                  <p className="text-xs text-gray-600">{webhook.mockup.trigger.event}</p>
                </div>
              </div>

              {/* Arrow down */}
              <div className="flex justify-center py-1">
                <ArrowRight className="w-5 h-5 text-gray-300 rotate-90" />
              </div>

              {/* Step 2 - Action */}
              <div className="flex items-stretch gap-3 mb-2">
                <div className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-xs font-black shrink-0">2</div>
                <div className="flex-1 p-3 bg-white border-2 border-purple-200 rounded-xl">
                  <p className="text-[10px] font-black text-purple-700 uppercase tracking-widest mb-1">Action</p>
                  <p className="text-sm font-bold text-gray-900">Webhooks by Zapier</p>
                  <p className="text-xs text-gray-600">POST → {webhook.url}</p>
                </div>
              </div>

              {/* Arrow down */}
              <div className="flex justify-center py-1">
                <ArrowRight className="w-5 h-5 text-gray-300 rotate-90" />
              </div>

              {/* Step 3 - Success */}
              <div className="flex items-stretch gap-3">
                <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center text-xs font-black shrink-0">3</div>
                <div className="flex-1 p-3 bg-emerald-50 border-2 border-emerald-200 rounded-xl">
                  <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-1">Expected Result</p>
                  <p className="text-sm font-bold text-emerald-900">✓ 200 OK — {webhook.mockup.outcome}</p>
                </div>
              </div>
            </div>
          </section>

          {/* Gotchas */}
          <section>
            <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              ⚠️ Common gotchas
            </h3>
            <ul className="space-y-2">
              {webhook.gotchas.map((g, idx) => (
                <li key={idx} className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
                  <span className="text-amber-500 shrink-0 mt-0.5">•</span>
                  <span className="text-xs text-amber-900 leading-relaxed">{g}</span>
                </li>
              ))}
            </ul>
          </section>

          {/* Quick access */}
          <section className="pt-4 border-t border-gray-100 space-y-2">
            <button
              type="button"
              onClick={() => onCopy(webhook.url, "Endpoint URL copied!")}
              className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition-colors text-left"
            >
              <div>
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">Endpoint URL</p>
                <p className="text-[11px] font-mono text-gray-700 break-all">{webhook.url}</p>
              </div>
              <CopyIcon className="w-4 h-4 text-gray-500 shrink-0 ml-3" />
            </button>
            <button
              type="button"
              onClick={() => onCopy(webhook.apiKey, "API key copied!")}
              className="w-full flex items-center justify-between p-3 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-xl transition-colors text-left"
            >
              <div>
                <p className="text-[10px] font-black text-gray-500 uppercase tracking-widest">API Key</p>
                <p className="text-[11px] font-mono text-gray-700 break-all">{webhook.apiKey || "Loading..."}</p>
              </div>
              <CopyIcon className="w-4 h-4 text-gray-500 shrink-0 ml-3" />
            </button>
          </section>
          {/* Close footer */}
          <div className="pt-4 border-t border-gray-100 flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3 bg-gray-900 text-white rounded-xl font-black text-xs uppercase tracking-widest hover:bg-gray-800 transition-colors"
            >
              Got It
            </button>
            <a
              href="https://zapier.com/app/dashboard"
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 py-3 bg-white border-2 border-gray-200 text-gray-700 rounded-xl font-black text-xs uppercase tracking-widest hover:border-gray-300 transition-colors flex items-center justify-center gap-2"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              Open Zapier
            </a>
          </div>
        </div>
      </div>
    </>
  );
}

const TENANT_STORAGE_KEY = "tenantId";

// ── Timezone options (Apr 23, 2026) ──────────────────────────────────
// Maps friendly names to IANA strings. IANA is what tenant.timezone expects
// and what the backend's isWithinBusinessHours() passes to Intl.DateTimeFormat.
// Arizona is its own entry because it stays on MST year-round (no DST).
const TIMEZONE_OPTIONS = [
  { value: "America/New_York",    label: "Eastern Time (ET)" },
  { value: "America/Chicago",     label: "Central Time (CT)" },
  { value: "America/Denver",      label: "Mountain Time (MT)" },
  { value: "America/Phoenix",     label: "Arizona (MST, no DST)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
];

/**
 * Best-effort browser timezone detection. Returns the IANA string the browser
 * reports, or null if it doesn't match one of our 5 supported US zones.
 * Used to auto-populate tenant.timezone on first save if it's null.
 */
function detectBrowserTimezone() {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONE_OPTIONS.some((o) => o.value === detected)) return detected;
    // Browser returned something we don't offer (e.g. America/Indiana/Indianapolis).
    // Caller falls back to null so the tenant keeps whatever they had.
    return null;
  } catch (_) {
    return null;
  }
}

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

// ═══════════════════════════════════════════════════════════════════
// Tabs — Phone & voice first, then Branding (new, 2nd), then rest.
// Nurturing hidden behind tenant.has_nurturing_referral flag below.
// ═══════════════════════════════════════════════════════════════════
const TABS = [
 { id: "numbers",      label: "Phone & voice",       icon: Phone      },
 { id: "branding",     label: "Branding",             icon: Palette    },
 { id: "ai",           label: "AI behavior",          icon: Bot        },
 { id: "knowledge",    label: "Knowledge base",       icon: BookOpen   },
 { id: "estimator",    label: "Estimator",            icon: Calculator },
 { id: "ai-control",   label: "AI Control",           icon: SlidersHorizontal },
 { id: "nurturing",    label: "Nurturing & referrals", icon: UserPlus  },
 { id: "integrations", label: "Integrations",         icon: LinkIcon   },
 { id: "plans",        label: "Plans",                icon: CreditCard },
 { id: "billing",      label: "Usage & Billing",      icon: BarChart3  },
];

// PHASE 7 — Plan tiers that include estimator addon by default
const ESTIMATOR_INCLUDED_PLANS = ["elite", "franchise", "hq_starter", "hq_growth", "hq_enterprise"];

export default function Settings({ tenantId }) {
  const { success, error: toastError } = useToast();
  const [tenant, setTenant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [activeTab, setActiveTab] = useState("numbers");

  // Webhook guide drawer state — null | "job-completed" | "estimate-sent"
  const [openGuide, setOpenGuide] = useState(null);

  // Form states
  const [form, setForm] = useState({
    // ── Branding (white-label) ────────────────────────────────
    company_name: "",
    brand_color: "#E8600A",
    accent_color: "",
    logo_url: "",
    favicon_url: "",
    support_email: "",
    // ──────────────────────────────────────────────────────────
    welcome_message: "",
    voice_welcome_message: "",
    chat_welcome_message: "",
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
    reengagement_touchpoints: [{ months: 12, header: "" }],
    // ── AI Control (mig 040, Apr 23 2026) ─────────────────────
    ai_master_enabled: true,
    ai_answers_after_hours: false,
    ring_first_enabled: false,
    ring_first_phone: "",
    ring_first_timeout_seconds: 20,
    voicemail_message_url: "",
    estimator_widget_enabled: false,
    estimator_pop_enabled: false,
    cost_region: null,
    cost_custom_percentage: null
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

   // ── Reseller-tab guard (Apr 28, 2026) ─────────────────────────────
  // The Usage & Billing tab is filtered out of the sidebar for resellers
  // (see TABS.filter() below), but if a reseller bookmarks /settings?tab=billing
  // or has the tab cached in localStorage, they'd land on a page rendering
  // wrong-tier billing data. Bounce them to "numbers" instead.
  useEffect(() => {
    if (tenant?.reseller_tier && activeTab === "billing") {
      setActiveTab("numbers");
    }
  }, [tenant?.reseller_tier, activeTab]);
  
  const loadTenant = async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const t = await getTenant(tenantId);
      setTenant(t);
      setForm({
        // Branding
        company_name: t.company_name || t.name || "",
        brand_color: t.brand_color || "#E8600A",
        accent_color: t.accent_color || "",
        logo_url: t.logo_url || "",
        favicon_url: t.favicon_url || "",
        support_email: t.support_email || "",
        // Everything else
        welcome_message: t.welcome_message || "",
        voice_welcome_message: t.voice_welcome_message || "",
        chat_welcome_message: t.chat_welcome_message || "",
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
        // ── AI Control (mig 040, Apr 23 2026) ─────────────────────
        // Null-safe defaults: new tenants pre-migration will have
        // undefined, so we fall back to "AI fully on, no ring-first."
        ai_master_enabled: t.ai_master_enabled !== false, // default true
        ai_answers_after_hours: t.ai_answers_after_hours === true,
        ring_first_enabled: t.ring_first_enabled === true,
        ring_first_phone: t.ring_first_phone || "",
        ring_first_timeout_seconds: t.ring_first_timeout_seconds || 20,
        voicemail_message_url: t.voicemail_message_url || "",
         estimator_widget_enabled: t.estimator_widget_enabled === true,
        estimator_pop_enabled: t.estimator_pop_enabled === true,
        cost_region: t.cost_region || null,
        cost_custom_percentage: t.cost_custom_percentage ?? null
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

  // ═══════════════════════════════════════════════════════════════════
  // Webhook guide configurations — reused by WebhookGuideDrawer
  // ═══════════════════════════════════════════════════════════════════
  const webhookGuides = {
    "job-completed": {
      title: "Revenue Pipeline",
      subtitle: "Job Won / Completed → Revenue Tracking",
      icon: "💰",
      headerBg: "bg-gradient-to-r from-emerald-600 to-emerald-700",
      tableHeaderBg: "bg-emerald-600",
      purpose: "When DripJobs marks a job as Won or Completed, this Zap sends us the revenue so it lands on your Confirmed Revenue tile. Any active AI recovery sequence for that contact is marked converted, and post-service nurturing (review requests, seasonal campaigns) kicks off automatically.",
      url: `${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/job-completed`.replace(/\/+$/, ""),
      apiKey: tenant?.api_key,
      authMethod: "header",
      fields: [
        { name: "api_key", mapsFrom: "Your API key (set in Authorization header as 'Bearer <key>')", required: true },
        { name: "contact_phone", mapsFrom: "Job → Contact → Phone", required: true },
        { name: "contact_name", mapsFrom: "Job → Contact → Full Name", required: false },
        { name: "grand_total", mapsFrom: "Job → Grand Total (in dollars, e.g. 4500.00)", required: true },
        { name: "job_completed_at", mapsFrom: "Job → Won Date or Completed Date", required: false },
      ],
      mockup: {
        trigger: { app: "DripJobs", event: "Trigger: Job Won (or Job Completed)" },
        outcome: "Revenue appears on dashboard within 30 seconds",
      },
      gotchas: [
        "If Confirmed Revenue shows $0 → check that grand_total maps to a dollar value (e.g. 4500.00), NOT cents (450000). The system also accepts actual_revenue_cents if you prefer integer cents.",
        "If nothing fires at all → verify the Zap is toggled ON in Zapier, and that the DripJobs trigger filter matches the job status you actually use (some tenants customize 'Won' vs 'Completed').",
        "If duplicate revenue appears → make sure you're only using ONE of Job Won OR Job Completed as the trigger, not both.",
        "If 401 Unauthorized → the API key rotated. Copy the fresh key from this drawer and update your Zapier Authorization header.",
      ],
    },
    "estimate-sent": {
      title: "AI Sales Recovery",
      subtitle: "Estimate Sent → 21-Day Follow-Up",
      icon: "🤖",
      headerBg: "bg-gradient-to-r from-purple-600 to-purple-700",
      tableHeaderBg: "bg-purple-600",
      purpose: "When you send a proposal in DripJobs, this Zap kicks off a 21-day AI follow-up sequence. The AI texts, calls, and leaves voicemails at scientifically-spaced intervals (days 0, 1, 3, 5, 7, 10, 14, 17, 21) to recover the estimate if the prospect goes cold. If they book elsewhere or convert, the sequence auto-stops.",
      url: `${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/estimate-sent`.replace(/\/+$/, ""),
      apiKey: tenant?.api_key,
      authMethod: "body",
      fields: [
        { name: "api_key", mapsFrom: "Your API key (inside JSON body, not header)", required: true },
        { name: "contact_phone", mapsFrom: "Job → Contact → Phone", required: true },
        { name: "contact_name", mapsFrom: "Job → Contact → Full Name", required: false },
        { name: "contact_email", mapsFrom: "Job → Contact → Email", required: false },
        { name: "grand_total", mapsFrom: "Job → Estimate Amount (optional, informational only)", required: false },
      ],
      mockup: {
        trigger: { app: "DripJobs", event: "Trigger: Proposal Sent / Estimate Created" },
        outcome: "AI recovery sequence starts within 2 minutes",
      },
      gotchas: [
        "API key goes in the JSON BODY (not the Authorization header) for this endpoint. This is different from the Revenue Pipeline Zap — easy to mix up.",
        "Phone number MUST be a valid US number in E.164 format (+14025551234). Zapier Formatter can convert dashed numbers if needed.",
        "If the sequence doesn't start → check your Conversations tab for the contact. A sequence already in progress for that number won't duplicate.",
        "To manually cancel a sequence → mark the estimate as converted or declined in DripJobs, and set up a complementary Zap pointing to /webhooks/sales/stop to cleanly close it.",
      ],
    },
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

  // ═══════════════════════════════════════════════════════════════════
  // Image upload handler — shared by Logo and Favicon uploaders.
  // Reads file → base64 → writes into form field. Validates size/type.
  // ═══════════════════════════════════════════════════════════════════
  const handleImageUpload = (field, file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toastError("Please upload a valid image file.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toastError("Image too large (max 1MB). Try compressing it first.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => handleUpdateForm(field, reader.result || "");
    reader.onerror = () => toastError("Failed to read image file.");
    reader.readAsDataURL(file);
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

    // Basic email validation for support_email — only sent if non-empty.
    const supportEmailTrimmed = form.support_email.trim();
    if (supportEmailTrimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmailTrimmed)) {
      toastError("Support email doesn't look valid. Leave blank to use the default.");
      setSaving(false);
      return;
    }
// ── Timezone auto-detect (Apr 23, 2026) ──────────────────────────
    // If the tenant doesn't have a timezone saved yet, silently detect
    // the browser's timezone and include it in the PATCH. Handles the
    // 99% case where the owner sets up their dashboard from their own
    // business location. If the browser reports a timezone we don't
    // support (e.g. America/Indiana/Indianapolis), we skip this step
    // and leave timezone null — they can set it manually in Branding.
    let autoDetectedTimezone = null;
    if (!tenant?.timezone) {
      autoDetectedTimezone = detectBrowserTimezone();
      if (autoDetectedTimezone) {
        console.log("[Settings] Auto-detected timezone:", autoDetectedTimezone);
      }
    }
    // PHASE 7 — validate cost_custom_percentage when cost_region is "custom"
    if (form.cost_region === "custom") {
      const cp = Number(form.cost_custom_percentage);
      if (!Number.isFinite(cp) || cp < -50 || cp > 100) {
        toastError("Custom percentage must be between -50 and +100.");
        setSaving(false);
        return;
      }
    }
    const payload = {
      // Branding
      company_name: form.company_name.trim() || null,
      brand_color: form.brand_color || "#E8600A",
      accent_color: form.accent_color.trim() || null,
      logo_url: form.logo_url || null,
      favicon_url: form.favicon_url || null,
      support_email: supportEmailTrimmed || null,
      // Everything else
      welcome_message: form.welcome_message || null,
      voice_welcome_message: form.voice_welcome_message.trim() || null,
      chat_welcome_message: form.chat_welcome_message.trim() || null,
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
      reengagement_touchpoints: form.reengagement_touchpoints,
      // ── AI Control (mig 040, Apr 23 2026) ─────────────────────
      ai_master_enabled: form.ai_master_enabled,
      ai_answers_after_hours: form.ai_answers_after_hours,
      ring_first_enabled: form.ring_first_enabled,
      ring_first_phone: form.ring_first_phone.trim() || null,
      ring_first_timeout_seconds: form.ring_first_timeout_seconds,
      voicemail_message_url: form.voicemail_message_url.trim() || null,
      estimator_widget_enabled: form.estimator_widget_enabled,
      estimator_pop_enabled: form.estimator_pop_enabled,
      cost_region: form.cost_region || null,
      cost_custom_percentage: form.cost_region === "custom" ? form.cost_custom_percentage : null
    };

    if (form.facebook_page_access_token) payload.facebook_page_access_token = form.facebook_page_access_token;
    if (form.twilio_account_sid.trim()) payload.twilio_account_sid = form.twilio_account_sid.trim();
    if (form.twilio_auth_token) payload.twilio_auth_token = form.twilio_auth_token;

    try {
     const updated = await updateTenant(tenantId, payload);
      // Merge instead of replace — backend may return only the updated fields,
      // which would wipe out unchanged fields like timezone from local state.
      setTenant((prev) => ({ ...prev, ...updated }));
      success("Settings saved successfully.");
      setMessage("Settings saved successfully.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      if (e.message && /413/i.test(e.message)) {
        toastError("Image too large. Please upload a smaller logo or favicon.");
        setError("Image too large. Please upload a smaller logo or favicon.");
      } else {
        toastError(`Save failed: ${e.message}`);
        setError(e.message);
      }
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
            {TABS.filter((tab) => {
              // Nurturing is gated behind a feature flag (existing logic)
              if (tab.id === "nurturing" && !tenant?.has_nurturing_referral) return false;
              // Apr 28, 2026: Usage & Billing hidden for resellers — they see
              // network-wide usage on /reseller via ResellerUsageCard with
              // correct reseller-tier rates ($0.15/min vs $0.30/min Basic).
              if (tab.id === "billing" && tenant?.reseller_tier) return false;
               if (tab.id === "estimator" && tenant?.reseller_tier) return false;
              if (tab.id === "estimator" &&
                  !tenant?.estimator_addon_purchased &&
                  !ESTIMATOR_INCLUDED_PLANS.includes(tenant?.plan)) return false;
              return true;
            }).map((tab) => (
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
                            <Zap size={120} />
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

          {activeTab === "branding" && (
            <div className="space-y-10 max-w-4xl">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1 flex items-center gap-2">
                  <Palette className="text-primary w-5 h-5" />
                  Branding
                </h2>
                <p className="text-sm text-gray-500 mb-6 leading-relaxed">
                  Make this dashboard look like your business. Your logo, company name, and brand color appear in the sidebar, header, browser tab, and emails sent to your customers.
                </p>
              </div>

              {/* ── Company identity ────────────────────────────────────── */}
              <section className="space-y-6">
                <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                  <Building2 className="w-3.5 h-3.5" />
                  Company identity
                </h3>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Company name</label>
                  <input
                    type="text"
                    value={form.company_name}
                    onChange={(e) => handleUpdateForm("company_name", e.target.value)}
                    placeholder="e.g. Gladiators Painting"
                    className="w-full md:max-w-md px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:ring-4 focus:ring-primary/5 transition-all outline-none placeholder:text-slate-500"
                  />
                  <p className="text-xs text-gray-500 mt-2">Appears in the sidebar, header, browser tab, and in emails sent to your customers.</p>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Support email</label>
                  <input
                    type="email"
                    value={form.support_email}
                    onChange={(e) => handleUpdateForm("support_email", e.target.value)}
                    placeholder="support@yourcompany.com"
                    className="w-full md:max-w-md px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-sm focus:ring-4 focus:ring-primary/5 transition-all outline-none placeholder:text-slate-500"
                  />
                  <p className="text-xs text-gray-500 mt-2">Used in email footers ("Reply to this email or contact..."). Leave blank to use the AI Front Desk Helper default.</p>
                </div>

                {/* ── Timezone picker (Apr 23, 2026) ──────────────────── */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Timezone</label>
                  <select
                    value={tenant?.timezone || ""}
                    onChange={(e) => {
                      const newTz = e.target.value;
                      if (!newTz) return;
                      updateTenant(tenantId, { timezone: newTz })
                        .then(() => {
                          setTenant((prev) => prev ? { ...prev, timezone: newTz } : prev);
                          success("Timezone updated.");
                        })
                        .catch((err) => toastError(`Failed to update timezone: ${err.message}`));
                    }}
                    className="w-full md:max-w-md px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-medium text-sm focus:ring-4 focus:ring-primary/5 transition-all outline-none cursor-pointer"
                  >
                    {!tenant?.timezone && <option value="">(not set — save once to auto-detect)</option>}
                    {TIMEZONE_OPTIONS.map((tz) => (
                      <option key={tz.value} value={tz.value}>
                        {tz.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-2">
                    Affects call routing, nurturing schedules, and daily reports.
                    {tenant?.timezone
                      ? ` Currently: ${tenant.timezone}.`
                      : " We'll auto-detect this from your browser on your first save."}
                  </p>
                </div>
              </section>

              {/* ── Visual assets ───────────────────────────────────────── */}
              <section className="space-y-6 pt-8 border-t border-gray-100">
                <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                  <ImageIcon className="w-3.5 h-3.5" />
                  Visual assets
                </h3>

                {/* Logo uploader */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Logo</label>
                  <div className="flex items-center gap-4">
                    <div className="relative shrink-0">
                      <div className="w-20 h-20 rounded-2xl bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center">
                        {form.logo_url ? (
                          <img src={form.logo_url} alt="Logo" className="w-full h-full object-contain" />
                        ) : (
                          <Building2 className="w-8 h-8 text-slate-400" />
                        )}
                      </div>
                      {form.logo_url && (
                        <button
                          type="button"
                          onClick={() => handleUpdateForm("logo_url", "")}
                          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center hover:bg-slate-700 shadow transition-colors"
                          title="Remove logo"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        id="branding-logo-upload"
                        className="hidden"
                        onChange={(e) => {
                          handleImageUpload("logo_url", e.target?.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                      <label
                        htmlFor="branding-logo-upload"
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-slate-900 hover:bg-black rounded-xl cursor-pointer shadow-sm transition-colors"
                      >
                        {form.logo_url ? "Change logo" : "Upload logo"}
                      </label>
                      <p className="text-xs text-gray-500 mt-2">PNG or SVG recommended. Max 1MB.</p>
                    </div>
                  </div>
                </div>

                {/* Favicon uploader */}
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Favicon</label>
                  <div className="flex items-center gap-4">
                    <div className="relative shrink-0">
                      <div className="w-12 h-12 rounded-lg bg-slate-100 border-2 border-slate-200 overflow-hidden flex items-center justify-center">
                        {form.favicon_url ? (
                          <img src={form.favicon_url} alt="Favicon" className="w-full h-full object-contain" />
                        ) : (
                          <Globe className="w-5 h-5 text-slate-400" />
                        )}
                      </div>
                      {form.favicon_url && (
                        <button
                          type="button"
                          onClick={() => handleUpdateForm("favicon_url", "")}
                          className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-slate-800 text-white flex items-center justify-center hover:bg-slate-700 shadow transition-colors"
                          title="Remove favicon"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        id="branding-favicon-upload"
                        className="hidden"
                        onChange={(e) => {
                          handleImageUpload("favicon_url", e.target?.files?.[0]);
                          e.target.value = "";
                        }}
                      />
                      <label
                        htmlFor="branding-favicon-upload"
                        className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-bold text-white bg-slate-900 hover:bg-black rounded-xl cursor-pointer shadow-sm transition-colors"
                      >
                        {form.favicon_url ? "Change favicon" : "Upload favicon"}
                      </label>
                      <p className="text-xs text-gray-500 mt-2">Tiny icon in the browser tab. Square PNG, 32×32 or 64×64. Max 1MB.</p>
                    </div>
                  </div>
                </div>
              </section>

              {/* ── Colors ──────────────────────────────────────────────── */}
              <section className="space-y-6 pt-8 border-t border-gray-100">
                <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest flex items-center gap-2">
                  <Palette className="w-3.5 h-3.5" />
                  Colors
                </h3>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Brand color</label>
                  <div className="flex items-center gap-4 flex-wrap">
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
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Primary color used across the dashboard — sidebar active states, buttons, the chat widget on your website, and branded accents throughout the app.</p>
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2 uppercase tracking-wide">Accent color <span className="text-gray-400 font-medium normal-case ml-1">(optional)</span></label>
                  <div className="flex items-center gap-4 flex-wrap">
                    <input
                      type="color"
                      value={form.accent_color || form.brand_color || "#E8600A"}
                      onChange={(e) => handleUpdateForm("accent_color", e.target.value)}
                      className="w-12 h-10 rounded-lg border border-slate-200 cursor-pointer p-1"
                    />
                    <input
                      type="text"
                      value={form.accent_color}
                      onChange={(e) => handleUpdateForm("accent_color", e.target.value)}
                      placeholder="Leave blank to use brand color"
                      className="w-64 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-primary/5 transition-all outline-none placeholder:text-slate-500"
                    />
                    {form.accent_color && (
                      <>
                        <div
                          className="w-10 h-10 rounded-xl border border-slate-200 shadow-sm"
                          style={{ background: form.accent_color }}
                        />
                        <button
                          type="button"
                          onClick={() => handleUpdateForm("accent_color", "")}
                          className="text-xs font-bold text-gray-500 hover:text-gray-800 transition-colors"
                        >
                          Clear
                        </button>
                      </>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 mt-2">Secondary color for links and hover states. If left blank, we derive a shade from your brand color automatically.</p>
                </div>
              </section>

              {/* ── Custom domain (Phase 2 preview) ─────────────────────── */}
              <section className="pt-8 border-t border-gray-100">
                <h3 className="text-sm font-black text-gray-500 uppercase tracking-widest flex items-center gap-2 mb-4">
                  <Globe className="w-3.5 h-3.5" />
                  Custom domain
                </h3>
                {tenant?.brand_mode === "white_label" ? (
                  <div className="p-5 bg-slate-50/60 border-2 border-dashed border-slate-200 rounded-2xl flex items-start gap-4">
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                      <Globe className="w-5 h-5 text-slate-400" />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="text-sm font-black text-gray-700">Use your own domain</h4>
                        <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-widest rounded-md border border-amber-200">
                          Coming Soon
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 leading-relaxed mb-3">
                        Host your dashboard on your own domain (e.g. <span className="font-mono bg-white px-1.5 py-0.5 rounded">app.{form.company_name ? form.company_name.toLowerCase().replace(/[^a-z0-9]/g, "") : "yourcompany"}.com</span>) so your team and customers interact with a fully branded experience. Includes a branded login page.
                      </p>
                      <input
                        type="text"
                        value=""
                        disabled
                        placeholder={`app.${form.company_name ? form.company_name.toLowerCase().replace(/[^a-z0-9]/g, "") : "yourcompany"}.com`}
                        className="w-full md:max-w-sm px-4 py-2.5 bg-white/50 border border-slate-200 rounded-xl font-mono text-xs placeholder:text-slate-400 cursor-not-allowed opacity-60"
                      />
                      <p className="text-[11px] text-slate-400 mt-2 italic">Included with your plan. We'll email you when it's live and walk you through the DNS setup.</p>
                    </div>
                  </div>
                ) : (
                  <div className="relative overflow-hidden p-5 bg-gradient-to-br from-amber-50 via-white to-amber-50/30 border-2 border-amber-200 rounded-2xl flex items-start gap-4">
                    <div className="absolute top-0 right-0 -mt-4 -mr-4 w-32 h-32 bg-amber-400 blur-[80px] opacity-20 rounded-full pointer-events-none"></div>
                    <div className="relative z-10 w-10 h-10 rounded-xl bg-white border border-amber-200 flex items-center justify-center shrink-0 shadow-sm">
                      <Globe className="w-5 h-5 text-amber-600" />
                    </div>
                    <div className="relative z-10 flex-1">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h4 className="text-sm font-black text-gray-800">Use your own domain</h4>
                        <span className="px-2 py-0.5 bg-amber-600 text-white text-[9px] font-black uppercase tracking-widest rounded-md shadow-sm">
                          Elite Feature
                        </span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed mb-3">
                        Host your dashboard on your own domain (e.g. <span className="font-mono bg-white px-1.5 py-0.5 rounded border border-amber-100">app.yourcompany.com</span>) and remove all third-party branding from your team and customer experience. Includes a fully branded login page.
                      </p>
                      <div className="flex items-center gap-3 flex-wrap">
                        <Link
                          to="/plans"
                          className="inline-flex items-center gap-2 px-4 py-2 bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-amber-700 shadow-md shadow-amber-600/20 transition-all"
                        >
                          <Crown className="w-3.5 h-3.5" />
                          Upgrade to Elite
                        </Link>
                        <span className="text-[11px] text-amber-800/70 italic">Full white-label branding + custom domain included</span>
                      </div>
                    </div>
                  </div>
                )}
              </section>
            </div>
          )}

          {activeTab === "ai" && (
            <div className="space-y-8 max-w-4xl">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
                  <Bot className="text-primary w-5 h-5" />
                  AI Receptionist Behavior
                </h2>
                <p className="text-sm text-gray-500 mb-6 italic">
                  Brand appearance settings (logo, colors, company name) have moved to the <strong>Branding</strong> tab for easier access.
                </p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
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
                 {/* ──────────────────────────────────────────────────────────────────
                      Welcome messages (voice + chat). Apr 21, 2026: split from a single
                      field into two channel-specific fields. Voice gets injected into
                      OpenAI Realtime instructions (no robotic Twilio Polly anymore).
                      Chat is shown as the opening message in the website widget.
                     ─────────────────────────────────────────────────────────────────── */}
                  <div className="col-span-2 space-y-4 p-5 bg-blue-50/30 border border-blue-100/50 rounded-xl">
                    {/* Section header + AI-voice differentiator callout */}
                    <div>
                      <div className="flex items-start gap-3 mb-2">
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center">
                          <MessageSquare className="w-4 h-4 text-blue-600" />
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-black text-gray-700 uppercase tracking-wide">Welcome messages</h3>
                          <p className="text-xs text-gray-500 leading-relaxed mt-0.5">
                            Different channels, different greetings. Voice should be short and conversational; the chat widget can be longer with emoji.
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 px-3 py-2 bg-white border border-blue-100 rounded-lg">
                        <span className="text-[10px] font-black text-emerald-600 uppercase tracking-widest shrink-0">Powered by your AI voice</span>
                        <span className="text-[10px] text-gray-500 leading-relaxed">
                          — greetings are spoken in the natural OpenAI voice you selected, not a robotic Twilio Polly TTS.
                        </span>
                      </div>
                    </div>

                    {/* Voice Greeting */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide flex items-center gap-2">
                        <Mic2 className="w-3.5 h-3.5 text-primary" />
                        Voice greeting
                        <span className="text-[9px] font-medium text-gray-400 normal-case tracking-normal ml-1">spoken by AI on phone calls</span>
                      </label>
                      <textarea
                        value={form.voice_welcome_message}
                        onChange={(e) => handleUpdateForm("voice_welcome_message", e.target.value)}
                        rows={2}
                        maxLength={200}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-primary/5 transition-all outline-none font-medium placeholder:text-slate-500 text-sm"
                        placeholder="e.g. Thanks for calling Gladiators Painting. How can I help you today?"
                      />
                      <p className="text-[10px] text-gray-500 mt-1.5 italic leading-relaxed">
                        Spoken by the <strong className="text-gray-700 not-italic">AI in your selected voice</strong> (e.g. Ash, Shimmer) — <strong className="text-gray-700 not-italic">not</strong> a robotic Twilio voice. Keep it short, 6 to 12 words. Avoid emoji or formatting. <strong className="text-gray-700 not-italic">Leave blank</strong> if you'd rather the AI greet naturally without a scripted opener.
                      </p>
                    </div>

                    {/* Chat Widget Greeting */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1.5 uppercase tracking-wide flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5 text-primary" />
                        Chat widget greeting
                        <span className="text-[9px] font-medium text-gray-400 normal-case tracking-normal ml-1">shown when website chat opens</span>
                      </label>
                      <textarea
                        value={form.chat_welcome_message}
                        onChange={(e) => handleUpdateForm("chat_welcome_message", e.target.value)}
                        rows={3}
                        maxLength={500}
                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-4 focus:ring-primary/5 transition-all outline-none font-medium placeholder:text-slate-500 text-sm"
                        placeholder="e.g. Hi there 👋 Need a quick estimate or have a question? I can help you schedule in seconds."
                      />
                      <p className="text-[10px] text-gray-500 mt-1.5 italic leading-relaxed">
                        Shown when visitors open the chat bubble on your website. Can be longer — emoji and casual tone work great here since it's read, not spoken. <strong className="text-gray-700 not-italic">Leave blank</strong> to use a friendly default greeting.
                      </p>
                    </div>
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

          {activeTab === "ai-control" && (
            <div className="space-y-10 animate-in fade-in slide-in-from-right-4 duration-500">

              {/* ── Tab header ───────────────────────────────────── */}
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <SlidersHorizontal className="text-primary w-5 h-5" />
                  AI Control
                </h2>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-2xl">
                  Control when and how your AI answers calls. Master kill-switch,
                  calling hours, ring-first handoff, and voicemail — all in one place.
                </p>
              </div>

              {/* ── 1. Master AI toggle (dark hero card) ──────────── */}
              <section className={`relative overflow-hidden rounded-3xl p-8 transition-all border-2 ${
                form.ai_master_enabled
                  ? "bg-slate-900 border-slate-900 shadow-2xl shadow-slate-900/20"
                  : "bg-red-950 border-red-800 shadow-2xl shadow-red-900/20"
              }`}>
                <div className="absolute top-0 right-0 p-8 opacity-[0.06] pointer-events-none">
                  <Power className="w-32 h-32" />
                </div>
                <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                      form.ai_master_enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-red-500/20 text-red-300"
                    }`}>
                      <Power className="w-6 h-6" strokeWidth={2.5} />
                    </div>
                    <div>
                      <h3 className="text-lg font-black text-white tracking-tight mb-1 flex items-center gap-2">
                        AI Assistant
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                          form.ai_master_enabled
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                            : "bg-red-500/30 text-red-200 border border-red-400/40"
                        }`}>
                          {form.ai_master_enabled ? "Live" : "Off"}
                        </span>
                      </h3>
                      <p className="text-sm text-slate-300 leading-relaxed max-w-lg">
                        {form.ai_master_enabled
                          ? "Your AI is answering calls based on the rules below."
                          : "AI is off. Incoming calls ring your ring-first or transfer number, then fall through to voicemail."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUpdateForm("ai_master_enabled", !form.ai_master_enabled)}
                    className={`relative w-16 h-9 rounded-full transition-colors shrink-0 ${
                      form.ai_master_enabled ? "bg-emerald-500" : "bg-red-500"
                    }`}
                    aria-pressed={form.ai_master_enabled}
                    aria-label="Toggle AI assistant"
                  >
                    <div
                      className={`absolute top-1 w-7 h-7 rounded-full bg-white shadow-lg transition-transform ${
                        form.ai_master_enabled ? "translate-x-8" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>

                {/* Setup sanity check — if AI is off AND no human destination */}
                {!form.ai_master_enabled &&
                 !form.ring_first_phone.trim() &&
                 !(form.transfer_numbers_raw && form.transfer_numbers_raw.trim()) && (
                  <div className="relative z-10 mt-5 p-4 bg-red-500/20 border border-red-400/30 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-300 shrink-0 mt-0.5" />
                    <div className="text-xs text-red-100 leading-relaxed">
                      <strong className="font-bold">Heads up:</strong> You have no ring-first phone or transfer number configured.
                      With AI off, every call will go straight to voicemail. Add a transfer number in the
                      <strong> Integrations → Voice &amp; SMS</strong> tab, or enable ring-first below.
                    </div>
                  </div>
                )}
              </section>

              {/* ── 2. Your calling hours (BH jsonb editor) ──────── */}
              <section>
                <div className="flex items-center justify-between flex-wrap gap-4 mb-4">
                  <div>
                    <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                      <Clock className="w-4 h-4 text-primary" />
                      Your calling hours
                    </h3>
                    <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-xl">
                      When is someone at your business ready to take calls? The AI uses
                      these hours to decide what's "business hours" vs "after hours."
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab("branding")}
                    className="px-3 py-1.5 bg-primary/10 hover:bg-primary/15 rounded-xl transition-colors cursor-pointer group"
                    title="Change timezone in Branding tab"
                  >
                    <span className="text-xs font-bold text-primary flex items-center gap-1.5">
                      {tenant?.timezone || "Set timezone →"}
                      <span className="text-[10px] opacity-0 group-hover:opacity-60 transition-opacity">
                        edit
                      </span>
                    </span>
                  </button>
                </div>

                <div className="bg-gray-50 rounded-2xl p-6 border border-gray-100">
                  <div className="space-y-4">
                    {(() => {
                      // Sort days Sunday → Saturday. Object.entries() returns
                      // keys in insertion order, which depends on when the
                      // business_hours jsonb was seeded — not guaranteed to
                      // be Sun→Sat. This IIFE re-orders for display.
                      const DAY_ORDER = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
                      return DAY_ORDER
                        .filter((day) => form.business_hours[day])
                        .map((day) => [day, form.business_hours[day]]);
                    })().map(([day, config]) => (
                    
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
              </section>

              {/* ── 3. When AI answers (24/7 vs after-hours only) ── */}
              <section className={`pt-2 ${!form.ai_master_enabled ? "opacity-40 pointer-events-none" : ""}`}>
                <div className="mb-4">
                  <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Bot className="w-4 h-4 text-primary" />
                    When should AI answer?
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-xl">
                    Choose whether AI handles every call, or only after your calling hours
                    end so you can pick up during the day.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => handleUpdateForm("ai_answers_after_hours", false)}
                    className={`relative flex items-start gap-3 p-5 rounded-2xl border-2 transition-all text-left ${
                      !form.ai_answers_after_hours
                        ? "border-gray-900 bg-gray-900 text-white shadow-lg scale-[1.01]"
                        : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      !form.ai_answers_after_hours ? "bg-emerald-500/20 text-emerald-300" : "bg-white text-gray-400"
                    }`}>
                      <Bot className="w-5 h-5" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-black uppercase tracking-wide">AI answers 24/7</h4>
                        {!form.ai_answers_after_hours && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>
                      <p className={`text-xs leading-relaxed ${!form.ai_answers_after_hours ? "text-slate-300" : "text-gray-500"}`}>
                        Every call is answered by AI, regardless of time of day. Best for
                        maximum lead capture.
                      </p>
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => handleUpdateForm("ai_answers_after_hours", true)}
                    className={`relative flex items-start gap-3 p-5 rounded-2xl border-2 transition-all text-left ${
                      form.ai_answers_after_hours
                        ? "border-gray-900 bg-gray-900 text-white shadow-lg scale-[1.01]"
                        : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                    }`}
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      form.ai_answers_after_hours ? "bg-emerald-500/20 text-emerald-300" : "bg-white text-gray-400"
                    }`}>
                      <Clock className="w-5 h-5" strokeWidth={2.5} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-black uppercase tracking-wide">After-hours only</h4>
                        {form.ai_answers_after_hours && (
                          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                        )}
                      </div>
                      <p className={`text-xs leading-relaxed ${form.ai_answers_after_hours ? "text-slate-300" : "text-gray-500"}`}>
                        AI only answers outside your calling hours. During the day,
                        calls go to voicemail so you can pick up.
                      </p>
                    </div>
                  </button>
                </div>
              </section>

              {/* ── 4. Ring-first handoff ──────────────────────────── */}
              <section className={`pt-4 border-t border-gray-100 ${!form.ai_master_enabled ? "opacity-60" : ""}`}>
                <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                      <PhoneForwarded className="w-4 h-4 text-primary" />
                      Ring-first handoff
                    </h3>
                    <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-xl">
                      Ring a human's number first. If they don't pick up within the timeout,
                      the call falls through to {form.ai_master_enabled ? "AI (or voicemail if AI is off)" : "voicemail"}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const next = !form.ring_first_enabled;
                      // Smart autofill: when enabling for the first time and no
                      // phone is set yet, pre-populate from transfer_numbers[0]
                      // if available (matches memory #29 decision).
                      if (next && !form.ring_first_phone.trim() && form.transfer_numbers_raw) {
                        const firstTransfer = form.transfer_numbers_raw
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)[0];
                        if (firstTransfer) {
                          handleUpdateForm("ring_first_phone", firstTransfer);
                        }
                      }
                      handleUpdateForm("ring_first_enabled", next);
                    }}
                    className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${
                      form.ring_first_enabled ? "bg-gray-900" : "bg-gray-300"
                    }`}
                    aria-pressed={form.ring_first_enabled}
                    aria-label="Toggle ring-first"
                  >
                    <div
                      className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                        form.ring_first_enabled ? "translate-x-5" : "translate-x-0.5"
                      }`}
                    />
                  </button>
                </div>

                {form.ring_first_enabled && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 animate-in fade-in slide-in-from-top-2 duration-300">
                    <div className="md:col-span-2">
                      <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-2">
                        Phone to ring
                      </label>
                      <input
                        type="tel"
                        value={form.ring_first_phone}
                        onChange={(e) => handleUpdateForm("ring_first_phone", e.target.value)}
                        placeholder="+1 (402) 555-1234"
                        className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-sm focus:ring-4 focus:ring-primary/5 transition-all outline-none placeholder:text-slate-400"
                      />
                      <p className="text-xs text-gray-500 mt-1.5 italic">
                        US or international, any format. We'll normalize it.
                      </p>
                    </div>
                    <div>
                      <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-2">
                        Ring timeout
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min={5}
                          max={60}
                          value={form.ring_first_timeout_seconds}
                          onChange={(e) => handleUpdateForm("ring_first_timeout_seconds", parseInt(e.target.value, 10) || 20)}
                          className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-bold text-sm focus:ring-4 focus:ring-primary/5 transition-all outline-none text-center"
                        />
                        <span className="text-xs font-black text-gray-500 uppercase tracking-widest">sec</span>
                      </div>
                      <p className="text-xs text-gray-500 mt-1.5 italic">5–60 seconds</p>
                    </div>
                  </div>
                )}
              </section>

              {/* ── 5. Voicemail greeting ─────────────────────────── */}
              <section className="pt-4 border-t border-gray-100">
                <div className="mb-4">
                  <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <Volume2 className="w-4 h-4 text-primary" />
                    Voicemail greeting <span className="text-xs font-medium text-gray-400 normal-case ml-1">(optional)</span>
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-xl">
                    Custom audio played when a call lands in voicemail. Leave blank to
                    use a friendly default message.
                  </p>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-black text-gray-500 uppercase tracking-widest mb-2">
                      Audio URL
                    </label>
                    <input
                      type="url"
                      value={form.voicemail_message_url}
                      onChange={(e) => handleUpdateForm("voicemail_message_url", e.target.value)}
                      placeholder="https://cdn.example.com/my-greeting.mp3"
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl font-mono text-xs focus:ring-4 focus:ring-primary/5 transition-all outline-none placeholder:text-slate-400"
                    />
                    <p className="text-xs text-gray-500 mt-1.5 italic">
                      Must be HTTPS, and end in <code className="bg-gray-100 px-1 rounded">.mp3</code> or <code className="bg-gray-100 px-1 rounded">.wav</code>.
                    </p>
                  </div>

                  {/* Record greeting — placeholder stub (Round C) */}
                  <button
                    type="button"
                    disabled
                    className="w-full md:w-auto flex items-center justify-center gap-2 px-5 py-2.5 bg-gray-100 text-gray-400 rounded-xl text-xs font-black uppercase tracking-widest cursor-not-allowed border border-gray-200"
                    title="In-browser recording coming in a future update"
                  >
                    <Mic className="w-3.5 h-3.5" />
                    Record greeting (coming soon)
                  </button>
                </div>
              </section>
            </div>
          )}

          {activeTab === "estimator" && (
            <div className="space-y-10 animate-in fade-in slide-in-from-right-4 duration-500">

              {/* Tab header */}
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Calculator className="text-primary w-5 h-5" />
                  Estimator
                </h2>
                <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-2xl">
                  A standalone popup widget that gives homeowners ballpark pricing on your website.
                  Captures leads with full project details — including the calculated range — straight into your dashboard.
                </p>
              </div>

              {/* Master toggle (hero card matching ai-control style) */}
              <section className={`relative overflow-hidden rounded-3xl p-8 transition-all border-2 ${
                form.estimator_widget_enabled
                  ? "bg-slate-900 border-slate-900 shadow-2xl shadow-slate-900/20"
                  : "bg-gray-50 border-gray-200"
              }`}>
                <div className="absolute top-0 right-0 p-8 opacity-[0.06] pointer-events-none">
                  <Calculator className="w-32 h-32" />
                </div>
                <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${
                      form.estimator_widget_enabled ? "bg-emerald-500/20 text-emerald-400" : "bg-white text-gray-400"
                    }`}>
                      <Calculator className="w-6 h-6" strokeWidth={2.5} />
                    </div>
                    <div>
                      <h3 className={`text-lg font-black tracking-tight mb-1 flex items-center gap-2 ${
                        form.estimator_widget_enabled ? "text-white" : "text-gray-900"
                      }`}>
                        Ballpark Pricing Widget
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-widest ${
                          form.estimator_widget_enabled
                            ? "bg-emerald-500/20 text-emerald-300 border border-emerald-400/30"
                            : "bg-gray-200 text-gray-600 border border-gray-300"
                        }`}>
                          {form.estimator_widget_enabled ? "Live" : "Off"}
                        </span>
                      </h3>
                      <p className={`text-sm leading-relaxed max-w-lg ${
                        form.estimator_widget_enabled ? "text-slate-300" : "text-gray-500"
                      }`}>
                        {form.estimator_widget_enabled
                          ? "The widget is live on any site running your embed snippet. Homeowners see the floating CTA bottom-left."
                          : "Turn on to enable the widget on websites running your embed snippet."}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUpdateForm("estimator_widget_enabled", !form.estimator_widget_enabled)}
                    className={`relative w-16 h-9 rounded-full transition-colors shrink-0 ${
                      form.estimator_widget_enabled ? "bg-emerald-500" : "bg-gray-300"
                    }`}
                    aria-pressed={form.estimator_widget_enabled}
                    aria-label="Toggle estimator widget"
                  >
                    <div className={`absolute top-1 w-7 h-7 rounded-full bg-white shadow-lg transition-transform ${
                      form.estimator_widget_enabled ? "translate-x-8" : "translate-x-1"
                    }`} />
                  </button>
                </div>
              </section>

              {/* Proactive popup toggle */}
              <section className={`pt-2 ${!form.estimator_widget_enabled ? "opacity-40 pointer-events-none" : ""}`}>
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                      <Zap className="w-4 h-4 text-primary" />
                      Proactive auto-open
                    </h3>
                    <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-xl">
                      Automatically open the widget after a few seconds when a homeowner lands on your site.
                      Higher engagement, but more intrusive — leave off if you prefer a passive CTA.
                      <span className="block text-xs text-amber-600 italic mt-1">Coming soon — toggle persists, behavior wires in V2.</span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleUpdateForm("estimator_pop_enabled", !form.estimator_pop_enabled)}
                    className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${
                      form.estimator_pop_enabled ? "bg-gray-900" : "bg-gray-300"
                    }`}
                    aria-pressed={form.estimator_pop_enabled}
                    aria-label="Toggle proactive popup"
                  >
                    <div className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${
                      form.estimator_pop_enabled ? "translate-x-5" : "translate-x-0.5"
                    }`} />
                  </button>
                </div>
              </section>

              {/* Cost region selector */}
              <section className="pt-4 border-t border-gray-100">
                <div className="mb-4">
                  <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-primary" />
                    Cost region
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-xl">
                    Adjusts the ballpark range to match your local market. Auto-detect uses your business state.
                    Override if your specific market doesn't match the state-wide average.
                  </p>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                  {[
                    { value: null,     label: "Auto",   sub: "Detect from state" },
                    { value: "high",   label: "High",   sub: "+50% over baseline" },
                    { value: "mid",    label: "Mid",    sub: "Baseline rates" },
                    { value: "low",    label: "Low",    sub: "−15% from baseline" },
                    { value: "custom", label: "Custom", sub: "Set your own %" }
                  ].map((opt) => {
                    const selected = form.cost_region === opt.value || (opt.value === null && !form.cost_region);
                    return (
                      <button
                        key={opt.label}
                        type="button"
                        onClick={() => handleUpdateForm("cost_region", opt.value)}
                        className={`flex flex-col items-start gap-1 p-4 rounded-2xl border-2 transition-all text-left ${
                          selected
                            ? "border-gray-900 bg-gray-900 text-white shadow-lg scale-[1.01]"
                            : "border-gray-200 bg-gray-50 text-gray-700 hover:border-gray-300 hover:bg-gray-100"
                        }`}
                      >
                        <div className="flex items-center gap-2 w-full">
                          <h4 className="text-sm font-black uppercase tracking-wide">{opt.label}</h4>
                          {selected && <CheckCircle2 className="w-4 h-4 text-emerald-400 ml-auto" />}
                        </div>
                        <p className={`text-[11px] leading-relaxed ${selected ? "text-slate-300" : "text-gray-500"}`}>
                          {opt.sub}
                        </p>
                      </button>
                    );
                  })}
                </div>

                {/* Custom percentage input — appears only when "Custom" is selected */}
                {form.cost_region === "custom" && (
                  <div className="mt-5 p-5 bg-amber-50 border border-amber-200 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                    <label className="block text-xs font-black text-amber-800 uppercase tracking-widest mb-2">
                      Custom adjustment (%)
                    </label>
                    <div className="flex items-center gap-3 max-w-xs">
                      <input
                        type="number"
                        min={-50}
                        max={100}
                        step={1}
                        value={form.cost_custom_percentage ?? ""}
                        onChange={(e) => handleUpdateForm("cost_custom_percentage", e.target.value === "" ? null : parseFloat(e.target.value))}
                        placeholder="e.g. 18"
                        className="flex-1 px-4 py-3 bg-white border border-amber-300 rounded-xl font-bold text-lg focus:ring-4 focus:ring-amber-500/10 transition-all outline-none text-center"
                      />
                      <span className="text-sm font-black text-amber-800">%</span>
                    </div>
                    <p className="text-xs text-amber-800 mt-2 italic leading-relaxed">
                      Range: −50 to +100. Applied as a multiplier on top of the baseline (mid) rates.
                      For example, 18 = +18% over baseline.
                    </p>
                  </div>
                )}
              </section>

              {/* Embed snippet */}
              <section className="pt-4 border-t border-gray-100">
                <div className="mb-4">
                  <h3 className="text-base font-black text-gray-900 flex items-center gap-2">
                    <LinkIcon className="w-4 h-4 text-primary" />
                    Embed on your website
                  </h3>
                  <p className="text-sm text-gray-500 mt-1 leading-relaxed max-w-xl">
                    Paste this script tag before the closing <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs">&lt;/body&gt;</code> tag on every page where you want the widget to appear.
                  </p>
                </div>

                {/* Snippet display + copy */}
                <div className="bg-gradient-to-br from-slate-900 to-slate-800 rounded-2xl p-6 shadow-xl border border-slate-700 mb-4">
                  <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                    <span className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.2em]">Estimator Widget Snippet</span>
                    <button
                      type="button"
                      onClick={() => {
                        const snippet = `<script src="${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/estimator-widget.js" data-tenant-id="${tenant?.id}" async></script>`;
                        navigator.clipboard.writeText(snippet);
                        success("Estimator widget snippet copied!");
                      }}
                      className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500 hover:bg-emerald-400 text-slate-900 rounded-lg text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-500/20 transition-all active:scale-95"
                    >
                      <RefreshCw className="w-3 h-3" />
                      Copy Snippet
                    </button>
                  </div>
                  <code className="block p-4 bg-black/40 rounded-xl text-xs font-mono text-emerald-400 break-all border border-emerald-500/20 leading-relaxed">
                    {`<script src="${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/estimator-widget.js" data-tenant-id="${tenant?.id}" async></script>`}
                  </code>
                  <p className="text-[10px] text-slate-400 font-medium italic mt-3 leading-relaxed">
                    💡 Coexists with the chat widget. Chat lives bottom-right, estimator bottom-left. Both can run on the same page.
                  </p>
                </div>

                {/* Send to Developer email button */}
                <div className="p-6 bg-gradient-to-br from-primary/5 to-primary/10 border-2 border-primary/20 rounded-2xl">
                  <h4 className="text-sm font-bold text-gray-900 mb-2 flex items-center gap-2">
                    <Mail className="w-4 h-4 text-primary" />
                    Send install instructions to your developer
                  </h4>
                  <p className="text-sm text-gray-700 leading-relaxed mb-4">
                    Don't install it yourself? This button copies a ready-to-forward email with the script tag, install instructions for every major platform, and verification steps.
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      const snippet = `<script src="${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/estimator-widget.js" data-tenant-id="${tenant?.id}" async></script>`;
                      const companyName = tenant?.company_name || tenant?.name || "our business";
                      const emailBody = `Subject: Install our new ballpark pricing widget

Hi,

We just enabled an estimator widget that gives our website visitors instant ballpark pricing for their projects, with full lead capture into our dashboard. Please install this script tag on every page of ${companyName}'s website, just before the closing </body> tag:

${snippet}

Alternative: the script can also go inside the <head> tag — the "async" attribute prevents it from blocking page load.

Platform-specific install paths:
• Webflow → Project Settings → Custom Code → Footer Code → Save & Publish
• WordPress → "Insert Headers and Footers" plugin → Footer → Save
• Wix → Settings → Custom Code → Add New Code → Apply to All Pages → Body End
• Shopify → Online Store → Themes → Edit Code → theme.liquid → before </body>
• Squarespace → Settings → Advanced → Code Injection → Footer → Save
• Custom HTML → paste before </body> on every page

Once installed, a "Get Ballpark Pricing" button should appear in the bottom-LEFT corner of every page. (It coexists with our chat widget on the bottom-right — both should be visible.)

Verification:
1. Floating "Get Ballpark Pricing" button visible bottom-left
2. Click opens a modal with our brand colors
3. Picking a service shows the question form
4. Submitting produces a ballpark range and lead capture form

Thanks!`;
                      navigator.clipboard.writeText(emailBody);
                      success("Developer email copied to clipboard!");
                    }}
                    className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-600/30 hover:bg-emerald-700 transition-all active:scale-95"
                  >
                    <Mail className="w-4 h-4" />
                    Copy Email for Developer
                  </button>
                </div>
              </section>

              {/* Save reminder */}
              <div className="pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-500 italic flex items-center gap-2">
                  <Save className="w-3.5 h-3.5" />
                  Click "Save Changes" at the top to apply these settings.
                </p>
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
                      className="w-full flex items-center justify-center gap-2 px-6 py-3.5 bg-emerald-600 text-white rounded-xl font-black text-xs uppercase tracking-widest shadow-lg shadow-emerald-600/30 hover:bg-emerald-700 transition-all active:scale-95"
                    >
                      <Mail className="w-4 h-4" />
                      Copy Email for Developer
                    </button>
                    <p className="text-[10px] text-gray-500 italic mt-3 text-center">
                      The email contains both installs, platform-specific paths, and verification steps.
                    </p>
                  </div>
                </div>

                {/* Platform-Specific Guides — collapsed by default */}
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
                        Project Settings → <strong>Custom Code</strong> → Paste in <strong>Footer Code</strong> → Save & Publish.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-slate-700 text-white flex items-center justify-center text-xs font-black">W</div>
                        <span className="text-sm font-bold text-gray-900">WordPress</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Install the <strong>"Insert Headers and Footers"</strong> plugin → Paste in <strong>Footer</strong> → Save.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-black text-white flex items-center justify-center text-xs font-black">W</div>
                        <span className="text-sm font-bold text-gray-900">Wix</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Settings → <strong>Custom Code</strong> → Add New Code → Paste → Apply to All Pages → <strong>Place Code in Body - End</strong>.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-emerald-600 text-white flex items-center justify-center text-xs font-black">S</div>
                        <span className="text-sm font-bold text-gray-900">Shopify</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Online Store → Themes → <strong>Edit Code</strong> → <code className="bg-gray-100 px-1 rounded text-[10px]">theme.liquid</code> → Paste before <code className="bg-gray-100 px-1 rounded text-[10px]">&lt;/body&gt;</code>.
                      </p>
                    </div>
                    <div className="p-4 bg-white border border-gray-200 rounded-xl hover:border-primary/40 hover:shadow-md transition-all">
                      <div className="flex items-center gap-2 mb-2">
                        <div className="w-7 h-7 rounded-md bg-slate-900 text-white flex items-center justify-center text-xs font-black">S</div>
                        <span className="text-sm font-bold text-gray-900">Squarespace</span>
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">
                        Settings → Advanced → <strong>Code Injection</strong> → Paste in <strong>Footer</strong> → Save.
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
                    Open your website in a new tab after your developer finishes the install. You should see a chat bubble in the bottom-right corner within 2–3 seconds. Click it to test a message — the AI should respond using your tenant's settings. On mobile, tapping the "Text Us to Book" button should open your messaging app with the AI line pre-filled.
                  </p>
                  <p className="text-[11px] text-emerald-700/70 italic leading-relaxed">
                    💡 Troubleshooting: if the widget doesn't appear, check the browser console for errors (F12). Most issues are caused by aggressive ad-blockers, HTTPS misconfigurations, or a missing <code className="bg-white/60 px-1 rounded">async</code> attribute.
                  </p>
                </div>

                {/* Click-to-Text Button — PROMOTED from "Bonus" to co-equal section */}
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
                      <p className="text-xs text-emerald-800/70 font-medium">Website button that opens SMS app → messages route to your AI.</p>
                    </div>
                  </div>

                  <p className="text-sm text-gray-700 leading-relaxed mb-4">
                    Add a "Text Us to Book" button to your site. When a customer taps it on their phone, their messaging app opens pre-filled with a booking inquiry <strong>sent directly to your AI</strong>. The AI replies instantly, books appointments, and captures leads — just like the chat widget, but via SMS.
                  </p>

                  {/* How it works */}
                  <div className="mb-5 p-4 bg-white/70 border border-emerald-100 rounded-xl">
                    <p className="text-[10px] font-black text-emerald-700 uppercase tracking-widest mb-2">How it works</p>
                    <ol className="space-y-1.5 text-xs text-emerald-900">
                      <li className="flex gap-2"><span className="font-black text-emerald-600">1.</span> Customer taps "Text Us to Book" on your site (mobile)</li>
                      <li className="flex gap-2"><span className="font-black text-emerald-600">2.</span> Their messaging app opens with your AI's number pre-filled</li>
                      <li className="flex gap-2"><span className="font-black text-emerald-600">3.</span> The AI replies instantly and starts qualifying the lead</li>
                      <li className="flex gap-2"><span className="font-black text-emerald-600">4.</span> Conversation logs under Inbox → SMS in your dashboard</li>
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

                      const snippet = `<a href="sms:${aiPhoneNumber}?&body=Hi%2C%20I%27d%20like%20to%20book%20an%20estimate" style="display:inline-block;padding:14px 28px;background:#10b981;color:#fff;font-weight:700;text-decoration:none;border-radius:12px;font-family:system-ui,sans-serif;box-shadow:0 4px 12px rgba(16,185,129,0.3);">💬 Text Us to Book</a>`;

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
                      💡 The AI phone number is pulled from your primary AI line. Change it in the <strong>Phone & voice</strong> tab. Your developer can style or resize the button to match the site — the <code className="bg-gray-100 px-1 rounded text-[9px]">href</code> is the key.
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

              {/* Revenue Tracking & Sales Recovery */}
              <div className="pt-6 border-t border-gray-100">
                <h2 className="text-xl font-bold text-gray-900 mb-2 flex items-center gap-2">
                  <TrendingUp className="text-emerald-500 w-5 h-5" />
                  Revenue Tracking & Sales Recovery
                </h2>
                <p className="text-sm text-gray-500 mb-6 leading-relaxed max-w-2xl">
                  Two webhooks from your CRM power revenue tracking and AI follow-ups. Click "How to connect" on each card for field-by-field mapping instructions.
                </p>
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

                  {/* ──────────── Job Won → Revenue Pipeline (primary) ──────────── */}
                  <div className="mt-8 p-6 bg-gradient-to-br from-emerald-50 to-emerald-50/30 border-2 border-emerald-200 rounded-2xl">
                    <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-emerald-900 mb-1 flex items-center gap-2">
                          <span className="text-base">💰</span>
                          Revenue Pipeline
                          <span className="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-black uppercase tracking-widest rounded-md shadow-sm">Primary</span>
                        </h3>
                        <p className="text-xs text-emerald-800/70 leading-relaxed">
                          <strong>Job Won → Confirmed Revenue.</strong> When DripJobs marks a job as Won or Completed, revenue lands on your dashboard tile and post-service nurturing kicks off automatically.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenGuide("job-completed")}
                        className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-emerald-600/20 transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap shrink-0"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        How to Connect
                      </button>
                    </div>

                    <div className="flex items-center gap-2 mt-4">
                      <div className="flex-1 p-3 bg-white border border-emerald-200 rounded-xl font-mono text-[10px] text-emerald-900 break-all select-all">
                        {`${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/job-completed`.replace(/\/+$/, "")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/job-completed`.replace(/\/+$/, "");
                          navigator.clipboard.writeText(url);
                          success("Revenue Pipeline URL copied!");
                        }}
                        className="p-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors shadow-lg shadow-emerald-600/20"
                        title="Copy to clipboard"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-4 space-y-2">
                      <p className="text-[10px] text-emerald-700/80 font-black uppercase tracking-wider">Auth Header (Required):</p>
                      <div className="p-2 bg-white/70 border border-emerald-100 rounded-lg font-mono text-[9px] text-emerald-900 flex justify-between items-center gap-2">
                        <span className="truncate">Authorization: Bearer <span className="font-bold">{tenant?.api_key || "Loading..."}</span></span>
                        <button
                          type="button"
                          onClick={() => {
                            if (tenant?.api_key) {
                              navigator.clipboard.writeText(tenant.api_key);
                              success("API Key copied!");
                            }
                          }}
                          className="px-2 py-1 bg-emerald-100 hover:bg-emerald-200 text-emerald-800 rounded text-[9px] font-black transition-colors shrink-0"
                        >
                          COPY KEY
                        </button>
                      </div>
                    </div>
                  </div>
                  
                {/* ──────────── Estimate Sent → AI Sales Recovery (optional) ──────────── */}
                  <div className="mt-4 p-6 bg-gradient-to-br from-purple-50 to-purple-50/30 border-2 border-purple-200 rounded-2xl">
                    <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-purple-900 mb-1 flex items-center gap-2">
                          <span className="text-base">🤖</span>
                          AI Sales Recovery
                          <span className="px-2 py-0.5 bg-purple-600 text-white text-[9px] font-black uppercase tracking-widest rounded-md shadow-sm">Optional</span>
                        </h3>
                        <p className="text-xs text-purple-800/70 leading-relaxed">
                          <strong>Estimate Sent → 21-day follow-up.</strong> When you send a proposal, the AI texts, calls, and leaves voicemails at optimal intervals to recover the estimate if the prospect goes cold.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setOpenGuide("estimate-sent")}
                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-[10px] font-black uppercase tracking-widest shadow-lg shadow-purple-600/20 transition-all active:scale-95 flex items-center gap-2 whitespace-nowrap shrink-0"
                      >
                        <BookOpen className="w-3.5 h-3.5" />
                        How to Connect
                      </button>
                    </div>

                    <div className="flex items-center gap-2 mt-4">
                      <div className="flex-1 p-3 bg-white border border-purple-200 rounded-xl font-mono text-[10px] text-purple-900 break-all select-all">
                        {`${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/estimate-sent`.replace(/\/+$/, "")}
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          const url = `${import.meta.env.VITE_API_URL || "https://ai-front-desk-backend.onrender.com"}/webhooks/crm/estimate-sent`.replace(/\/+$/, "");
                          navigator.clipboard.writeText(url);
                          success("AI Recovery URL copied!");
                        }}
                        className="p-3 bg-purple-600 text-white rounded-xl hover:bg-purple-700 transition-colors shadow-lg shadow-purple-600/20"
                        title="Copy to clipboard"
                      >
                        <RefreshCw className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-4 space-y-2">
                      <p className="text-[10px] text-purple-700/80 font-black uppercase tracking-wider">JSON Body Key (Required):</p>
                      <div className="p-2 bg-white/70 border border-purple-100 rounded-lg font-mono text-[9px] text-purple-900 flex justify-between items-center gap-2">
                        <span className="truncate">"api_key": "<span className="font-bold">{tenant?.api_key || "Loading..."}</span>"</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (tenant?.api_key) {
                              navigator.clipboard.writeText(tenant.api_key);
                              success("API Key copied!");
                            }
                          }}
                          className="px-2 py-1 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded text-[9px] font-black transition-colors shrink-0"
                        >
                          COPY KEY
                        </button>
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

      {/* Webhook Guide Drawer — renders over everything when openGuide is set */}
      <WebhookGuideDrawer
        isOpen={!!openGuide}
        onClose={() => setOpenGuide(null)}
        webhook={openGuide ? webhookGuides[openGuide] : null}
        onCopy={(value, msg) => {
          if (!value) return;
          navigator.clipboard.writeText(value);
          success(msg || "Copied!");
        }}
      />
      
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

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getTenants, updateTenant } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Building2,
  Globe,
  Shield,
  Bot,
  Calendar,
  Zap,
  Facebook,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";

export default function Tenants() {
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [activeTenantId, setActiveTenantId] = useState(null);

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = () => {
    setLoading(true);
    getTenants()
      .then((data) => {
        const list = data.tenants || [];
        setTenants(list);
        if (list.length === 1 && !activeTenantId) setActiveTenantId(list[0].id);
        if (list.length > 1 && !activeTenantId) setActiveTenantId(list[0].id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  const activeTenant = tenants.find((t) => t.id === activeTenantId) || tenants[0];
  const [form, setForm] = useState(null);

  useEffect(() => {
    const t = tenants.find((x) => x.id === activeTenantId);
    if (t) setForm({ ...t });
  }, [activeTenantId, tenants]);

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form) return;
    setSaveLoading(true);
    try {
      await updateTenant(form.id, {
        name: form.name,
        company_name: form.company_name,
        timezone: form.timezone,
        website: form.website,
        logo_url: form.logo_url || null,
        welcome_message: form.welcome_message,
        tone_of_voice: form.tone_of_voice,
        instructions: form.instructions,
      });
      await fetchTenants();
    } catch (err) {
      setError(err.message || "Failed to save");
    } finally {
      setSaveLoading(false);
    }
  };

  const setField = (key, value) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : null));
  };

  if (loading && tenants.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <LumaSpin />
      </div>
    );
  }

  if (tenants.length === 0) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
          <Building2 className="w-8 h-8 text-gray-400" />
        </div>
        <p className="text-gray-500">No business profile found.</p>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
          <Building2 className="text-blue-600" size={28} />
          Business
        </h1>
        <p className="text-gray-500 mt-1">Your business profile. Configure phone and AI in Settings.</p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3">
          <AlertCircle size={20} />
          {error}
        </div>
      )}

      {tenants.length > 1 && (
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Business</label>
          <select
            value={activeTenantId || ""}
            onChange={(e) => setActiveTenantId(e.target.value)}
            className="w-full max-w-sm px-4 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name || t.company_name || t.slug}
              </option>
            ))}
          </select>
        </div>
      )}

      {form && (
        <form onSubmit={handleSave} className="space-y-8">
          {/* Business image */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Business image</h3>
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <div className="w-20 h-20 rounded-full bg-gray-100 border-2 border-gray-200 overflow-hidden flex items-center justify-center">
                  {form.logo_url ? (
                    <img src={form.logo_url} alt="Business" className="w-full h-full object-cover" />
                  ) : (
                    <Building2 className="w-8 h-8 text-gray-400" />
                  )}
                </div>
                {form.logo_url && (
                  <button
                    type="button"
                    onClick={() => setField("logo_url", "")}
                    className="absolute -top-0.5 -right-0.5 w-6 h-6 rounded-full bg-gray-800 text-white flex items-center justify-center hover:bg-gray-700 shadow transition-colors"
                    title="Remove image"
                    aria-label="Remove image"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <div>
                <input
                  type="file"
                  accept="image/*"
                  id="business-image-upload"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target?.files?.[0];
                    if (!file || !file.type.startsWith("image/")) return;
                    const reader = new FileReader();
                    reader.onload = () => setField("logo_url", reader.result || "");
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
                <label
                  htmlFor="business-image-upload"
                  className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg cursor-pointer transition-colors"
                >
                  {form.logo_url ? "Change image" : "Upload image"}
                </label>
              </div>
            </div>
          </div>

          {/* Core details */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-4">Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Display name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.name || ""}
                  onChange={(e) => setField("name", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Company name</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.company_name || ""}
                  onChange={(e) => setField("company_name", e.target.value)}
                />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="block text-sm font-medium text-gray-700">Website</label>
                <input
                  type="url"
                  placeholder="https://example.com"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.website || ""}
                  onChange={(e) => setField("website", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Timezone</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.timezone || "America/Chicago"}
                  onChange={(e) => setField("timezone", e.target.value)}
                >
                  <option value="America/Chicago">America/Chicago (CST)</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                </select>
              </div>
            </div>
          </div>

          {/* AI & identity */}
          <div className="pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Bot size={16} className="text-gray-500" />
              AI & identity
            </h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Welcome message</label>
                <textarea
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  value={form.welcome_message || ""}
                  onChange={(e) => setField("welcome_message", e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">Response tone</label>
                <select
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  value={form.tone_of_voice || "professional"}
                  onChange={(e) => setField("tone_of_voice", e.target.value)}
                >
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="luxury">Luxury & formal</option>
                  <option value="authoritative">Authoritative</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-gray-700">AI instructions</label>
                <textarea
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent font-mono"
                  value={form.instructions || ""}
                  onChange={(e) => setField("instructions", e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Integrations (read-only) */}
          <div className="pt-6 border-t border-gray-100">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Integrations</h3>
            <div className="flex flex-wrap gap-2">
              <IntegrationBadge active={form.has_twilio_credentials} icon={<Zap size={12} />} name="Twilio" />
              <IntegrationBadge active={form.google_calendar_linked} icon={<Calendar size={12} />} name="Google" />
              <IntegrationBadge active={!!form.facebook_page_id} icon={<Facebook size={12} />} name="Facebook" />
              <IntegrationBadge active={!!form.crm_webhook_url} icon={<Shield size={12} />} name="CRM" />
            </div>
            <p className="text-xs text-gray-500 mt-3">Configure in Settings → Integrations.</p>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-4">
            <button
              type="submit"
              disabled={saveLoading}
              className="px-6 py-2.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-2"
            >
              {saveLoading && <LumaSpin className="w-4 h-4 border-white" />}
              Save changes
            </button>
            <Link to="/settings" className="text-sm text-gray-600 hover:text-blue-600">
              Open Settings
            </Link>
          </div>
        </form>
      )}
    </div>
  );
}

function IntegrationBadge({ active, icon, name }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
        active ? "bg-green-50 text-green-700 border border-green-100" : "bg-gray-50 text-gray-500 border border-gray-100"
      }`}
    >
      {icon}
      <span>{name}</span>
      {active && <CheckCircle2 size={12} className="text-green-600" />}
    </div>
  );
}

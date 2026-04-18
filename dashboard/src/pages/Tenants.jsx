import { useState, useEffect } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { getTenants, updateTenant } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Building2,
  MapPin,
  Globe,
  Shield,
  Bot,
  Calendar,
  Zap,
  Facebook,
  CheckCircle2,
  AlertCircle,
  X,
  Plus,
  ChevronRight,
  Crown,
  Settings,
  Palette,
} from "lucide-react";

const MAX_LOGO_BYTES = 1024 * 1024;

export default function Tenants() {
  const navigate = useNavigate();
  const { onTenantChange } = useOutletContext() || {};
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [editTenant, setEditTenant] = useState(null); // null = card view, object = editing

  useEffect(() => {
    fetchTenants();
  }, []);

  const fetchTenants = () => {
    setLoading(true);
    getTenants()
      .then((data) => {
        const list = data.tenants || [];
        setTenants(list);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  };

  // Group tenants by hierarchy
  const parents = tenants.filter(t => t.business_type === 'parent');
  const standalones = tenants.filter(t => t.business_type === 'standalone' || (!t.business_type));
  const getChildren = (parentId) => tenants.filter(t => t.parent_id === parentId);

  // --- Edit form state ---
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (editTenant) {
      // Normalize brand_mode so the toggle always has a concrete value,
      // even for legacy rows that somehow slipped past the DB default.
      setForm({
        ...editTenant,
        brand_mode: editTenant.brand_mode === "white_label" ? "white_label" : "ai_branded",
      });
    } else {
      setForm(null);
    }
  }, [editTenant]);

  const setField = (key, value) => setForm((prev) => (prev ? { ...prev, [key]: value } : null));

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form) return;
    setError("");
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
        brand_mode: form.brand_mode === "white_label" ? "white_label" : "ai_branded",
      });
      setEditTenant(null);
      await fetchTenants();
    } catch (err) {
      if (err.message && /413/i.test(err.message)) {
        setError("Business image is too large. Please upload a smaller image (under 1MB).");
      } else {
        setError(err.message || "Failed to save");
      }
    } finally {
      setSaveLoading(false);
    }
  };

  // --- Loading state ---
  if (loading && tenants.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <LumaSpin />
      </div>
    );
  }

  // --- Edit view ---
  if (editTenant && form) {
    return (
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
        <button
          onClick={() => setEditTenant(null)}
          className="flex items-center gap-1 text-sm text-stone-500 hover:text-stone-800 font-medium mb-6 transition-colors"
        >
          <ChevronRight className="w-4 h-4 rotate-180" />
          Back to Businesses
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${editTenant.business_type === 'parent' ? 'bg-amber-100 text-amber-700' : editTenant.business_type === 'location' ? 'bg-blue-100 text-blue-700' : 'bg-stone-100 text-stone-600'}`}>
            {editTenant.business_type === 'parent' ? <Crown className="w-5 h-5" /> : editTenant.business_type === 'location' ? <MapPin className="w-5 h-5" /> : <Building2 className="w-5 h-5" />}
          </div>
          <div>
            <h1 className="text-xl font-black text-stone-900">{editTenant.name}</h1>
            <p className="text-xs text-stone-500 capitalize">{editTenant.business_type || 'standalone'} account</p>
          </div>
        </div>

        {error && (
          <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
            <AlertCircle size={18} />
            {error}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-8 bg-white rounded-2xl border border-stone-200 p-6 shadow-sm">
          {/* Business image */}
          <div>
            <h3 className="text-sm font-semibold text-stone-700 mb-3">Business image</h3>
            <div className="flex items-center gap-4">
              <div className="relative shrink-0">
                <div className="w-20 h-20 rounded-full bg-stone-100 border-2 border-stone-200 overflow-hidden flex items-center justify-center">
                  {form.logo_url ? (
                    <img src={form.logo_url} alt="Business" className="w-full h-full object-cover" />
                  ) : (
                    <Building2 className="w-8 h-8 text-stone-400" />
                  )}
                </div>
                {form.logo_url && (
                  <button type="button" onClick={() => setField("logo_url", "")} className="absolute -top-0.5 -right-0.5 w-6 h-6 rounded-full bg-stone-800 text-white flex items-center justify-center hover:bg-stone-700 shadow transition-colors" title="Remove image"><X className="w-3.5 h-3.5" /></button>
                )}
              </div>
              <div>
                <input type="file" accept="image/*" id="business-image-upload" className="hidden"
                  onChange={(e) => {
                    const file = e.target?.files?.[0];
                    if (!file) return;
                    if (!file.type.startsWith("image/")) { setError("Please upload a valid image file."); return; }
                    if (file.size > MAX_LOGO_BYTES) { setError("Image too large (max 1MB)."); e.target.value = ""; return; }
                    const reader = new FileReader();
                    reader.onload = () => setField("logo_url", reader.result || "");
                    reader.readAsDataURL(file);
                    e.target.value = "";
                  }}
                />
                <label htmlFor="business-image-upload" className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-stone-900 hover:bg-black rounded-lg cursor-pointer shadow-sm transition-colors">
                  {form.logo_url ? "Change image" : "Upload image"}
                </label>
              </div>
            </div>
          </div>

          {/* Core details */}
          <div>
            <h3 className="text-sm font-semibold text-stone-700 mb-4">Details</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700">Display name</label>
                <input type="text" className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent" value={form.name || ""} onChange={(e) => setField("name", e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700">Company name</label>
                <input type="text" className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent" value={form.company_name || ""} onChange={(e) => setField("company_name", e.target.value)} />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <label className="block text-sm font-medium text-stone-700">Website</label>
                <input type="url" placeholder="https://example.com" className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent" value={form.website || ""} onChange={(e) => setField("website", e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700">Timezone</label>
                <select className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent" value={form.timezone || "America/Chicago"} onChange={(e) => setField("timezone", e.target.value)}>
                  <option value="America/Chicago">America/Chicago (CST)</option>
                  <option value="America/New_York">America/New_York (EST)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (PST)</option>
                  <option value="Europe/London">Europe/London (GMT)</option>
                </select>
              </div>
            </div>
          </div>

          {/* ── Branding & plan (superadmin) ───────────────────────────────
            * Controls the per-tenant brand_mode flag introduced Apr 19.
            * - ai_branded: dashboard chrome shows AI Front Desk Helper
            *   branding (default, free marketing surface for Basic tier).
            * - white_label: dashboard chrome shows the tenant's own brand
            *   (Pro $29/mo add-on, included on Elite, always on for Reseller).
            * Flipping this flag takes effect on the tenant's next page load.
            * Any logo/color fields they've uploaded are preserved on the row
            * regardless of mode, so flipping back picks up right where they
            * left off.
            */}
          <div className="pt-6 border-t border-stone-100">
            <h3 className="text-sm font-semibold text-stone-700 mb-4 flex items-center gap-2">
              <Palette size={16} className="text-stone-500" /> Branding mode
            </h3>
            <div className="space-y-2">
              <BrandModeOption
                selected={form.brand_mode === "ai_branded"}
                onSelect={() => setField("brand_mode", "ai_branded")}
                title="AI Front Desk Branded"
                badge="Default"
                description="Dashboard shows AI Front Desk Helper branding. Included free on Basic tier — free marketing surface on every login."
              />
              <BrandModeOption
                selected={form.brand_mode === "white_label"}
                onSelect={() => setField("brand_mode", "white_label")}
                title="White Label"
                badge="Pro add-on · Elite incl."
                description="Dashboard shows the tenant's own logo, colors, and company name. $29/mo add-on on Pro, included free on Elite, always on for Reseller accounts."
              />
            </div>
          </div>

          {/* AI & identity */}
          <div className="pt-6 border-t border-stone-100">
            <h3 className="text-sm font-semibold text-stone-700 mb-4 flex items-center gap-2">
              <Bot size={16} className="text-stone-500" /> AI & identity
            </h3>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700">Welcome message</label>
                <textarea rows={2} className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent resize-none" value={form.welcome_message || ""} onChange={(e) => setField("welcome_message", e.target.val

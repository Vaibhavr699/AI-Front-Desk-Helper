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
                <textarea rows={2} className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent resize-none" value={form.welcome_message || ""} onChange={(e) => setField("welcome_message", e.target.value)} />
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700">Response tone</label>
                <select className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent" value={form.tone_of_voice || "professional"} onChange={(e) => setField("tone_of_voice", e.target.value)}>
                  <option value="professional">Professional</option>
                  <option value="friendly">Friendly</option>
                  <option value="luxury">Luxury & formal</option>
                  <option value="authoritative">Authoritative</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="block text-sm font-medium text-stone-700">AI instructions</label>
                <textarea rows={4} className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent font-mono" value={form.instructions || ""} onChange={(e) => setField("instructions", e.target.value)} />
              </div>
            </div>
          </div>

          {/* Integrations (read-only) */}
          <div className="pt-6 border-t border-stone-100">
            <h3 className="text-sm font-semibold text-stone-700 mb-3">Integrations</h3>
            <div className="flex flex-wrap gap-2">
              <IntegrationBadge active={form.has_twilio_credentials} icon={<Zap size={12} />} name="Twilio" />
              <IntegrationBadge active={form.google_calendar_linked} icon={<Calendar size={12} />} name="Google" />
              <IntegrationBadge active={!!form.facebook_page_id} icon={<Facebook size={12} />} name="Facebook" />
              <IntegrationBadge active={!!form.crm_webhook_url} icon={<Shield size={12} />} name="CRM" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-4 pt-4">
            <button type="submit" disabled={saveLoading} className="px-6 py-2.5 bg-stone-900 text-white text-sm font-medium rounded-xl hover:bg-stone-800 disabled:opacity-50 flex items-center gap-2 transition-colors">
              {saveLoading && <LumaSpin className="w-4 h-4 border-white" />}
              Save changes
            </button>
            <button type="button" onClick={() => setEditTenant(null)} className="text-sm text-stone-500 hover:text-stone-700 font-medium transition-colors">Cancel</button>
          </div>
        </form>
      </div>
    );
  }

  // --- Card View ---
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-stone-900 flex items-center gap-3">
            <Building2 className="text-stone-600" size={28} />
            Businesses
          </h1>
          <p className="text-stone-500 mt-1 text-sm">Your business locations and hierarchy.</p>
        </div>
        <button
          onClick={() => navigate("/add-location")}
          className="flex items-center gap-2 px-4 py-2.5 bg-stone-900 text-white text-sm font-bold rounded-xl hover:bg-stone-800 shadow-sm hover:shadow-md transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Location
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <div className="space-y-6">
        {/* Parent businesses with their children */}
        {parents.map(parent => {
          const children = getChildren(parent.id);
          return (
            <div key={parent.id} className="space-y-3">
              {/* Parent card */}
              <TenantCard
                tenant={parent}
                isParent={true}
                childCount={children.length}
                onEdit={() => setEditTenant(parent)}
                onSelect={() => {
                  if (onTenantChange) onTenantChange(parent.id);
                  navigate("/dashboard");
                }}
              />
              {/* Child cards */}
              {children.length > 0 && (
                <div className="ml-6 pl-4 border-l-2 border-stone-200 space-y-3">
                  {children.map(child => (
                    <TenantCard
                      key={child.id}
                      tenant={child}
                      isChild={true}
                      parentName={parent.name}
                      onEdit={() => setEditTenant(child)}
                      onSelect={() => {
                        if (onTenantChange) onTenantChange(child.id);
                        navigate("/dashboard");
                      }}
                    />
                  ))}
                  {/* Add child button */}
                  <button
                    onClick={() => navigate("/add-location")}
                    className="w-full border-2 border-dashed border-stone-200 rounded-xl py-3 px-4 flex items-center justify-center gap-2 text-sm font-medium text-stone-400 hover:text-stone-600 hover:border-stone-300 hover:bg-stone-50 transition-all"
                  >
                    <Plus className="w-4 h-4" />
                    Add location to {parent.name}
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Standalone businesses */}
        {standalones.map(t => (
          <TenantCard
            key={t.id}
            tenant={t}
            onEdit={() => setEditTenant(t)}
            onSelect={() => {
              if (onTenantChange) onTenantChange(t.id);
              navigate("/dashboard");
            }}
          />
        ))}

        {/* Empty state */}
        {tenants.length === 0 && (
          <div className="text-center py-16">
            <div className="w-16 h-16 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-stone-400" />
            </div>
            <p className="text-stone-500 mb-4">No business profile found.</p>
            <Link
              to="/create-business"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-stone-900 text-white text-sm font-bold rounded-xl hover:bg-stone-800 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Create Business
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function TenantCard({ tenant, isParent, isChild, childCount, parentName, onEdit, onSelect }) {
  const phone = tenant.phones?.find(p => p.is_primary)?.phone || tenant.phones?.[0]?.phone;
  const isWhiteLabel = tenant.brand_mode === "white_label";

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          {/* Logo / Icon */}
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
            isParent ? 'bg-gradient-to-br from-amber-100 to-amber-50 text-amber-600 ring-2 ring-amber-200/50' :
            isChild ? 'bg-gradient-to-br from-blue-100 to-blue-50 text-blue-600 ring-2 ring-blue-200/50' :
            'bg-gradient-to-br from-stone-100 to-stone-50 text-stone-600 ring-2 ring-stone-200/50'
          }`}>
            {tenant.logo_url ? (
              <img src={tenant.logo_url} alt="" className="w-full h-full object-cover rounded-xl" />
            ) : isParent ? (
              <Crown className="w-6 h-6" />
            ) : isChild ? (
              <MapPin className="w-6 h-6" />
            ) : (
              <Building2 className="w-6 h-6" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base font-black text-stone-900 truncate">{tenant.name}</h3>
              {isParent && (
                <span className="shrink-0 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                  HQ
                </span>
              )}
              {isChild && (
                <span className="shrink-0 px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                  Branch
                </span>
              )}
              {isWhiteLabel && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold uppercase tracking-wider rounded-md border border-indigo-100" title="White-labeled dashboard">
                  <Palette className="w-2.5 h-2.5" /> WL
                </span>
              )}
            </div>
            <p className="text-sm text-stone-500 truncate">
              {tenant.company_name || 'No company name'}
              {isChild && parentName && <span className="text-stone-400"> · under {parentName}</span>}
            </p>

            {/* Status row */}
            <div className="flex flex-wrap items-center gap-3 mt-3">
              {phone && (
                <span className="flex items-center gap-1 text-xs text-stone-500">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" /></svg>
                  {phone}
                </span>
              )}
              {tenant.website && (
                <span className="flex items-center gap-1 text-xs text-stone-500">
                  <Globe className="w-3.5 h-3.5" />
                  {tenant.website.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                </span>
              )}
              {isParent && childCount > 0 && (
                <span className="flex items-center gap-1 text-xs text-stone-500 font-medium">
                  <MapPin className="w-3.5 h-3.5" />
                  {childCount} location{childCount !== 1 ? 's' : ''}
                </span>
              )}
              {/* Integrations mini-badges */}
              <div className="flex items-center gap-1">
                {tenant.has_twilio_credentials && <IntegrationDot color="green" title="Twilio" />}
                {tenant.google_calendar_linked && <IntegrationDot color="blue" title="Google Calendar" />}
                {tenant.facebook_page_id && <IntegrationDot color="indigo" title="Facebook" />}
              </div>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onEdit}
              className="p-2 rounded-lg text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
              title="Edit business"
            >
              <Settings className="w-4 h-4" />
            </button>
            <button
              onClick={onSelect}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-lg transition-colors"
            >
              View
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrationDot({ color, title }) {
  const colorMap = {
    green: 'bg-emerald-400',
    blue: 'bg-blue-400',
    indigo: 'bg-indigo-400',
  };
  return (
    <span className={`block w-2 h-2 rounded-full ${colorMap[color] || 'bg-stone-400'}`} title={title} />
  );
}

function IntegrationBadge({ active, icon, name }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
      active ? "bg-green-50 text-green-700 border border-green-100" : "bg-stone-50 text-stone-500 border border-stone-100"
    }`}>
      {icon}
      <span>{name}</span>
      {active && <CheckCircle2 size={12} className="text-green-600" />}
    </div>
  );
}

// ── Brand mode radio card (superadmin) ───────────────────────────────────
// Rich radio option for the brand_mode toggle. Unlike a segmented control,
// this gives room to explain what each mode does — important because the
// difference drives pricing tiers and what end-users actually see.
function BrandModeOption({ selected, onSelect, title, badge, description }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full text-left p-4 rounded-xl border-2 transition-all ${
        selected
          ? "border-stone-900 bg-stone-50 shadow-sm"
          : "border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50/50"
      }`}
    >
      <div className="flex items-start gap-3">
        {/* Radio dot */}
        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
          selected ? "border-stone-900 bg-stone-900" : "border-stone-300 bg-white"
        }`}>
          {selected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-bold text-stone-900">{title}</span>
            {badge && (
              <span className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 text-stone-600 text-[10px] font-bold uppercase tracking-wider rounded">
                {badge}
              </span>
            )}
          </div>
          <p className="text-xs text-stone-500 leading-relaxed">{description}</p>
        </div>
      </div>
    </button>
  );
}

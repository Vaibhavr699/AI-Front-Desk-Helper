import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import {
  getTenants,
  getTenantRollup,
  getRollupActivity,
  updateTenant,
} from "../api";
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
  AlertTriangle,
  Info,
  X,
  Plus,
  ChevronRight,
  Crown,
  Settings,
  Palette,
  TrendingUp,
  DollarSign,
  PhoneCall,
  CalendarCheck,
  Users,
  Mail,
  Loader2,
  Activity,
  UserPlus,
  PhoneMissed,
  Star,
} from "lucide-react";

const MAX_LOGO_BYTES = 1024 * 1024;

/** Format an integer cents value as "$X,XXX.XX". */
function formatCents(cents) {
  if (cents == null) return "$0";
  const dollars = cents / 100;
  if (dollars === 0) return "$0";
  // Round to nearest dollar for big numbers, show cents for small numbers
  if (Math.abs(dollars) >= 1000) {
    return `$${Math.round(dollars).toLocaleString()}`;
  }
  return `$${dollars.toFixed(2)}`;
}

/** Format a number with thousand separators. */
function formatNum(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString();
}

export default function Tenants() {
  const navigate = useNavigate();
  const { onTenantChange } = useOutletContext() || {};
  const [rollup, setRollup] = useState(null); // { parent, summary, locations, insights } | null
  const [standalone, setStandalone] = useState(null); // fallback flat tenant list when user isn't a parent
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveLoading, setSaveLoading] = useState(false);
  const [editTenant, setEditTenant] = useState(null); // null = card view, object = editing
  const [activeTab, setActiveTab] = useState("overview"); // "overview" | "activity"

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchData() {
    setLoading(true);
    setError("");
    try {
      // Step 1: always pull the flat tenant list first. This tells us whether
      // the current user is a parent (has children) or a standalone tenant.
      const tenantsResponse = await getTenants();
      const list = tenantsResponse?.tenants || [];

      // Find the tenant where the user is primary — the API returns the
      // user's own tenant first (sorted ORDER BY CASE WHEN t.id = $1 THEN 0).
      const primary = list[0];
      const isParent =
        primary?.business_type === "parent" ||
        list.some((t) => t.parent_id === primary?.id);

      if (isParent && primary?.id) {
        // Parent view: pull the full rollup
        try {
          const rollupData = await getTenantRollup(primary.id);
          setRollup(rollupData);
          setStandalone(null);
        } catch (rollupErr) {
          // Rollup endpoint failed — fall back to the flat list so the page
          // still renders something useful while we debug.
          console.error("[Tenants] Rollup failed, falling back:", rollupErr);
          setRollup(null);
          setStandalone(list);
        }
      } else {
        // Standalone / location-only user: just show their tenant(s)
        setRollup(null);
        setStandalone(list);
      }
    } catch (e) {
      setError(e.message || "Failed to load businesses");
    } finally {
      setLoading(false);
    }
  }

  // --- Edit form state ---
  // Note: brand_mode is intentionally NOT in this form. Branding mode is a
  // superadmin-only setting that lives at /admin/tenants. The WL pill on
  // the card is kept as a read-only visual indicator.
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (editTenant) setForm({ ...editTenant });
    else setForm(null);
  }, [editTenant]);

  const setField = (key, value) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : null));

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
      });
      setEditTenant(null);
      await fetchData();
    } catch (err) {
      if (err.message && /413/i.test(err.message)) {
        setError(
          "Business image is too large. Please upload a smaller image (under 1MB)."
        );
      } else {
        setError(err.message || "Failed to save");
      }
    } finally {
      setSaveLoading(false);
    }
  };

  // --- Loading state ---
  if (loading && !rollup && !standalone) {
    return (
      <div className="flex items-center justify-center py-20">
        <LumaSpin />
      </div>
    );
  }

  // --- Edit view ---
  if (editTenant && form) {
    return (
      <EditTenantView
        editTenant={editTenant}
        form={form}
        setField={setField}
        setEditTenant={setEditTenant}
        handleSave={handleSave}
        saveLoading={saveLoading}
        error={error}
        setError={setError}
      />
    );
  }

  // --- Parent rollup view ---
  if (rollup) {
    return (
      <RollupView
        rollup={rollup}
        onEdit={setEditTenant}
        onSelect={(id) => {
          if (onTenantChange) onTenantChange(id);
          navigate("/dashboard");
        }}
        onAddLocation={() => navigate("/locations")}
        error={error}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
      />
    );
  }

  // --- Standalone / fallback view ---
  return (
    <StandaloneView
      tenants={standalone || []}
      onEdit={setEditTenant}
      onSelect={(id) => {
        if (onTenantChange) onTenantChange(id);
        navigate("/dashboard");
      }}
      error={error}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════
// ROLLUP VIEW — franchise/multi-location dashboard
// ═════════════════════════════════════════════════════════════════════════

  function RollupView({ rollup, onEdit, onSelect, onAddLocation, error, activeTab, setActiveTab }) {
  const { parent, summary, locations, insights } = rollup;

  // Split HQ out from child locations so we can render them differently.
  // HQ is only in `locations[]` when parent_mode === 'operating_hq'.
  const { hqRow, childRows } = useMemo(() => {
    const hq = locations.find((l) => l.is_hq) || null;
    const kids = locations.filter((l) => !l.is_hq);
    return { hqRow: hq, childRows: kids };
  }, [locations]);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-stone-900 flex items-center gap-3">
            <Building2 className="text-stone-600" size={28} />
            Businesses
          </h1>
          <p className="text-stone-500 mt-1 text-sm">
            {parent.company_name || parent.name} · {summary.total_locations}{" "}
            location{summary.total_locations !== 1 ? "s" : ""}
          </p>
        </div>
        <button
          onClick={onAddLocation}
          className="flex items-center gap-2 px-4 py-2.5 bg-stone-900 text-white text-sm font-bold rounded-xl hover:bg-stone-800 shadow-sm hover:shadow-md transition-all"
        >
          <Plus className="w-4 h-4" />
          Add Location
        </button>
      </div>

       {/* ── Tabs ─────────────────────────────────────────────── Apr 21, 2026 */}
      <div className="flex items-center gap-1 p-1 bg-stone-100/80 rounded-xl w-fit mb-6">
        <button
          onClick={() => setActiveTab("overview")}
          className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
            activeTab === "overview"
              ? "bg-white text-stone-900 shadow-sm"
              : "text-stone-500 hover:text-stone-700"
          }`}
        >
          Overview
        </button>
        <button
          onClick={() => setActiveTab("activity")}
          className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all inline-flex items-center gap-1.5 ${
            activeTab === "activity"
              ? "bg-white text-stone-900 shadow-sm"
              : "text-stone-500 hover:text-stone-700"
          }`}
        >
          <Activity className="w-3 h-3" />
          Activity
        </button>
      </div>
      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

  {activeTab === "overview" && (
        <>
          {/* HQ Summary Hero */}
          <HQHero parent={parent} summary={summary} />

          {/* Insights strip */}
          {insights && insights.length > 0 && (
            <InsightsStrip insights={insights} onSelect={onSelect} />
          )}

          {/* HQ row (if operating_hq) */}
          {hqRow && (
            <div className="mt-6">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-3 flex items-center gap-2">
                <Crown className="w-3.5 h-3.5 text-amber-500" />
                Headquarters
              </div>
              <LocationCard
                location={hqRow}
                parent={parent}
                onEdit={() => onEdit(hqRow)}
                onSelect={() => onSelect(hqRow.id)}
              />
            </div>
          )}

          {/* Locations list */}
          <div className="mt-6">
            <div className="text-xs font-bold uppercase tracking-wider text-stone-400 mb-3 flex items-center gap-2">
              <MapPin className="w-3.5 h-3.5" />
              {hqRow ? "Branch locations" : "Locations"} ({childRows.length})
            </div>
            {childRows.length === 0 ? (
              <EmptyLocationsPrompt parent={parent} onAddLocation={onAddLocation} />
            ) : (
              <div className="space-y-3">
                {childRows.map((loc) => (
                  <LocationCard
                    key={loc.id}
                    location={loc}
                    parent={parent}
                    onEdit={() => onEdit(loc)}
                    onSelect={() => onSelect(loc.id)}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {activeTab === "activity" && (
        <ActivityFeedTab
          parentId={parent.id}
          locations={locations}
          onSelect={onSelect}
        />
      )}
     </div>     
  );
}    

function HQHero({ parent, summary }) {
  const isWhiteLabel = parent.brand_mode === "white_label";
  const stats = [
    {
      label: "Locations",
      value: formatNum(summary.total_locations),
      icon: <MapPin className="w-4 h-4" />,
    },
    {
      label: "Billed to HQ / mo",
      value: formatCents(summary.total_mrr_to_hq_cents),
      icon: <DollarSign className="w-4 h-4" />,
      tooltip: "What you pay to host all locations. Child plans + overrides.",
    },
    {
      label: "Calls (30d)",
      value: formatNum(summary.total_calls_30d),
      icon: <PhoneCall className="w-4 h-4" />,
    },
    {
      label: "Bookings (30d)",
      value: formatNum(summary.total_bookings_30d),
      icon: <CalendarCheck className="w-4 h-4" />,
    },
    {
      label: "Revenue (30d)",
      value: formatCents(summary.total_revenue_30d_cents),
      icon: <TrendingUp className="w-4 h-4" />,
    },
    {
      label: "Open leads",
      value: formatNum(summary.total_open_leads),
      icon: <Users className="w-4 h-4" />,
    },
  ];

  return (
    <div className="bg-gradient-to-br from-stone-900 via-stone-800 to-stone-900 text-white rounded-2xl shadow-lg overflow-hidden">
      <div className="p-6 sm:p-8">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center shrink-0 shadow-lg ring-2 ring-white/10">
            {parent.logo_url ? (
              <img
                src={parent.logo_url}
                alt=""
                className="w-full h-full rounded-xl object-cover"
              />
            ) : (
              <Crown className="w-5 h-5 text-white" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-black text-white truncate">
                {parent.name}
              </h2>
              <span className="px-2 py-0.5 bg-amber-400/20 text-amber-300 text-[10px] font-bold uppercase tracking-wider rounded-md border border-amber-400/30">
                HQ
              </span>
              {parent.parent_mode === "rollup_only" && (
                <span className="px-2 py-0.5 bg-blue-400/20 text-blue-200 text-[10px] font-bold uppercase tracking-wider rounded-md border border-blue-400/30">
                  Rollup only
                </span>
              )}
              {parent.parent_mode === "operating_hq" && (
                <span className="px-2 py-0.5 bg-emerald-400/20 text-emerald-200 text-[10px] font-bold uppercase tracking-wider rounded-md border border-emerald-400/30">
                  Operating HQ
                </span>
              )}
              {isWhiteLabel && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-400/20 text-indigo-200 text-[10px] font-bold uppercase tracking-wider rounded-md border border-indigo-400/30">
                  <Palette className="w-2.5 h-2.5" /> White-labeled
                </span>
              )}
            </div>
            <p className="text-sm text-stone-400 mt-0.5">
              {parent.plan?.charAt(0).toUpperCase() + parent.plan?.slice(1)} plan
              {parent.billing_interval === "annual" && " · Annual billing"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mt-5">
          {stats.map((s) => (
            <div
              key={s.label}
              className="bg-white/5 border border-white/10 rounded-xl p-3"
              title={s.tooltip}
            >
              <div className="flex items-center gap-1.5 text-stone-400 text-[11px] font-medium uppercase tracking-wider">
                {s.icon}
                <span>{s.label}</span>
              </div>
              <div className="mt-1 text-xl font-black text-white tabular-nums">
                {s.value}
              </div>
            </div>
          ))}
        </div>

        {summary.combined_booking_rate > 0 && (
          <div className="mt-4 text-xs text-stone-400">
            Combined booking rate:{" "}
            <span className="text-white font-bold">
              {summary.combined_booking_rate}%
            </span>
            {" · "}
            Across {formatNum(summary.total_calls_30d)} calls (30d)
          </div>
        )}
      </div>
    </div>
  );
}

function InsightsStrip({ insights, onSelect }) {
  const bySeverity = {
    error: insights.filter((i) => i.severity === "error"),
    warning: insights.filter((i) => i.severity === "warning"),
    info: insights.filter((i) => i.severity === "info"),
  };
  const palette = {
    error: {
      wrap: "bg-red-50 border-red-100 text-red-700",
      icon: <AlertCircle className="w-4 h-4 text-red-500" />,
    },
    warning: {
      wrap: "bg-amber-50 border-amber-100 text-amber-800",
      icon: <AlertTriangle className="w-4 h-4 text-amber-500" />,
    },
    info: {
      wrap: "bg-blue-50 border-blue-100 text-blue-800",
      icon: <Info className="w-4 h-4 text-blue-500" />,
    },
  };

  return (
    <div className="mt-6 space-y-2">
      {["error", "warning", "info"].flatMap((sev) =>
        bySeverity[sev].map((i) => {
          const p = palette[sev];
          return (
            <button
              key={i.id}
              onClick={() => i.location_id && onSelect(i.location_id)}
              className={`w-full flex items-center justify-between gap-3 text-left text-sm font-medium px-4 py-3 rounded-xl border ${p.wrap} hover:brightness-95 transition-all`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                {p.icon}
                <span className="truncate">{i.text}</span>
              </div>
              <ChevronRight className="w-4 h-4 shrink-0 opacity-60" />
            </button>
          );
        })
      )}
    </div>
  );
}

function EmptyLocationsPrompt({ parent, onAddLocation }) {
  return (
    <div className="bg-white rounded-2xl border-2 border-dashed border-stone-200 p-8 text-center">
      <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
        <MapPin className="w-7 h-7 text-stone-400" />
      </div>
      <h3 className="text-base font-bold text-stone-900 mb-1">
        No locations yet
      </h3>
      <p className="text-sm text-stone-500 mb-4 max-w-md mx-auto">
        Add a location to {parent.name} to start rolling up calls, bookings, and
        revenue across your whole business.
      </p>
      <button
        onClick={onAddLocation}
        className="inline-flex items-center gap-2 px-4 py-2 bg-stone-900 text-white text-sm font-bold rounded-xl hover:bg-stone-800 transition-colors"
      >
        <Plus className="w-4 h-4" />
        Add your first location
      </button>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// LOCATION CARD
// ═════════════════════════════════════════════════════════════════════════

function LocationCard({ location, parent, onEdit, onSelect }) {
  const isHQ = location.is_hq;
  const isWhiteLabel = location.brand_mode === "white_label";
  const stats = location.stats_30d || {};

  // Determine status for pills
  const isSelfPays = location.billing_responsibility === "self_pays";
  const isPending = location.is_pending_invite;
  const syncFailed = location.stripe_sync_failed;
  const isSuspended = location.is_suspended && !isPending;

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group ${
        syncFailed
          ? "border-red-200 bg-red-50/20"
          : isPending
          ? "border-amber-200 bg-amber-50/20"
          : "border-stone-200"
      }`}
    >
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          {/* Logo */}
          <div
            className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              isHQ
                ? "bg-gradient-to-br from-amber-100 to-amber-50 text-amber-600 ring-2 ring-amber-200/50"
                : "bg-gradient-to-br from-blue-100 to-blue-50 text-blue-600 ring-2 ring-blue-200/50"
            }`}
          >
            {location.logo_url ? (
              <img
                src={location.logo_url}
                alt=""
                className="w-full h-full object-cover rounded-xl"
              />
            ) : isHQ ? (
              <Crown className="w-6 h-6" />
            ) : (
              <MapPin className="w-6 h-6" />
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base font-black text-stone-900 truncate">
                {location.name}
              </h3>
              {isHQ ? (
                <span className="shrink-0 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                  HQ
                </span>
              ) : (
                <span className="shrink-0 px-2 py-0.5 bg-blue-100 text-blue-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                  Branch
                </span>
              )}
              {isSelfPays && (
                <span className="shrink-0 px-2 py-0.5 bg-purple-100 text-purple-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                  Self-pays
                </span>
              )}
              {isWhiteLabel && (
                <span
                  className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold uppercase tracking-wider rounded-md border border-indigo-100"
                  title="White-labeled dashboard"
                >
                  <Palette className="w-2.5 h-2.5" /> WL
                </span>
              )}
              {isPending && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                  <Mail className="w-2.5 h-2.5" /> Pending invite
                </span>
              )}
              {syncFailed && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                  <AlertCircle className="w-2.5 h-2.5" /> Stripe sync failed
                </span>
              )}
              {isSuspended && (
                <span className="shrink-0 px-2 py-0.5 bg-stone-200 text-stone-700 text-[10px] font-bold uppercase tracking-wider rounded-md">
                  Suspended
                </span>
              )}
            </div>

            <p className="text-sm text-stone-500 truncate">
              {location.company_name || "No company name"}
              {!isHQ && (
                <>
                  <span className="text-stone-400"> · under {parent.name}</span>
                </>
              )}
            </p>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <LocStat
                label="Calls (30d)"
                value={formatNum(stats.calls)}
                icon={<PhoneCall className="w-3.5 h-3.5" />}
              />
              <LocStat
                label="Bookings (30d)"
                value={formatNum(stats.bookings)}
                icon={<CalendarCheck className="w-3.5 h-3.5" />}
              />
              <LocStat
                label="Revenue (30d)"
                value={formatCents(stats.revenue_cents)}
                icon={<TrendingUp className="w-3.5 h-3.5" />}
              />
              <LocStat
                label="Booking rate"
                value={`${stats.booking_rate || 0}%`}
                icon={<Users className="w-3.5 h-3.5" />}
                emphasize={stats.calls >= 10 && stats.booking_rate < 40}
              />
            </div>

            {/* Bottom row: cost + meta */}
            <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-3 border-t border-stone-100">
              <div className="flex flex-wrap items-center gap-3 text-xs text-stone-500">
                {location.website && (
                  <span className="flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" />
                    {location.website
                      .replace(/^https?:\/\//, "")
                      .replace(/\/$/, "")}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="font-medium capitalize">{location.plan}</span>
                  {" plan"}
                </span>
                <span className="text-stone-400">
                  {stats.open_leads || 0} open lead
                  {stats.open_leads === 1 ? "" : "s"}
                </span>
              </div>
              {!isHQ && (
                <div
                  className="text-xs font-bold text-stone-700 flex items-center gap-1 px-2.5 py-1 bg-stone-100 rounded-lg"
                  title={
                    isSelfPays
                      ? "Franchisee pays their own bill"
                      : "What this location costs your HQ each month"
                  }
                >
                  <DollarSign className="w-3 h-3" />
                  {isSelfPays
                    ? "Self-pays"
                    : `${formatCents(location.cost_monthly_cents)}/mo to HQ`}
                </div>
              )}
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

function LocStat({ label, value, icon, emphasize }) {
  return (
    <div>
      <div className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-stone-400">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`mt-0.5 text-sm font-bold tabular-nums ${
          emphasize ? "text-amber-600" : "text-stone-900"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// STANDALONE VIEW — for non-parent tenants (or fallback if rollup breaks)
// ═════════════════════════════════════════════════════════════════════════

function StandaloneView({ tenants, onEdit, onSelect, error }) {
  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-stone-900 flex items-center gap-3">
            <Building2 className="text-stone-600" size={28} />
            Businesses
          </h1>
          <p className="text-stone-500 mt-1 text-sm">
            Your business profile.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <div className="space-y-3">
        {tenants.map((t) => (
          <StandaloneTenantCard
            key={t.id}
            tenant={t}
            onEdit={() => onEdit(t)}
            onSelect={() => onSelect(t.id)}
          />
        ))}

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

function StandaloneTenantCard({ tenant, onEdit, onSelect }) {
  const phone =
    tenant.phones?.find((p) => p.is_primary)?.phone || tenant.phones?.[0]?.phone;
  const isWhiteLabel = tenant.brand_mode === "white_label";

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
      <div className="p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 bg-gradient-to-br from-stone-100 to-stone-50 text-stone-600 ring-2 ring-stone-200/50">
            {tenant.logo_url ? (
              <img
                src={tenant.logo_url}
                alt=""
                className="w-full h-full object-cover rounded-xl"
              />
            ) : (
              <Building2 className="w-6 h-6" />
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base font-black text-stone-900 truncate">
                {tenant.name}
              </h3>
              {isWhiteLabel && (
                <span className="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold uppercase tracking-wider rounded-md border border-indigo-100">
                  <Palette className="w-2.5 h-2.5" /> WL
                </span>
              )}
            </div>
            <p className="text-sm text-stone-500 truncate">
              {tenant.company_name || "No company name"}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-3">
              {phone && (
                <span className="flex items-center gap-1 text-xs text-stone-500">
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"
                    />
                  </svg>
                  {phone}
                </span>
              )}
              {tenant.website && (
                <span className="flex items-center gap-1 text-xs text-stone-500">
                  <Globe className="w-3.5 h-3.5" />
                  {tenant.website
                    .replace(/^https?:\/\//, "")
                    .replace(/\/$/, "")}
                </span>
              )}
              <div className="flex items-center gap-1">
                {tenant.has_twilio_credentials && (
                  <IntegrationDot color="green" title="Twilio" />
                )}
                {tenant.google_calendar_linked && (
                  <IntegrationDot color="blue" title="Google Calendar" />
                )}
                {tenant.facebook_page_id && (
                  <IntegrationDot color="indigo" title="Facebook" />
                )}
              </div>
            </div>
          </div>

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
    green: "bg-emerald-400",
    blue: "bg-blue-400",
    indigo: "bg-indigo-400",
  };
  return (
    <span
      className={`block w-2 h-2 rounded-full ${colorMap[color] || "bg-stone-400"}`}
      title={title}
    />
  );
}

// ═════════════════════════════════════════════════════════════════════════
// EDIT VIEW — unchanged in behavior from the old Tenants.jsx, just pulled
// out into its own component so the main file stays readable.
// ═════════════════════════════════════════════════════════════════════════

function EditTenantView({
  editTenant,
  form,
  setField,
  setEditTenant,
  handleSave,
  saveLoading,
  error,
  setError,
}) {
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
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center ${
            editTenant.business_type === "parent" || editTenant.is_hq
              ? "bg-amber-100 text-amber-700"
              : editTenant.business_type === "location"
              ? "bg-blue-100 text-blue-700"
              : "bg-stone-100 text-stone-600"
          }`}
        >
          {editTenant.business_type === "parent" || editTenant.is_hq ? (
            <Crown className="w-5 h-5" />
          ) : editTenant.business_type === "location" ? (
            <MapPin className="w-5 h-5" />
          ) : (
            <Building2 className="w-5 h-5" />
          )}
        </div>
        <div>
          <h1 className="text-xl font-black text-stone-900">
            {editTenant.name}
          </h1>
          <p className="text-xs text-stone-500 capitalize">
            {editTenant.is_hq
              ? "Headquarters"
              : editTenant.business_type || "standalone"}{" "}
            account
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <form
        onSubmit={handleSave}
        className="space-y-8 bg-white rounded-2xl border border-stone-200 p-6 shadow-sm"
      >
        {/* Business image */}
        <div>
          <h3 className="text-sm font-semibold text-stone-700 mb-3">
            Business image
          </h3>
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              <div className="w-20 h-20 rounded-full bg-stone-100 border-2 border-stone-200 overflow-hidden flex items-center justify-center">
                {form.logo_url ? (
                  <img
                    src={form.logo_url}
                    alt="Business"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <Building2 className="w-8 h-8 text-stone-400" />
                )}
              </div>
              {form.logo_url && (
                <button
                  type="button"
                  onClick={() => setField("logo_url", "")}
                  className="absolute -top-0.5 -right-0.5 w-6 h-6 rounded-full bg-stone-800 text-white flex items-center justify-center hover:bg-stone-700 shadow transition-colors"
                  title="Remove image"
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
                  if (!file) return;
                  if (!file.type.startsWith("image/")) {
                    setError("Please upload a valid image file.");
                    return;
                  }
                  if (file.size > MAX_LOGO_BYTES) {
                    setError("Image too large (max 1MB).");
                    e.target.value = "";
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () =>
                    setField("logo_url", reader.result || "");
                  reader.readAsDataURL(file);
                  e.target.value = "";
                }}
              />
              <label
                htmlFor="business-image-upload"
                className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-white bg-stone-900 hover:bg-black rounded-lg cursor-pointer shadow-sm transition-colors"
              >
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
              <label className="block text-sm font-medium text-stone-700">
                Display name
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                value={form.name || ""}
                onChange={(e) => setField("name", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-stone-700">
                Company name
              </label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                value={form.company_name || ""}
                onChange={(e) => setField("company_name", e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <label className="block text-sm font-medium text-stone-700">
                Website
              </label>
              <input
                type="url"
                placeholder="https://example.com"
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                value={form.website || ""}
                onChange={(e) => setField("website", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-stone-700">
                Timezone
              </label>
              <select
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent"
                value={form.timezone || "America/Chicago"}
                onChange={(e) => setField("timezone", e.target.value)}
              >
                <option value="America/Chicago">America/Chicago (CST)</option>
                <option value="America/New_York">America/New_York (EST)</option>
                <option value="America/Los_Angeles">
                  America/Los_Angeles (PST)
                </option>
                <option value="Europe/London">Europe/London (GMT)</option>
              </select>
            </div>
          </div>
        </div>

        {/* AI & identity */}
        <div className="pt-6 border-t border-stone-100">
          <h3 className="text-sm font-semibold text-stone-700 mb-4 flex items-center gap-2">
            <Bot size={16} className="text-stone-500" /> AI & identity
          </h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-stone-700">
                Welcome message
              </label>
              <textarea
                rows={2}
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent resize-none"
                value={form.welcome_message || ""}
                onChange={(e) => setField("welcome_message", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="block text-sm font-medium text-stone-700">
                Response tone
              </label>
              <select
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent"
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
              <label className="block text-sm font-medium text-stone-700">
                AI instructions
              </label>
              <textarea
                rows={4}
                className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-500 focus:border-transparent font-mono"
                value={form.instructions || ""}
                onChange={(e) => setField("instructions", e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Integrations (read-only) */}
        <div className="pt-6 border-t border-stone-100">
          <h3 className="text-sm font-semibold text-stone-700 mb-3">
            Integrations
          </h3>
          <div className="flex flex-wrap gap-2">
            <IntegrationBadge
              active={form.has_twilio_credentials}
              icon={<Zap size={12} />}
              name="Twilio"
            />
            <IntegrationBadge
              active={form.google_calendar_linked}
              icon={<Calendar size={12} />}
              name="Google"
            />
            <IntegrationBadge
              active={!!form.facebook_page_id}
              icon={<Facebook size={12} />}
              name="Facebook"
            />
            <IntegrationBadge
              active={!!form.crm_webhook_url}
              icon={<Shield size={12} />}
              name="CRM"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-4 pt-4">
          <button
            type="submit"
            disabled={saveLoading}
            className="px-6 py-2.5 bg-stone-900 text-white text-sm font-medium rounded-xl hover:bg-stone-800 disabled:opacity-50 flex items-center gap-2 transition-colors"
          >
            {saveLoading && <Loader2 className="w-4 h-4 animate-spin" />}
            Save changes
          </button>
          <button
            type="button"
            onClick={() => setEditTenant(null)}
            className="text-sm text-stone-500 hover:text-stone-700 font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function IntegrationBadge({ active, icon, name }) {
  return (
    <div
      className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
        active
          ? "bg-green-50 text-green-700 border border-green-100"
          : "bg-stone-50 text-stone-500 border border-stone-100"
      }`}
    >
      {icon}
      <span>{name}</span>
      {active && <CheckCircle2 size={12} className="text-green-600" />}
    </div>
  );
}

      // ═════════════════════════════════════════════════════════════════════════
// ACTIVITY FEED TAB — Apr 21, 2026
// Cross-location event stream from /api/rollup/:parentId/activity.
// Filter by location, paginate back 7d → 30d → further.
// ═════════════════════════════════════════════════════════════════════════

function ActivityFeedTab({ parentId, locations, onSelect }) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(true);
  const [locationFilter, setLocationFilter] = useState("all");

  // Load initial feed on mount OR when locationFilter changes.
  useEffect(() => {
    loadFirstPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationFilter]);

  async function loadFirstPage() {
    setLoading(true);
    setError("");
    setEvents([]);
    setNextCursor(null);
    setHasMore(true);
    try {
      const opts = { limit: 50 };
      if (locationFilter !== "all") opts.locationId = locationFilter;
      const data = await getRollupActivity(parentId, opts);
      setEvents(data.events || []);
      setNextCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (e) {
      setError(e.message || "Failed to load activity");
    } finally {
      setLoading(false);
    }
  }

  async function loadNextPage() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const opts = { limit: 50, before: nextCursor };
      if (locationFilter !== "all") opts.locationId = locationFilter;
      const data = await getRollupActivity(parentId, opts);
      setEvents((prev) => [...prev, ...(data.events || [])]);
      setNextCursor(data.nextCursor);
      setHasMore(!!data.nextCursor);
    } catch (e) {
      setError(e.message || "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  const locationOptions = [
    { value: "all", label: "All locations" },
    ...locations.map((l) => ({
      value: l.id,
      label: l.name + (l.is_hq ? " (HQ)" : ""),
    })),
  ];

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <span className="text-xs font-bold uppercase tracking-wider text-stone-400">
          Filter
        </span>
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-sm font-medium text-stone-700 hover:border-stone-300 focus:ring-2 focus:ring-stone-500 focus:border-transparent"
        >
          {locationOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-stone-400 ml-auto">
          Last 7 days · newest first
        </span>
      </div>

      {error && (
        <div className="mb-4 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 text-stone-400 animate-spin" />
        </div>
      ) : events.length === 0 ? (
        <ActivityEmptyState />
      ) : (
        <>
          <div className="space-y-2">
            {events.map((ev) => (
              <ActivityEventRow key={ev.id} event={ev} onSelect={onSelect} />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center mt-6">
              <button
                onClick={loadNextPage}
                disabled={loadingMore}
                className="px-4 py-2 bg-white border border-stone-200 rounded-xl text-sm font-bold text-stone-700 hover:bg-stone-50 hover:border-stone-300 disabled:opacity-50 flex items-center gap-2 transition-all"
              >
                {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                Load older events
              </button>
            </div>
          )}

          {!hasMore && events.length > 0 && (
            <div className="text-center mt-6 text-xs text-stone-400">
              End of activity
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ActivityEmptyState() {
  return (
    <div className="bg-white rounded-2xl border-2 border-dashed border-stone-200 p-10 text-center">
      <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
        <Activity className="w-7 h-7 text-stone-400" />
      </div>
      <h3 className="text-base font-bold text-stone-900 mb-1">
        No activity yet
      </h3>
      <p className="text-sm text-stone-500 max-w-md mx-auto">
        When new leads, bookings, or calls happen across your locations, they'll
        show up here in real-time.
      </p>
    </div>
  );
}

function ActivityEventRow({ event, onSelect }) {
  const cfg = EVENT_CONFIG[event.type] || EVENT_CONFIG.default;

  return (
    <button
      onClick={() => onSelect && onSelect(event.tenantId)}
      className="w-full bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md hover:border-stone-300 transition-all text-left px-4 py-3 flex items-start gap-3 group"
    >
      <div
        className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${cfg.iconWrap}`}
      >
        <cfg.Icon className={`w-5 h-5 ${cfg.iconColor}`} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-black text-stone-900 truncate">
            {event.title || cfg.defaultTitle}
          </span>
          <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 px-1.5 py-0.5 bg-stone-100 rounded">
            {event.tenantName}
          </span>
        </div>
        {event.body && (
          <p className="text-xs text-stone-500 mt-0.5 line-clamp-2">
            {event.body}
          </p>
        )}
      </div>

      <div className="shrink-0 text-[10px] font-medium text-stone-400 whitespace-nowrap pt-1">
        {formatRelativeTime(event.createdAt)}
      </div>
    </button>
  );
}

const EVENT_CONFIG = {
  new_lead: {
    Icon: UserPlus,
    iconWrap: "bg-blue-50",
    iconColor: "text-blue-600",
    defaultTitle: "New lead",
  },
  lead_captured: {
    Icon: UserPlus,
    iconWrap: "bg-blue-50",
    iconColor: "text-blue-600",
    defaultTitle: "Lead info captured",
  },
  booking_created: {
    Icon: CalendarCheck,
    iconWrap: "bg-emerald-50",
    iconColor: "text-emerald-600",
    defaultTitle: "New booking",
  },
  missed_call: {
    Icon: PhoneMissed,
    iconWrap: "bg-amber-50",
    iconColor: "text-amber-600",
    defaultTitle: "Missed call",
  },
  transfer_requested: {
    Icon: PhoneCall,
    iconWrap: "bg-indigo-50",
    iconColor: "text-indigo-600",
    defaultTitle: "Transfer requested",
  },
  revenue_recovered: {
    Icon: DollarSign,
    iconWrap: "bg-emerald-50",
    iconColor: "text-emerald-600",
    defaultTitle: "Revenue recorded",
  },
  negative_review: {
    Icon: Star,
    iconWrap: "bg-red-50",
    iconColor: "text-red-600",
    defaultTitle: "Negative review",
  },
  review_received: {
    Icon: Star,
    iconWrap: "bg-amber-50",
    iconColor: "text-amber-600",
    defaultTitle: "Review received",
  },
  spam_detected: {
    Icon: AlertCircle,
    iconWrap: "bg-stone-100",
    iconColor: "text-stone-500",
    defaultTitle: "Spam call",
  },
  default: {
    Icon: Activity,
    iconWrap: "bg-stone-100",
    iconColor: "text-stone-500",
    defaultTitle: "Event",
  },
};

function formatRelativeTime(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

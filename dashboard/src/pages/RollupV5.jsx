import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import { getTenants, getRollupV5 } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { useBrand } from "../contexts/BrandContext";
import {
  Building2,
  MapPin,
  Crown,
  Phone,
  PhoneCall,
  PhoneMissed,
  Moon,
  TrendingUp,
  TrendingDown,
  Star,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Sparkles,
  Globe,
  MessageSquare,
  Facebook,
  Zap,
  HelpCircle,
  CheckCircle2,
  Info,
  ArrowUpDown,
  Target,
  Users,
  DollarSign,
  Trophy,
  Clock,
  Activity,
} from "lucide-react";

// ═════════════════════════════════════════════════════════════════════════
// Rollup V5 — Parent Tenant Dashboard
// ═════════════════════════════════════════════════════════════════════════

function formatCents(cents) {
  if (cents == null) return "$0";
  const dollars = cents / 100;
  if (dollars === 0) return "$0";
  if (Math.abs(dollars) >= 1000) {
    return `$${Math.round(dollars).toLocaleString()}`;
  }
  return `$${dollars.toFixed(2)}`;
}

function formatNum(n) {
  if (n == null) return "0";
  return Number(n).toLocaleString();
}

function formatPct(n) {
  if (n == null) return "—";
  return `${n}%`;
}

function formatRating(r) {
  if (r == null) return "—";
  return Number(r).toFixed(1);
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const CONTACT_METHOD_LABELS = {
  voice:    "Phone",
  sms:      "SMS",
  web_form: "Web form",
  facebook: "Facebook",
  crm:      "CRM",
  unknown:  "Unknown",
};

const CONTACT_METHOD_ICONS = {
  voice:    PhoneCall,
  sms:      MessageSquare,
  web_form: Globe,
  facebook: Facebook,
  crm:      Zap,
  unknown:  HelpCircle,
};

const CONTACT_METHOD_COLORS = {
  voice:    "bg-blue-500",
  sms:      "bg-emerald-500",
  web_form: "bg-amber-500",
  facebook: "bg-indigo-500",
  crm:      "bg-purple-500",
  unknown:  "bg-stone-400",
};

const LEAD_SOURCE_COLORS = {
  "Google Ads": "#3b82f6",
  "LSA":        "#0ea5e9",
  "Facebook":   "#6366f1",
  "Website":    "#10b981",
  "Yelp":       "#ef4444",
  "Angi":       "#f97316",
  "Thumbtack":  "#8b5cf6",
  "Houzz":      "#14b8a6",
  "Phone":      "#eab308",
  "CRM":        "#a855f7",
  "Referral":   "#ec4899",
  "Other":      "#64748b",
  "Unknown":    "#a8a29e",
};

// Call outcome buckets — SIMPLIFIED 4-bucket Apr 24 (was 6, rolled back)
// Backend only emits: booked, transferred, spam, other.
const CALL_OUTCOME_CONFIG = {
  booked:      { label: "Booked",            color: "emerald", icon: CheckCircle2 },
  transferred: { label: "Transferred",       color: "blue",    icon: PhoneCall    },
  other:       { label: "Other / in-progress", color: "stone",  icon: Activity     },
  spam:        { label: "Spam filtered",     color: "purple",  icon: AlertCircle  },
};

const CALL_OUTCOME_ORDER = ["booked", "transferred", "other", "spam"];

const SORT_LABELS = {
  tenant_name:          "Location",
  calls_total:          "Calls",
  bookings_total:       "Bookings",
  booking_rate_pct:     "Booking rate",
  revenue_cents:        "Revenue",
  avg_rating:           "Rating",
  review_count:         "Reviews",
  pending_alerts_count: "Alerts",
  open_leads:           "Open leads",
};

// ═════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═════════════════════════════════════════════════════════════════════════
export default function RollupV5() {
  const { tenantId, onTenantChange } = useOutletContext() || {};
  const navigate = useNavigate();
  const brand = useBrand();

  const [parentId, setParentId]       = useState(null);
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [error, setError]             = useState("");

  const [period, setPeriod] = useState("30d");
  const [sort, setSort]     = useState("revenue_cents");
  const [dir, setDir]       = useState("desc");

  useEffect(() => {
    resolveParent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  async function resolveParent() {
    setLoading(true);
    setError("");
    try {
      const tenantsResponse = await getTenants();
      const list = tenantsResponse?.tenants || [];
      const primary = list[0];

      if (!primary?.id) {
        setError("No tenant found for this user.");
        setLoading(false);
        return;
      }

      const isParent =
        !!primary.parent_mode ||
        primary.business_type === "parent" ||
        list.some((t) => t.parent_id === primary.id);

      if (isParent) {
        setParentId(primary.id);
      } else if (primary.parent_id) {
        setParentId(primary.parent_id);
      } else {
        setParentId(null);
        setLoading(false);
        setError(
          "This dashboard is only available for parent tenants with child locations."
        );
      }
    } catch (e) {
      setError(e.message || "Failed to load business info");
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!parentId) return;
    fetchRollup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentId, period, sort, dir]);

  async function fetchRollup() {
    if (data) setRefreshing(true);
    else setLoading(true);

    try {
      const result = await getRollupV5(parentId, { period, sort, dir });
      setData(result);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load rollup data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  function handleSort(column) {
    if (sort === column) {
      setDir((prev) => (prev === "desc" ? "asc" : "desc"));
    } else {
      setSort(column);
      setDir(column === "tenant_name" ? "asc" : "desc");
    }
  }

  function handleLocationClick(locationId) {
    if (onTenantChange) onTenantChange(locationId);
    navigate("/dashboard");
  }

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-20">
        <LumaSpin />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
        <Link
          to="/tenants"
          className="text-sm font-medium text-stone-600 hover:text-stone-900 transition-colors"
        >
          ← Back to Businesses (V4)
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const {
    parent, meta, tiles,
    contact_method_donut,
    lead_source_donut,
    revenue_goals_panel,
    call_outcomes_panel,
    reviews_alerts,
    locations,
  } = data;

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <Header
        parent={parent}
        meta={meta}
        period={period}
        setPeriod={setPeriod}
        refreshing={refreshing}
      />

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4 mb-8">
        <AiActivityTile data={tiles.ai_activity} period={period} />
        <AfterHoursRevenueTile data={tiles.after_hours_revenue} period={period} />
        <NetworkRevenueTile data={tiles.network_revenue} period={period} />
        <ReviewsHealthTile data={tiles.reviews_health} />
        <MissedOppsTile data={tiles.missed_opps} period={period} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <ContactMethodDonut data={contact_method_donut} period={period} />
        <LeadSourceDonut data={lead_source_donut} period={period} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
        <RevenueGoalsPanel
          data={revenue_goals_panel}
          onLocationClick={handleLocationClick}
        />
        <CallOutcomesPanel data={call_outcomes_panel} period={period} />
      </div>

      <div className="mb-8">
        <ReviewsAlertsPanel data={reviews_alerts} />
      </div>

      <LocationTable
        locations={locations}
        sort={sort}
        dir={dir}
        onSort={handleSort}
        onRowClick={handleLocationClick}
      />

      <div className="mt-8 text-center">
        <Link
          to="/tenants"
          className="text-xs text-stone-400 hover:text-stone-600 font-medium transition-colors"
        >
          ← Switch to Businesses (V4)
        </Link>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// HEADER
// ═════════════════════════════════════════════════════════════════════════
function Header({ parent, meta, period, setPeriod, refreshing }) {
  const periods = [
    { value: "7d",  label: "7d"  },
    { value: "30d", label: "30d" },
    { value: "90d", label: "90d" },
  ];

  const count = meta.location_count;
  const hqSuffix = meta.includes_parent ? " (HQ + branches)" : "";

  return (
    <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
      <div>
        <h1 className="text-2xl font-black text-stone-900 flex items-center gap-3">
          <Sparkles className="text-brand-600" size={28} />
          Business Rollup
          {refreshing && (
            <span className="text-xs font-medium text-stone-400 normal-case tracking-normal">
              Refreshing...
            </span>
          )}
        </h1>
        <p className="text-stone-500 mt-1 text-sm">
          {parent.company_name || parent.name} ·{" "}
          {formatNum(count)}{" "}
          location{count !== 1 ? "s" : ""}
          {hqSuffix}
        </p>
      </div>

      <div className="flex items-center gap-1 p-1 bg-stone-100/80 rounded-xl">
        {periods.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-all ${
              period === p.value
                ? "bg-white text-stone-900 shadow-sm"
                : "text-stone-500 hover:text-stone-700"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// HERO TILES (1-5)
// ═════════════════════════════════════════════════════════════════════════
function AiActivityTile({ data, period }) {
  return (
    <TileShell
      icon={<PhoneCall className="w-4 h-4" />}
      label="AI Activity"
      subtitle={`Calls + bookings · ${period}`}
      color="blue"
    >
      <div className="text-3xl font-black text-stone-900 tabular-nums tracking-tight">
        {formatNum(data.calls_total)}
      </div>
      <div className="text-xs font-medium text-stone-500 mt-0.5">
        calls handled
      </div>
      <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-xs">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-stone-400 font-bold">
            Booked
          </div>
          <div className="text-sm font-black text-stone-900 tabular-nums">
            {formatNum(data.bookings_total)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-stone-400 font-bold">
            Rate
          </div>
          <div className="text-sm font-black text-emerald-600 tabular-nums">
            {formatPct(data.booking_rate_pct)}
          </div>
        </div>
      </div>
    </TileShell>
  );
}

function AfterHoursRevenueTile({ data, period }) {
  return (
    <TileShell
      icon={<Moon className="w-4 h-4" />}
      label="After-Hours Revenue"
      subtitle={`AI-captured · ${period}`}
      color="indigo"
      highlight
    >
      <div className="text-3xl font-black text-stone-900 tabular-nums tracking-tight">
        {formatCents(data.after_hours_revenue_cents)}
      </div>
      <div className="text-xs font-medium text-stone-500 mt-0.5">
        {formatNum(data.after_hours_booking_count)} booking
        {data.after_hours_booking_count !== 1 ? "s" : ""} outside hours
      </div>
      <div className="mt-3 pt-3 border-t border-stone-100 text-xs text-stone-600">
        <span className="font-bold text-stone-900">
          {data.after_hours_pct_of_total != null
            ? `${data.after_hours_pct_of_total}%`
            : "—"}
        </span>
        <span className="text-stone-400"> of total revenue</span>
      </div>
    </TileShell>
  );
}

function NetworkRevenueTile({ data, period }) {
  const isUp   = data.delta_direction === "up";
  const isDown = data.delta_direction === "down";
  const isLowConfidence = data.confidence === "low";

  const TrendIcon = isUp ? TrendingUp : isDown ? TrendingDown : null;
  const trendColor = isLowConfidence
    ? "text-stone-400"
    : isUp
    ? "text-emerald-600"
    : isDown
    ? "text-red-500"
    : "text-stone-500";

  return (
    <TileShell
      icon={<TrendingUp className="w-4 h-4" />}
      label="Network Revenue"
      subtitle={`Total · ${period}`}
      color="emerald"
    >
      <div className="text-3xl font-black text-stone-900 tabular-nums tracking-tight">
        {formatCents(data.current_cents)}
      </div>
      <div className="text-xs font-medium text-stone-500 mt-0.5">
        confirmed revenue
      </div>
      <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-xs">
        <div className={`flex items-center gap-1 ${trendColor} font-bold`}>
          {TrendIcon && <TrendIcon className="w-3.5 h-3.5" />}
          <span className="tabular-nums">
            {data.delta_pct != null
              ? `${data.delta_pct > 0 ? "+" : ""}${data.delta_pct}%`
              : data.delta_cents > 0
              ? `+${formatCents(data.delta_cents)}`
              : "—"}
          </span>
          <span className="text-stone-400 font-medium">vs prior {period}</span>
        </div>
        {isLowConfidence && (
          <span
            className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-stone-400"
            title={`Only ${data.parent_age_days} days of data — trend may be noisy`}
          >
            <Info className="w-2.5 h-2.5" />
            Low conf
          </span>
        )}
      </div>
    </TileShell>
  );
}

function ReviewsHealthTile({ data }) {
  const hasAlerts    = data.prominent_alert_count > 0;
  const noReviews    = data.total_review_count === 0;
  const noneConnected = data.oauth_connected_count === 0;

  if (noReviews) {
    return (
      <TileShell
        icon={<Star className="w-4 h-4" />}
        label="Reviews Health"
        subtitle="No data yet"
        color="amber"
      >
        <div className="py-2">
          <div className="flex items-center gap-2 text-stone-700 font-bold text-sm mb-1">
            <Info className="w-4 h-4 text-stone-400" />
            {noneConnected ? "Not connected" : "Waiting for reviews"}
          </div>
          <p className="text-xs text-stone-500 leading-snug mb-3">
            {noneConnected
              ? "Connect Google Business Profile to start tracking reviews across your locations."
              : "Google is connected — reviews will appear here as they come in."}
          </p>
          {noneConnected && (
            <Link
              to="/reviews"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700 transition-colors"
            >
              Connect Google
              <ChevronRight className="w-3 h-3" />
            </Link>
          )}
        </div>
      </TileShell>
    );
  }

  return (
    <TileShell
      icon={<Star className="w-4 h-4" />}
      label="Reviews Health"
      subtitle="Lifetime avg"
      color="amber"
    >
      <div className="flex items-baseline gap-1.5">
        <div className="text-3xl font-black text-stone-900 tabular-nums tracking-tight">
          {formatRating(data.avg_rating_lifetime)}
        </div>
        <Star
          className="w-5 h-5 text-amber-500 fill-amber-500"
          strokeWidth={1.5}
        />
      </div>
      <div className="text-xs font-medium text-stone-500 mt-0.5">
        across {formatNum(data.total_review_count)} review
        {data.total_review_count !== 1 ? "s" : ""}
      </div>
      <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-xs">
        {hasAlerts ? (
          <div className="flex items-center gap-1 text-red-600 font-bold">
            <AlertTriangle className="w-3.5 h-3.5" />
            <span className="tabular-nums">
              {formatNum(data.prominent_alert_count)}
            </span>
            <span className="text-stone-500 font-medium">pending</span>
          </div>
        ) : (
          <div className="flex items-center gap-1 text-emerald-600 font-bold">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>All clear</span>
          </div>
        )}
        <span
          className="text-[10px] font-bold uppercase tracking-wider text-stone-400"
          title={`${data.oauth_connected_count} of ${data.total_tenant_count} locations have Google connected`}
        >
          {data.oauth_connected_count}/{data.total_tenant_count} linked
        </span>
      </div>
    </TileShell>
  );
}

function MissedOppsTile({ data, period }) {
  const hasLostValue = data.estimated_lost_cents > 0;
  const noData = data.total_calls === 0;

  if (noData) {
    return (
      <TileShell
        icon={<PhoneMissed className="w-4 h-4" />}
        label="Missed Opps"
        subtitle={`At-risk calls · ${period}`}
        color="red"
      >
        <div className="py-2">
          <div className="flex items-center gap-2 text-stone-700 font-bold text-sm mb-1">
            <Info className="w-4 h-4 text-stone-400" />
            No calls yet
          </div>
          <p className="text-xs text-stone-500 leading-snug">
            When calls come in and don't convert, we'll surface them here.
          </p>
        </div>
      </TileShell>
    );
  }

  return (
    <TileShell
      icon={<PhoneMissed className="w-4 h-4" />}
      label="Missed Opps"
      subtitle={`At-risk calls · ${period}`}
      color="red"
    >
      <div className="text-3xl font-black text-stone-900 tabular-nums tracking-tight">
        {formatNum(data.missed_count)}
      </div>
      <div className="text-xs font-medium text-stone-500 mt-0.5">
        calls without conversion
      </div>
      <div className="mt-3 pt-3 border-t border-stone-100 flex items-center justify-between text-xs">
        {hasLostValue ? (
          <div className="flex items-center gap-1">
            <DollarSign className="w-3.5 h-3.5 text-stone-400" />
            <span className="text-sm font-black text-stone-900 tabular-nums">
              {formatCents(data.estimated_lost_cents)}
            </span>
            <span className="text-stone-400 font-medium">est. at risk</span>
          </div>
        ) : (
          <span className="text-stone-400 font-medium">No $ estimate yet</span>
        )}
        {data.data_quality_warning && (
          <span
            className="inline-flex items-center gap-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-600"
            title={`${data.null_disposition_count} calls untagged — estimate may be off`}
          >
            <Info className="w-2.5 h-2.5" />
            Low conf
          </span>
        )}
      </div>
    </TileShell>
  );
}

function TileShell({ icon, label, subtitle, color, highlight, children }) {
  const colorClasses = {
    blue:    "from-blue-50 text-blue-600 ring-blue-200/50",
    indigo:  "from-indigo-50 text-indigo-600 ring-indigo-200/50",
    emerald: "from-emerald-50 text-emerald-600 ring-emerald-200/50",
    amber:   "from-amber-50 text-amber-600 ring-amber-200/50",
    red:     "from-red-50 text-red-600 ring-red-200/50",
  };

  return (
    <div
      className={`bg-white rounded-2xl border shadow-sm hover:shadow-md transition-all p-5 ${
        highlight ? "border-brand-200" : "border-stone-200"
      }`}
    >
      <div className="flex items-center gap-2 mb-3">
        <div
          className={`w-7 h-7 rounded-lg bg-gradient-to-br to-white flex items-center justify-center ring-1 ${colorClasses[color] || colorClasses.blue}`}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-black text-stone-900 uppercase tracking-wider leading-tight">
            {label}
          </div>
          <div className="text-[10px] text-stone-400 font-medium leading-tight">
            {subtitle}
          </div>
        </div>
      </div>
      {children}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// CONTACT METHOD DONUT
// ═════════════════════════════════════════════════════════════════════════
function ContactMethodDonut({ data, period }) {
  const size = 140, stroke = 18;
  const radius = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  const slicesWithCounts = data.buckets.filter((b) => b.count > 0);
  const hasData = data.total_leads > 0;

  let cumulative = 0;

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-black text-stone-900">Contact Method</h3>
          <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wider mt-0.5">
            How leads reached you · {period}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-stone-900 tabular-nums">
            {formatNum(data.total_leads)}
          </div>
          <div className="text-[10px] text-stone-400 font-medium uppercase tracking-wider">
            total leads
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="shrink-0 relative">
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f5f5f4" strokeWidth={stroke} />
            {hasData &&
              slicesWithCounts.map((bucket) => {
                const pct = bucket.count / data.total_leads;
                const dash = pct * circumference;
                const offset = -cumulative * circumference;
                cumulative += pct;

                return (
                  <circle
                    key={bucket.method}
                    cx={cx} cy={cy} r={radius}
                    fill="none"
                    stroke={getContactSliceColor(bucket.method)}
                    strokeWidth={stroke}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={offset}
                  />
                );
              })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-lg font-black text-stone-900 tabular-nums">
              {formatNum(data.total_leads)}
            </div>
            <div className="text-[9px] text-stone-400 font-bold uppercase tracking-wider">
              leads
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          {data.buckets.map((bucket) => {
            const Icon = CONTACT_METHOD_ICONS[bucket.method];
            return (
              <div key={bucket.method} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`shrink-0 w-2 h-2 rounded-full ${CONTACT_METHOD_COLORS[bucket.method]}`} />
                  <Icon className="w-3.5 h-3.5 text-stone-400 shrink-0" />
                  <span className="font-medium text-stone-700 truncate">
                    {CONTACT_METHOD_LABELS[bucket.method]}
                  </span>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className="font-bold text-stone-900 tabular-nums">
                    {formatNum(bucket.count)}
                  </span>
                  <span className="text-stone-400 tabular-nums w-10 text-right">
                    {bucket.pct}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {data.unknown_count > 0 && data.total_leads > 0 && (
        <div className="mt-4 pt-3 border-t border-stone-100 flex items-center gap-2 text-[11px] text-stone-500">
          <Info className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          <span>
            {formatNum(data.unknown_count)} lead
            {data.unknown_count !== 1 ? "s" : ""} missing source — check your integrations
          </span>
        </div>
      )}
    </div>
  );
}

function getContactSliceColor(method) {
  const colorHex = {
    voice:    "#3b82f6",
    sms:      "#10b981",
    web_form: "#f59e0b",
    facebook: "#6366f1",
    crm:      "#a855f7",
    unknown:  "#a8a29e",
  };
  return colorHex[method] || "#a8a29e";
}

// ═════════════════════════════════════════════════════════════════════════
// LEAD SOURCE DONUT
// ═════════════════════════════════════════════════════════════════════════
function LeadSourceDonut({ data, period }) {
  const size = 140, stroke = 18;
  const radius = (size - stroke) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * radius;

  const slicesWithCounts = data.buckets.filter((b) => b.count > 0);
  const hasData = data.total_leads > 0;

  const unknownPct = data.total_leads > 0
    ? (data.unknown_count / data.total_leads) * 100
    : 0;
  const highUnknown = unknownPct >= 30;

  let cumulative = 0;

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-black text-stone-900">Lead Source</h3>
          <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wider mt-0.5">
            Marketing origin · {period}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-stone-900 tabular-nums">
            {formatNum(data.total_leads)}
          </div>
          <div className="text-[10px] text-stone-400 font-medium uppercase tracking-wider">
            total leads
          </div>
        </div>
      </div>

      <div className="flex items-center gap-6">
        <div className="shrink-0 relative">
          <svg width={size} height={size} className="-rotate-90">
            <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f5f5f4" strokeWidth={stroke} />
            {hasData &&
              slicesWithCounts.map((bucket) => {
                const pct = bucket.count / data.total_leads;
                const dash = pct * circumference;
                const offset = -cumulative * circumference;
                cumulative += pct;

                return (
                  <circle
                    key={bucket.source}
                    cx={cx} cy={cy} r={radius}
                    fill="none"
                    stroke={LEAD_SOURCE_COLORS[bucket.source] || "#a8a29e"}
                    strokeWidth={stroke}
                    strokeDasharray={`${dash} ${circumference - dash}`}
                    strokeDashoffset={offset}
                  />
                );
              })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <div className="text-lg font-black text-stone-900 tabular-nums">
              {formatNum(data.total_leads)}
            </div>
            <div className="text-[9px] text-stone-400 font-bold uppercase tracking-wider">
              leads
            </div>
          </div>
        </div>

        <div className="flex-1 min-w-0 space-y-1.5">
          {hasData ? (
            slicesWithCounts.map((bucket) => (
              <div key={bucket.source} className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="shrink-0 w-2 h-2 rounded-full"
                    style={{ backgroundColor: LEAD_SOURCE_COLORS[bucket.source] || "#a8a29e" }}
                  />
                  <span className="font-medium text-stone-700 truncate">
                    {bucket.source}
                  </span>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                  <span className="font-bold text-stone-900 tabular-nums">
                    {formatNum(bucket.count)}
                  </span>
                  <span className="text-stone-400 tabular-nums w-10 text-right">
                    {bucket.pct}%
                  </span>
                </div>
              </div>
            ))
          ) : (
            <div className="text-xs text-stone-400 italic">
              No leads in this period
            </div>
          )}
        </div>
      </div>

      {highUnknown && data.total_leads > 0 && (
        <div className="mt-4 pt-3 border-t border-stone-100 flex items-start gap-2 text-[11px] text-amber-700 bg-amber-50 -mx-5 -mb-5 px-5 py-3 rounded-b-2xl">
          <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
          <span>
            <strong>{Math.round(unknownPct)}% of leads have no source tracked.</strong>{" "}
            Tag leads with a source in your CRM to unlock marketing attribution.
          </span>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// REVENUE GOALS PANEL
// ═════════════════════════════════════════════════════════════════════════
function RevenueGoalsPanel({ data, onLocationClick }) {
  const hasNetworkGoal = data.network_goal_cents > 0;
  const monthName = MONTH_NAMES[data.current_month] || "This month";

  if (!hasNetworkGoal) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-black text-stone-900 flex items-center gap-2">
              <Target className="w-4 h-4 text-brand-600" />
              Revenue Goals
            </h3>
            <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wider mt-0.5">
              {monthName}
            </p>
          </div>
        </div>

        <div className="text-center py-8">
          <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
            <Target className="w-6 h-6 text-stone-400" />
          </div>
          <h4 className="text-sm font-bold text-stone-900 mb-1">No goals set</h4>
          <p className="text-xs text-stone-500 mb-3 max-w-[280px] mx-auto">
            Set monthly revenue targets for your locations to track attainment.
          </p>
          <Link
            to="/metrics"
            className="inline-flex items-center gap-1 text-[11px] font-bold text-brand-600 hover:text-brand-700 transition-colors"
          >
            Set goals in Metrics
            <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>
    );
  }

  const attainmentPct = data.network_attainment_pct || 0;
  const remainingCents = Math.max(0, data.network_goal_cents - data.network_actual_cents);

  const daysInMonth = data.days_remaining + (new Date().getDate());
  const pctMonthElapsed = daysInMonth > 0
    ? ((daysInMonth - data.days_remaining) / daysInMonth) * 100
    : 50;
  const onPace = attainmentPct >= pctMonthElapsed * 0.9;

  let barColor, barLabel;
  if (attainmentPct >= 100) {
    barColor = "bg-emerald-500";
    barLabel = "text-emerald-600";
  } else if (onPace) {
    barColor = "bg-blue-500";
    barLabel = "text-blue-600";
  } else {
    barColor = "bg-amber-500";
    barLabel = "text-amber-600";
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-black text-stone-900 flex items-center gap-2">
            <Target className="w-4 h-4 text-brand-600" />
            Revenue Goals
          </h3>
          <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wider mt-0.5">
            {monthName} · {data.locations_with_goal} location{data.locations_with_goal !== 1 ? "s" : ""} tracking
          </p>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-black tabular-nums ${barLabel}`}>
            {formatPct(attainmentPct)}
          </div>
          <div className="text-[10px] text-stone-400 font-medium uppercase tracking-wider">
            of goal
          </div>
        </div>
      </div>

      <div className="mb-4">
        <div className="flex items-baseline justify-between mb-1.5">
          <span className="text-sm font-black text-stone-900 tabular-nums">
            {formatCents(data.network_actual_cents)}
          </span>
          <span className="text-xs text-stone-400 font-medium">
            of {formatCents(data.network_goal_cents)}
          </span>
        </div>
        <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${Math.min(100, attainmentPct)}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-1.5 text-[10px] text-stone-400 font-medium">
          <span className="flex items-center gap-1">
            <DollarSign className="w-3 h-3" />
            {formatCents(remainingCents)} remaining
          </span>
          <span className="flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {data.days_remaining} day{data.days_remaining !== 1 ? "s" : ""} left
          </span>
        </div>
      </div>

      {data.top_performers.length > 0 && (
        <div className="pt-4 border-t border-stone-100">
          <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-stone-400 mb-3">
            <Trophy className="w-3 h-3 text-amber-500" />
            Top Performers
          </div>
          <div className="space-y-2.5">
            {data.top_performers.map((loc, idx) => (
              <PerformerRow
                key={loc.tenant_id}
                rank={idx + 1}
                loc={loc}
                onClick={() => onLocationClick(loc.tenant_id)}
              />
            ))}
          </div>
        </div>
      )}

      {data.locations_without_goal > 0 && (
        <div className="mt-4 pt-3 border-t border-stone-100 flex items-center gap-2 text-[11px] text-stone-500">
          <Info className="w-3.5 h-3.5 text-stone-400 shrink-0" />
          <span>
            {data.locations_without_goal} location{data.locations_without_goal !== 1 ? "s" : ""} missing a goal this month —
          </span>
          <Link
            to="/metrics"
            className="font-bold text-brand-600 hover:text-brand-700 transition-colors"
          >
            set goals
          </Link>
        </div>
      )}
    </div>
  );
}

function PerformerRow({ rank, loc, onClick }) {
  const rankBadgeColors = {
    1: "bg-amber-100 text-amber-700 border-amber-200",
    2: "bg-stone-100 text-stone-600 border-stone-200",
    3: "bg-orange-50 text-orange-700 border-orange-200",
  };

  const pct = loc.attainment_pct;
  const barColor =
    pct >= 100 ? "bg-emerald-500" :
    pct >= 75  ? "bg-blue-500"    :
    pct >= 50  ? "bg-amber-500"   :
                 "bg-red-400";

  return (
    <button
      onClick={onClick}
      className="w-full text-left group"
    >
      <div className="flex items-center gap-3">
        <span
          className={`shrink-0 inline-flex items-center justify-center w-6 h-6 text-[10px] font-black rounded-full border ${rankBadgeColors[rank]}`}
        >
          #{rank}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-xs font-bold text-stone-900 truncate group-hover:text-brand-700 transition-colors">
              {loc.tenant_name}
            </span>
            <span className="text-xs font-black text-stone-900 tabular-nums shrink-0">
              {formatPct(loc.attainment_pct)}
            </span>
          </div>
          <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
            <div
              className={`h-full ${barColor} transition-all`}
              style={{ width: `${Math.min(100, loc.attainment_pct)}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1 text-[10px] text-stone-400 font-medium tabular-nums">
            <span>{formatCents(loc.actual_cents)}</span>
            <span>/ {formatCents(loc.goal_cents)}</span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// CALL OUTCOMES PANEL — 4 buckets Apr 24
// ═════════════════════════════════════════════════════════════════════════
function CallOutcomesPanel({ data, period }) {
  const { total_calls, buckets } = data;
  const hasData = total_calls > 0;

  if (!hasData) {
    return (
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-black text-stone-900 flex items-center gap-2">
              <PhoneCall className="w-4 h-4 text-stone-600" />
              Call Outcomes
            </h3>
            <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wider mt-0.5">
              {period}
            </p>
          </div>
        </div>

        <div className="text-center py-8">
          <div className="w-12 h-12 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-3">
            <PhoneCall className="w-6 h-6 text-stone-400" />
          </div>
          <h4 className="text-sm font-bold text-stone-900 mb-1">No calls yet</h4>
          <p className="text-xs text-stone-500">
            Call outcomes will appear here once your AI takes its first calls.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-black text-stone-900 flex items-center gap-2">
            <PhoneCall className="w-4 h-4 text-stone-600" />
            Call Outcomes
          </h3>
          <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wider mt-0.5">
            What happened · {period}
          </p>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-stone-900 tabular-nums">
            {formatNum(total_calls)}
          </div>
          <div className="text-[10px] text-stone-400 font-medium uppercase tracking-wider">
            total calls
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {CALL_OUTCOME_ORDER.map((key) => {
          const bucket = buckets[key];
          if (!bucket) return null;
          return (
            <CallOutcomeBar
              key={key}
              bucketKey={key}
              bucket={bucket}
              totalCalls={total_calls}
            />
          );
        })}
      </div>

      <div className="mt-4 pt-3 border-t border-stone-100 flex items-center gap-2 text-[11px] text-stone-500">
        <Info className="w-3.5 h-3.5 text-stone-400 shrink-0" />
        <span>
          For hang-up timing + confusion analysis, open a location's Metrics page.
        </span>
      </div>
    </div>
  );
}

function CallOutcomeBar({ bucketKey, bucket }) {
  const config = CALL_OUTCOME_CONFIG[bucketKey];
  if (!config) return null;

  const Icon = config.icon;

  const barColor = {
    emerald: "bg-emerald-500",
    blue:    "bg-blue-500",
    amber:   "bg-amber-500",
    red:     "bg-red-400",
    stone:   "bg-stone-300",
    purple:  "bg-purple-400",
  }[config.color] || "bg-stone-300";

  const iconColor = {
    emerald: "text-emerald-600",
    blue:    "text-blue-600",
    amber:   "text-amber-600",
    red:     "text-red-500",
    stone:   "text-stone-500",
    purple:  "text-purple-500",
  }[config.color] || "text-stone-500";

  const isZero = bucket.count === 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className={`w-3.5 h-3.5 shrink-0 ${isZero ? "text-stone-300" : iconColor}`} />
          <span className={`text-xs font-bold truncate ${isZero ? "text-stone-400" : "text-stone-700"}`}>
            {config.label}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs font-black tabular-nums ${isZero ? "text-stone-400" : "text-stone-900"}`}>
            {formatNum(bucket.count)}
          </span>
          <span className="text-[11px] text-stone-400 font-medium tabular-nums w-10 text-right">
            {bucket.pct}%
          </span>
        </div>
      </div>
      <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
        {!isZero && (
          <div
            className={`h-full ${barColor} transition-all`}
            style={{ width: `${Math.max(2, bucket.pct)}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// REVIEWS ALERTS PANEL
// ═════════════════════════════════════════════════════════════════════════
// Apr 24 eve: Backend LIMIT bumped from 2 to 10. ReviewAlertCard tightened
// (smaller padding, smaller icon, line-clamp-1) so 10 cards don't dominate
// the page. "View all" link still surfaces anything beyond 10.
function ReviewsAlertsPanel({ data }) {
  const { alerts, total_count_14d } = data;
  const hasAlerts = alerts.length > 0;
  const extraCount = Math.max(0, total_count_14d - alerts.length);

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-sm font-black text-stone-900 flex items-center gap-2">
            Reviews Needing Response
            {hasAlerts && (
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 bg-red-100 text-red-700 text-[10px] font-bold rounded-full">
                {total_count_14d}
              </span>
            )}
          </h3>
          <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wider mt-0.5">
            1-3★ pending · last 14 days
          </p>
        </div>
      </div>

      {hasAlerts ? (
        <div className="space-y-2">
          {alerts.map((alert) => (
            <ReviewAlertCard key={alert.review_id} alert={alert} />
          ))}
          {extraCount > 0 && (
            <Link
              to="/reviews"
              className="block text-center text-xs font-bold text-stone-600 hover:text-stone-900 pt-2 transition-colors"
            >
              View all {total_count_14d} pending reviews →
            </Link>
          )}
        </div>
      ) : (
        <div className="text-center py-8">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mx-auto mb-3">
            <CheckCircle2 className="w-6 h-6 text-emerald-600" />
          </div>
          <h4 className="text-sm font-bold text-stone-900 mb-1">All clear</h4>
          <p className="text-xs text-stone-500">
            No pending bad reviews in the last 14 days
          </p>
        </div>
      )}
    </div>
  );
}

function ReviewAlertCard({ alert }) {
  return (
    <Link
      to="/reviews"
      className="block border border-stone-200 rounded-xl p-2.5 hover:border-stone-300 hover:shadow-sm transition-all group"
    >
      <div className="flex items-start gap-2.5">
        <div className="shrink-0 w-7 h-7 rounded-lg bg-red-50 flex items-center justify-center">
          <Star className="w-3.5 h-3.5 text-red-500 fill-red-500" strokeWidth={1.5} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="text-xs font-black text-stone-900">
              {alert.rating}-star
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-stone-400 px-1.5 py-0.5 bg-stone-100 rounded">
              {alert.tenant_name}
            </span>
            {alert.has_ai_draft && (
              <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 px-1.5 py-0.5 bg-emerald-50 rounded border border-emerald-100">
                <Sparkles className="w-2.5 h-2.5" />
                AI draft ready
              </span>
            )}
          </div>
          {alert.reviewer_name && (
            <div className="text-[11px] text-stone-500 font-medium mb-0.5">
              {alert.reviewer_name}
            </div>
          )}
          {alert.review_text && (
            <p className="text-xs text-stone-700 line-clamp-1 leading-snug">
              {alert.review_text}
            </p>
          )}
        </div>
        <ChevronRight className="w-4 h-4 shrink-0 text-stone-300 group-hover:text-stone-500 transition-colors" />
      </div>
    </Link>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// LOCATION TABLE
// ═════════════════════════════════════════════════════════════════════════
function LocationTable({ locations, sort, dir, onSort, onRowClick }) {
  const columns = [
    { key: "tenant_name",          label: "Location",     align: "left"  },
    { key: "calls_total",          label: "Calls",        align: "right" },
    { key: "bookings_total",       label: "Bookings",     align: "right" },
    { key: "booking_rate_pct",     label: "Rate",         align: "right" },
    { key: "revenue_cents",        label: "Revenue",      align: "right" },
    { key: "open_leads",           label: "Open",         align: "right" },
    { key: "avg_rating",           label: "Rating",       align: "right" },
    { key: "review_count",         label: "Reviews",      align: "right" },
    { key: "pending_alerts_count", label: "Alerts",       align: "right" },
  ];

  if (locations.length === 0) {
    return (
      <div className="bg-white rounded-2xl border-2 border-dashed border-stone-200 p-10 text-center">
        <div className="w-14 h-14 rounded-2xl bg-stone-100 flex items-center justify-center mx-auto mb-4">
          <MapPin className="w-7 h-7 text-stone-400" />
        </div>
        <h3 className="text-base font-bold text-stone-900 mb-1">
          No locations
        </h3>
        <p className="text-sm text-stone-500">
          Add locations to see network-wide performance.
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-black text-stone-900">Locations</h3>
          <p className="text-[10px] text-stone-400 font-medium uppercase tracking-wider mt-0.5">
            {formatNum(locations.length)} location{locations.length !== 1 ? "s" : ""} · sorted by {SORT_LABELS[sort]} {dir} · click a row to view
          </p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-stone-50/50 border-b border-stone-100">
            <tr>
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={`px-4 py-3 text-[10px] font-bold uppercase tracking-wider text-stone-400 ${
                    col.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    onClick={() => onSort(col.key)}
                    className={`inline-flex items-center gap-1 hover:text-stone-700 transition-colors ${
                      col.align === "right" ? "flex-row-reverse" : ""
                    } ${sort === col.key ? "text-stone-900" : ""}`}
                  >
                    <span>{col.label}</span>
                    {sort === col.key ? (
                      dir === "desc" ? (
                        <ChevronDown className="w-3 h-3" />
                      ) : (
                        <ChevronUp className="w-3 h-3" />
                      )
                    ) : (
                      <ArrowUpDown className="w-3 h-3 opacity-30" />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {locations.map((loc) => (
              <LocationRow
                key={loc.tenant_id}
                loc={loc}
                onClick={() => onRowClick(loc.tenant_id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LocationRow({ loc, onClick }) {
  const showRankBadge = loc.rank_revenue <= 3;
  const rankColors = {
    1: "bg-amber-100 text-amber-700 border-amber-200",
    2: "bg-stone-100 text-stone-600 border-stone-200",
    3: "bg-orange-50 text-orange-700 border-orange-200",
  };

  return (
    <tr
      onClick={onClick}
      className="hover:bg-stone-50 transition-colors group cursor-pointer"
    >
      <td className="px-4 py-3">
        <div className="flex items-center gap-2 min-w-0">
          {showRankBadge && (
            <span
              className={`shrink-0 inline-flex items-center justify-center min-w-[22px] h-5 px-1 text-[10px] font-black rounded border ${rankColors[loc.rank_revenue]}`}
              title={`Rank #${loc.rank_revenue} by revenue`}
            >
              #{loc.rank_revenue}
            </span>
          )}
          <span className="font-bold text-stone-900 truncate group-hover:text-brand-700 transition-colors">
            {loc.tenant_name}
          </span>
          {loc.oauth_connected && (
            <span
              className="shrink-0 w-1.5 h-1.5 rounded-full bg-emerald-400"
              title="Google Reviews connected"
            />
          )}
          <ChevronRight className="w-3 h-3 shrink-0 text-stone-300 group-hover:text-stone-500 transition-colors ml-auto" />
        </div>
      </td>
      <td className="px-4 py-3 text-right font-bold text-stone-900 tabular-nums">
        {formatNum(loc.calls_total)}
      </td>
      <td className="px-4 py-3 text-right font-bold text-stone-900 tabular-nums">
        {formatNum(loc.bookings_total)}
      </td>
      <td className="px-4 py-3 text-right font-bold tabular-nums">
        <span
          className={
            loc.booking_rate_pct == null
              ? "text-stone-400"
              : loc.booking_rate_pct >= 40
              ? "text-emerald-600"
              : loc.booking_rate_pct >= 20
              ? "text-amber-600"
              : "text-red-500"
          }
        >
          {formatPct(loc.booking_rate_pct)}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-black text-stone-900 tabular-nums">
        {formatCents(loc.revenue_cents)}
      </td>
      <td className="px-4 py-3 text-right font-bold tabular-nums">
        {loc.open_leads > 0 ? (
          <span className="text-blue-600">{formatNum(loc.open_leads)}</span>
        ) : (
          <span className="text-stone-400 font-medium">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {loc.avg_rating != null ? (
          <span className="inline-flex items-center gap-1 font-bold text-stone-900">
            {formatRating(loc.avg_rating)}
            <Star className="w-3 h-3 text-amber-500 fill-amber-500" strokeWidth={1.5} />
          </span>
        ) : (
          <span className="text-stone-400 font-medium">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right font-medium text-stone-600 tabular-nums">
        {formatNum(loc.review_count)}
      </td>
      <td className="px-4 py-3 text-right tabular-nums">
        {loc.pending_alerts_count > 0 ? (
          <span className="inline-flex items-center gap-1 font-bold text-red-600">
            <AlertTriangle className="w-3 h-3" />
            {loc.pending_alerts_count}
          </span>
        ) : (
          <span className="text-stone-400 font-medium">—</span>
        )}
      </td>
    </tr>
  );
}

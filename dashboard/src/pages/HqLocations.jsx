import { useEffect, useState, useMemo } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import {
  MapPin,
  Building2,
  CheckCircle2,
  AlertCircle,
  CreditCard,
  Phone,
  ListChecks,
  TrendingUp,
  Users,
  ExternalLink,
  ChevronRight,
  ChevronLeft,
  Loader2,
  Search,
  PhoneCall,
  Calendar,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  getTenants,
  listFranchiseZees,
  updateZeeOutboundGates,
} from "../api";

/**
 * HQ Locations Management — Apr 29, 2026 (Phase 6).
 *
 * For HQ tenants on hq_starter/hq_growth/hq_enterprise plans. Lists all
 * franchise zees under this HQ with management controls:
 *   - Subscription status badge
 *   - Per-zee MRR
 *   - Outbound gate toggles (followup, lists, daily max)
 *   - Activity counts (calls, bookings)
 *
 * Backend: GET /api/admin/tenants/:hqId/zees + PATCH /admin/tenants/:id/outbound-gates
 */
export default function HqLocations() {
  const { tenantId } = useOutletContext() || {};
  const navigate = useNavigate();

  const [hqId, setHqId] = useState(null);
  const [hq, setHq] = useState(null);
  const [zees, setZees] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");

  // Resolve current HQ tenant — same pattern RollupV5 uses
  useEffect(() => {
    resolveHq();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

 async function resolveHq() {
    setLoading(true);
    setError("");
    try {
      // Apr 29, 2026 — respect superadmin impersonation. impersonate_tenant_id
      // takes precedence over the user's primary tenant when set.
      const impersonatedId = localStorage.getItem("impersonate_tenant_id");

      const data = await getTenants();
      const list = data?.tenants || [];

      let primary;
      if (impersonatedId) {
        primary = list.find((t) => t.id === impersonatedId) || list[0];
      } else {
        primary = list[0];
      }

      if (!primary?.id) {
        setError("No tenant found for this user.");
        setLoading(false);
        return;
      }

      // HQ check: must be on an HQ-tier plan
      const HQ_PLANS = ["hq_starter", "hq_growth", "hq_enterprise"];
      if (!HQ_PLANS.includes(primary.plan)) {
        setError(
          "This page is only available for HQ tenants. Please contact corporate to upgrade."
        );
        setLoading(false);
        return;
      }

      setHqId(primary.id);
      setHq(primary);
    } catch (e) {
      setError(e.message || "Failed to load tenant info");
      setLoading(false);
    }
  }

  // Load zees once HQ is known
  useEffect(() => {
    if (!hqId) return;
    fetchZees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hqId]);

  async function fetchZees() {
    setLoading(true);
    try {
      const data = await listFranchiseZees(hqId);
      setZees(data?.zees || []);
      setError("");
    } catch (e) {
      setError(e.message || "Failed to load zees");
    } finally {
      setLoading(false);
    }
  }

  // Optimistic update on toggle
  async function handleToggleGate(zeeId, field, newValue) {
    // Optimistic local update
    setZees((prev) =>
      prev.map((z) =>
        z.id === zeeId
          ? {
              ...z,
              [field === "outbound_followup"
                ? "outbound_followup_enabled"
                : "outbound_lists_enabled"]: newValue,
            }
          : z
      )
    );

    try {
      await updateZeeOutboundGates(zeeId, { [field]: newValue });
    } catch (e) {
      // Revert on failure
      setZees((prev) =>
        prev.map((z) =>
          z.id === zeeId
            ? {
                ...z,
                [field === "outbound_followup"
                  ? "outbound_followup_enabled"
                  : "outbound_lists_enabled"]: !newValue,
              }
            : z
        )
      );
      alert(`Failed to update: ${e.message}`);
    }
  }

  async function handleDailyMaxChange(zeeId, newMax) {
    const max = parseInt(newMax, 10);
    if (!Number.isFinite(max) || max < 0) return;

    setZees((prev) =>
      prev.map((z) =>
        z.id === zeeId ? { ...z, outbound_daily_max: max } : z
      )
    );

    try {
      await updateZeeOutboundGates(zeeId, { outbound_daily_max: max });
    } catch (e) {
      fetchZees(); // refetch on failure
      alert(`Failed to update: ${e.message}`);
    }
  }

  const filtered = useMemo(() => {
    if (!search.trim()) return zees;
    const q = search.toLowerCase();
    return zees.filter(
      (z) =>
        (z.company_name || z.name || "").toLowerCase().includes(q) ||
        (z.slug || "").toLowerCase().includes(q)
    );
  }, [zees, search]);

  // Network rollup stats
  const stats = useMemo(() => {
    const active = zees.filter((z) => z.subscription_status === "active").length;
    const mrr = zees
      .filter((z) => z.subscription_status === "active")
      .reduce((sum, z) => sum + (z.effective_monthly || 0), 0);
    const totalCalls = zees.reduce((sum, z) => sum + (z.total_calls || 0), 0);
    const totalBookings = zees.reduce((sum, z) => sum + (z.total_bookings || 0), 0);
    return { active, total: zees.length, mrr, totalCalls, totalBookings };
  }, [zees]);

  if (loading && !zees.length) {
    return (
      <div className="flex items-center justify-center py-20">
        <LumaSpin />
      </div>
    );
  }

  if (error && !zees.length) {
    return (
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 mb-6 flex-wrap">
        <div>
          <Link
            to="/rollup-v5"
            className="inline-flex items-center gap-1 text-xs font-bold text-slate-400 hover:text-slate-600 transition-colors mb-2 uppercase tracking-wide"
          >
            <ChevronLeft size={14} />
            Back to rollup
          </Link>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-3">
            <Building2 className="text-orange-500" size={28} />
            Locations
          </h1>
          <p className="text-slate-500 mt-1 text-sm">
            {hq?.company_name || hq?.name} · Manage your franchise locations
          </p>
        </div>

        {zees.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search locations..."
                className="pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
              />
            </div>
          </div>
        )}
      </div>

      {/* Network rollup stats */}
      {zees.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            icon={<CheckCircle2 size={16} />}
            label="Active"
            value={`${stats.active} / ${stats.total}`}
            sublabel="subscribed"
            color="emerald"
          />
          <StatCard
            icon={<CreditCard size={16} />}
            label="Network MRR"
            value={`$${(stats.mrr / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
            sublabel="monthly recurring"
            color="orange"
          />
          <StatCard
            icon={<PhoneCall size={16} />}
            label="Total Calls"
            value={stats.totalCalls.toLocaleString()}
            sublabel="lifetime"
            color="blue"
          />
          <StatCard
            icon={<Calendar size={16} />}
            label="Total Bookings"
            value={stats.totalBookings.toLocaleString()}
            sublabel="lifetime"
            color="indigo"
          />
        </div>
      )}

      {/* Empty state */}
      {zees.length === 0 && !loading && (
        <div className="bg-white rounded-2xl border-2 border-dashed border-slate-200 p-12 text-center">
          <div className="w-14 h-14 rounded-2xl bg-slate-100 flex items-center justify-center mx-auto mb-4">
            <MapPin className="w-7 h-7 text-slate-400" />
          </div>
          <h3 className="text-base font-bold text-slate-900 mb-1">
            No locations yet
          </h3>
          <p className="text-sm text-slate-500 mb-4">
            Locations are added by your platform admin. Contact corporate to provision new zees.
          </p>
        </div>
      )}

      {/* Filtered empty state */}
      {zees.length > 0 && filtered.length === 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-sm text-slate-400">
          No locations match "{search}"
        </div>
      )}

      {/* Zee cards */}
      <AnimatePresence>
        {filtered.length > 0 && (
          <div className="space-y-3">
            {filtered.map((zee, idx) => (
              <motion.div
                key={zee.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: idx * 0.03 }}
              >
                <ZeeCard
                  zee={zee}
                  onToggleGate={handleToggleGate}
                  onDailyMaxChange={handleDailyMaxChange}
                />
              </motion.div>
            ))}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// StatCard
// ────────────────────────────────────────────────────────────────────────
function StatCard({ icon, label, value, sublabel, color }) {
  const colors = {
    emerald: "bg-emerald-50 text-emerald-600 border-emerald-100",
    orange: "bg-orange-50 text-orange-600 border-orange-100",
    blue: "bg-blue-50 text-blue-600 border-blue-100",
    indigo: "bg-indigo-50 text-indigo-600 border-indigo-100",
  };
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${colors[color]}`}>
          {icon}
        </div>
        <div className="text-[10px] font-black text-slate-900 uppercase tracking-wider">
          {label}
        </div>
      </div>
      <div className="text-xl font-black text-slate-900 tabular-nums">{value}</div>
      <div className="text-[10px] text-slate-400 font-medium uppercase tracking-wider mt-0.5">
        {sublabel}
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Zee Card — one row per franchise location
// ────────────────────────────────────────────────────────────────────────
function ZeeCard({ zee, onToggleGate, onDailyMaxChange }) {
  const isActive = zee.subscription_status === "active";
  const isManual = zee.billing_mode === "manual";
  const isSuspended = zee.is_suspended;
  const monthlyDollars = (zee.effective_monthly || 0) / 100;

  let statusBadge;
  if (isSuspended) {
    statusBadge = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-black uppercase tracking-wider rounded border border-red-100">
        <AlertCircle size={10} />
        Suspended
      </span>
    );
  } else if (isManual) {
    statusBadge = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 text-purple-700 text-[10px] font-black uppercase tracking-wider rounded border border-purple-100">
        <CreditCard size={10} />
        Manual billing
      </span>
    );
  } else if (isActive) {
    statusBadge = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-black uppercase tracking-wider rounded border border-emerald-100">
        <CheckCircle2 size={10} />
        Active
      </span>
    );
  } else {
    statusBadge = (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-black uppercase tracking-wider rounded border border-amber-100">
        <AlertCircle size={10} />
        Awaiting payment
      </span>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden hover:shadow-md transition-all">
      <div className="p-5">
        {/* Top row — name, status, MRR */}
        <div className="flex items-start justify-between gap-4 mb-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-base font-black text-slate-900">
                {zee.company_name || zee.name}
              </h3>
              {statusBadge}
            </div>
            <div className="text-[11px] text-slate-400 font-medium">
              <code className="font-mono">{zee.slug}</code>
            </div>
          </div>

          <div className="text-right">
            <div className="text-2xl font-black text-slate-900 tabular-nums">
              ${monthlyDollars.toFixed(0)}
            </div>
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
              /month
            </div>
          </div>
        </div>

        {/* Activity stats */}
        <div className="grid grid-cols-2 gap-3 mb-4 pb-4 border-b border-slate-100">
          <ActivityStat
            icon={<PhoneCall size={12} />}
            label="Calls"
            value={zee.total_calls || 0}
          />
          <ActivityStat
            icon={<Calendar size={12} />}
            label="Bookings"
            value={zee.total_bookings || 0}
          />
        </div>

        {/* Outbound gates */}
        <div className="space-y-3">
          <div className="text-[10px] font-black text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
            <Phone size={11} />
            Outbound Calling Gates
          </div>

          <GateToggle
            label="Follow-up calls"
            hint="Auto-call leads after missed inbound calls"
            checked={!!zee.outbound_followup_enabled}
            onChange={(v) => onToggleGate(zee.id, "outbound_followup", v)}
          />

          <GateToggle
            label="Outbound lists"
            hint="Proactive call campaigns from contact lists"
            checked={!!zee.outbound_lists_enabled}
            onChange={(v) => onToggleGate(zee.id, "outbound_lists", v)}
          />

          <div className="flex items-center justify-between gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-xs font-bold text-slate-900">Daily call cap</div>
              <div className="text-[10px] text-slate-400 font-medium leading-relaxed">
                Maximum outbound calls per day (0 = unlimited)
              </div>
            </div>
            <input
              type="number"
              min="0"
              max="1000"
              defaultValue={zee.outbound_daily_max || 0}
              onBlur={(e) => {
                const newMax = parseInt(e.target.value, 10);
                if (newMax !== (zee.outbound_daily_max || 0)) {
                  onDailyMaxChange(zee.id, newMax);
                }
              }}
              className="w-20 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold text-slate-900 tabular-nums text-right focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ActivityStat({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2">
      <div className="w-7 h-7 rounded-lg bg-slate-50 text-slate-500 flex items-center justify-center border border-slate-100">
        {icon}
      </div>
      <div>
        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
          {label}
        </div>
        <div className="text-sm font-black text-slate-900 tabular-nums">
          {value.toLocaleString()}
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────
// Toggle switch
// ────────────────────────────────────────────────────────────────────────
function GateToggle({ label, hint, checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className="w-full flex items-center justify-between gap-3 py-2 group"
    >
      <div className="min-w-0 flex-1 text-left">
        <div className="text-xs font-bold text-slate-900">{label}</div>
        <div className="text-[10px] text-slate-400 font-medium leading-relaxed">
          {hint}
        </div>
      </div>
      <div
        className={`shrink-0 relative w-11 h-6 rounded-full transition-colors ${
          checked ? "bg-orange-500" : "bg-slate-200"
        }`}
      >
        <motion.div
          layout
          className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow-sm`}
          animate={{ left: checked ? "calc(100% - 22px)" : "2px" }}
          transition={{ type: "spring", stiffness: 500, damping: 30 }}
        />
      </div>
    </button>
  );
}

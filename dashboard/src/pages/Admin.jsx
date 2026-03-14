import { useState, useEffect } from "react";
import {
  getAdminStats,
  getAdminTenants,
  updateTenantPricing,
  removeTenantPricing,
  suspendTenant,
} from "../api";
import * as api from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Shield,
  Building2,
  DollarSign,
  TrendingUp,
  Users,
  Search,
  X,
  Tag,
  Calendar,
  Trash2,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronLeft,
  ChevronRight as ChevronRightIcon,
  Crown,
  Phone,
  Zap,
  BarChart3,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const PLAN_COLORS = {
  basic: { bg: "rgba(156,163,175,0.1)", text: "#6b7280", border: "rgba(156,163,175,0.2)", dot: "#9ca3af", gradient: "from-gray-400 to-gray-500" },
  pro: { bg: "rgba(59,130,246,0.08)", text: "#2563eb", border: "rgba(59,130,246,0.15)", dot: "#3b82f6", gradient: "from-blue-500 to-blue-600" },
  elite: { bg: "rgba(139,92,246,0.08)", text: "#7c3aed", border: "rgba(139,92,246,0.15)", dot: "#8b5cf6", gradient: "from-violet-500 to-purple-600" },
};

function centsToDisplay(cents) {
  if (cents == null) return "—";
  return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
}

function centsToMRR(cents) {
  if (cents == null || cents === 0) return "$0";
  if (cents >= 100000) return `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0 })}`;
  return `$${(cents / 100).toFixed(2)}`;
}

export default function Admin() {
  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 10;

  const [overrideForm, setOverrideForm] = useState({
    promo_label: "",
    promo_expires_at: "",
    promo_notes: "",
    plan: "basic",
    plan_overrides: {
      basic: { monthly: "", setup: "", waive_setup: false },
      pro: { monthly: "", setup: "", waive_setup: false },
      elite: { monthly: "", setup: "", waive_setup: false },
    }
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const [s, t] = await Promise.all([getAdminStats(), getAdminTenants()]);
      setStats(s);
      setTenants(t.tenants || []);
    } catch (e) {
      console.error("Admin load error:", e);
    } finally {
      setLoading(false);
    }
  }

  function openOverrideDrawer(tenant) {
    setSelectedTenant(tenant);
    
    // Parse existing JSON overrides or fallback
    const existingOverrides = tenant.plan_overrides || {};
    const defaultPlanState = { monthly: "", setup: "", waive_setup: false };
    
    const buildPlanForm = (planId) => {
      const dbPlan = existingOverrides[planId] || {};
      return {
        monthly: dbPlan.monthly != null ? (dbPlan.monthly / 100).toString() : "",
        setup: dbPlan.setup != null && dbPlan.setup > 0 ? (dbPlan.setup / 100).toString() : "",
        waive_setup: dbPlan.setup === 0
      };
    };

    setOverrideForm({
      promo_label: tenant.promo_label || "",
      promo_expires_at: tenant.promo_expires_at ? tenant.promo_expires_at.split("T")[0] : "",
      promo_notes: tenant.promo_notes || "",
      plan: tenant.plan || "basic",
      plan_overrides: {
        basic: buildPlanForm("basic"),
        pro: buildPlanForm("pro"),
        elite: buildPlanForm("elite"),
      }
    });
    setSaveMessage("");
  }

  async function handleSaveOverride(e) {
    e.preventDefault();
    if (!selectedTenant) return;
    setSaveLoading(true);
    setSaveMessage("");
    try {
      const formattedOverrides = {};
      
      for (const [planId, formValues] of Object.entries(overrideForm.plan_overrides)) {
        const hasMonthly = formValues.monthly !== "";
        const hasSetup = formValues.setup !== "" || formValues.waive_setup;
        
        if (hasMonthly || hasSetup) {
          formattedOverrides[planId] = {};
          if (hasMonthly) {
            formattedOverrides[planId].monthly = Math.round(parseFloat(formValues.monthly) * 100);
          }
          if (formValues.waive_setup) {
            formattedOverrides[planId].setup = 0;
          } else if (formValues.setup !== "") {
            formattedOverrides[planId].setup = Math.round(parseFloat(formValues.setup) * 100);
          }
        }
      }
      
      const payload = {
        plan: overrideForm.plan,
        plan_overrides: formattedOverrides,
        promo_label: overrideForm.promo_label || null,
        promo_expires_at: overrideForm.promo_expires_at || null,
        promo_notes: overrideForm.promo_notes || null,
      };

      await updateTenantPricing(selectedTenant.id, payload);
      setSaveMessage("Pricing override saved!");
      await loadData();
    } catch (err) {
      setSaveMessage(`Error: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleRemoveOverride() {
    if (!selectedTenant) return;
    if (!confirm(`Remove all pricing overrides for "${selectedTenant.company_name || selectedTenant.name}"?`)) return;
    setSaveLoading(true);
    try {
      await removeTenantPricing(selectedTenant.id);
      setSaveMessage("Overrides removed.");
      await loadData();
      setSelectedTenant(null);
    } catch (err) {
      setSaveMessage(`Error: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleToggleSuspension() {
    if (!selectedTenant) return;
    const action = selectedTenant.is_suspended ? "unsuspend" : "suspend";
    const reason = !selectedTenant.is_suspended ? prompt("Reason for suspension (optional):") : null;
    
    setSaveLoading(true);
    try {
      await api.suspendTenant(selectedTenant.id, !selectedTenant.is_suspended, reason);
      setSaveMessage(`Tenant ${action}ed!`);
      await loadData();
      setSelectedTenant((prev) => ({ ...prev, is_suspended: !prev.is_suspended }));
    } catch (err) {
      setSaveMessage(`Error: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  }

  function handleImpersonate(tenant) {
    if (confirm(`Switch to viewing ${tenant.company_name || tenant.name} perspective?`)) {
      localStorage.setItem("impersonate_tenant_id", tenant.id);
      localStorage.setItem("impersonate_tenant_name", tenant.company_name || tenant.name);
      window.location.href = "/";
    }
  }

  const filteredTenants = tenants.filter((t) => {
    const matchesSearch =
      (t.name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.company_name || "").toLowerCase().includes(searchQuery.toLowerCase()) ||
      (t.slug || "").toLowerCase().includes(searchQuery.toLowerCase());
    const matchesPlan = filterPlan === "all" || (t.plan || "basic") === filterPlan;
    return matchesSearch && matchesPlan;
  });

  const totalPages = Math.max(1, Math.ceil(filteredTenants.length / ROWS_PER_PAGE));
  const safePage = Math.min(currentPage, totalPages);
  const paginatedTenants = filteredTenants.slice((safePage - 1) * ROWS_PER_PAGE, safePage * ROWS_PER_PAGE);

  // Reset to page 1 when filters change
  useEffect(() => { setCurrentPage(1); }, [searchQuery, filterPlan]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <div className="text-center">
          <LumaSpin />
          <p className="text-sm text-gray-400 mt-4 font-medium">Loading admin console…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50">
      {/* Hero Header */}
      <div className="bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-red-500 to-orange-500 flex items-center justify-center shadow-lg shadow-red-500/20">
              <Shield size={24} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight">Admin Console</h1>
              <p className="text-gray-400 text-sm font-medium">Platform management & pricing control</p>
            </div>
          </div>

          {/* Stats Row */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <StatCard
                icon={<Users size={18} />}
                label="Total Tenants"
                value={stats.total_tenants}
                iconBg="bg-blue-500/20"
                iconColor="text-blue-400"
              />
              <StatCard
                icon={<CheckCircle2 size={18} />}
                label="Active Subs"
                value={stats.active_subs}
                iconBg="bg-emerald-500/20"
                iconColor="text-emerald-400"
                accent="emerald"
              />
              <StatCard
                icon={<TrendingUp size={18} />}
                label="Platform MRR"
                value={centsToMRR(stats.mrr_cents)}
                iconBg="bg-violet-500/20"
                iconColor="text-violet-400"
                accent="violet"
                large
              />
              <StatCard
                icon={<AlertCircle size={18} />}
                label="Churned"
                value={stats.churned}
                iconBg="bg-red-500/20"
                iconColor="text-red-400"
              />
              <StatCard
                icon={<Tag size={18} />}
                label="Overrides"
                value={stats.with_overrides}
                iconBg="bg-amber-500/20"
                iconColor="text-amber-400"
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 -mt-4">
        {/* Plan Distribution + Controls Bar */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => setFilterPlan("all")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all ${filterPlan === "all" ? "bg-gray-900 text-white shadow-sm" : "bg-gray-50 text-gray-500 hover:bg-gray-100"}`}
            >
              All ({tenants.length})
            </button>
            {stats?.plan_breakdown?.map((p) => {
              const pc = PLAN_COLORS[p.plan] || PLAN_COLORS.basic;
              return (
                <button
                  key={p.plan}
                  onClick={() => setFilterPlan(p.plan)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wide transition-all flex items-center gap-1.5 ${filterPlan === p.plan ? "bg-gray-900 text-white shadow-sm" : "hover:bg-gray-100"}`}
                  style={filterPlan !== p.plan ? { backgroundColor: pc.bg, color: pc.text, border: `1px solid ${pc.border}` } : {}}
                >
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: filterPlan === p.plan ? "#fff" : pc.dot }} />
                  {p.plan} {p.count}
                </button>
              );
            })}
          </div>

          <div className="relative w-full md:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-300" />
            <input
              type="text"
              placeholder="Search tenants…"
              className="pl-9 pr-4 py-2.5 w-full bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent focus:bg-white transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Tenants Table */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="px-6 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Business</th>
                  <th className="px-4 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Plan</th>
                  <th className="px-4 py-4 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">Monthly</th>
                  <th className="px-4 py-4 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">Setup</th>
                  <th className="px-4 py-4 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest">Status</th>
                  <th className="px-4 py-4 text-left text-[10px] font-black text-gray-400 uppercase tracking-widest">Promo</th>
                  <th className="px-4 py-4 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">Calls</th>
                  <th className="px-4 py-4 text-right text-[10px] font-black text-gray-400 uppercase tracking-widest">Bookings</th>
                  <th className="px-4 py-4" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paginatedTenants.map((t, i) => {
                  const pc = PLAN_COLORS[t.plan] || PLAN_COLORS.basic;
                  return (
                    <motion.tr
                      key={t.id}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="hover:bg-gray-50/60 transition-colors group"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center text-gray-500 text-xs font-black shrink-0">
                            {(t.company_name || t.name || "?").charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-bold text-gray-900 text-sm truncate">{t.company_name || t.name}</div>
                            <div className="text-[11px] text-gray-400 font-mono truncate">{t.slug}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider"
                          style={{ backgroundColor: pc.bg, color: pc.text, border: `1px solid ${pc.border}` }}
                        >
                          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pc.dot }} />
                          {t.plan || "basic"}
                        </span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <div className="text-sm font-black text-gray-900">{centsToDisplay(t.effective_monthly)}</div>
                        {t.override_active && (
                          <div className="text-[10px] text-gray-400 line-through">{centsToDisplay(t.default_monthly)}</div>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        {t.price_override_setup === 0 ? (
                          <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">WAIVED</span>
                        ) : (
                          <span className="text-sm font-bold text-gray-700">{centsToDisplay(t.effective_setup)}</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-center">
                        {t.is_suspended ? (
                          <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-red-50 text-red-600 border border-red-200">SUSPENDED</span>
                        ) : (
                          <StatusBadge status={t.subscription_status} />
                        )}
                      </td>
                      <td className="px-4 py-4">
                        {t.promo_label ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-black border" style={{ backgroundColor: "rgba(245,158,11,0.06)", color: "#b45309", borderColor: "rgba(245,158,11,0.2)" }}>
                            <Tag size={9} />
                            {t.promo_label}
                          </span>
                        ) : (
                          <span className="text-gray-200">—</span>
                        )}
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="text-sm font-mono font-bold text-gray-700">{t.total_calls}</span>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <span className="text-sm font-mono font-bold text-gray-700">{t.total_bookings}</span>
                      </td>
                      <td className="px-4 py-4">
                        <button
                          onClick={() => openOverrideDrawer(t)}
                          className="px-3.5 py-1.5 text-[10px] font-black tracking-wider uppercase rounded-lg transition-all opacity-0 group-hover:opacity-100 bg-gray-900 text-white hover:bg-black shadow-sm"
                        >
                          Override
                        </button>
                        <button
                          onClick={() => handleImpersonate(t)}
                          className="px-3.5 py-1.5 text-[10px] font-black tracking-wider uppercase rounded-lg transition-all opacity-0 group-hover:opacity-100 bg-stone-100 text-stone-600 hover:bg-stone-200"
                        >
                          View
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {filteredTenants.length === 0 && (
            <div className="py-20 text-center">
              <Search size={32} className="mx-auto text-gray-200 mb-3" />
              <p className="text-sm text-gray-400 font-medium">No tenants match your search.</p>
            </div>
          )}

          {/* Pagination */}
          {filteredTenants.length > ROWS_PER_PAGE && (
            <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-400 font-medium">
                Showing <span className="font-bold text-gray-600">{(safePage - 1) * ROWS_PER_PAGE + 1}–{Math.min(safePage * ROWS_PER_PAGE, filteredTenants.length)}</span> of{" "}
                <span className="font-bold text-gray-600">{filteredTenants.length}</span> tenants
              </p>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                  disabled={safePage <= 1}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronLeft size={16} className="text-gray-600" />
                </button>
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter((p) => p === 1 || p === totalPages || Math.abs(p - safePage) <= 2)
                  .reduce((acc, p, idx, arr) => {
                    if (idx > 0 && p - arr[idx - 1] > 1) acc.push("...");
                    acc.push(p);
                    return acc;
                  }, [])
                  .map((p, idx) =>
                    p === "..." ? (
                      <span key={`dot-${idx}`} className="px-1.5 text-xs text-gray-300">…</span>
                    ) : (
                      <button
                        key={p}
                        onClick={() => setCurrentPage(p)}
                        className={`w-8 h-8 rounded-lg text-xs font-bold transition-all ${
                          p === safePage
                            ? "bg-gray-900 text-white shadow-sm"
                            : "text-gray-500 hover:bg-gray-100"
                        }`}
                      >
                        {p}
                      </button>
                    )
                  )}
                <button
                  onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                  disabled={safePage >= totalPages}
                  className="p-2 rounded-lg hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronRightIcon size={16} className="text-gray-600" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Override Drawer */}
      <AnimatePresence>
        {selectedTenant && (
          <div className="fixed inset-0 z-50 flex items-stretch justify-end">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedTenant(null)}
              className="absolute inset-0 bg-gray-900/50 backdrop-blur-sm"
            />
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="relative w-full max-w-md bg-white shadow-2xl flex flex-col"
            >
              {/* Drawer Header */}
              <div className="p-6 border-b border-gray-100 bg-gradient-to-r from-gray-900 to-gray-800 text-white">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center">
                      <Crown size={20} className="text-amber-400" />
                    </div>
                    <div>
                      <h2 className="text-lg font-black tracking-tight">Pricing Override</h2>
                      <p className="text-xs text-gray-400 font-medium">{selectedTenant.company_name || selectedTenant.name}</p>
                    </div>
                  </div>
                  <button onClick={() => setSelectedTenant(null)} className="p-2 hover:bg-white/10 rounded-xl transition-colors">
                    <X size={20} className="text-gray-400" />
                  </button>
                </div>

                {/* Default Pricing Reference */}
                <div className="flex gap-4">
                  <div className="flex-1 bg-white/5 rounded-xl p-3 border border-white/10">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Default Monthly</div>
                    <div className="text-lg font-black">{centsToDisplay(selectedTenant.default_monthly)}</div>
                  </div>
                  <div className="flex-1 bg-white/5 rounded-xl p-3 border border-white/10">
                    <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-1">Default Setup</div>
                    <div className="text-lg font-black">{centsToDisplay(selectedTenant.default_setup)}</div>
                  </div>
                </div>
              </div>

              {/* Form */}
              <div className="flex-1 overflow-y-auto p-6">
                <form id="override-form" onSubmit={handleSaveOverride} className="space-y-5">
                  <div className="space-y-4">
                    <FormGroup label="Active Plan" hint="The base plan for this tenant">
                      <select
                        className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all font-bold"
                        value={overrideForm.plan}
                        onChange={(e) => setOverrideForm({ ...overrideForm, plan: e.target.value })}
                      >
                        <option value="basic">Basic Plan</option>
                        <option value="pro">Pro Plan</option>
                        <option value="elite">Elite Plan</option>
                      </select>
                    </FormGroup>
                  </div>

                  {/* Plan Price Overrides */}
                  <div className="space-y-4">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2 mt-4">Plan Price Overrides</div>
                    
                    {["basic", "pro", "elite"].map((planId) => {
                      const capitalized = planId.charAt(0).toUpperCase() + planId.slice(1);
                      const currentForm = overrideForm.plan_overrides[planId];
                      
                      const setPlanForm = (updates) => {
                        setOverrideForm({
                          ...overrideForm,
                          plan_overrides: {
                            ...overrideForm.plan_overrides,
                            [planId]: { ...currentForm, ...updates }
                          }
                        });
                      };

                      return (
                        <div key={planId} className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50/50 p-4 space-y-4">
                          <h3 className="font-bold text-gray-800 border-b border-gray-200 pb-2">{capitalized} Plan</h3>
                          
                          {/* Monthly */}
                          <FormGroup label="Monthly Override" compact hint="Leave empty for default">
                            <div className="relative">
                              <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                placeholder={`e.g. ${planId === 'basic' ? '297' : planId === 'pro' ? '497' : '997'}`}
                                className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-gray-900 transition-all"
                                value={currentForm.monthly}
                                onChange={(e) => setPlanForm({ monthly: e.target.value })}
                              />
                            </div>
                          </FormGroup>

                          {/* Setup */}
                          <FormGroup label="Setup Fee Override" compact>
                            <label className="flex items-center gap-2 cursor-pointer mb-2">
                              <input
                                type="checkbox"
                                className="w-3.5 h-3.5 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                checked={currentForm.waive_setup}
                                onChange={(e) => setPlanForm({ waive_setup: e.target.checked, setup: "" })}
                              />
                              <span className="text-xs font-bold text-emerald-700">Waive setup fee ($0)</span>
                            </label>
                            
                            {!currentForm.waive_setup && (
                              <div className="relative">
                                <DollarSign size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  placeholder={`e.g. ${planId === 'basic' ? '400' : planId === 'pro' ? '600' : '900'}`}
                                  className="w-full pl-8 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm font-mono focus:ring-2 focus:ring-gray-900 transition-all"
                                  value={currentForm.setup}
                                  onChange={(e) => setPlanForm({ setup: e.target.value })}
                                />
                              </div>
                            )}
                          </FormGroup>
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-gray-100 pt-5">
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Promotion Details</div>

                    <div className="space-y-4">
                      <FormGroup label="Promo Label" compact>
                        <input
                          type="text"
                          placeholder='e.g. "Launch Special" or "Elite @ Pro pricing"'
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
                          value={overrideForm.promo_label}
                          onChange={(e) => setOverrideForm({ ...overrideForm, promo_label: e.target.value })}
                        />
                      </FormGroup>

                      <FormGroup label="Expiry Date" compact hint="Leave empty for permanent override">
                        <input
                          type="date"
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
                          value={overrideForm.promo_expires_at}
                          onChange={(e) => setOverrideForm({ ...overrideForm, promo_expires_at: e.target.value })}
                        />
                      </FormGroup>

                      <FormGroup label="Internal Notes" compact>
                        <textarea
                          rows={2}
                          placeholder="Why was this override applied…"
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm resize-none focus:ring-2 focus:ring-gray-900 focus:border-transparent transition-all"
                          value={overrideForm.promo_notes}
                          onChange={(e) => setOverrideForm({ ...overrideForm, promo_notes: e.target.value })}
                        />
                      </FormGroup>
                    </div>
                  </div>
                </form>

                <div className="border-t border-gray-100 pt-5 mt-5">
                  <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-4">Account Status</div>
                  <div className={`p-4 rounded-xl border ${selectedTenant.is_suspended ? "bg-red-50 border-red-100" : "bg-emerald-50 border-emerald-100"}`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className={`text-sm font-black ${selectedTenant.is_suspended ? "text-red-700" : "text-emerald-700"}`}>
                          {selectedTenant.is_suspended ? "Account Suspended" : "Account Active"}
                        </div>
                        {selectedTenant.is_suspended && selectedTenant.suspended_reason && (
                          <div className="text-xs text-red-600 mt-0.5">{selectedTenant.suspended_reason}</div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={handleToggleSuspension}
                        className={`px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider transition-all ${
                          selectedTenant.is_suspended 
                            ? "bg-red-600 text-white hover:bg-red-700 shadow-sm" 
                            : "bg-white text-emerald-700 border border-emerald-200 hover:bg-emerald-100"
                        }`}
                      >
                        {selectedTenant.is_suspended ? "Unsuspend" : "Suspend Account"}
                      </button>
                    </div>
                  </div>
                </div>

                {(selectedTenant.price_override_monthly != null || selectedTenant.price_override_setup != null) && (
                  <button
                    onClick={handleRemoveOverride}
                    disabled={saveLoading}
                    className="mt-5 w-full flex items-center justify-center gap-2 px-4 py-2.5 text-red-600 border border-red-200 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-red-50 transition-colors"
                  >
                    <Trash2 size={14} />
                    Remove All Overrides
                  </button>
                )}
              </div>

              {/* Footer */}
              <div className="p-5 border-t border-gray-100 bg-gray-50/50 space-y-3">
                {saveMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`text-xs font-bold text-center py-2 px-3 rounded-xl ${saveMessage.startsWith("Error") ? "bg-red-50 text-red-600 border border-red-100" : "bg-emerald-50 text-emerald-600 border border-emerald-100"}`}
                  >
                    {saveMessage}
                  </motion.div>
                )}
                <div className="flex gap-3">
                  <button
                    type="submit"
                    form="override-form"
                    disabled={saveLoading}
                    className="flex-1 bg-gray-900 hover:bg-black text-white py-3 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-lg shadow-gray-900/10 disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {saveLoading && <LumaSpin className="w-4 h-4 border-white" />}
                    Save Override
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedTenant(null)}
                    className="px-5 py-3 bg-white border border-gray-200 text-gray-600 rounded-xl text-xs font-black uppercase tracking-wider hover:bg-gray-50 transition-all"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────── */

function StatCard({ icon, label, value, iconBg, iconColor, accent, large }) {
  return (
    <div className="bg-white/5 backdrop-blur-sm rounded-xl border border-white/10 p-4 hover:bg-white/10 transition-all">
      <div className="flex items-center gap-3">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${iconBg}`}>
          <span className={iconColor}>{icon}</span>
        </div>
        <div>
          <div className={`font-black text-white ${large ? "text-xl" : "text-lg"}`}>{value}</div>
          <div className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">{label}</div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }) {
  const map = {
    active: { bg: "rgba(16,185,129,0.08)", text: "#059669", border: "rgba(16,185,129,0.2)", label: "Active" },
    trialing: { bg: "rgba(59,130,246,0.08)", text: "#2563eb", border: "rgba(59,130,246,0.2)", label: "Trial" },
    past_due: { bg: "rgba(245,158,11,0.08)", text: "#d97706", border: "rgba(245,158,11,0.2)", label: "Past Due" },
    canceled: { bg: "rgba(239,68,68,0.08)", text: "#dc2626", border: "rgba(239,68,68,0.2)", label: "Canceled" },
    inactive: { bg: "rgba(156,163,175,0.08)", text: "#6b7280", border: "rgba(156,163,175,0.2)", label: "Inactive" },
  };
  const s = map[status] || map.inactive;
  return (
    <span
      className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider"
      style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

function FormGroup({ label, hint, compact, children }) {
  return (
    <div>
      <label className={`block font-black text-gray-700 uppercase tracking-wider mb-1.5 ${compact ? "text-[10px]" : "text-[11px]"}`}>
        {label}
      </label>
      {children}
      {hint && <p className="text-[10px] text-gray-400 mt-1 font-medium">{hint}</p>}
    </div>
  );
}

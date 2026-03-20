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
  UserPlus,
  Mail,
  UserCheck,
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

export default function Admin({ view = "tenants" }) {
  const [stats, setStats] = useState(null);
  const [tenants, setTenants] = useState([]);
  const [admins, setAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTenant, setSelectedTenant] = useState(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");
  const [filterPlan, setFilterPlan] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [impersonateConfirm, setImpersonateConfirm] = useState(null);
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [adminToDelete, setAdminToDelete] = useState(null);
  const [suspensionConfirm, setSuspensionConfirm] = useState(null);
  const [removalConfirm, setRemovalConfirm] = useState(null);
  const [alertConfig, setAlertConfig] = useState(null);
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
    },
    addons: { customerNurturingReferral: false },
  });

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [s, t, a] = await Promise.all([
        api.getAdminStats(),
        api.getAdminTenants(),
        api.getAdmins()
      ]);

      setStats(s);
      setTenants(t.tenants || []);
      setAdmins(a.admins || []);
      
      if (!t.tenants || t.tenants.length === 0) {
        console.warn("Tenant list is empty from server.");
      }
    } catch (e) {
      console.error("Admin load error:", e);
      setError(`Failed to load data: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleInviteAdmin(e) {
    e.preventDefault();
    if (!inviteEmail) return;
    setInviteLoading(true);
    try {
      await api.inviteAdmin(inviteEmail);
      setInviteEmail("");
      setIsInviteModalOpen(false);
      await loadData();
    } catch (err) {
      setAlertConfig({
        title: "Invitation Error",
        message: err.message,
        variant: "danger",
        icon: <UserCheck size={32} />
      });
    } finally {
      setInviteLoading(false);
    }
  }

  async function handleRemoveAdmin(admin) {
    const user = JSON.parse(localStorage.getItem("user") || "{}");
    if (admin.id === user.id) {
      setAlertConfig({
        title: "Action Restricted",
        message: "You cannot remove yourself from the platform console.",
        variant: "warning",
        icon: <Shield size={32} />
      });
      return;
    }
    setAdminToDelete(admin);
  }

  async function confirmRemoveAdmin() {
    if (!adminToDelete) return;
    try {
      await api.removeAdmin(adminToDelete.id);
      await loadData();
      setAdminToDelete(null);
    } catch (err) {
      setError(`Error: ${err.message}`);
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

    const addons = existingOverrides.addons && typeof existingOverrides.addons === "object" ? existingOverrides.addons : {};
    setOverrideForm({
      promo_label: tenant.promo_label || "",
      promo_expires_at: tenant.promo_expires_at ? tenant.promo_expires_at.split("T")[0] : "",
      promo_notes: tenant.promo_notes || "",
      plan: tenant.plan || "basic",
      plan_overrides: {
        basic: buildPlanForm("basic"),
        pro: buildPlanForm("pro"),
        elite: buildPlanForm("elite"),
      },
      addons: {
        customerNurturingReferral: !!addons.customerNurturingReferral,
      },
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
      if (overrideForm.addons && typeof overrideForm.addons === "object") {
        formattedOverrides.addons = Object.fromEntries(
          Object.entries(overrideForm.addons).map(([k, v]) => [k, !!v])
        );
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
    setRemovalConfirm({
      tenantId: selectedTenant.id,
      name: selectedTenant.company_name || selectedTenant.name
    });
  }

  async function confirmRemoveOverride() {
    if (!removalConfirm) return;
    setSaveLoading(true);
    try {
      await removeTenantPricing(removalConfirm.tenantId);
      setSaveMessage("Overrides removed.");
      await loadData();
      setSelectedTenant(null);
      setRemovalConfirm(null);
    } catch (err) {
      setSaveMessage(`Error: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  }

  async function handleToggleSuspension() {
    if (!selectedTenant) return;
    setSuspensionConfirm({
      tenant: selectedTenant,
      action: selectedTenant.is_suspended ? "unsuspend" : "suspend"
    });
  }

  async function confirmSuspension(reason = null) {
    if (!suspensionConfirm) return;
    const { tenant, action } = suspensionConfirm;
    
    setSaveLoading(true);
    try {
      await api.suspendTenant(tenant.id, action === "suspend", reason);
      setSaveMessage(`Tenant ${action}ed!`);
      await loadData();
      setSelectedTenant((prev) => ({ ...prev, is_suspended: action === "suspend" }));
      setSuspensionConfirm(null);
    } catch (err) {
      setSaveMessage(`Error: ${err.message}`);
    } finally {
      setSaveLoading(false);
    }
  }

  function handleImpersonate(tenant) {
    setImpersonateConfirm(tenant);
  }

  function confirmImpersonate() {
    if (!impersonateConfirm) return;
    localStorage.setItem("impersonate_tenant_id", impersonateConfirm.id);
    localStorage.setItem("impersonate_tenant_name", impersonateConfirm.company_name || impersonateConfirm.name);
    window.location.href = "/";
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
    <div className="min-h-screen bg-slate-50/30">

      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* Dynamic Content Area */}
        <main className="flex-1">
          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600">
              <AlertCircle size={20} />
              <div className="text-sm font-medium">{error}</div>
            </div>
          )}

          {view === 'tenants' ? (
            <div className="space-y-6 max-w-6xl">
              {/* Stats Section */}
              {stats && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-600 flex items-center justify-center">
                        <Building2 size={20} />
                      </div>
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Total Tenants</div>
                    </div>
                    <div className="text-2xl font-black text-slate-900 tracking-tight">{stats.total_tenants}</div>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
                        <CheckCircle2 size={20} />
                      </div>
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Active Subs</div>
                    </div>
                    <div className="text-2xl font-black text-slate-900 tracking-tight">{stats.active_subs}</div>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                        <DollarSign size={20} />
                      </div>
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">Monthly Revenue</div>
                    </div>
                    <div className="text-2xl font-black text-slate-900 tracking-tight">{centsToMRR(stats.mrr_cents)}</div>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                        <Tag size={20} />
                      </div>
                      <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest whitespace-nowrap">With Overrides</div>
                    </div>
                    <div className="text-2xl font-black text-slate-900 tracking-tight">{stats.with_overrides}</div>
                  </div>
                </div>
              )}

              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">Tenants</h2>
                  <p className="text-xs text-slate-500 font-medium">Manage business accounts and pricing</p>
                </div>
                
                <div className="flex items-center gap-3 w-full md:w-auto">
                  <div className="relative flex-1 md:w-72">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300" />
                    <input
                      type="text"
                      placeholder="Search tenants…"
                      className="pl-9 pr-4 py-2.5 w-full bg-white border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <select 
                    value={filterPlan}
                    onChange={(e) => setFilterPlan(e.target.value)}
                    className="px-4 py-2.5 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all"
                  >
                    <option value="all">All Plans</option>
                    <option value="basic">Basic</option>
                    <option value="pro">Pro</option>
                    <option value="elite">Elite</option>
                  </select>
                </div>
              </div>

              {/* Tenants Table */}
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden min-h-[400px]">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Business</th>
                        <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Plan</th>
                        <th className="px-4 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Monthly</th>
                        <th className="px-4 py-4 text-center text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                        <th className="px-4 py-4 text-right text-[10px] font-black text-slate-400 uppercase tracking-widest">Usage</th>
                        <th className="px-4 py-4" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {paginatedTenants.map((t, i) => {
                        const pc = PLAN_COLORS[t.plan] || PLAN_COLORS.basic;
                        return (
                          <motion.tr
                            key={t.id}
                            initial={{ opacity: 0, y: 8 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: i * 0.03 }}
                            className="hover:bg-slate-50/60 transition-colors group"
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500 text-xs font-black shrink-0">
                                  {(t.company_name || t.name || "?").charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0">
                                  <div className="font-bold text-slate-900 text-sm truncate">{t.company_name || t.name}</div>
                                  <div className="text-[11px] text-slate-400 font-medium truncate">{t.slug}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-4">
                              <span
                                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider"
                                style={{ backgroundColor: pc.bg, color: pc.text, border: `1px solid ${pc.border}` }}
                              >
                                {t.plan || "basic"}
                              </span>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <div className="text-sm font-black text-slate-900">{centsToDisplay(t.effective_monthly)}</div>
                              {t.override_active && (
                                <div className="text-[10px] text-amber-600 font-bold">OVERRIDE</div>
                              )}
                            </td>
                            <td className="px-4 py-4 text-center">
                              {t.is_suspended ? (
                                <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-red-50 text-red-600 border border-red-200">SUSPENDED</span>
                              ) : (
                                <StatusBadge status={t.subscription_status} />
                              )}
                            </td>
                            <td className="px-4 py-4 text-right">
                              <div className="text-xs font-bold text-slate-700">{t.total_calls} calls</div>
                              <div className="text-[10px] text-slate-400 font-medium">{t.total_bookings} bookings</div>
                            </td>
                            <td className="px-4 py-4 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  onClick={() => openOverrideDrawer(t)}
                                  className="w-8 h-8 flex items-center justify-center rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all shadow-sm"
                                  title="Pricing Settings"
                                >
                                  <Tag size={14} />
                                </button>
                                <button
                                  onClick={() => handleImpersonate(t)}
                                  className="px-3 py-1.5 text-[10px] font-black tracking-wider uppercase rounded-lg bg-slate-900 text-white hover:bg-black transition-all shadow-sm shadow-slate-900/10"
                                >
                                  View
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Empty State */}
                {filteredTenants.length === 0 && (
                  <div className="py-20 text-center">
                    <Building2 size={32} className="mx-auto text-slate-200 mb-3" />
                    <p className="text-sm text-slate-400 font-medium">No tenants found</p>
                  </div>
                )}

                {/* Pagination */}
                {filteredTenants.length > ROWS_PER_PAGE && (
                  <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between">
                    <p className="text-xs text-slate-400 font-medium">
                      Page <span className="font-bold text-slate-600">{safePage}</span> of <span className="font-bold text-slate-600">{totalPages}</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={safePage <= 1}
                        className="px-3 py-1.5 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 transition-all uppercase"
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                        disabled={safePage >= totalPages}
                        className="px-3 py-1.5 text-[10px] font-bold text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-30 transition-all uppercase"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-6 max-w-5xl">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-black text-slate-900 tracking-tight">Platform Admins</h2>
                  <p className="text-xs text-slate-500 font-medium">Manage people with access to this platform console</p>
                </div>
                <button 
                  onClick={() => setIsInviteModalOpen(true)}
                  className="flex items-center justify-center gap-2 px-6 py-3 bg-slate-900 border border-slate-900 text-white rounded-2xl text-[11px] font-black uppercase tracking-wider hover:bg-black transition-all shadow-xl shadow-slate-900/10"
                >
                  <UserPlus size={16} />
                  Invite New Admin
                </button>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100 bg-slate-50/50">
                        <th className="px-6 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Admin</th>
                        <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Role</th>
                        <th className="px-4 py-4 text-left text-[10px] font-black text-slate-400 uppercase tracking-widest">Joined</th>
                        <th className="px-4 py-4" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {admins.map((admin, i) => (
                        <motion.tr
                          key={admin.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: i * 0.03 }}
                          className="hover:bg-slate-50/60 transition-colors"
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-9 h-9 rounded-xl bg-red-50 text-red-600 flex items-center justify-center shadow-sm border border-red-100">
                                <Shield size={16} />
                              </div>
                              <div className="font-bold text-slate-900 text-sm">{admin.email}</div>
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <span className="inline-flex px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 text-slate-600 border border-slate-200">
                              SUPER ADMIN
                            </span>
                          </td>
                          <td className="px-4 py-4 text-sm text-slate-500 font-medium">
                            {new Date(admin.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-4 py-4 text-right">
                            <button
                              onClick={() => setAdminToDelete(admin)}
                              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-all"
                              title="Remove access"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
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
                    <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-2">Add-ons</div>
                    <p className="text-xs text-gray-500 mb-3">Grant feature add-ons without changing plan. Customer Nurturing is included on Elite; use this to enable it on Basic/Pro.</p>
                    <label className="flex items-center gap-3 p-3 rounded-xl border border-gray-200 bg-gray-50/50 cursor-pointer hover:bg-gray-50">
                      <input
                        type="checkbox"
                        className="w-4 h-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                        checked={overrideForm.addons?.customerNurturingReferral ?? false}
                        onChange={(e) => setOverrideForm({
                          ...overrideForm,
                          addons: { ...overrideForm.addons, customerNurturingReferral: e.target.checked },
                        })}
                      />
                      <span className="text-sm font-medium text-gray-800">Customer Nurturing & Referral</span>
                    </label>
                  </div>

                  <div className="border-t border-gray-100 pt-5 mt-5">
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
                        onClick={() => setSuspensionConfirm({ tenant: selectedTenant, action: selectedTenant.is_suspended ? "unsuspend" : "suspend" })}
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
                    onClick={() => setRemovalConfirm(selectedTenant)}
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

       <ConfirmModal
         isOpen={!!impersonateConfirm}
         onClose={() => setImpersonateConfirm(null)}
         onConfirm={confirmImpersonate}
         title="Switch Perspective"
         message={`Switch to viewing ${impersonateConfirm?.company_name || impersonateConfirm?.name} perspective?`}
         confirmText="View Dashboard"
         icon={<Users size={32} />}
       />

      <ConfirmModal
        isOpen={!!adminToDelete}
        onClose={() => setAdminToDelete(null)}
        onConfirm={confirmRemoveAdmin}
        title="Remove Admin Access"
        message={`Are you sure you want to remove access for ${adminToDelete?.email}? This action cannot be undone.`}
        confirmText="Remove Access"
        variant="danger"
        icon={<Trash2 size={32} />}
      />

      <ConfirmModal
        isOpen={!!removalConfirm}
        onClose={() => setRemovalConfirm(null)}
        onConfirm={confirmRemoveOverride}
        title="Remove Pricing Overrides"
        message={`This will clear all custom pricing for ${removalConfirm?.name} and revert them to default plan pricing. Proceed?`}
        confirmText="Clear Overrides"
        variant="danger"
        icon={<Tag size={32} />}
      />

      {suspensionConfirm && (
        <SuspensionModal
          isOpen={!!suspensionConfirm}
          onClose={() => setSuspensionConfirm(null)}
          onConfirm={confirmSuspension}
          tenantName={suspensionConfirm.tenant.company_name || suspensionConfirm.tenant.name}
          action={suspensionConfirm.action}
        />
      )}

      <ConfirmModal
        isOpen={!!alertConfig}
        onClose={() => setAlertConfig(null)}
        onConfirm={() => setAlertConfig(null)}
        title={alertConfig?.title || "Notification"}
        message={alertConfig?.message}
        confirmText="Understood"
        variant={alertConfig?.variant || "primary"}
        icon={alertConfig?.icon}
        isAlert
      />

       {/* Invite Admin Modal */}
      <AnimatePresence>
        {isInviteModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-sm w-full overflow-hidden"
            >
              <form onSubmit={handleInviteAdmin} className="p-8">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border border-red-100/50">
                  <UserPlus size={32} />
                </div>
                <h3 className="text-xl font-black text-slate-900 text-center mb-2">Invite Platform Admin</h3>
                <p className="text-sm text-slate-500 text-center font-medium leading-relaxed mb-6">
                  Enter an email address to send an invitation to join the platform console.
                </p>
                
                <div className="space-y-4 mb-8">
                  <div className="relative">
                    <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      autoFocus
                      type="email"
                      required
                      placeholder="admin@example.com"
                      className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all font-medium"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                  </div>
                </div>

                <div className="flex flex-col gap-3">
                  <button
                    type="submit"
                    disabled={inviteLoading}
                    className="w-full bg-slate-900 hover:bg-black text-white py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-xl shadow-slate-900/10 flex items-center justify-center gap-2"
                  >
                    {inviteLoading && <LumaSpin className="w-4 h-4 border-white" />}
                    Send Invitation
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsInviteModalOpen(false);
                      setInviteEmail("");
                    }}
                    className="w-full bg-white text-slate-400 hover:text-slate-600 font-bold text-xs py-2 transition-all uppercase tracking-wide"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ─── Sub-components ───────────────────────────────────────── */

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
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider"
      style={{ backgroundColor: s.bg, color: s.text, border: `1px solid ${s.border}` }}
    >
      {s.label}
    </span>
  );
}

function ConfirmModal({ isOpen, onClose, onConfirm, title, message, confirmText, variant = "primary", icon, isAlert }) {
  const isDanger = variant === "danger";
  const isWarning = variant === "warning";
  
  const getColors = () => {
    if (isDanger) return "bg-red-50 text-red-500 border-red-100/50";
    if (isWarning) return "bg-amber-50 text-amber-500 border-amber-100/50";
    return "bg-blue-50 text-blue-500 border-blue-100/50";
  };

  const getButtonColors = () => {
    if (isDanger) return "bg-red-600 hover:bg-red-700 text-white shadow-red-600/10";
    if (isWarning) return "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/10";
    return "bg-slate-900 hover:bg-black text-white shadow-slate-900/10";
  };
  
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-sm w-full overflow-hidden"
          >
            <div className="p-8 text-center">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border ${getColors()}`}>
                {icon || <Users size={32} />}
              </div>
              <h3 className="text-xl font-black text-slate-900 mb-2">{title}</h3>
              <p className="text-sm text-slate-500 font-medium leading-relaxed mb-8">
                {message}
              </p>
              <div className="flex flex-col gap-3">
                <button
                  onClick={onConfirm}
                  className={`w-full py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-xl ${getButtonColors()}`}
                >
                  {confirmText}
                </button>
                {!isAlert && (
                  <button
                    onClick={onClose}
                    className="w-full bg-white text-slate-400 hover:text-slate-600 font-bold text-xs py-2 transition-all uppercase tracking-wide"
                  >
                    Go Back
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

function SuspensionModal({ isOpen, onClose, onConfirm, tenantName, action }) {
  const [reason, setReason] = useState("");
  const isSuspended = action === "suspend";

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-slate-900/40 backdrop-blur-md">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-3xl shadow-2xl border border-slate-100 max-w-sm w-full overflow-hidden"
          >
            <div className="p-8">
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-sm border ${isSuspended ? "bg-amber-50 text-amber-500 border-amber-100/50" : "bg-emerald-50 text-emerald-500 border-emerald-100/50"}`}>
                <AlertCircle size={32} />
              </div>
              <h3 className="text-xl font-black text-slate-900 text-center mb-2">
                {isSuspended ? "Suspend Tenant" : "Unsuspend Tenant"}
              </h3>
              <p className="text-sm text-slate-500 text-center font-medium leading-relaxed mb-6">
                Are you sure you want to {action} <strong>{tenantName}</strong>?
                {isSuspended && " Access to their dashboard will be restricted."}
              </p>

              {isSuspended && (
                <div className="mb-8">
                  <FormGroup label="Reason (Optional)" compact>
                    <textarea
                      className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-slate-900 focus:border-transparent outline-none transition-all font-medium min-h-[100px]"
                      placeholder="e.g. Non-payment, violation of terms..."
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </FormGroup>
                </div>
              )}

              <div className="flex flex-col gap-3">
                <button
                  onClick={() => onConfirm(reason)}
                  className={`w-full py-3.5 rounded-2xl text-xs font-black uppercase tracking-wider transition-all shadow-xl ${isSuspended ? "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/10" : "bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/10"}`}
                >
                  Confirm {action === "suspend" ? "Suspension" : "Unsuspension"}
                </button>
                <button
                  onClick={onClose}
                  className="w-full bg-white text-slate-400 hover:text-slate-600 font-bold text-xs py-2 transition-all uppercase tracking-wide text-center"
                >
                  Cancel
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
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

import { useState, useEffect } from "react";
import {
  getTeam, inviteTeamMember, removeTeamMember, getTenants, getUser, get,
} from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Users, Crown, MapPin, Trash2, Mail, Plus, AlertCircle, Building2,
  Shield, User, History,
} from "lucide-react";

// ─── Action badge config ───────────────────────────────────────────────────
const ACTION_BADGES = {
  user_login:       { label: "Login",            bg: "#dbeafe", color: "#1e40af" },
  user_removed:     { label: "User removed",     bg: "#fee2e2", color: "#991b1b" },
  team_viewed:      { label: "Team viewed",      bg: "#dcfce7", color: "#166534" },
  booking_updated:  { label: "Booking updated",  bg: "#fef9c3", color: "#854d0e" },
  lead_viewed:      { label: "Lead viewed",      bg: "#ede9fe", color: "#5b21b6" },
  settings_updated: { label: "Settings changed", bg: "#f3f4f6", color: "#374151" },
  password_reset:   { label: "Password reset",   bg: "#fee2e2", color: "#991b1b" },
  recording_played: { label: "Recording played", bg: "#ede9fe", color: "#5b21b6" },
};

function initials(email = "") {
  if (!email) return "??";
  const parts = email.split("@")[0].split(/[._-]/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : email.slice(0, 2).toUpperCase();
}

function formatTime(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("en-US", {
      month: "short", day: "numeric",
      hour: "numeric", minute: "2-digit", hour12: true,
    });
  } catch {
    return iso;
  }
}

function summarizeValue(val) {
  if (!val || typeof val !== "object") return String(val || "—");
  const entries = Object.entries(val).slice(0, 2);
  return entries.map(([k, v]) => `${k}: ${String(v).slice(0, 30)}`).join(" · ") || "—";
}

// ─── History Tab ──────────────────────────────────────────────────────────
function HistoryTab({ isHQ }) {
  const today     = new Date().toISOString().slice(0, 10);
  const monthAgo  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [pages,   setPages]   = useState(1);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  const [filterAction, setFilterAction] = useState("");
  const [filterFrom,   setFilterFrom]   = useState(monthAgo);
  const [filterTo,     setFilterTo]     = useState(today);
  const [page,         setPage]         = useState(1);

  useEffect(() => {
    let cancelled = false;
    const fetch = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = { page, limit: 25 };
        if (filterAction) params.action = filterAction;
        if (filterFrom)   params.from   = filterFrom;
        if (filterTo)     params.to     = filterTo;
        const data = await get("/api/audit-logs", params);
        if (!cancelled) {
          setLogs(data.logs   || []);
          setTotal(data.total || 0);
          setPages(data.pages || 1);
        }
      } catch (err) {
        if (!cancelled) setError(err.message || "Failed to load history");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, [page, filterAction, filterFrom, filterTo]);

  const handleFilter = (setter) => (e) => { setter(e.target.value); setPage(1); };

  return (
    <div>
      {/* Filters */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 12, marginBottom: 16 }}>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">Action type</label>
          <select
            value={filterAction}
            onChange={handleFilter(setFilterAction)}
            className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-400 outline-none"
          >
            <option value="">All actions</option>
            {Object.entries(ACTION_BADGES).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">From</label>
          <input
            type="date"
            value={filterFrom}
            onChange={handleFilter(setFilterFrom)}
            className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-400 outline-none"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold uppercase tracking-wider text-stone-500 mb-1">To</label>
          <input
            type="date"
            value={filterTo}
            onChange={handleFilter(setFilterTo)}
            className="w-full px-3 py-2 border border-stone-200 rounded-lg text-sm focus:ring-2 focus:ring-stone-400 outline-none"
          />
        </div>
      </div>

      {/* Count */}
      <p className="text-xs text-stone-400 mb-3">
        {loading ? "Loading…" : `${total} result${total !== 1 ? "s" : ""}`}
      </p>

      {/* Error */}
      {error && (
        <div className="mb-4 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-2 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-stone-50 border-b border-stone-200">
              <tr>
                {["Action", "User", isHQ ? "Location" : null, "Detail", "Time"]
                  .filter(Boolean)
                  .map(h => (
                    <th key={h} className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-stone-500">
                      {h}
                    </th>
                  ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {!loading && logs.length === 0 && (
                <tr>
                  <td colSpan={isHQ ? 5 : 4} className="px-5 py-10 text-center text-stone-400 text-sm">
                    No activity matches your filters.
                  </td>
                </tr>
              )}
              {logs.map((row) => {
                const badge = ACTION_BADGES[row.action] || { label: row.action, bg: "#f3f4f6", color: "#374151" };
                return (
                  <tr key={row.id} className="hover:bg-stone-50 transition-colors">
                    <td className="px-5 py-3">
                      <span style={{
                        display: "inline-block", fontSize: 11, fontWeight: 600,
                        padding: "2px 9px", borderRadius: 6,
                        background: badge.bg, color: badge.color,
                      }}>
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <div style={{
                          width: 24, height: 24, borderRadius: "50%",
                          background: "#e8f0fe", display: "flex",
                          alignItems: "center", justifyContent: "center",
                          fontSize: 9, fontWeight: 700, color: "#1a56db", flexShrink: 0,
                        }}>
                          {initials(row.user_email)}
                        </div>
                        <span className="text-stone-700 text-sm">{row.user_email || "System"}</span>
                      </div>
                    </td>
                    {isHQ && (
                      <td className="px-5 py-3 text-xs text-stone-400">{row.location_name || "—"}</td>
                    )}
                    <td className="px-5 py-3 text-xs text-stone-400 max-w-[200px] truncate">
                      {row.new_value
                        ? summarizeValue(row.new_value)
                        : row.entity_type
                          ? `${row.entity_type}${row.entity_id ? ` · ${row.entity_id.slice(0, 8)}` : ""}`
                          : "—"}
                    </td>
                    <td className="px-5 py-3 text-xs text-stone-400 whitespace-nowrap">
                      {formatTime(row.created_at)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-4">
        <span className="text-xs text-stone-400">Page {page} of {pages}</span>
        <div className="flex gap-2">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            ← Prev
          </button>
          <button
            onClick={() => setPage(p => Math.min(pages, p + 1))}
            disabled={page >= pages}
            className="px-3 py-1.5 text-xs border border-stone-200 rounded-lg text-stone-600 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-default transition-colors"
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Team Page ───────────────────────────────────────────────────────
export default function Team() {
  const currentUser = getUser();
  const isHQ = currentUser?.tenant_business_type === "parent";

  const [activeTab, setActiveTab] = useState("members");
  const [team, setTeam] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [inviteLocation, setInviteLocation] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  const activeTenantId = localStorage.getItem("tenantId");

  useEffect(() => { fetchData(); }, [activeTenantId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [teamRes, tenantsRes] = await Promise.all([
        getTeam(activeTenantId),
        getTenants(),
      ]);
      setTeam(teamRes.team || []);
      setLocations(tenantsRes.tenants || []);
      if (activeTenantId && activeTenantId !== "all") {
        setInviteLocation(activeTenantId);
      } else if (tenantsRes.tenants?.length > 0) {
        setInviteLocation(tenantsRes.tenants[0].id);
      }
    } catch (err) {
      setError(err.message || "Failed to load team data");
    } finally {
      setLoading(false);
    }
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    setInviteError(""); setInviteSuccess(""); setInviteLoading(true);
    try {
      await inviteTeamMember({ email: inviteEmail, role: inviteRole, location_id: inviteLocation });
      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail("");
      await fetchData();
    } catch (err) {
      setInviteError(err.message || "Failed to invite user");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRemove = async (id, email) => {
    if (!window.confirm(`Remove ${email}? They will lose access immediately.`)) return;
    try {
      await removeTeamMember(id);
      setTeam(prev => prev.filter(u => u.id !== id));
    } catch (err) {
      setError(err.message || "Failed to remove user");
    }
  };

  if (loading && team.length === 0) {
    return <div className="flex items-center justify-center py-20"><LumaSpin /></div>;
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-stone-900 flex items-center gap-3">
            <Users className="text-stone-600" size={28} />
            Team Management
          </h1>
          <p className="text-stone-500 mt-1 text-sm">Manage access for your HQ and branch locations.</p>
        </div>
        {activeTab === "members" && (
          <button
            onClick={() => { setIsInviteOpen(true); setInviteSuccess(""); setInviteError(""); }}
            className="flex items-center gap-2 px-4 py-2.5 bg-stone-900 text-white text-sm font-bold rounded-xl hover:bg-stone-800 shadow-sm hover:shadow-md transition-all"
          >
            <Plus className="w-4 h-4" /> Invite User
          </button>
        )}
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-stone-200">
        {[
          { key: "members",     label: "Members",          icon: <Users size={15} /> },
          { key: "history",     label: "Activity History", icon: <History size={15} /> },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-stone-900 text-stone-900"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "members" && (
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-stone-600">
              <thead className="bg-stone-50 border-b border-stone-200 text-xs uppercase font-semibold text-stone-500">
                <tr>
                  <th className="px-6 py-4">User</th>
                  <th className="px-6 py-4">Assigned Location</th>
                  <th className="px-6 py-4">Role</th>
                  <th className="px-6 py-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {team.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="px-6 py-8 text-center text-stone-500">No team members found.</td>
                  </tr>
                ) : (
                  team.map(user => {
                    const isParent = user.business_type === "parent";
                    const isOwner  = user.role === "admin" && isParent;
                    return (
                      <tr key={user.id} className="hover:bg-stone-50 transition-colors">
                        <td className="px-6 py-4 font-medium text-stone-900 flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-stone-100 flex flex-shrink-0 items-center justify-center text-stone-500">
                            {isOwner ? <Crown className="w-4 h-4 text-amber-500" /> : <User className="w-4 h-4" />}
                          </div>
                          {user.email}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex items-center gap-2">
                            <div className={`p-1.5 rounded-lg ${isParent ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-700"}`}>
                              {isParent ? <Building2 className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                            </div>
                            <span>
                              {user.tenant_name}
                              {isParent && (
                                <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                                  HQ
                                </span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-sm font-medium">
                          {user.role === "admin" || user.role === "owner" ? (
                            <span className="flex items-center gap-1 w-fit text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide">
                              <Shield className="w-3.5 h-3.5" /> Owner
                            </span>
                          ) : user.role === "manager" ? (
                            <span className="flex items-center gap-1 w-fit text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide">
                              <Users className="w-3.5 h-3.5" /> Manager
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 w-fit text-stone-600 bg-stone-50 border border-stone-200 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide">
                              <User className="w-3.5 h-3.5" /> Staff
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-right">
                          <button
                            onClick={() => handleRemove(user.id, user.email)}
                            className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                            title="Revoke access"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "history" && <HistoryTab isHQ={isHQ} />}

      {/* Invite Modal */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden relative">
            <button
              onClick={() => setIsInviteOpen(false)}
              className="absolute top-4 right-4 p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
            >
              ✕
            </button>
            <div className="p-6">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 rounded-xl bg-stone-100 text-stone-700 flex items-center justify-center">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-stone-900">Invite Team Member</h2>
                  <p className="text-sm text-stone-500">They will receive an email to set their password.</p>
                </div>
              </div>

              {inviteError && (
                <div className="mb-4 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-2 text-sm">
                  <AlertCircle size={16} /> {inviteError}
                </div>
              )}
              {inviteSuccess && (
                <div className="mb-4 bg-green-50 border border-green-100 text-green-700 px-4 py-3 rounded-xl flex items-center gap-2 text-sm">
                  <CheckCircle2 size={16} /> {inviteSuccess}
                </div>
              )}

              <form onSubmit={handleInvite} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-stone-700">Email Address</label>
                  <input
                    type="email" required
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-500 outline-none"
                    placeholder="manager@example.com"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-stone-700">Role</label>
                  <select
                    value={inviteRole}
                    onChange={e => setInviteRole(e.target.value)}
                    className="w-full px-3 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-500 outline-none"
                  >
                    <option value="staff">Staff / Technician (Bookings Only)</option>
                    <option value="manager">Business Manager (Operational Access)</option>
                    <option value="admin">Business Owner (Full Access + Billing)</option>
                  </select>
                  {inviteRole === "admin" && (
                    <p className="text-xs text-amber-600 mt-1 flex items-center gap-1 font-medium bg-amber-50/50 p-2 rounded-lg border border-amber-100/50">
                      <Shield className="w-3 h-3 flex-shrink-0" /> Full cross-branch access including billing, settings, and team management.
                    </p>
                  )}
                  {inviteRole === "manager" && (
                    <p className="text-xs text-indigo-600 mt-1 flex items-center gap-1 font-medium bg-indigo-50/50 p-2 rounded-lg border border-indigo-100/50">
                      <Users className="w-3 h-3 flex-shrink-0" /> Access to leads and calls for all locations. No billing or plan access.
                    </p>
                  )}
                  {inviteRole === "staff" && (
                    <p className="text-xs text-stone-500 mt-1 flex items-center gap-1 font-medium bg-stone-50/50 p-2 rounded-lg border border-stone-200/50">
                      <AlertCircle className="w-3 h-3 flex-shrink-0" /> Staff can ONLY see the Bookings calendar.
                    </p>
                  )}
                </div>

                {currentUser?.tenant_business_type === "parent" && (
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-stone-700">Assign Location</label>
                    <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 mb-2">
                      <p className="text-[10px] text-stone-400 uppercase font-bold tracking-wider mb-1">Accessibility Note</p>
                      <p className="text-xs text-stone-600 leading-relaxed italic">
                        Role permissions apply across the selected location. Members assigned to HQ gain visibility across the whole organization to the level of their role.
                      </p>
                    </div>
                    <select
                      value={inviteLocation}
                      onChange={e => setInviteLocation(e.target.value)}
                      className="w-full px-3 py-2 border border-stone-200 rounded-lg focus:ring-2 focus:ring-stone-500 outline-none"
                    >
                      {locations.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name} {t.business_type === "parent" ? "(HQ / Corporate)" : "(Branch)"}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div className="pt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setIsInviteOpen(false)}
                    className="flex-1 px-4 py-2.5 bg-stone-100 text-stone-700 font-medium rounded-xl hover:bg-stone-200 transition-colors"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={inviteLoading || !inviteEmail}
                    className="flex-1 px-4 py-2.5 bg-stone-900 text-white font-medium rounded-xl hover:bg-stone-800 disabled:opacity-50 flex items-center justify-center gap-2 transition-colors"
                  >
                    {inviteLoading ? <LumaSpin className="w-4 h-4 border-white" /> : "Send Invite"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckCircle2(props) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

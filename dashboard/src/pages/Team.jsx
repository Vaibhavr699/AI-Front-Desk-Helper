import { useState, useEffect } from "react";
import { getTeam, inviteTeamMember, removeTeamMember, getTenants } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import { Users, Crown, MapPin, Trash2, Mail, Plus, AlertCircle, Building2, Shield, User } from "lucide-react";

export default function Team() {
  const [team, setTeam] = useState([]);
  const [locations, setLocations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // Modal state
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("staff");
  const [inviteLocation, setInviteLocation] = useState("");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [teamRes, tenantsRes] = await Promise.all([getTeam(), getTenants()]);
      setTeam(teamRes.team || []);
      setLocations(tenantsRes.tenants || []);
      if (tenantsRes.tenants && tenantsRes.tenants.length > 0) {
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
    setInviteError("");
    setInviteSuccess("");
    setInviteLoading(true);
    try {
      await inviteTeamMember({
        email: inviteEmail,
        role: inviteRole,
        location_id: inviteLocation,
      });
      setInviteSuccess(`Invitation sent to ${inviteEmail}`);
      setInviteEmail(""); // Reset email field
      await fetchData(); // Refresh list
    } catch (err) {
      setInviteError(err.message || "Failed to invite user");
    } finally {
      setInviteLoading(false);
    }
  };

  const handleRemove = async (id, email) => {
    if (!window.confirm(`Are you sure you want to remove ${email}? They will lose access immediately.`)) {
      return;
    }
    try {
      await removeTeamMember(id);
      setTeam(prev => prev.filter(u => u.id !== id));
    } catch (err) {
      setError(err.message || "Failed to remove user");
    }
  };

  if (loading && team.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <LumaSpin />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-black text-stone-900 flex items-center gap-3">
            <Users className="text-stone-600" size={28} />
            Team Management
          </h1>
          <p className="text-stone-500 mt-1 text-sm">Manage access for your HQ and branch locations.</p>
        </div>
        <button
          onClick={() => {
            setIsInviteOpen(true);
            setInviteSuccess("");
            setInviteError("");
          }}
          className="flex items-center gap-2 px-4 py-2.5 bg-stone-900 text-white text-sm font-bold rounded-xl hover:bg-stone-800 shadow-sm hover:shadow-md transition-all"
        >
          <Plus className="w-4 h-4" />
          Invite User
        </button>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl flex items-center gap-3 text-sm">
          <AlertCircle size={18} />
          {error}
        </div>
      )}

      {/* Team Table */}
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
                  <td colSpan="4" className="px-6 py-8 text-center text-stone-500">
                    No team members found.
                  </td>
                </tr>
              ) : (
                team.map(user => {
                  const isParent = user.business_type === 'parent';
                  const isOwner = user.role === 'admin' && isParent;
                  
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
                          <div className={`p-1.5 rounded-lg ${isParent ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                            {isParent ? <Building2 className="w-3.5 h-3.5" /> : <MapPin className="w-3.5 h-3.5" />}
                          </div>
                          <span>
                            {user.tenant_name}
                            {isParent && <span className="ml-2 text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">HQ</span>}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm font-medium">
                        <div className="flex items-center gap-1.5">
                          {user.role === 'admin' || user.role === 'owner' ? (
                            <span className="flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide">
                              <Shield className="w-3.5 h-3.5" /> Owner
                            </span>
                          ) : user.role === 'manager' ? (
                            <span className="flex items-center gap-1 text-indigo-700 bg-indigo-50 border border-indigo-100 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide">
                              <Users className="w-3.5 h-3.5" /> Manager
                            </span>
                          ) : (
                            <span className="flex items-center gap-1 text-stone-600 bg-stone-50 border border-stone-200 px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wide">
                              <User className="w-3.5 h-3.5" /> Staff
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-6 py-4 text-right">
                        {/* Don't allow deleting the primary owner for safety, or we could add more complex logic here */}
                        <button
                          onClick={() => handleRemove(user.id, user.email)}
                          className="p-2 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Revoke access"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Invite Modal */}
      {isInviteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-900/50 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden relative">
             <button 
                onClick={() => setIsInviteOpen(false)}
                className="absolute top-4 right-4 p-2 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-lg transition-colors"
             >
                X
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
                    <AlertCircle size={16} />
                    {inviteError}
                  </div>
                )}
                {inviteSuccess && (
                  <div className="mb-4 bg-green-50 border border-green-100 text-green-700 px-4 py-3 rounded-xl flex items-center gap-2 text-sm">
                    <CheckCircle2 size={16} />
                    {inviteSuccess}
                  </div>
                )}

                <form onSubmit={handleInvite} className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-stone-700">Email Address</label>
                    <input 
                      type="email" 
                      required
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
                    {inviteRole === 'admin' && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1 font-medium bg-amber-50/50 p-2 rounded-lg border border-amber-100/50">
                          <Shield className="w-3 h-3 flex-shrink-0" /> Full cross-branch access including billing, settings, and team management.
                        </p>
                    )}
                    {inviteRole === 'manager' && (
                        <p className="text-xs text-indigo-600 mt-1 flex items-center gap-1 font-medium bg-indigo-50/50 p-2 rounded-lg border border-indigo-100/50">
                          <Users className="w-3 h-3 flex-shrink-0" /> Access to leads and calls for all locations. No billing or plan access.
                        </p>
                    )}
                    {inviteRole === 'staff' && (
                        <p className="text-xs text-stone-500 mt-1 flex items-center gap-1 font-medium bg-stone-50/50 p-2 rounded-lg border border-stone-200/50">
                          <AlertCircle className="w-3 h-3 flex-shrink-0" /> Staff can ONLY see the Bookings calendar.
                        </p>
                    )}
                  </div>

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
                          {t.name} {t.business_type === 'parent' ? '(HQ / Corporate)' : '(Branch)'}
                        </option>
                      ))}
                    </select>
                  </div>

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

import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getFollowUps } from "../api";

const TYPE_LABELS = { "24h": "24h", "3d": "3 days", "5d": "5 days", "10d": "10 days" };

export default function FollowUps({ tenantId }) {
  const [followUps, setFollowUps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  useEffect(() => {
    if (!tenantId) return;
    const params = statusFilter ? { status: statusFilter } : {};
    getFollowUps(tenantId, params)
      .then((data) => setFollowUps(data.follow_ups || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [tenantId, statusFilter]);

  if (!tenantId) {
    return (
      <div className="px-0">
        <p className="text-stone-500 text-sm sm:text-base">Select a business to view follow-ups.</p>
      </div>
    );
  }
  if (loading) return (
    <div className="px-0"><div className="animate-pulse text-stone-500 text-sm">Loading follow-ups…</div></div>
  );
  if (error) return (
    <div className="px-0"><p className="text-red-600 text-sm sm:text-base">{error}</p></div>
  );

  return (
    <div className="px-0">
      <h1 className="text-xl sm:text-2xl font-semibold text-stone-900 mb-4 sm:mb-6">Follow-ups</h1>
      <p className="text-sm text-stone-500 mb-4">Scheduled follow-up messages (24h, 3d, 5d, 10d) for quotes.</p>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <label className="text-sm text-stone-600">Status:</label>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm text-stone-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
        >
          <option value="">All</option>
          <option value="pending">Pending</option>
          <option value="sent">Sent</option>
          <option value="failed">Failed</option>
        </select>
      </div>
      <div className="bg-white rounded-xl border border-stone-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-stone-200">
            <thead>
              <tr>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Contact</th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden sm:table-cell">Phone</th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Type</th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider hidden md:table-cell">Due</th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-left text-xs font-medium text-stone-500 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 sm:px-6 sm:py-3.5 text-right text-xs font-medium text-stone-500 uppercase tracking-wider"><span className="sr-only">Call</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-200">
              {followUps.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-8 sm:px-6 text-center text-sm text-stone-500">No follow-ups match.</td>
                </tr>
              ) : (
                followUps.map((f) => (
                  <tr key={f.id} className="hover:bg-stone-50/80">
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-900">{f.contact_name || "—"}</td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 whitespace-nowrap hidden sm:table-cell">{f.contact_phone || "—"}</td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600">{TYPE_LABELS[f.follow_up_type] || f.follow_up_type}</td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm text-stone-600 whitespace-nowrap hidden md:table-cell">{new Date(f.due_at).toLocaleString()}</td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-sm">
                      <span className={f.status === "sent" ? "text-emerald-600" : f.status === "failed" ? "text-red-600" : "text-amber-600"}>{f.status}</span>
                      {f.sent_at && <span className="text-stone-400 text-xs ml-1">{new Date(f.sent_at).toLocaleString()}</span>}
                    </td>
                    <td className="px-4 py-3 sm:px-6 sm:py-3.5 text-right">
                      {f.call_id ? <Link to={"/calls/" + f.call_id} className="text-sm font-medium text-brand-600 hover:text-brand-700">View call</Link> : <span className="text-stone-400 text-sm">—</span>}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

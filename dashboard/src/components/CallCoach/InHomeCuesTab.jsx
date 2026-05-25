import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../../api";

const CUE_LABELS = {
  ask_discovery: { label: "Ask Discovery", color: "bg-amber-100 text-amber-800" },
  listen: { label: "Listen", color: "bg-amber-100 text-amber-800" },
  disc_reframe: { label: "DISC Reframe", color: "bg-orange-100 text-orange-800" },
  missing_close: { label: "Missing Close", color: "bg-orange-100 text-orange-800" },
  address_objection: { label: "Objection", color: "bg-orange-100 text-orange-800" },
  slow_down: { label: "Slow Down", color: "bg-red-100 text-red-800" },
  build_rapport: { label: "Rapport", color: "bg-amber-100 text-amber-800" },
  confirm_next_step: { label: "Next Step", color: "bg-emerald-100 text-emerald-800" },
};

const DATE_RANGES = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
];

function formatDuration(startedAt, endedAt) {
  if (!startedAt || !endedAt) return "—";
  const ms = new Date(endedAt) - new Date(startedAt);
  const min = Math.floor(ms / 60000);
  const sec = Math.floor((ms % 60000) / 1000);
  return `${min}m ${sec}s`;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function InHomeCuesTab({ tenantId }) {
  const [days, setDays] = useState(30);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await get("/api/call-coach/in-home/sessions", { days, limit: 100 });
        if (!cancelled) setSessions(json.sessions || []);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [days, tenantId]);

  const totalCues = sessions.reduce((sum, s) => sum + (parseInt(s.alert_count, 10) || 0), 0);
  const avgCues = sessions.length > 0 ? (totalCues / sessions.length).toFixed(1) : "0";
  const closedWon = sessions.filter((s) => s.outcome === "closed_won").length;

  return (
    <div>
      <div className="mb-4 flex items-center gap-2">
        <span className="text-xs uppercase tracking-wide text-gray-500 font-semibold mr-1">Range:</span>
        {DATE_RANGES.map((r) => (
          <button
            key={r.days}
            onClick={() => setDays(r.days)}
            className={`px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              days === r.days
                ? "bg-brand-100 text-brand-700"
                : "bg-gray-50 text-gray-600 hover:bg-gray-100"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Sessions</div>
          <div className="text-3xl font-bold mt-1 text-gray-900">{loading ? "…" : sessions.length}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Avg Cues / Session</div>
          <div className="text-3xl font-bold mt-1 text-amber-700">{loading ? "…" : avgCues}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Closed Won</div>
          <div className="text-3xl font-bold mt-1 text-emerald-700">{loading ? "…" : closedWon}</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>
      )}

      {loading ? (
        <div className="text-center py-12 text-gray-400">Loading sessions…</div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-12 text-gray-400">No in-home sessions in this period.</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Rep</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Duration</th>
                <th className="px-4 py-3 text-center">Cues Fired</th>
                <th className="px-4 py-3">Outcome</th>
                <th className="px-4 py-3 text-center">Satisfaction</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-700">
                    <Link to={`/call-coach/in-home/${s.id}`} className="text-brand-600 hover:underline">
                      {formatDate(s.started_at)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{s.rep_email || "—"}</td>
                  <td className="px-4 py-3 text-gray-700">{s.lead_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-600">{formatDuration(s.started_at, s.ended_at)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                      parseInt(s.alert_count, 10) > 0 ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-500"
                    }`}>
                      {s.alert_count || 0}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-700 capitalize">{s.outcome ? s.outcome.replace(/_/g, " ") : "—"}</td>
                  <td className="px-4 py-3 text-center text-gray-600">
                    {s.rep_satisfaction ? `${s.rep_satisfaction}/5` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

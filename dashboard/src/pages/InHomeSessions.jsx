import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getInHomeSessions } from "../api";

const RANGES = [
  { label: "7 days", value: 7 },
  { label: "30 days", value: 30 },
  { label: "90 days", value: 90 },
];

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function duration(session) {
  if (!session.ended_at) return "Ongoing";
  const secs = Math.floor((new Date(session.ended_at) - new Date(session.started_at)) / 1000);
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

const OUTCOME_STYLE = {
  booked: "bg-emerald-100 text-emerald-800",
  follow_up: "bg-amber-100 text-amber-800",
  not_interested: "bg-stone-100 text-stone-600",
};

export default function InHomeSessions({ tenantId }) {
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
        const json = await getInHomeSessions({ days });
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

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link to="/call-coach" className="text-sm text-brand-600 hover:underline mb-4 inline-block">
        ← Back to AI Coaching
      </Link>

      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">In-Home Sessions</h1>
          <p className="mt-1 text-sm text-gray-500">
            Review your reps' recorded in-home visits and leave coaching notes.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-stone-100 rounded-lg p-1 shrink-0">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setDays(r.value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                days === r.value
                  ? "bg-white text-gray-900 shadow-sm"
                  : "text-stone-500 hover:text-stone-700"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading sessions…</div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">{error}</div>
      ) : sessions.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-500 font-medium">No in-home sessions in this range.</p>
          <p className="text-sm text-gray-400 mt-1">
            Sessions appear here once your reps record visits in the app.
          </p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100 text-left text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3 font-semibold">Rep</th>
                <th className="px-4 py-3 font-semibold">Customer</th>
                <th className="px-4 py-3 font-semibold">Date</th>
                <th className="px-4 py-3 font-semibold">Duration</th>
                <th className="px-4 py-3 font-semibold">Outcome</th>
                <th className="px-4 py-3 font-semibold text-right">Cues</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {sessions.map((s) => (
                <tr key={s.id} className="hover:bg-stone-50 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      to={`/call-coach/in-home/${s.id}`}
                      className="font-medium text-brand-600 hover:underline"
                    >
                      {s.rep_email || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-gray-700">{s.lead_name || "—"}</td>
                  <td className="px-4 py-3 text-gray-500">{formatDate(s.started_at)}</td>
                  <td className="px-4 py-3 text-gray-700">{duration(s)}</td>
                  <td className="px-4 py-3">
                    {s.outcome ? (
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          OUTCOME_STYLE[s.outcome] || "bg-stone-100 text-stone-600"
                        }`}
                      >
                        {s.outcome.replace(/_/g, " ")}
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-900">
                    {s.total_cues_fired ?? s.alert_count ?? 0}
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

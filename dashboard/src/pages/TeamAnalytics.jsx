import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";

const CUE_LABELS = {
  ask_discovery: "Ask Discovery",
  listen: "Listen",
  disc_reframe: "DISC Reframe",
  missing_close: "Missing Close",
  address_objection: "Objection",
  slow_down: "Slow Down",
  build_rapport: "Rapport",
  confirm_next_step: "Next Step",
};

const WINDOWS = [
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

function repName(email) {
  if (!email) return "Unknown rep";
  return email.split("@")[0];
}

function scoreColor(score) {
  if (score == null) return "text-gray-400";
  if (score >= 8) return "text-emerald-600";
  if (score >= 6) return "text-brand-600";
  if (score >= 4) return "text-amber-600";
  return "text-red-600";
}

export default function TeamAnalytics({ tenantId }) {
  const [data, setData] = useState(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const json = await get("/api/call-coach/team-analytics", { days });
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [days, tenantId]);

  const cueTypes = useMemo(() => {
    const seen = new Set();
    for (const rep of data?.reps || []) {
      for (const k of Object.keys(rep.cues || {})) seen.add(k);
    }
    const ordered = Object.keys(CUE_LABELS).filter((k) => seen.has(k));
    const extras = [...seen].filter((k) => !CUE_LABELS[k]);
    return [...ordered, ...extras];
  }, [data]);

  const trendStats = useMemo(() => {
    const pts = (data?.trend || []).filter((t) => t.avg_score != null);
    if (pts.length === 0) return null;
    const first = pts[0].avg_score;
    const last = pts[pts.length - 1].avg_score;
    return { first, last, delta: Math.round((last - first) * 10) / 10, points: pts };
  }, [data]);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <Link to="/call-coach" className="text-sm text-brand-600 hover:underline">
            ← AI Coaching
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1">Team Analytics</h1>
          <p className="text-sm text-gray-500">
            Compare reps, track coaching trends, and see who needs which reps.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-gray-200 p-1">
          {WINDOWS.map((w) => (
            <button
              key={w.days}
              type="button"
              onClick={() => setDays(w.days)}
              className={`rounded px-3 py-1 text-sm font-medium ${
                days === w.days
                  ? "bg-brand-600 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="p-12 text-center text-gray-400">Loading team analytics…</div>
      ) : error ? (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error}
        </div>
      ) : !data || data.reps.length === 0 ? (
        <div className="p-12 text-center text-gray-400">
          No coaching data for any rep in this window yet.
        </div>
      ) : (
        <div className="space-y-6">
          {trendStats ? (
            <div className="bg-white border border-gray-200 rounded-lg p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">
                  Team trend ({data.window_days}d)
                </h2>
                <span
                  className={`text-sm font-semibold ${
                    trendStats.delta >= 0 ? "text-emerald-600" : "text-red-600"
                  }`}
                >
                  {trendStats.delta >= 0 ? "↗ +" : "↘ "}
                  {trendStats.delta} avg score
                </span>
              </div>
              <div className="mt-3 flex items-end gap-1 h-20">
                {trendStats.points.map((p, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-brand-200 rounded-t"
                    style={{ height: `${(p.avg_score / 10) * 100}%` }}
                    title={`${p.day}: ${p.avg_score}`}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                    <th className="px-4 py-2.5 font-semibold">Rep</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Avg score</th>
                    <th className="px-4 py-2.5 font-semibold text-right">Scored</th>
                    {cueTypes.map((c) => (
                      <th key={c} className="px-3 py-2.5 font-semibold text-right">
                        {CUE_LABELS[c] || c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {data.reps.map((rep) => (
                    <tr key={rep.rep_user_id} className="hover:bg-gray-50">
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        {repName(rep.rep_email)}
                      </td>
                      <td
                        className={`px-4 py-2.5 text-right font-bold ${scoreColor(rep.avg_score)}`}
                      >
                        {rep.avg_score != null ? rep.avg_score.toFixed(1) : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-right text-gray-500">
                        {rep.scored_count}
                      </td>
                      {cueTypes.map((c) => {
                        const count = rep.cues?.[c] || 0;
                        const isMissingClose = c === "missing_close" && count > 0;
                        return (
                          <td
                            key={c}
                            className={`px-3 py-2.5 text-right ${
                              isMissingClose
                                ? "font-semibold text-red-600"
                                : count > 0
                                  ? "text-gray-700"
                                  : "text-gray-300"
                            }`}
                          >
                            {count || "·"}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

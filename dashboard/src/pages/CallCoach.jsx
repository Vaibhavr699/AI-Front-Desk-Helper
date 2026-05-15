import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { get } from "../api";

// ═══════════════════════════════════════════════════════════════════════════
// Call Coach — Phase 6 A4 List View
//
// Uses the shared `get` helper from ../api which prepends VITE_API_URL and
// attaches Bearer auth + impersonation header consistently with the rest
// of the dashboard.
// ═══════════════════════════════════════════════════════════════════════════

const PERSONA_LABELS = {
  researcher:    { label: "Researcher",    color: "bg-blue-100 text-blue-800"       },
  protector:     { label: "Protector",     color: "bg-emerald-100 text-emerald-800" },
  status_seeker: { label: "Status Seeker", color: "bg-purple-100 text-purple-800"   },
  pragmatist:    { label: "Pragmatist",    color: "bg-amber-100 text-amber-800"     },
  negotiator:    { label: "Negotiator",    color: "bg-rose-100 text-rose-800"       },
  collaborator:  { label: "Collaborator",  color: "bg-cyan-100 text-cyan-800"       },
  unknown:       { label: "Unknown",       color: "bg-gray-100 text-gray-600"       },
};

const DIMENSION_LABELS = {
  rapport:              "Rapport",
  property_walkthrough: "Property Walkthrough",
  discovery:            "Discovery",
  education:            "Education",
  value_framing:        "Value Framing",
  objection_handling:   "Objection Handling",
  close:                "Close",
  professionalism:      "Professionalism",
};

const SOURCE_LABELS = {
  ai_call_inbound:  "Inbound call",
  ai_call_outbound: "Outbound call",
  ai_sms:           "SMS",
  rep_recording:    "Rep recording",
  ai_roleplay:      "AI roleplay",
  live_coach:       "Live coach",
};

const DATE_RANGES = [
  { label: "7d",  days: 7   },
  { label: "30d", days: 30  },
  { label: "90d", days: 90  },
];

function scoreColor(score) {
  if (score == null) return "text-gray-400";
  const s = parseFloat(score);
  if (s >= 8) return "text-emerald-700";
  if (s >= 6) return "text-amber-700";
  return "text-rose-700";
}

export default function CallCoach({ tenantId }) {
  const [days, setDays]             = useState(30);
  const [persona, setPersona]       = useState("");
  const [sourceType, setSourceType] = useState("");
  const [minScore, setMinScore]     = useState("");

  const [summary, setSummary]               = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(true);

  const [conversations, setConversations] = useState([]);
  const [total, setTotal]                 = useState(0);
  const [listLoading, setListLoading]     = useState(true);
  const [error, setError]                 = useState(null);

  const [offset, setOffset] = useState(0);
  const limit = 50;

  useEffect(() => { setOffset(0); }, [days, persona, sourceType, minScore]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setSummaryLoading(true);
      try {
        const json = await get("/api/call-coach/summary", { days });
        if (!cancelled) setSummary(json);
      } catch (err) {
        if (!cancelled) console.warn("[CallCoach] summary error:", err.message);
      } finally {
        if (!cancelled) setSummaryLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [days, tenantId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setListLoading(true);
      setError(null);
      try {
        const params = { limit, offset };
        const dateFrom = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
        params.dateFrom = dateFrom;
        if (persona)    params.persona = persona;
        if (sourceType) params.source_type = sourceType;
        if (minScore)   params.minScore = minScore;

        const json = await get("/api/call-coach/conversations", params);
        if (!cancelled) {
          setConversations(json.conversations || []);
          setTotal(json.total || 0);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setListLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [days, persona, sourceType, minScore, offset, tenantId]);

  const avgOverall    = summary?.overall?.avg_overall != null
                          ? parseFloat(summary.overall.avg_overall).toFixed(1) : "—";
  const scoredCount   = summary?.overall?.scored_count ?? 0;
  const bookedCount   = summary?.overall?.booked_count ?? 0;
  const bookRate      = scoredCount > 0 ? Math.round((bookedCount / scoredCount) * 100) : 0;
  const topWeakness   = summary?.top_weakness;
  const weaknessLabel = topWeakness ? DIMENSION_LABELS[topWeakness.dimension] : null;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Call Coach</h1>
        <p className="mt-1 text-sm text-gray-500">
          AI-scored conversations across 8 dimensions with persona detection and rationale-backed feedback.
        </p>
      </div>

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Average Score</div>
          <div className={`text-3xl font-bold mt-1 ${scoreColor(summary?.overall?.avg_overall)}`}>
            {summaryLoading ? "…" : avgOverall}
            <span className="text-base text-gray-400 font-normal"> / 10</span>
          </div>
          <div className="text-xs text-gray-500 mt-1">
            Across {scoredCount} scored {scoredCount === 1 ? "call" : "calls"}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Calls Scored</div>
          <div className="text-3xl font-bold mt-1 text-gray-900">
            {summaryLoading ? "…" : scoredCount.toLocaleString()}
          </div>
          <div className="text-xs text-gray-500 mt-1">Last {days} days</div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Book Rate</div>
          <div className="text-3xl font-bold mt-1 text-gray-900">
            {summaryLoading ? "…" : `${bookRate}%`}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {bookedCount} booked of {scoredCount}
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Focus Area</div>
          <div className="text-lg font-bold mt-1 text-gray-900 truncate">
            {summaryLoading ? "…" : weaknessLabel || "—"}
          </div>
          <div className="text-xs text-gray-500 mt-1">
            {topWeakness?.avg_score != null
              ? `Avg ${parseFloat(topWeakness.avg_score).toFixed(1)} — lowest dimension`
              : "No data yet"}
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-lg p-3 mb-4 flex flex-wrap gap-2 items-center">
        <select
          value={persona}
          onChange={(e) => setPersona(e.target.value)}
          className="text-sm border border-gray-300 rounded px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="">All personas</option>
          {Object.entries(PERSONA_LABELS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>

        <select
          value={sourceType}
          onChange={(e) => setSourceType(e.target.value)}
          className="text-sm border border-gray-300 rounded px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="">All sources</option>
          {Object.entries(SOURCE_LABELS).map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
        </select>

        <select
          value={minScore}
          onChange={(e) => setMinScore(e.target.value)}
          className="text-sm border border-gray-300 rounded px-3 py-1.5 bg-white text-gray-700"
        >
          <option value="">Any score</option>
          <option value="8">8+ (great)</option>
          <option value="6">6+ (good)</option>
        </select>

        {(persona || sourceType || minScore) && (
          <button
            onClick={() => { setPersona(""); setSourceType(""); setMinScore(""); }}
            className="text-xs text-gray-500 hover:text-gray-700 ml-1"
          >
            Clear filters
          </button>
        )}

        <span className="ml-auto text-xs text-gray-500">
          {listLoading ? "Loading…" : `${total.toLocaleString()} total`}
        </span>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-md mb-4">
          {error}
        </div>
      )}

      {listLoading && conversations.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center text-gray-400">
          Loading conversations…
        </div>
      ) : conversations.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <div className="text-gray-500 text-sm font-medium">No scored conversations in this window.</div>
          <div className="text-gray-400 text-xs mt-1">
            New calls are scored every 5 minutes by the coaching engine.
          </div>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr className="text-xs uppercase tracking-wide text-gray-500">
                <th className="px-4 py-2.5 text-left font-semibold">Scored</th>
                <th className="px-4 py-2.5 text-left font-semibold">Source</th>
                <th className="px-4 py-2.5 text-left font-semibold">Persona</th>
                <th className="px-4 py-2.5 text-left font-semibold">Rep</th>
                <th className="px-4 py-2.5 text-left font-semibold">Outcome</th>
                <th className="px-4 py-2.5 text-right font-semibold">Score</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {conversations.map((c) => {
                const personaMeta = PERSONA_LABELS[c.buyer_persona] || PERSONA_LABELS.unknown;
                const sourceLabel = SOURCE_LABELS[c.source_type] || c.source_type;
                return (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm whitespace-nowrap">
                      <Link to={`/call-coach/${c.id}`} className="text-brand-600 hover:underline font-medium">
                        {c.scored_at ? new Date(c.scored_at).toLocaleString() : "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{sourceLabel}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${personaMeta.color}`}>
                        {personaMeta.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{c.rep_name || "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-700 capitalize">
                      {c.outcome ? c.outcome.replace(/_/g, " ") : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`text-base font-bold ${scoreColor(c.overall_score)}`}>
                        {c.overall_score != null ? parseFloat(c.overall_score).toFixed(1) : "—"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {total > limit && (
            <div className="px-4 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between text-sm text-gray-600">
              <div>
                Showing {offset + 1}–{Math.min(offset + limit, total)} of {total.toLocaleString()}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setOffset(Math.max(0, offset - limit))}
                  disabled={offset === 0}
                  className="px-3 py-1 rounded border border-gray-300 bg-white disabled:opacity-40 hover:bg-gray-100 transition-colors"
                >
                  Previous
                </button>
                <button
                  onClick={() => setOffset(offset + limit)}
                  disabled={offset + limit >= total}
                  className="px-3 py-1 rounded border border-gray-300 bg-white disabled:opacity-40 hover:bg-gray-100 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

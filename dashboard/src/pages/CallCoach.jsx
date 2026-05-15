import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

// ═══════════════════════════════════════════════════════════════════════════
// Call Coach — Phase 6 A4 list page (May 15, 2026)
//
// Owner-facing surface for AI-scored sales conversations. Consumes:
//   GET /api/call-coach/summary
//   GET /api/call-coach/conversations
//
// Receives tenantId from useOutletContext via the WithContext wrapper in
// App.jsx. authFetch injects x-impersonate-tenant-id so superadmin tenant
// switching in the header refreshes data correctly.
// ═══════════════════════════════════════════════════════════════════════════

function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const impersonate = localStorage.getItem("impersonate_tenant_id");
  if (impersonate) headers["x-impersonate-tenant-id"] = impersonate;
  return fetch(url, { ...options, credentials: "include", headers });
}

const PERSONA_LABELS = {
  researcher:    { label: "Researcher",    color: "bg-blue-100 text-blue-800" },
  protector:     { label: "Protector",     color: "bg-emerald-100 text-emerald-800" },
  status_seeker: { label: "Status Seeker", color: "bg-purple-100 text-purple-800" },
  pragmatist:    { label: "Pragmatist",    color: "bg-amber-100 text-amber-800" },
  negotiator:    { label: "Negotiator",    color: "bg-rose-100 text-rose-800" },
  collaborator:  { label: "Collaborator",  color: "bg-cyan-100 text-cyan-800" },
  unknown:       { label: "Unknown",       color: "bg-gray-100 text-gray-600" },
};

const DIMENSION_LABELS = {
  rapport: "Rapport",
  property_walkthrough: "Property Walkthrough",
  discovery: "Discovery",
  education: "Education",
  value_framing: "Value Framing",
  objection_handling: "Objection Handling",
  close: "Close",
  professionalism: "Professionalism",
};

const SOURCE_LABELS = {
  ai_call_inbound: "Inbound call",
  ai_call_outbound: "Outbound call",
  ai_sms: "SMS",
  rep_recording: "Rep recording",
  ai_roleplay: "Roleplay",
  live_coach: "Live coached",
};

function scoreColor(score) {
  if (score == null) return "text-gray-400 bg-gray-50 border-gray-200";
  const s = parseFloat(score);
  if (s >= 8) return "text-emerald-700 bg-emerald-50 border-emerald-200";
  if (s >= 6) return "text-amber-700 bg-amber-50 border-amber-200";
  return "text-rose-700 bg-rose-50 border-rose-200";
}

function ScoreBadge({ score }) {
  const display = score == null ? "—" : parseFloat(score).toFixed(1);
  return (
    <span className={`inline-flex items-center justify-center w-12 h-7 rounded-md border text-sm font-semibold ${scoreColor(score)}`}>
      {display}
    </span>
  );
}

function PersonaChip({ persona, confidence }) {
  const meta = PERSONA_LABELS[persona] || PERSONA_LABELS.unknown;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
      {meta.label}
      {confidence != null && persona && persona !== "unknown" && (
        <span className="ml-1 opacity-60">{Math.round(parseFloat(confidence) * 100)}%</span>
      )}
    </span>
  );
}

function SummaryTiles({ summary }) {
  if (!summary) return null;
  const { overall, top_weakness, personas } = summary;
  const personasTop = (personas || []).slice(0, 3);
  const totalPersona = (personas || []).reduce((sum, p) => sum + p.count, 0);
  const bookRate = overall?.scored_count > 0
    ? Math.round((overall.booked_count / overall.scored_count) * 100)
    : null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Avg Score</div>
        <div className="mt-2 text-3xl font-bold text-gray-900">{overall?.avg_overall ?? "—"}</div>
        <div className="text-xs text-gray-500 mt-1">across {overall?.scored_count ?? 0} scored calls</div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Booked</div>
        <div className="mt-2 text-3xl font-bold text-gray-900">{overall?.booked_count ?? 0}</div>
        <div className="text-xs text-gray-500 mt-1">
          {bookRate != null ? `${bookRate}% booking rate` : "—"}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Focus Area</div>
        <div className="mt-2 text-lg font-semibold text-gray-900">
          {top_weakness ? DIMENSION_LABELS[top_weakness.dimension] : "—"}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          {top_weakness ? `avg ${top_weakness.avg_score} — lowest dimension` : "no data yet"}
        </div>
      </div>
      <div className="bg-white border border-gray-200 rounded-lg p-4">
        <div className="text-xs text-gray-500 uppercase tracking-wide">Top Personas</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {personasTop.length > 0 ? (
            personasTop.map((p) => (
              <PersonaChip key={p.buyer_persona} persona={p.buyer_persona} confidence={null} />
            ))
          ) : (
            <span className="text-sm text-gray-400">no personas yet</span>
          )}
        </div>
        <div className="text-xs text-gray-500 mt-2">{totalPersona} classified</div>
      </div>
    </div>
  );
}

function DimensionBars({ dimensions }) {
  if (!dimensions || dimensions.length === 0) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 mb-6">
      <div className="text-xs text-gray-500 uppercase tracking-wide mb-3">Dimension Averages</div>
      <div className="space-y-2">
        {dimensions.map((d) => {
          const score = parseFloat(d.avg_score);
          const pct = Math.max(0, Math.min(100, (score / 10) * 100));
          const barColor = score >= 8 ? "bg-emerald-500" : score >= 6 ? "bg-amber-500" : "bg-rose-500";
          return (
            <div key={d.dimension} className="flex items-center gap-3">
              <div className="w-44 text-sm text-gray-700">{DIMENSION_LABELS[d.dimension] || d.dimension}</div>
              <div className="flex-1 bg-gray-100 rounded h-2 overflow-hidden">
                <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
              </div>
              <div className="w-12 text-right text-sm font-medium text-gray-900">{d.avg_score}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function CallCoach({ tenantId }) {
  const [summary, setSummary] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ persona: "", source_type: "", days: 30 });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const listParams = new URLSearchParams();
        if (filters.persona)     listParams.set("persona", filters.persona);
        if (filters.source_type) listParams.set("source_type", filters.source_type);
        listParams.set("limit", "100");

        const [listRes, summaryRes] = await Promise.all([
          authFetch(`/api/call-coach/conversations?${listParams.toString()}`),
          authFetch(`/api/call-coach/summary?days=${filters.days}`),
        ]);

        if (!listRes.ok)    throw new Error(`List failed: ${listRes.status}`);
        if (!summaryRes.ok) throw new Error(`Summary failed: ${summaryRes.status}`);

        const listData    = await listRes.json();
        const summaryData = await summaryRes.json();

        if (!cancelled) {
          setConversations(listData.conversations || []);
          setTotal(listData.total || 0);
          setSummary(summaryData);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [filters.persona, filters.source_type, filters.days, tenantId]);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Call Coach</h1>
          <p className="text-sm text-gray-500 mt-1">AI-scored sales conversations across 8 dimensions</p>
        </div>
        <select
          value={filters.days}
          onChange={(e) => setFilters((f) => ({ ...f, days: parseInt(e.target.value, 10) }))}
          className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
        >
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-md mb-6">{error}</div>
      )}

      {loading && !summary ? (
        <div className="text-center py-12 text-gray-500">Loading...</div>
      ) : (
        <>
          <SummaryTiles summary={summary} />
          <DimensionBars dimensions={summary?.dimensions} />

          <div className="bg-white border border-gray-200 rounded-lg p-4 mb-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-500 uppercase tracking-wide">Filter</span>
              <select
                value={filters.persona}
                onChange={(e) => setFilters((f) => ({ ...f, persona: e.target.value }))}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
              >
                <option value="">All personas</option>
                {Object.entries(PERSONA_LABELS).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
              <select
                value={filters.source_type}
                onChange={(e) => setFilters((f) => ({ ...f, source_type: e.target.value }))}
                className="px-3 py-1.5 border border-gray-300 rounded-md text-sm bg-white"
              >
                <option value="">All sources</option>
                <option value="ai_call_inbound">Inbound calls</option>
                <option value="ai_call_outbound">Outbound calls</option>
                <option value="ai_sms">SMS conversations</option>
                <option value="rep_recording">Rep recordings</option>
                <option value="ai_roleplay">AI roleplay</option>
              </select>
              {(filters.persona || filters.source_type) && (
                <button
                  onClick={() => setFilters((f) => ({ ...f, persona: "", source_type: "" }))}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Clear
                </button>
              )}
              <div className="flex-1" />
              <span className="text-sm text-gray-500">{total} conversations</span>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {conversations.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                No scored conversations yet. They appear here once the scorer runs (every 5 min).
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left text-xs uppercase tracking-wide text-gray-500 font-medium px-4 py-2">Score</th>
                    <th className="text-left text-xs uppercase tracking-wide text-gray-500 font-medium px-4 py-2">Source</th>
                    <th className="text-left text-xs uppercase tracking-wide text-gray-500 font-medium px-4 py-2">Persona</th>
                    <th className="text-left text-xs uppercase tracking-wide text-gray-500 font-medium px-4 py-2">Outcome</th>
                    <th className="text-left text-xs uppercase tracking-wide text-gray-500 font-medium px-4 py-2">Rep</th>
                    <th className="text-left text-xs uppercase tracking-wide text-gray-500 font-medium px-4 py-2">When</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {conversations.map((c) => (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <Link to={`/call-coach/${c.id}`}>
                          <ScoreBadge score={c.overall_score} />
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        <Link to={`/call-coach/${c.id}`} className="hover:underline">
                          {SOURCE_LABELS[c.source_type] || c.source_type}
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <PersonaChip persona={c.buyer_persona} confidence={c.persona_confidence} />
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {c.outcome === "booked" ? (
                          <span className="text-emerald-700 font-medium">Booked</span>
                        ) : c.outcome ? (
                          <span className="text-gray-500">{c.outcome}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {c.rep_name || <span className="text-gray-400">AI</span>}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {c.scored_at ? new Date(c.scored_at).toLocaleString() : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";

// ═══════════════════════════════════════════════════════════════════════════
// Call Coach Detail — Phase 6 A4 (May 15, 2026)
//
// Per-conversation detail page. Receives tenantId from useOutletContext via
// the WithContext wrapper in App.jsx. authFetch injects the impersonation
// header so superadmin tenant switching works correctly.
// ═══════════════════════════════════════════════════════════════════════════

function authFetch(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  const impersonate = localStorage.getItem("impersonate_tenant_id");
  if (impersonate) headers["x-impersonate-tenant-id"] = impersonate;
  return fetch(url, { ...options, credentials: "include", headers });
}

const PERSONA_LABELS = {
  researcher:    { label: "Researcher",    color: "bg-blue-100 text-blue-800",       desc: "Wants thorough info, low pressure" },
  protector:     { label: "Protector",     color: "bg-emerald-100 text-emerald-800", desc: "Wants safety, guarantees, references" },
  status_seeker: { label: "Status Seeker", color: "bg-purple-100 text-purple-800",   desc: "Wants premium, top-tier solutions" },
  pragmatist:    { label: "Pragmatist",    color: "bg-amber-100 text-amber-800",     desc: "Wants practical, no-nonsense value" },
  negotiator:    { label: "Negotiator",    color: "bg-rose-100 text-rose-800",       desc: "Wants the best deal, will haggle" },
  collaborator:  { label: "Collaborator",  color: "bg-cyan-100 text-cyan-800",       desc: "Wants partnership, dialogue" },
  unknown:       { label: "Unknown",       color: "bg-gray-100 text-gray-600",       desc: "Persona not yet classified" },
};

const DIMENSIONS = [
  { key: "rapport",              label: "Rapport" },
  { key: "property_walkthrough", label: "Property Walkthrough" },
  { key: "discovery",            label: "Discovery" },
  { key: "education",            label: "Education" },
  { key: "value_framing",        label: "Value Framing" },
  { key: "objection_handling",   label: "Objection Handling" },
  { key: "close",                label: "Close" },
  { key: "professionalism",      label: "Professionalism" },
];

function scoreColor(score) {
  if (score == null) return { bg: "bg-gray-50", border: "border-gray-200", text: "text-gray-500", bar: "bg-gray-300" };
  const s = parseFloat(score);
  if (s >= 8) return { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-800", bar: "bg-emerald-500" };
  if (s >= 6) return { bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-800",   bar: "bg-amber-500" };
  return     { bg: "bg-rose-50",      border: "border-rose-200",     text: "text-rose-800",    bar: "bg-rose-500" };
}

function formatTranscript(transcript) {
  if (!transcript) return [];
  if (Array.isArray(transcript)) {
    return transcript.map((t) => ({
      role: ["user", "customer", "caller"].includes((t.role || "").toLowerCase()) ? "customer" : "rep",
      text: t.text || t.content || "",
    }));
  }
  if (typeof transcript === "string") {
    return transcript.split("\n").filter(Boolean).map((line) => {
      const m = line.match(/^(assistant|agent|ai|rep|user|customer|caller)\s*:\s*(.*)$/i);
      if (!m) return { role: "rep", text: line };
      const r = m[1].toLowerCase();
      return {
        role: ["user", "customer", "caller"].includes(r) ? "customer" : "rep",
        text: m[2],
      };
    });
  }
  return [];
}

function evidenceQuotes(evidence) {
  if (!evidence) return [];
  if (Array.isArray(evidence)) return evidence;
  if (evidence.quotes && Array.isArray(evidence.quotes)) return evidence.quotes;
  return [];
}

function evidenceText(q) {
  if (typeof q === "string") return q;
  return q?.text || q?.quote || q?.content || JSON.stringify(q);
}

export default function CallCoachDetail({ tenantId }) {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`/api/call-coach/conversations/${id}`);
        if (!res.ok) throw new Error(`Failed: ${res.status}`);
        const json = await res.json();
        if (!cancelled) setData(json);
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, tenantId]);

  if (loading) return <div className="p-6 text-center text-gray-500">Loading...</div>;
  if (error) return (
    <div className="p-6 max-w-4xl mx-auto">
      <Link to="/call-coach" className="text-sm text-gray-500 hover:text-gray-700">← Back to Call Coach</Link>
      <div className="mt-4 bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-md">{error}</div>
    </div>
  );
  if (!data) return null;

  const { conversation, scores, call } = data;
  const overall       = scoreColor(conversation.overall_score);
  const personaMeta   = PERSONA_LABELS[conversation.buyer_persona] || PERSONA_LABELS.unknown;
  const transcriptTurns = formatTranscript(conversation.transcript);
  const scoreByDim    = Object.fromEntries((scores || []).map((s) => [s.dimension, s]));

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link to="/call-coach" className="text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1">
        ← Back to Call Coach
      </Link>

      <div className="mt-4 mb-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 truncate">
              {call?.lead?.name || call?.from_number || "Conversation"}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-500">
              <span>{conversation.source_type?.replace(/_/g, " ")}</span>
              {call?.duration_minutes != null && <span>• {parseFloat(call.duration_minutes).toFixed(1)} min</span>}
              {call?.started_at && <span>• {new Date(call.started_at).toLocaleString()}</span>}
              {conversation.rep_name && <span>• Rep: {conversation.rep_name}</span>}
              {call?.from_number && <span>• {call.from_number}</span>}
            </div>
          </div>
          <div className={`text-center border ${overall.border} ${overall.bg} rounded-lg px-5 py-3 flex-shrink-0`}>
            <div className="text-xs uppercase tracking-wide text-gray-500">Overall</div>
            <div className={`text-4xl font-bold ${overall.text}`}>
              {conversation.overall_score != null ? parseFloat(conversation.overall_score).toFixed(1) : "—"}
            </div>
            <div className="text-xs text-gray-500">/ 10</div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${personaMeta.color}`}>
            {personaMeta.label}
          </span>
          {conversation.persona_confidence != null && conversation.buyer_persona !== "unknown" && (
            <span className="text-xs text-gray-500">
              {Math.round(parseFloat(conversation.persona_confidence) * 100)}% confidence
            </span>
          )}
          <span className="text-sm text-gray-500">— {personaMeta.desc}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {DIMENSIONS.map(({ key, label }) => {
          const s = scoreByDim[key];
          const c = scoreColor(s?.score);
          const quotes = evidenceQuotes(s?.evidence);
          const pct = s?.score != null ? Math.max(0, Math.min(100, (parseFloat(s.score) / 10) * 100)) : 0;
          return (
            <div key={key} className={`border ${c.border} ${c.bg} rounded-lg p-4`}>
              <div className="flex items-baseline justify-between mb-2">
                <div className="font-semibold text-gray-900">{label}</div>
                <div className={`text-2xl font-bold ${c.text}`}>
                  {s?.score != null ? parseFloat(s.score).toFixed(1) : "—"}
                </div>
              </div>
              <div className="w-full bg-white/60 rounded h-1.5 overflow-hidden mb-3">
                <div className={`h-full ${c.bar}`} style={{ width: `${pct}%` }} />
              </div>
              {s?.rationale && (
                <p className="text-sm text-gray-700 leading-relaxed">{s.rationale}</p>
              )}
              {quotes.length > 0 && (
                <div className="mt-3 space-y-1">
                  {quotes.slice(0, 3).map((q, i) => (
                    <div key={i} className="text-xs text-gray-600 bg-white/60 rounded px-2 py-1 border border-white">
                      "{evidenceText(q)}"
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-200 bg-gray-50 flex items-baseline justify-between">
          <div className="text-sm font-semibold text-gray-900">Transcript</div>
          <div className="text-xs text-gray-500">{transcriptTurns.length} turns</div>
        </div>
        {transcriptTurns.length === 0 ? (
          <div className="p-6 text-center text-gray-500 text-sm">Transcript not available</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {transcriptTurns.map((turn, i) => {
              const isCustomer = turn.role === "customer";
              return (
                <div key={i} className={`px-4 py-3 flex gap-3 ${isCustomer ? "bg-blue-50/30" : ""}`}>
                  <div className={`text-xs font-semibold uppercase tracking-wide w-20 flex-shrink-0 ${isCustomer ? "text-blue-700" : "text-gray-500"}`}>
                    {isCustomer ? "Customer" : "AI"}
                  </div>
                  <div className="text-sm text-gray-800 flex-1">{turn.text}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

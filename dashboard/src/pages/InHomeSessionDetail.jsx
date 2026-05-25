import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { get } from "../api";

const CUE_META = {
  ask_discovery: { label: "Ask Discovery", color: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  listen: { label: "Listen", color: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  disc_reframe: { label: "DISC Reframe", color: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  missing_close: { label: "Missing Close", color: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  address_objection: { label: "Objection", color: "bg-orange-100 text-orange-800", dot: "bg-orange-500" },
  slow_down: { label: "Slow Down", color: "bg-red-100 text-red-800", dot: "bg-red-500" },
  build_rapport: { label: "Rapport", color: "bg-amber-100 text-amber-800", dot: "bg-amber-500" },
  confirm_next_step: { label: "Next Step", color: "bg-emerald-100 text-emerald-800", dot: "bg-emerald-500" },
};

const URGENCY_BORDER = {
  green: "border-l-emerald-500",
  yellow: "border-l-amber-500",
  orange: "border-l-orange-500",
  red: "border-l-red-500",
};

function formatTime(iso, base) {
  if (!iso || !base) return "";
  const diff = Math.floor((new Date(iso) - new Date(base)) / 1000);
  const m = Math.floor(diff / 60);
  const s = diff % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

export default function InHomeSessionDetail({ tenantId }) {
  const { id } = useParams();
  const [session, setSession] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const json = await get(`/api/call-coach/in-home/sessions/${id}`);
        if (!cancelled) {
          setSession(json.session);
          setAlerts(json.alerts || []);
        }
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [id, tenantId]);

  if (loading) {
    return <div className="p-6 text-center text-gray-400">Loading session…</div>;
  }
  if (error || !session) {
    return (
      <div className="p-6">
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
          {error || "Session not found"}
        </div>
      </div>
    );
  }

  const transcript = Array.isArray(session.transcript) ? session.transcript : [];
  const duration = session.ended_at
    ? Math.floor((new Date(session.ended_at) - new Date(session.started_at)) / 1000)
    : null;

  const cueSummary = {};
  for (const a of alerts) {
    const key = a.cue_type || a.alert_type;
    cueSummary[key] = (cueSummary[key] || 0) + 1;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <Link to="/call-coach" className="text-sm text-brand-600 hover:underline mb-4 inline-block">
        ← Back to AI Coaching
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">In-Home Session Review</h1>
        <p className="mt-1 text-sm text-gray-500">{formatDate(session.started_at)}</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Rep</div>
          <div className="text-sm font-semibold mt-1 text-gray-900">{session.rep_email || "—"}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Customer</div>
          <div className="text-sm font-semibold mt-1 text-gray-900">{session.lead_name || "—"}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Duration</div>
          <div className="text-sm font-semibold mt-1 text-gray-900">
            {duration != null ? `${Math.floor(duration / 60)}m ${duration % 60}s` : "Ongoing"}
          </div>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <div className="text-xs uppercase tracking-wide text-gray-500">Outcome</div>
          <div className="text-sm font-semibold mt-1 text-gray-900 capitalize">
            {session.outcome ? session.outcome.replace(/_/g, " ") : "—"}
          </div>
        </div>
      </div>

      {Object.keys(cueSummary).length > 0 && (
        <div className="mb-6 flex flex-wrap gap-2">
          {Object.entries(cueSummary).map(([key, count]) => {
            const meta = CUE_META[key] || { label: key, color: "bg-gray-100 text-gray-600" };
            return (
              <span key={key} className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${meta.color}`}>
                {meta.label}
                <span className="bg-white/50 rounded-full px-1.5 text-[10px] font-bold">{count}</span>
              </span>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Coaching Cue Timeline</h2>
          {alerts.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-8 text-center text-gray-400">
              No coaching cues were fired during this session.
            </div>
          ) : (
            <div className="space-y-3">
              {alerts.map((a, i) => {
                const meta = CUE_META[a.cue_type || a.alert_type] || { label: a.alert_type, color: "bg-gray-100 text-gray-600", dot: "bg-gray-400" };
                const urgencyBorder = URGENCY_BORDER[a.alert_urgency] || "border-l-gray-300";
                const payload = a.payload || {};
                const window = a.transcript_window || [];
                const timestamp = formatTime(a.fired_at, session.started_at);

                return (
                  <div key={a.id || i} className={`bg-white border border-gray-200 rounded-lg border-l-4 ${urgencyBorder} overflow-hidden`}>
                    <div className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-2 h-2 rounded-full ${meta.dot}`} />
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${meta.color}`}>
                            {meta.label}
                          </span>
                          {a.watch_label && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-200 text-[10px] font-bold text-gray-600">
                              {a.watch_label}
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-gray-400">
                          <span className="font-mono">{timestamp}</span>
                          {a.dismissed_at && (
                            <span className="text-emerald-600">dismissed</span>
                          )}
                        </div>
                      </div>

                      <p className="text-sm font-semibold text-gray-900">{a.alert_content}</p>
                      {payload.full_text && (
                        <p className="text-sm text-gray-600 mt-1">{payload.full_text}</p>
                      )}

                      {window.length > 0 && (
                        <div className="mt-3 bg-gray-50 rounded-lg p-3 space-y-1">
                          <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold mb-1">Transcript window</div>
                          {window.map((entry, j) => (
                            <div key={j} className="text-xs">
                              <span className="font-semibold text-gray-500">[{entry.speaker}]</span>{" "}
                              <span className="text-gray-700">{entry.text}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="lg:col-span-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-3">Transcript</h2>
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {transcript.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">No transcript recorded.</div>
            ) : (
              <div className="max-h-[600px] overflow-y-auto divide-y divide-gray-100">
                {transcript.map((entry, i) => (
                  <div key={i} className="px-4 py-2.5">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={`text-[10px] font-bold uppercase ${
                        entry.speaker === "rep" ? "text-brand-600" :
                        entry.speaker === "customer" ? "text-emerald-600" :
                        "text-gray-400"
                      }`}>
                        {entry.speaker}
                      </span>
                      <span className="text-[10px] text-gray-300 font-mono">
                        {formatTime(entry.at, session.started_at)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-800">{entry.text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCalls, getRecordingAudioUrl, updateCall } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Phone, Play, Voicemail, PhoneForwarded, PhoneMissed,
  ChevronRight, CheckCircle2, Search, X, Clock,
} from "lucide-react";
import { useToast } from "../components/ui/Toast";

/**
 * Voicemails.jsx (Phase 3B, Jun 2026)
 *
 * Dedicated inbox for voicemails captured by the Phase 1 + Phase 2 voicemail
 * pipeline. A voicemail is a `calls` row whose disposition is 'voicemail'
 * (AI-off / missed) or 'transfer_voicemail' (caller asked for a human, the
 * owner didn't pick up). The recording lives on that call (call.recording_id)
 * and is played through the same lazy-loading AudioPlayer the Calls page uses.
 *
 * Why a separate page instead of the main call list: a voicemail has no lead
 * score, AI summary, or transcript to lean on — in the main list it reads as
 * noise. Here each row is framed as what it is: someone called, you missed
 * them, here's their message and their number — call them back.
 *
 * Data: reuses getCalls(tenantId) and filters client-side, matching how
 * Calls.jsx already filters everything in-memory. At larger scale a dedicated
 * GET /voicemails endpoint would be better — noted for later.
 */

// ─── AudioPlayer — same lazy-load pattern as Calls.jsx ────────────────
function AudioPlayer({ recordingId }) {
  const [src, setSrc] = useState(null);
  const [err, setErr] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handlePlay() {
    if (src) return;
    setLoading(true);
    try {
      const u = await getRecordingAudioUrl(recordingId);
      setSrc(u);
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  if (err) return <p className="text-xs text-red-500">Error: {err}</p>;
  if (!src) {
    return (
      <button
        onClick={handlePlay}
        disabled={loading}
        className="flex items-center gap-2 px-3 py-1.5 bg-brand-50 text-brand-600 rounded-lg text-xs font-medium hover:bg-brand-100 transition-colors"
      >
        {loading ? <LumaSpin className="w-3 h-3" /> : <Play className="w-3 h-3" />}
        Play message
      </button>
    );
  }
  return <audio controls autoPlay src={src} className="w-full max-w-xs h-8 rounded-md" />;
}

// ─── Voicemail detection — defensive across schema shapes ─────────────
// disposition may be a top-level column OR the info may only be in metadata
// (we wrote voicemail / voicemail_kind into metadata in the capture handler).
function isVoicemail(call) {
  const disp = call.disposition || call.metadata?.disposition || "";
  if (disp === "voicemail" || disp === "transfer_voicemail") return true;
  const m = call.metadata || {};
  return m.voicemail === true || !!m.voicemail_kind;
}

function voicemailKind(call) {
  const disp = call.disposition || call.metadata?.disposition || "";
  if (disp === "transfer_voicemail") return "transfer";
  if (call.metadata?.voicemail_kind === "transfer") return "transfer";
  return "missed";
}

function voicemailDuration(call) {
  const s = call.metadata?.voicemail_duration_sec;
  if (!s || !Number.isFinite(Number(s))) return null;
  const n = Number(s);
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}

function whenLabel(call) {
  const raw = call.started_at || call.created_at;
  if (!raw) return "";
  const d = new Date(raw);
  if (!Number.isFinite(d.getTime())) return "";
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function isHandled(call) {
  // We mark handled via call.status; also respect an explicit metadata flag.
  return call.status === "Handled" || call.metadata?.voicemail_handled === true;
}

// ─── A single voicemail card ──────────────────────────────────────────
function VoicemailCard({ call, onChanged }) {
  const { success, error: toastError } = useToast();
  const [saving, setSaving] = useState(false);
  const kind = voicemailKind(call);
  const dur = voicemailDuration(call);
  const handled = isHandled(call);
  const number = call.from_number || "Unknown number";

  const markHandled = async () => {
    setSaving(true);
    try {
      await updateCall(call.id, { status: "Handled" });
      success("Marked as handled.");
      onChanged();
    } catch {
      toastError("Couldn't update. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const telHref = `tel:${(call.from_number || "").replace(/[^\d+]/g, "")}`;

  return (
    <div className={`p-4 sm:p-5 ${handled ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-4">
        {/* Kind icon */}
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
            kind === "transfer"
              ? "bg-amber-50 text-amber-600 border border-amber-200"
              : "bg-brand-50 text-brand-600 border border-brand-100"
          }`}
        >
          {kind === "transfer" ? <PhoneForwarded className="w-5 h-5" /> : <PhoneMissed className="w-5 h-5" />}
        </div>

        {/* Main */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <a href={telHref} className="text-base font-bold text-stone-900 hover:text-brand-600 transition-colors">
              {number}
            </a>
            <span
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border ${
                kind === "transfer"
                  ? "bg-amber-50 text-amber-700 border-amber-200"
                  : "bg-stone-100 text-stone-600 border-stone-200"
              }`}
            >
              {kind === "transfer" ? "Missed transfer" : "Voicemail"}
            </span>
            {handled && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 border border-emerald-200 inline-flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> Handled
              </span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1 text-xs text-stone-500">
            <span>{whenLabel(call)}</span>
            {dur && (
              <span className="inline-flex items-center gap-1">
                <Clock className="w-3 h-3" /> {dur}
              </span>
            )}
            {kind === "transfer" && (
              <span className="text-amber-700/80 italic">asked for a team member</span>
            )}
          </div>

          {/* Player + actions */}
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            {call.recording_id ? (
              <AudioPlayer recordingId={call.recording_id} />
            ) : (
              <span className="text-xs text-stone-400 italic">Recording still processing…</span>
            )}

            <a
              href={telHref}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 text-white rounded-lg text-xs font-bold hover:bg-emerald-700 transition-colors"
            >
              <Phone className="w-3 h-3" /> Call back
            </a>

            {!handled && (
              <button
                onClick={markHandled}
                disabled={saving}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-stone-200 text-stone-600 rounded-lg text-xs font-bold hover:bg-stone-50 hover:text-stone-900 transition-colors disabled:opacity-50"
              >
                {saving ? <LumaSpin className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                Mark handled
              </button>
            )}

            <Link
              to={`/calls/${call.id}`}
              className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700 ml-auto"
            >
              Details <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────
export default function Voicemails({ tenantId }) {
  const navigate = useNavigate();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [showHandled, setShowHandled] = useState(false);
  const { error: toastError } = useToast();

  const fetchCalls = () => {
    if (!tenantId) return;
    setLoading(true);
    getCalls(tenantId)
      .then((data) => setCalls(data.calls || []))
      .catch((e) => { setError(e.message); toastError("Couldn't load voicemails."); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCalls(); }, [tenantId]);

  const voicemails = useMemo(() => {
    let result = calls.filter(isVoicemail);
    if (!showHandled) result = result.filter((c) => !isHandled(c));
    const q = search.trim().toLowerCase();
    if (q) {
      result = result.filter((c) => (c.from_number || "").toLowerCase().includes(q));
    }
    // Newest first.
    result = [...result].sort((a, b) => {
      const ta = new Date(a.started_at || a.created_at || 0).getTime();
      const tb = new Date(b.started_at || b.created_at || 0).getTime();
      return tb - ta;
    });
    return result;
  }, [calls, search, showHandled]);

  const newCount = useMemo(
    () => calls.filter((c) => isVoicemail(c) && !isHandled(c)).length,
    [calls]
  );

  if (!tenantId) return (
    <p className="text-stone-500 text-sm italic">Select a business to view voicemails.</p>
  );

  return (
    <div className="max-w-6xl mx-auto px-0 space-y-6 pb-12">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">AI Call Intelligence Center</h1>
        <p className="text-stone-500 text-sm mt-1">Review, analyze, and action calls processed by your AI receptionist.</p>
      </header>

      {/* Tab bar — Voicemails active */}
      <div className="flex gap-2 border-b border-stone-200 overflow-x-auto">
        <button
          onClick={() => navigate("/calls")}
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-stone-500 hover:text-stone-700 -mb-px transition-all whitespace-nowrap"
        >
          Inbound Calls
        </button>
        <button
          onClick={() => navigate("/outbound")}
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-stone-500 hover:text-stone-700 -mb-px transition-all whitespace-nowrap"
        >
          Outbound Campaigns
        </button>
        <button
          onClick={() => navigate("/outreach-log")}
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-stone-500 hover:text-stone-700 -mb-px transition-all whitespace-nowrap"
        >
          AI Outreach Log
        </button>
        <button
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-brand-600 text-brand-600 -mb-px transition-all whitespace-nowrap inline-flex items-center gap-2"
        >
          <Voicemail className="w-4 h-4" />
          Voicemails
          {newCount > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-brand-600 text-white text-[10px] font-black leading-none">
              {newCount}
            </span>
          )}
        </button>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-xl border border-stone-200 p-3 sm:p-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              placeholder="Search by phone number…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-stone-100 rounded"
              >
                <X className="w-3 h-3 text-stone-400" />
              </button>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm text-stone-600 px-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showHandled}
              onChange={(e) => setShowHandled(e.target.checked)}
              className="w-4 h-4 rounded border-stone-300 text-brand-600"
            />
            Show handled
          </label>
        </div>
      </div>

      {/* List */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden divide-y divide-stone-100">
        {loading && calls.length === 0 ? (
          <div className="flex items-center justify-center py-24"><LumaSpin /></div>
        ) : error ? (
          <p className="text-red-600 text-sm font-medium p-6">{error}</p>
        ) : voicemails.length === 0 ? (
          <div className="text-center py-20">
            <Voicemail className="w-12 h-12 text-stone-200 mx-auto mb-4" />
            <p className="text-stone-500 font-medium italic">
              {showHandled ? "No voicemails yet." : "No new voicemails. You're all caught up."}
            </p>
            <p className="text-stone-400 text-xs mt-2 max-w-sm mx-auto">
              When a caller leaves a message — after a missed transfer or when the AI is off —
              it shows up here with their number and a recording.
            </p>
          </div>
        ) : (
          voicemails.map((c) => (
            <VoicemailCard key={c.id} call={c} onChanged={fetchCalls} />
          ))
        )}
      </div>
    </div>
  );
}

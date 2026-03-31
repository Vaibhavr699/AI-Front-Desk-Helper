import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getCalls, getRecordingAudioUrl, updateCall } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Phone,
  Clock,
  MessageSquare,
  Play,
  TrendingUp,
  User,
  Calendar,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ShieldAlert,
  ChevronRight
} from "lucide-react";
import { useToast } from "../components/ui/Toast";

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
        Load Recording
      </button>
    );
  }

  return <audio controls src={src} className="w-full max-w-xs h-8 rounded-md" />;
}

function CallCard({ call, onUpdate }) {
  const meta = call.metadata || {};
  const lead = meta.leadCapture || {};
  const score = lead.lead_score || meta.lead_score || 0;
  const summary = lead.ai_summary || meta.ai_summary || "No summary available.";
  const projectType = lead.project_type || lead.scope || "General Inquiry";
  const projectValue = lead.estimated_value ? `$${parseFloat(lead.estimated_value).toLocaleString()}` : "N/A";
  const { success, error: toastError } = useToast();

  const [isUpdating, setIsUpdating] = useState(false);

  const handleAction = async (action) => {
    setIsUpdating(true);
    try {
      await updateCall(call.id, { status: action });
      success(`Lead state updated: ${action}`);
      onUpdate();
    } catch (e) {
      toastError("Mission protocol adjustment failed.");
    } finally {
      setIsUpdating(false);
    }
  };

  const getScoreColor = (s) => {
    if (s >= 80) return "bg-emerald-100 text-emerald-700 border-emerald-200";
    if (s >= 50) return "bg-amber-100 text-amber-700 border-amber-200";
    return "bg-rose-100 text-rose-700 border-rose-200";
  };

  return (
    <div className="bg-white rounded-2xl border border-stone-200 shadow-sm hover:shadow-md transition-all overflow-hidden flex flex-col sm:flex-row">
      {/* Left: Score & Basic Info */}
      <div className="p-5 sm:w-64 border-b sm:border-b-0 sm:border-r border-stone-100 flex flex-col justify-between">
        <div>
          <div className="flex items-center justify-between mb-4">
            <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getScoreColor(score)}`}>
              Score: {score}
            </span>
            <span className="text-[10px] text-stone-400 font-medium">
              {new Date(call.started_at).toLocaleDateString()}
            </span>
          </div>

          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-stone-50 rounded-lg text-stone-500">
                <User className="w-4 h-4" />
              </div>
              <div className="overflow-hidden">
                <p className="text-sm font-semibold text-stone-900 truncate">
                  {lead.full_name || lead.contact_name || "Anonymous"}
                </p>
                <div className="flex items-center gap-1 text-xs text-stone-500">
                  <Phone className="w-3 h-3" />
                  <span>{call.from_number}</span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <div className="p-2 bg-stone-50 rounded-lg text-stone-500">
                <TrendingUp className="w-4 h-4" />
              </div>
              <div>
                <p className="text-stone-400 font-medium tracking-tight">Value</p>
                <p className="font-bold text-stone-900">{projectValue}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-6 pt-4 border-t border-stone-50">
          <p className="text-[10px] uppercase font-bold text-stone-400 tracking-wider mb-2 leading-none">Status</p>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-stone-100 text-stone-600">
            {call.status}
          </span>
        </div>
      </div>

      {/* Middle: Content & Analysis */}
      <div className="p-5 flex-1 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-4 h-4 text-brand-500" />
              <h3 className="text-sm font-bold text-stone-900 uppercase tracking-tight">AI Summary</h3>
            </div>
            <p className="text-sm text-stone-600 leading-relaxed italic">
              "{summary}"
            </p>
          </div>

          <div className="shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="w-4 h-4 text-brand-500" />
              <h3 className="text-sm font-bold text-stone-900 uppercase tracking-tight">Project</h3>
            </div>
            <p className="text-xs font-semibold text-stone-800 bg-brand-50 px-2 py-1 rounded">
              {projectType}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          <div className="space-y-2">
            <h4 className="text-[10px] font-bold text-stone-400 uppercase">Recording</h4>
            {call.recording_id ? (
              <AudioPlayer recordingId={call.recording_id} />
            ) : (
              <p className="text-xs text-stone-400 italic">No recording available</p>
            )}
          </div>

          <div className="space-y-2 overflow-hidden">
            <h4 className="text-[10px] font-bold text-stone-400 uppercase">Transcript Snippet</h4>
            <p className="text-xs text-stone-500 truncate italic">
              {call.transcript_preview || "Processing transcript..."}
            </p>
            <Link to={`/calls/${call.id}`} className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700 tracking-tight">
              View full transcript <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="p-5 sm:w-48 bg-stone-50/50 flex flex-col gap-2 border-t sm:border-t-0 sm:border-l border-stone-100">
        <p className="text-[10px] font-bold text-stone-400 uppercase mb-1">Actions</p>

        <button
          onClick={() => handleAction('Estimate Scheduled')}
          disabled={isUpdating}
          className={`flex items-center gap-2 w-full px-3 py-2 border rounded-lg text-xs font-semibold transition-all text-left disabled:opacity-50 ${
            call.status === 'Estimate Scheduled' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-700 ring-1 ring-emerald-100' 
              : 'bg-white border-stone-200 text-stone-700 hover:bg-emerald-50 hover:border-emerald-200 hover:text-emerald-700'
          }`}
        >
          <div className="shrink-0">{call.status === 'Estimate Scheduled' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Calendar className="w-3.5 h-3.5" />}</div>
          <span>Schedule Estimate</span>
        </button>

        <button
          onClick={() => handleAction('FollowUp Needed')}
          disabled={isUpdating}
          className={`flex items-center gap-2 w-full px-3 py-2 border rounded-lg text-xs font-semibold transition-all text-left disabled:opacity-50 ${
            call.status === 'FollowUp Needed' 
              ? 'bg-amber-50 border-amber-200 text-amber-700 ring-1 ring-amber-100' 
              : 'bg-white border-stone-200 text-stone-700 hover:bg-amber-50 hover:border-amber-200 hover:text-amber-700'
          }`}
        >
          <div className="shrink-0">{call.status === 'FollowUp Needed' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}</div>
          <span>FollowUp</span>
        </button>

        <button
          onClick={() => handleAction('Lost Lead')}
          disabled={isUpdating}
          className={`flex items-center gap-2 w-full px-3 py-2 border rounded-lg text-xs font-semibold transition-all text-left disabled:opacity-50 ${
            call.status === 'Lost Lead' 
              ? 'bg-rose-50 border-rose-200 text-rose-700 ring-1 ring-rose-100' 
              : 'bg-white border-stone-200 text-stone-700 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-700'
          }`}
        >
          <div className="shrink-0">{call.status === 'Lost Lead' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}</div>
          <span>Lost Lead</span>
        </button>

        <button
          onClick={() => handleAction('Spam')}
          disabled={isUpdating}
          className={`flex items-center gap-2 w-full px-3 py-2 border rounded-lg text-xs font-semibold transition-all text-left disabled:opacity-50 ${
            call.status === 'Spam' 
              ? 'bg-stone-200 border-stone-300 text-stone-900 ring-1 ring-stone-100' 
              : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-200 hover:text-stone-900'
          }`}
        >
          <div className="shrink-0">{call.status === 'Spam' ? <ShieldAlert className="w-3.5 h-3.5" /> : <ShieldAlert className="w-3.5 h-3.5" />}</div>
          <span>Spam</span>
        </button>
      </div>
    </div>
  );
}

export default function Calls({ tenantId }) {
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const { error: toastError } = useToast();
  const [error, setError] = useState("");

  const fetchCalls = () => {
    if (!tenantId) return;
    setLoading(true);
    getCalls(tenantId)
      .then((data) => setCalls(data.calls || []))
      .catch((e) => {
        setError(e.message);
        toastError("Data sync failed. Retrying...");
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchCalls();
  }, [tenantId]);

  if (!tenantId) {
    return (
      <div className="px-0">
        <p className="text-stone-500 text-sm sm:text-base italic">Select a business to view intelligence center.</p>
      </div>
    );
  }

  if (loading && calls.length === 0) {
    return (
      <div className="px-0 flex items-center justify-center py-24">
        <LumaSpin />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-0">
        <p className="text-red-600 text-sm font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-0 space-y-8 pb-12">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">
          AI Call Intelligence Center
        </h1>
        <p className="text-stone-500 text-sm mt-1">
          Review, analyze, and action calls processed by your AI receptionist.
        </p>
      </header>

      <div className="space-y-6">
        {calls.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-2xl border border-stone-200 border-dashed">
            <Phone className="w-12 h-12 text-stone-200 mx-auto mb-4" />
            <p className="text-stone-500 font-medium italic">No calls detected yet.</p>
          </div>
        ) : (
          calls.map((c) => (
            <CallCard key={c.id} call={c} onUpdate={fetchCalls} />
          ))
        )}
      </div>
    </div>
  );
}

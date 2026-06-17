import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { getCalls, getRecordingAudioUrl, updateCall } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Phone, Clock, MessageSquare, Play, TrendingUp, User,
  Calendar, AlertCircle, CheckCircle2, XCircle, ShieldAlert, ChevronRight,
  Search, ChevronDown, X
} from "lucide-react";
import { useToast } from "../components/ui/Toast";

// ─── AudioPlayer (unchanged from original) ────────────────────────────
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

// ─── Helpers ──────────────────────────────────────────────────────────
function getScoreColor(s) {
  if (s >= 80) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (s >= 50) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-rose-100 text-rose-700 border-rose-200";
}

function getCallScore(call) {
  const meta = call.metadata || {};
  const lead = meta.leadCapture || {};
  return lead.lead_score || meta.lead_score || 0;
}

function getCallName(call) {
  const meta = call.metadata || {};
  const lead = meta.leadCapture || {};
  return lead.full_name || lead.contact_name || "Anonymous";
}

function getCallProject(call) {
  const meta = call.metadata || {};
  const lead = meta.leadCapture || {};
  return lead.project_type || lead.scope || "General Inquiry";
}

// ─── Filter Bar ───────────────────────────────────────────────────────
function FilterBar({ filters, setFilters, totalCount, filteredCount }) {
  const ranges = [
    { value: "7d",  label: "Last 7 days" },
    { value: "30d", label: "Last 30 days" },
    { value: "90d", label: "Last 90 days" },
    { value: "all", label: "All time" },
  ];

  const scores = [
    { value: "all",    label: "All scores" },
    { value: "high",   label: "High (80+)" },
    { value: "medium", label: "Medium (50-79)" },
    { value: "low",    label: "Low (<50)" },
  ];

  const statuses = [
    { value: "all",                label: "All statuses" },
    { value: "completed",          label: "Completed" },
    { value: "Estimate Scheduled", label: "Estimate Scheduled" },
    { value: "FollowUp Needed",    label: "FollowUp Needed" },
    { value: "Lost Lead",          label: "Lost Lead" },
    { value: "Spam",               label: "Spam" },
  ];

  const searchActive = filters.search.trim().length > 0;

  const hasActiveFilters =
    filters.range !== "30d" ||
    filters.score !== "all" ||
    filters.status !== "all" ||
    searchActive;

  const clearAll = () => setFilters({ range: "30d", score: "all", status: "all", search: "" });

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-3 sm:p-4 space-y-3">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        {/* Search — always-on, searches by name, phone, or transcript across ALL calls */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            type="text"
            placeholder="Search name, phone, transcript..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            className="w-full pl-9 pr-3 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
          {filters.search && (
            <button
              onClick={() => setFilters({ ...filters, search: "" })}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-stone-100 rounded"
            >
              <X className="w-3 h-3 text-stone-400" />
            </button>
          )}
        </div>

        {/* Date range — disabled-look when search is active so user understands it's ignored */}
        <select
          value={filters.range}
          onChange={(e) => setFilters({ ...filters, range: e.target.value })}
          disabled={searchActive}
          className={`px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 ${searchActive ? "opacity-50 cursor-not-allowed" : ""}`}
          title={searchActive ? "Search is global across all calls — date filter ignored" : ""}
        >
          {ranges.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>

        {/* Score */}
        <select
          value={filters.score}
          onChange={(e) => setFilters({ ...filters, score: e.target.value })}
          className="px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {scores.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>

        {/* Status */}
        <select
          value={filters.status}
          onChange={(e) => setFilters({ ...filters, status: e.target.value })}
          className="px-3 py-2 text-sm border border-stone-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {statuses.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
      </div>

      {/* Result counter — different copy when global search is active */}
      <div className="flex items-center justify-between text-xs">
        <span className="text-stone-500">
          {searchActive ? (
            <>
              Searching <span className="font-bold text-stone-800">all calls</span> —{" "}
              <span className="font-bold text-stone-800">{filteredCount}</span> match
              {filteredCount !== 1 ? "es" : ""}
            </>
          ) : (
            <>
              Showing <span className="font-bold text-stone-800">{filteredCount}</span> of{" "}
              <span className="font-bold text-stone-800">{totalCount}</span> calls
            </>
          )}
        </span>
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="text-brand-600 hover:text-brand-700 font-semibold"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Compact Row (collapsed view) ─────────────────────────────────────
function CompactRow({ call, expanded, onToggle }) {
  const score = getCallScore(call);
  const name = getCallName(call);
  const project = getCallProject(call);

  return (
    <button
      onClick={onToggle}
      className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-stone-50 transition-colors"
    >
      <span className="text-xs text-stone-500 font-medium w-20 shrink-0 hidden sm:inline">
        {new Date(call.started_at).toLocaleDateString()}
      </span>
      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border w-12 text-center shrink-0 ${getScoreColor(score)}`}>
        {score}
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-stone-900 truncate">{name}</p>
        <p className="text-xs text-stone-500 truncate">{call.from_number}</p>
      </div>
      <span className="hidden md:inline text-xs text-stone-600 truncate max-w-[140px] bg-brand-50 px-2 py-0.5 rounded">
        {project}
      </span>
      <span className="text-[10px] font-semibold bg-stone-100 text-stone-600 px-2 py-1 rounded uppercase tracking-wide hidden sm:inline-block">
        {call.status}
      </span>
      <ChevronDown
        className={`w-4 h-4 text-stone-400 transition-transform shrink-0 ${expanded ? "rotate-180" : ""}`}
      />
    </button>
  );
}

// ─── Expanded Detail (full info, shown when row is clicked) ──────────
function ExpandedDetail({ call, onUpdate }) {
  const meta = call.metadata || {};
  const lead = meta.leadCapture || {};
  const summary = lead.ai_summary || meta.ai_summary || "No summary available.";
  const projectType = getCallProject(call);
  const projectValue = lead.estimated_value
    ? `$${parseFloat(lead.estimated_value).toLocaleString()}`
    : "N/A";
  const { success, error: toastError } = useToast();
  const [isUpdating, setIsUpdating] = useState(false);

  const handleAction = async (action) => {
    setIsUpdating(true);
    try {
      await updateCall(call.id, {
        status: action,
        ...(action === "Spam" && { disposition: "spam" }),
      });
      success(`Lead state updated: ${action}`);
      onUpdate();
    } catch {
      toastError("Update failed.");
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="p-5 grid grid-cols-1 lg:grid-cols-3 gap-5 bg-stone-50/40">
      {/* Left column: lead detail */}
      <div className="space-y-4">
        <div>
          <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Lead Value</h4>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-white border border-stone-100 rounded-lg text-stone-500">
              <TrendingUp className="w-4 h-4" />
            </div>
            <span className="font-bold text-stone-900">{projectValue}</span>
          </div>
        </div>
        <div>
          <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Project</h4>
          <p className="text-xs font-semibold text-stone-800 bg-brand-50 px-2 py-1 rounded inline-block">
            {projectType}
          </p>
        </div>
        <div>
          <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Status</h4>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-stone-100 text-stone-600">
            {call.status}
          </span>
        </div>
      </div>

      {/* Middle column: AI summary + recording + transcript */}
      <div className="space-y-4">
        <div>
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-brand-500" />
            <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-wider">AI Summary</h4>
          </div>
          <p className="text-sm text-stone-600 leading-relaxed italic">"{summary}"</p>
        </div>

        <div>
          <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Recording</h4>
          {call.recording_id
            ? <AudioPlayer recordingId={call.recording_id} />
            : <p className="text-xs text-stone-400 italic">No recording available</p>
          }
        </div>

        <div>
          <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Transcript Snippet</h4>
          <p className="text-xs text-stone-500 italic line-clamp-3">{call.transcript_preview || "Processing transcript..."}</p>
          <Link
            to={`/calls/${call.id}`}
            className="inline-flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700 tracking-tight mt-2"
          >
            View full transcript <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      </div>

      {/* Right column: actions */}
      <div>
        <h4 className="text-[10px] font-bold text-stone-400 uppercase tracking-wider mb-2">Actions</h4>
        <div className="flex flex-col gap-2">
          {[
            { action: "Estimate Scheduled", label: "Schedule Estimate", active: "bg-emerald-50 border-emerald-200 text-emerald-700 ring-1 ring-emerald-100", icon: Calendar,    activeIcon: CheckCircle2 },
            { action: "FollowUp Needed",    label: "FollowUp",          active: "bg-amber-50 border-amber-200 text-amber-700 ring-1 ring-amber-100",         icon: AlertCircle, activeIcon: CheckCircle2 },
            { action: "Lost Lead",          label: "Lost Lead",          active: "bg-rose-50 border-rose-200 text-rose-700 ring-1 ring-rose-100",             icon: XCircle,     activeIcon: CheckCircle2 },
            { action: "Spam",               label: "Spam",               active: "bg-stone-200 border-stone-300 text-stone-900 ring-1 ring-stone-100",        icon: ShieldAlert, activeIcon: ShieldAlert  },
          ].map(({ action, label, active, icon: Icon, activeIcon: ActiveIcon }) => {
            const isActive = call.status === action;
            return (
              <button
                key={action}
                onClick={() => handleAction(action)}
                disabled={isUpdating}
                className={`flex items-center gap-2 w-full px-3 py-2 border rounded-lg text-xs font-semibold transition-all text-left disabled:opacity-50 ${
                  isActive ? active : "bg-white border-stone-200 text-stone-700 hover:bg-stone-100"
                }`}
              >
                <div className="shrink-0">
                  {isActive ? <ActiveIcon className="w-3.5 h-3.5" /> : <Icon className="w-3.5 h-3.5" />}
                </div>
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Top-level Calls page ─────────────────────────────────────────────
export default function Calls({ tenantId }) {
  const navigate = useNavigate();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedIds, setExpandedIds] = useState(new Set());
  const { error: toastError } = useToast();

  // Filter state — default to last 30 days, all scores, all statuses, empty search
  const [filters, setFilters] = useState({
    range: "30d",
    score: "all",
    status: "all",
    search: "",
  });

  const fetchCalls = () => {
    if (!tenantId) return;
    setLoading(true);
    getCalls(tenantId)
      .then((data) => setCalls(data.calls || []))
      .catch((e) => { setError(e.message); toastError("Data sync failed. Retrying..."); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchCalls(); }, [tenantId]);

  // Apply filters in-memory. Search bypasses the date filter so old
  // customers stay findable regardless of which date window is selected.
  const filteredCalls = useMemo(() => {
    let result = calls;
    const searchActive = filters.search.trim().length > 0;

    // Date range — skipped when search is active
    if (filters.range !== "all" && !searchActive) {
      const days = filters.range === "7d" ? 7 : filters.range === "30d" ? 30 : 90;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      result = result.filter((c) => new Date(c.started_at) >= cutoff);
    }

    if (filters.score !== "all") {
      result = result.filter((c) => {
        const score = getCallScore(c);
        if (filters.score === "high")   return score >= 80;
        if (filters.score === "medium") return score >= 50 && score < 80;
        if (filters.score === "low")    return score < 50;
        return true;
      });
    }

    if (filters.status !== "all") {
      result = result.filter((c) => c.status === filters.status);
    }

    if (searchActive) {
      const q = filters.search.toLowerCase();
      result = result.filter((c) => {
        const name = getCallName(c).toLowerCase();
        const phone = (c.from_number || "").toLowerCase();
        const transcript = (c.transcript_preview || "").toLowerCase();
        return name.includes(q) || phone.includes(q) || transcript.includes(q);
      });
    }

    return result;
  }, [calls, filters]);

  const toggleExpanded = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!tenantId) return (
    <p className="text-stone-500 text-sm italic">Select a business to view call intelligence.</p>
  );

  return (
    <div className="max-w-6xl mx-auto px-0 space-y-6 pb-12">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">AI Call Intelligence Center</h1>
        <p className="text-stone-500 text-sm mt-1">Review, analyze, and action calls processed by your AI receptionist.</p>
      </header>

      {/* Tab bar */}
       <div className="flex gap-2 border-b border-stone-200">
//     <button className="px-4 py-2.5 text-sm font-bold border-b-2 border-brand-600 text-brand-600 -mb-px transition-all">
//       Inbound Calls
//     </button>
//     <button
//       onClick={() => navigate("/outreach-log")}
//       className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-stone-500 hover:text-stone-700 -mb-px transition-all"
//     >
//       AI Outreach Log
//     </button>
//   </div>

      {/* Filter bar */}
      <FilterBar
        filters={filters}
        setFilters={setFilters}
        totalCount={calls.length}
        filteredCount={filteredCalls.length}
      />

      {/* Calls list — compact rows that expand on click */}
      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden divide-y divide-stone-100">
        {loading && calls.length === 0 ? (
          <div className="flex items-center justify-center py-24"><LumaSpin /></div>
        ) : error ? (
          <p className="text-red-600 text-sm font-medium p-6">{error}</p>
        ) : filteredCalls.length === 0 ? (
          <div className="text-center py-20">
            <Phone className="w-12 h-12 text-stone-200 mx-auto mb-4" />
            <p className="text-stone-500 font-medium italic">
              {calls.length === 0 ? "No calls detected yet." : "No calls match your filters."}
            </p>
          </div>
        ) : (
          filteredCalls.map((c) => (
            <div key={c.id}>
              <CompactRow
                call={c}
                expanded={expandedIds.has(c.id)}
                onToggle={() => toggleExpanded(c.id)}
              />
              {expandedIds.has(c.id) && (
                <ExpandedDetail call={c} onUpdate={fetchCalls} />
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

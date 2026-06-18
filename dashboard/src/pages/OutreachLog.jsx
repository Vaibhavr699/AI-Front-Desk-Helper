import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getOutboundActivity } from "../api";
import { LumaSpin } from "../components/ui/luma-spin";
import {
  Phone, MessageSquare, Search, X, ChevronRight, Voicemail,
  PhoneOutgoing, PhoneOff, CheckCircle2, AlertCircle, Send, Inbox,
} from "lucide-react";
import { useToast } from "../components/ui/Toast";

// ─────────────────────────────────────────────────────────────────────
// AI Outreach Log (Jun 17, 2026)
//
// The read-only record of every automated touch the AI sent on its own —
// recovery calls/SMS, nurturing, seasonal, referral, inquiry, missed-call.
// Built to answer one question fast: "what reached out to this person, when,
// why, and what happened?" — the exact lookup that took eight SQL queries
// to answer for Mike F.
//
// Distinct from the /outbound Campaigns page (launch-a-bulk-campaign). This
// is what ALREADY happened automatically, not what you configure to send.
//
// Visual language matches Calls.jsx (stone palette, FilterBar shape) so the
// two Call Intelligence tabs feel like one product. The one thing made loud
// per row: SOURCE (why it fired) + STATUS (what happened), since that's the
// scan target.
//
// View routing (Jun 17): a CALL row opens /calls/:id — the call-detail page
// with the recording player + full transcript (same target as the Inbound
// tab's "View full transcript"). An SMS row opens /conversations?lead=ID —
// the message thread. A call's substance is its recording, not a text body,
// so the two channels route to different places on purpose.
// ─────────────────────────────────────────────────────────────────────

// Source → display config. Color encodes "what kind of outreach," kept
// muted so STATUS (the outcome) stays the brightest signal in a row.
const SOURCE_CONFIG = {
  recovery:    { label: "Estimate recovery", chip: "bg-blue-50 text-blue-700 border-blue-200" },
  inquiry:     { label: "Inquiry follow-up", chip: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  missed_call: { label: "Missed-call callback", chip: "bg-violet-50 text-violet-700 border-violet-200" },
  nurturing:   { label: "Nurturing", chip: "bg-teal-50 text-teal-700 border-teal-200" },
  seasonal:    { label: "Seasonal campaign", chip: "bg-amber-50 text-amber-700 border-amber-200" },
  referral:    { label: "Referral", chip: "bg-pink-50 text-pink-700 border-pink-200" },
  other:       { label: "Other", chip: "bg-stone-100 text-stone-600 border-stone-200" },
};

// Status → display config. icon + tone tell you the outcome at a glance.
const STATUS_CONFIG = {
  answered:  { label: "Answered",   icon: CheckCircle2, tone: "text-emerald-600", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  voicemail: { label: "Voicemail",  icon: Voicemail,    tone: "text-blue-600",    bg: "bg-blue-50 text-blue-700 border-blue-200" },
  "no-answer": { label: "No answer", icon: PhoneOff,    tone: "text-stone-500",   bg: "bg-stone-100 text-stone-600 border-stone-200" },
  dialing:   { label: "Dialing",    icon: PhoneOutgoing, tone: "text-amber-600",  bg: "bg-amber-50 text-amber-700 border-amber-200" },
  delivered: { label: "Delivered",  icon: CheckCircle2, tone: "text-emerald-600", bg: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  sent:      { label: "Sent",       icon: Send,         tone: "text-stone-600",   bg: "bg-stone-100 text-stone-600 border-stone-200" },
  failed:    { label: "Failed",     icon: AlertCircle,  tone: "text-rose-600",    bg: "bg-rose-50 text-rose-700 border-rose-200" },
  unknown:   { label: "—",          icon: AlertCircle,  tone: "text-stone-400",   bg: "bg-stone-100 text-stone-500 border-stone-200" },
};

function sourceCfg(s) { return SOURCE_CONFIG[s] || SOURCE_CONFIG.other; }
function statusCfg(s) { return STATUS_CONFIG[s] || STATUS_CONFIG.unknown; }

function relativeTime(iso) {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

// ─── Filter bar — search + source chips ──────────────────────────────
function OutreachFilterBar({ search, setSearch, source, setSource, sourceCounts, total }) {
  const searchActive = search.trim().length > 0;

  // Build the chip list from counts the API returned (only show sources
  // that actually have activity, plus an "All").
  const presentSources = Object.keys(sourceCounts || {}).sort(
    (a, b) => (sourceCounts[b] || 0) - (sourceCounts[a] || 0)
  );

  return (
    <div className="bg-white rounded-xl border border-stone-200 p-3 sm:p-4 space-y-3">
      <div className="relative">
        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-stone-400" />
        <input
          type="text"
          placeholder="Search by customer name or phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-9 py-2 text-sm border border-stone-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
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

      {/* Source chips */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setSource("all")}
          className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
            source === "all"
              ? "bg-stone-800 text-white border-stone-800"
              : "bg-white text-stone-600 border-stone-200 hover:border-stone-300"
          }`}
        >
          All {total > 0 ? `· ${total}` : ""}
        </button>
        {presentSources.map((s) => {
          const cfg = sourceCfg(s);
          const isActive = source === s;
          return (
            <button
              key={s}
              onClick={() => setSource(s)}
              className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition-all ${
                isActive ? cfg.chip + " ring-1 ring-current/20" : "bg-white text-stone-500 border-stone-200 hover:border-stone-300"
              }`}
            >
              {cfg.label} · {sourceCounts[s]}
            </button>
          );
        })}
      </div>

      <div className="text-xs text-stone-500">
        {searchActive ? (
          <>Searching <span className="font-bold text-stone-800">all outreach</span> — <span className="font-bold text-stone-800">{total}</span> match{total !== 1 ? "es" : ""}</>
        ) : (
          <><span className="font-bold text-stone-800">{total}</span> outreach {total === 1 ? "touch" : "touches"} in the last 90 days</>
        )}
      </div>
    </div>
  );
}

// ─── One outreach row ────────────────────────────────────────────────
function OutreachRow({ item, onOpen }) {
  const src = sourceCfg(item.source);
  const st = statusCfg(item.status);
  const StatusIcon = st.icon;
  const ChannelIcon = item.channel === "call" ? Phone : MessageSquare;

  // A call always has its own /calls/:id detail page, so it's always
  // viewable. An SMS is only viewable if we have a lead_id to open the
  // thread with.
  const canView = item.type === "call" || !!item.lead_id;

  return (
    <div className="px-4 py-3 flex items-center gap-3 hover:bg-stone-50 transition-colors">
      {/* Channel + time */}
      <div className="flex flex-col items-center w-16 shrink-0">
        <ChannelIcon className={`w-4 h-4 ${item.channel === "call" ? "text-blue-500" : "text-green-500"}`} />
        <span className="text-[10px] text-stone-400 mt-1">{relativeTime(item.at)}</span>
      </div>

      {/* Contact + what fired */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-stone-900 truncate">{item.contact_name}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${src.chip}`}>
            {src.label}
          </span>
          {item.step_label && (
            <span className="text-[11px] text-stone-500 truncate">{item.step_label}</span>
          )}
        </div>
        {item.preview && (
          <p className="text-[11px] text-stone-400 italic truncate mt-1">"{item.preview}"</p>
        )}
      </div>

      {/* Status */}
      <span className={`hidden sm:inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold border shrink-0 ${st.bg}`}>
        <StatusIcon className="w-3 h-3" />
        {st.label}
      </span>

      {/* View — calls open the recording/transcript page, SMS the thread */}
      {canView ? (
        <button
          onClick={() => onOpen(item)}
          className="flex items-center gap-1 text-xs font-bold text-brand-600 hover:text-brand-700 shrink-0"
          title={item.type === "call" ? "Listen to recording / read transcript" : "Open this customer's conversation"}
        >
          <span className="hidden md:inline">View</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
    </div>
  );
}

// ─── Top-level page ──────────────────────────────────────────────────
export default function OutreachLog({ tenantId }) {
  const navigate = useNavigate();
  const { error: toastError } = useToast();

  const [activity, setActivity] = useState([]);
  const [sourceCounts, setSourceCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");

  // Debounce the search so we're not firing a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchActivity = () => {
    if (!tenantId) return;
    setLoading(true);
    getOutboundActivity(tenantId, {
      search: debouncedSearch || undefined,
      source: source !== "all" ? source : undefined,
    })
      .then((data) => {
        setActivity(data.activity || []);
        setSourceCounts(data.source_counts || {});
        setTotal(data.pagination?.total ?? (data.activity || []).length);
      })
      .catch((e) => { setError(e.message); toastError("Couldn't load outreach log."); })
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchActivity(); /* eslint-disable-next-line */ }, [tenantId, debouncedSearch, source]);

  // Calls open the call-detail page (recording player + full transcript);
  // SMS opens the conversation thread. Mirrors the Inbound tab, where a
  // call's substance is its transcript, not a message body.
  const openItem = (item) => {
    if (item.type === "call") {
      navigate(`/calls/${item.id}`);
    } else if (item.lead_id) {
      navigate(`/conversations?lead=${item.lead_id}&msg=${item.id}`);
    }
  };

  if (!tenantId) return (
    <p className="text-stone-500 text-sm italic">Select a business to view the outreach log.</p>
  );

  return (
    <div className="max-w-6xl mx-auto px-0 space-y-6 pb-12">
      <header>
        <h1 className="text-2xl sm:text-3xl font-bold text-stone-900 tracking-tight">AI Call Intelligence Center</h1>
        <p className="text-stone-500 text-sm mt-1">Review, analyze, and action calls processed by your AI receptionist.</p>
      </header>

      {/* Tab bar — Inbound Calls | AI Outreach Log */}
      <div className="flex gap-2 border-b border-stone-200">
        <button
          onClick={() => navigate("/calls")}
          className="px-4 py-2.5 text-sm font-bold border-b-2 border-transparent text-stone-500 hover:text-stone-700 -mb-px transition-all"
        >
          Inbound Calls
        </button>
        <button className="px-4 py-2.5 text-sm font-bold border-b-2 border-brand-600 text-brand-600 -mb-px transition-all">
          AI Outreach Log
        </button>
      </div>

      {/* Intro line — names what this is vs. the Campaigns page */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-stone-500 max-w-xl">
          Every automated touch your AI sent on its own — recovery, nurturing, seasonal, and callbacks.
          To launch a new bulk calling campaign instead, go to{" "}
          <button onClick={() => navigate("/outbound")} className="text-brand-600 font-semibold hover:text-brand-700">
            Outbound Campaigns →
          </button>
        </p>
      </div>

      <OutreachFilterBar
        search={search}
        setSearch={setSearch}
        source={source}
        setSource={setSource}
        sourceCounts={sourceCounts}
        total={total}
      />

      <div className="bg-white rounded-xl border border-stone-200 overflow-hidden divide-y divide-stone-100">
        {loading && activity.length === 0 ? (
          <div className="flex items-center justify-center py-24"><LumaSpin /></div>
        ) : error ? (
          <p className="text-red-600 text-sm font-medium p-6">{error}</p>
        ) : activity.length === 0 ? (
          <div className="text-center py-20">
            <Inbox className="w-12 h-12 text-stone-200 mx-auto mb-4" />
            <p className="text-stone-500 font-medium italic">
              {debouncedSearch
                ? "No outreach matches your search."
                : "No automated outreach in the last 90 days."}
            </p>
          </div>
        ) : (
          activity.map((item) => (
            <OutreachRow key={`${item.type}-${item.id}`} item={item} onOpen={openItem} />
          ))
        )}
      </div>
    </div>
  );
}

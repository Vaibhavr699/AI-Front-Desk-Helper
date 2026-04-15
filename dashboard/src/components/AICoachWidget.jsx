import { useState, useRef, useEffect, useCallback } from "react";
import { getMetrics, getLeadsByTenant, api } from "../api";

const MODES = {
  nurture: { label: "Nurture", icon: "🌱" },
  coaching: { label: "Coaching", icon: "🏆" },
};

const COACHING_LEVELS = ["Starter", "Growth", "Franchise"];

const NURTURE_QUICK = [
  "Draft follow-up",
  "Re-engage cold lead",
  "Pre-appt reminder",
  "Post-job thank you",
];

const COACHING_QUICK = [
  "Why am I behind on my goal this month?",
  "Which lead source is converting best?",
  "How can I improve my booking rate?",
  "What should I focus on this week?",
  "How many more leads do I need to hit my goal?",
  "How can I produce more leads?",
];

const MONTH_NAME = new Date().toLocaleString("default", { month: "long" });
const YEAR = new Date().getFullYear();
const NOW_MONTH = new Date().getMonth();

// ── Build coaching system prompt with live data ────────────────────────────
function buildCoachingPrompt(level, liveContext, memory) {
  const memCtx = memory.length
    ? `\n\nSession memory:\n${memory.map((m) => `- ${m}`).join("\n")}`
    : "";

  let dataCtx = "";
  if (liveContext) {
    const { goals, metrics } = liveContext;
    const monthRow = goals?.months?.find((m) => m.month === NOW_MONTH);
    const monthGoal = monthRow ? Math.round((monthRow.revenue_goal || 0) / 100) : 0;
    const monthActual = monthRow ? Math.round((monthRow.actual_revenue || 0) / 100) : 0;
    const annualGoal = goals?.annual_goal ? Math.round(goals.annual_goal / 100) : 0;
    const calls30d = metrics?.totals?.calls || 0;
    const bookingRate = metrics?.totals?.booking_rate || 0;
    const closeRate = metrics?.sales?.close_rate || 0;
    const openLeads = metrics?.pipeline?.open_estimates || 0;
    const pipelineValue = metrics?.pipeline?.estimated_revenue
      ? Math.round(metrics.pipeline.estimated_revenue / 100)
      : 0;
    const avgJobValue = metrics?.metrics?.ops?.avg_job_value || 0;
    const hungUp = metrics?.ai?.calls_hung_up || 0;
    const confused = metrics?.ai?.calls_confused || 0;
    const todayCalls = metrics?.today?.calls || 0;
    const todayBooked = metrics?.today?.booked || 0;
    const dayOfMonth = new Date().getDate();
    const daysInMonth = new Date(YEAR, NOW_MONTH + 1, 0).getDate();
    const pacePct = monthGoal > 0 ? Math.round((monthActual / monthGoal) * 100) : null;
    const expectedPct = Math.round((dayOfMonth / daysInMonth) * 100);

    dataCtx = `

LIVE BUSINESS DATA (use these exact numbers in your answers):
- Month: ${MONTH_NAME} ${YEAR} (Day ${dayOfMonth} of ${daysInMonth})
- Monthly revenue goal: ${monthGoal > 0 ? `$${monthGoal.toLocaleString()}` : "not set"}
- Monthly actual revenue: ${monthActual > 0 ? `$${monthActual.toLocaleString()}` : "$0"}
- Goal pace: ${pacePct !== null ? `${pacePct}% achieved vs ${expectedPct}% expected` : "no goal set"}
- Annual goal: ${annualGoal > 0 ? `$${annualGoal.toLocaleString()}` : "not set"}
- Calls (last 30d): ${calls30d}
- Booking rate: ${bookingRate}%
- Close rate: ${closeRate}%
- Open estimates: ${openLeads}
- Pipeline value: ${pipelineValue > 0 ? `$${pipelineValue.toLocaleString()}` : "$0"}
- Avg job value: ${avgJobValue > 0 ? `$${avgJobValue.toLocaleString()}` : "unknown"}
- Calls hung up: ${hungUp}
- Calls confused: ${confused}
- Today's calls: ${todayCalls} | Today's bookings: ${todayBooked}`;
  }

  return `You are an elite AI revenue coach for home service contractors and franchise operators inside AI Front Desk Helper. The owner is at the ${level} tier.

Coaching philosophy by tier:
- Starter: Speed-to-lead (answer within 5 min), booking rate basics, first AI automation wins.
- Growth: Close rate by lead source, estimate recovery sequences, team KPI visibility.
- Franchise: HQ rollup dashboards, multi-location benchmarking, white-label positioning, SOC 2 readiness.

Industry benchmarks: avg booking rate 25-35%, avg close rate 35-50%, avg job value $2,400-$4,000 for painting.

Be direct, specific, and dollar-quantified. Always reference the owner's actual numbers when available. End every response with one concrete action they can take today.${dataCtx}${memCtx}`;
}

// ── Build nurture system prompt ────────────────────────────────────────────
function buildNurturePrompt(contact, memory) {
  const memCtx = memory.length
    ? `\n\nSession memory:\n${memory.map((m) => `- ${m}`).join("\n")}`
    : "";
  return `You are an AI contact nurturing specialist embedded inside AI Front Desk Helper for home service contractors.
${contact ? `\nActive contact: ${contact.name} | Stage: ${contact.stage} | Est. Value: ${contact.value} | Days since contact: ${contact.days} | Lead source: ${contact.source}` : ""}
Craft specific, human, conversion-focused outreach messages (texts, emails, or voicemail scripts). Keep messages short, warm, and action-oriented. Reference the contact's stage and lead source. Never sound robotic. Always include a clear next step.${memCtx}`;
}

// ── Calls backend proxy — uses OpenAI gpt-4o streaming ────────────────────
async function callAI(messages, systemPrompt, onChunk) {
  const token = localStorage.getItem("token");

  const res = await fetch("/api/ai-coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ messages, system: systemPrompt }),
  });

  if (!res.ok) {
    throw new Error(`AI service error: ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
    for (const line of lines) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const json = JSON.parse(data);
        const text = json.choices?.[0]?.delta?.content;
        if (text) {
          full += text;
          onChunk(full);
        }
      } catch {}
    }
  }
  return full;
}

// ── Widget ────────────────────────────────────────────────────────────────
export default function AICoachWidget({ tenantId }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("nurture");
  const [coachLevel, setCoachLevel] = useState("Growth");

  // Nurture
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showContacts, setShowContacts] = useState(false);

  // Coaching live context
  const [liveContext, setLiveContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);

  // Chat
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [memory, setMemory] = useState([]);

  // UI
  const [showMemory, setShowMemory] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // ── Fetch leads for Nurture ──────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || tenantId === "all") return;
    setContactsLoading(true);
    getLeadsByTenant(tenantId, 20, 0)
      .then((data) => {
        const rows = Array.isArray(data) ? data : (data.leads || []);
        const mapped = rows.map((l) => {
          const ref = l.last_contact_at || l.created_at;
          const days = ref ? Math.floor((Date.now() - new Date(ref)) / 86400000) : 0;
          const cents = l.estimated_revenue_cents || l.estimate_value_cents || 0;
          return {
            id: l.id,
            name: l.name || l.contact_name || "Unknown",
            stage: l.status || "new_lead",
            value: cents ? `$${(cents / 100).toLocaleString()}` : "N/A",
            days,
            source: l.lead_source || "Unknown",
          };
        });
        setContacts(mapped);
        if (mapped.length > 0) setSelectedContact(mapped[0]);
      })
      .catch((e) => console.error("[AICoachWidget] Leads fetch failed:", e))
      .finally(() => setContactsLoading(false));
  }, [tenantId]);

  // ── Fetch live goals + metrics for Coaching ──────────────────────────
  useEffect(() => {
    if (!tenantId || tenantId === "all" || mode !== "coaching") return;
    setContextLoading(true);
    Promise.all([
      api(`/api/goals/annual?year=${YEAR}&tenant_id=${tenantId}`).catch(() => null),
      getMetrics(tenantId, "30d").catch(() => null),
    ]).then(([goals, metrics]) => {
      setLiveContext({ goals, metrics });
    }).finally(() => setContextLoading(false));
  }, [tenantId, mode]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const reset = () => { setMessages([]); setStreamText(""); };

  // ── Send ──────────────────────────────────────────────────────────────
  const send = useCallback(async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput("");
    setLoading(true);
    setStreamText("");

    const userMsg = { role: "user", content: userText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    const systemPrompt = mode === "nurture"
      ? buildNurturePrompt(selectedContact, memory)
      : buildCoachingPrompt(coachLevel, liveContext, memory);

    try {
      const full = await callAI(
        newMessages.map((m) => ({ role: m.role, content: m.content })),
        systemPrompt,
        (partial) => setStreamText(partial)
      );
      setStreamText("");
      setMessages((prev) => [...prev, { role: "assistant", content: full }]);
      setMemory((prev) => [`[${mode}] ${full.slice(0, 100).replace(/\n/g, " ")}…`, ...prev.slice(0, 7)]);
    } catch (e) {
      setStreamText("");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Connection error. Please try again." },
      ]);
    }
    setLoading(false);
  }, [input, loading, messages, mode, coachLevel, selectedContact, liveContext, memory]);

  // ── Live context bar data ─────────────────────────────────────────────
  const monthRow = liveContext?.goals?.months?.find((m) => m.month === NOW_MONTH);
  const monthGoal = monthRow ? Math.round((monthRow.revenue_goal || 0) / 100) : 0;
  const monthActual = monthRow ? Math.round((monthRow.actual_revenue || 0) / 100) : 0;
  const closeRate = liveContext?.metrics?.sales?.close_rate || 0;
  const openLeads = liveContext?.metrics?.pipeline?.open_estimates || 0;
  const bookingRate = liveContext?.metrics?.totals?.booking_rate || 0;

  const stageDot = (stage) =>
    stage === "booked" ? "#22c55e" : stage === "estimate_sent" ? "#f59e0b" : "#6b7280";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');
        .aiw * { box-sizing: border-box; margin: 0; padding: 0; }
        .aiw-fab-wrap { position: fixed; bottom: 24px; right: 20px; z-index: 9999; }
        .aiw-fab {
          width: 60px; height: 60px; border-radius: 50%;
          background: linear-gradient(135deg, #f59e0b, #ea580c);
          border: none; cursor: pointer; display: flex; align-items: center;
          justify-content: center; font-size: 24px;
          animation: aiw-pulse 2.5s infinite; transition: transform .2s;
        }
        .aiw-fab:hover { transform: scale(1.08); }
        @keyframes aiw-pulse {
          0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)}
          50%{box-shadow:0 0 0 14px rgba(245,158,11,0)}
        }
        .aiw-badge {
          position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;
          font-size:10px;width:18px;height:18px;border-radius:50%;
          display:flex;align-items:center;justify-content:center;
          font-family:'Syne',sans-serif;font-weight:700;
        }
        .aiw-panel {
          position:fixed;bottom:0;right:0;width:100vw;height:100dvh;
          background:#0d0d14;display:flex;flex-direction:column;
          border-top:2px solid #f59e0b;
          transform:translateY(100%);
          transition:transform .35s cubic-bezier(.16,1,.3,1);
          z-index:9998;font-family:'DM Mono',monospace;
        }
        @media(min-width:520px){
          .aiw-panel{bottom:24px;right:20px;width:420px;height:700px;
            border-radius:20px;border:1.5px solid #1e1e2e;border-top:2px solid #f59e0b;}
        }
        .aiw-panel.open{transform:translateY(0);}
        .aiw-header{padding:14px 16px 11px;border-bottom:1px solid #1e1e2e;
          display:flex;flex-direction:column;gap:9px;background:#0d0d14;flex-shrink:0;}
        .aiw-header-top{display:flex;align-items:center;justify-content:space-between;}
        .aiw-logo{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;
          color:#f59e0b;letter-spacing:.05em;text-transform:uppercase;}
        .aiw-logo span{color:#4b5563;font-weight:600;}
        .aiw-hbts{display:flex;gap:6px;align-items:center;}
        .aiw-ibt{background:#1a1a28;border:1px solid #2a2a3e;border-radius:8px;
          width:30px;height:30px;display:flex;align-items:center;justify-content:center;
          cursor:pointer;font-size:13px;color:#9ca3af;transition:border-color .15s,color .15s;}
        .aiw-ibt:hover{border-color:#f59e0b;color:#f59e0b;}
        .aiw-x{background:none;border:none;cursor:pointer;color:#6b7280;font-size:19px;padding:3px;}
        .aiw-tabs{display:flex;gap:5px;}
        .aiw-tab{flex:1;padding:6px 0;border-radius:8px;font-family:'Syne',sans-serif;
          font-size:11px;font-weight:700;border:1.5px solid #1e1e2e;background:transparent;
          color:#6b7280;cursor:pointer;transition:all .15s;letter-spacing:.03em;}
        .aiw-tab.n{background:#052e16;border-color:#22c55e;color:#22c55e;}
        .aiw-tab.c{background:#1c1007;border-color:#f59e0b;color:#f59e0b;}
        .aiw-ctx{display:flex;align-items:center;gap:7px;padding:9px 16px;
          background:#0a0a10;border-bottom:1px solid #1e1e2e;flex-shrink:0;}
        .aiw-pill{background:#1a1a28;border:1px solid #2a2a3e;border-radius:20px;
          padding:5px 11px;font-size:11px;color:#9ca3af;cursor:pointer;
          display:flex;align-items:center;gap:5px;transition:border-color .15s;
          max-width:100%;overflow:hidden;}
        .aiw-pill:hover{border-color:#f59e0b;color:#f59e0b;}
        .aiw-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
        .aiw-pt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .aiw-lvls{display:flex;gap:4px;flex:1;}
        .aiw-lvl{flex:1;padding:5px 0;border-radius:6px;font-size:10px;
          font-family:'Syne',sans-serif;font-weight:700;border:1px solid #2a2a3e;
          background:transparent;color:#6b7280;cursor:pointer;transition:all .15s;}
        .aiw-lvl.on{background:#1c1007;border-color:#f59e0b;color:#f59e0b;}
        .aiw-ctxbar{display:flex;gap:16px;padding:9px 16px;background:#0a0a10;
          border-bottom:1px solid #1e1e2e;overflow-x:auto;flex-shrink:0;}
        .aiw-ctxbar::-webkit-scrollbar{display:none;}
        .aiw-stat{flex-shrink:0;}
        .aiw-stlbl{font-size:9px;color:#4b5563;letter-spacing:.06em;text-transform:uppercase;}
        .aiw-stval{font-size:12px;font-weight:700;color:#e5e7eb;margin-top:1px;}
        .aiw-msgs{flex:1;overflow-y:auto;padding:14px 14px 6px;
          display:flex;flex-direction:column;gap:10px;min-height:0;}
        .aiw-msgs::-webkit-scrollbar{width:3px;}
        .aiw-msgs::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px;}
        .aiw-empty{flex:1;display:flex;flex-direction:column;align-items:center;
          justify-content:center;gap:7px;padding:18px;}
        .aiw-ei{font-size:34px;}
        .aiw-et{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;
          color:#e5e7eb;text-align:center;}
        .aiw-es{font-size:11px;color:#6b7280;text-align:center;line-height:1.6;}
        .aiw-qg{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:6px;}
        .aiw-qb{background:#1a1a28;border:1px solid #2a2a3e;border-radius:8px;
          padding:6px 11px;font-size:11px;color:#9ca3af;cursor:pointer;
          font-family:'DM Mono',monospace;transition:all .15s;text-align:left;}
        .aiw-qb:hover{border-color:#f59e0b;color:#f59e0b;background:#1c1007;}
        .aiw-bw{display:flex;flex-direction:column;gap:2px;}
        .aiw-bw.user{align-items:flex-end;}
        .aiw-bw.assistant{align-items:flex-start;}
        .aiw-b{max-width:86%;padding:10px 13px;border-radius:14px;font-size:12px;
          line-height:1.65;white-space:pre-wrap;font-family:'DM Mono',monospace;}
        .aiw-b.user{background:linear-gradient(135deg,#f59e0b22,#ea580c22);
          border:1px solid #f59e0b44;color:#fde68a;border-bottom-right-radius:4px;}
        .aiw-b.assistant{background:#15151f;border:1px solid #1e1e2e;color:#d1d5db;
          border-bottom-left-radius:4px;}
        .aiw-b.streaming{border-color:#f59e0b55;}
        .aiw-bm{font-size:9px;color:#374151;margin:2px 4px;font-family:'DM Mono',monospace;}
        .aiw-cur{display:inline-block;width:2px;height:13px;background:#f59e0b;
          margin-left:2px;vertical-align:middle;animation:aiw-blink .7s infinite;}
        @keyframes aiw-blink{0%,100%{opacity:1}50%{opacity:0}}
        .aiw-ov{position:absolute;top:0;left:0;right:0;bottom:0;background:#0d0d14;
          z-index:10;border-radius:inherit;display:flex;flex-direction:column;}
        .aiw-ovh{padding:14px 16px;border-bottom:1px solid #1e1e2e;
          display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
        .aiw-ovt{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#f59e0b;}
        .aiw-ovl{flex:1;overflow-y:auto;padding:12px 14px;
          display:flex;flex-direction:column;gap:7px;min-height:0;}
        .aiw-ovl::-webkit-scrollbar{width:3px;}
        .aiw-ovl::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px;}
        .aiw-mi{background:#1a1a28;border:1px solid #2a2a3e;border-radius:10px;
          padding:9px 11px 9px 16px;font-size:11px;color:#9ca3af;line-height:1.5;
          position:relative;font-family:'DM Mono',monospace;}
        .aiw-mb{position:absolute;left:0;top:4px;bottom:4px;width:3px;
          background:#f59e0b;border-radius:0 2px 2px 0;}
        .aiw-cc{background:#1a1a28;border:1.5px solid #2a2a3e;border-radius:11px;
          padding:11px 13px;cursor:pointer;transition:border-color .15s;}
        .aiw-cc:hover,.aiw-cc.sel{border-color:#22c55e;}
        .aiw-cn{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#e5e7eb;}
        .aiw-cm{display:flex;gap:9px;margin-top:4px;flex-wrap:wrap;}
        .aiw-ct{font-size:10px;color:#6b7280;display:flex;align-items:center;
          gap:3px;font-family:'DM Mono',monospace;}
        .aiw-el{color:#374151;font-size:11px;padding:18px;text-align:center;
          font-family:'DM Mono',monospace;}
        .aiw-inp{padding:10px 13px 14px;border-top:1px solid #1e1e2e;
          background:#0d0d14;flex-shrink:0;}
        .aiw-ir{display:flex;gap:7px;align-items:flex-end;}
        .aiw-ta{flex:1;background:#1a1a28;border:1.5px solid #2a2a3e;border-radius:11px;
          padding:9px 13px;color:#e5e7eb;font-size:12px;font-family:'DM Mono',monospace;
          resize:none;max-height:90px;min-height:40px;line-height:1.5;
          transition:border-color .15s;outline:none;}
        .aiw-ta:focus{border-color:#f59e0b55;}
        .aiw-ta::placeholder{color:#374151;}
        .aiw-sb{width:40px;height:40px;border-radius:11px;flex-shrink:0;
          background:linear-gradient(135deg,#f59e0b,#ea580c);border:none;cursor:pointer;
          display:flex;align-items:center;justify-content:center;font-size:15px;
          color:white;transition:opacity .15s,transform .15s;}
        .aiw-sb:disabled{opacity:.4;cursor:default;}
        .aiw-sb:not(:disabled):hover{transform:scale(1.06);}
        .aiw-pw{text-align:center;font-size:9px;color:#1f2937;margin-top:5px;
          letter-spacing:.06em;font-family:'DM Mono',monospace;}
      `}</style>

      {/* FAB */}
      {!open && (
        <div className="aiw aiw-fab-wrap">
          <div style={{ position: "relative" }}>
            <button className="aiw-fab" onClick={() => setOpen(true)}>🤖</button>
            <div className="aiw-badge">AI</div>
          </div>
        </div>
      )}

      <div className={`aiw aiw-panel ${open ? "open" : ""}`}>

        {/* Memory overlay */}
        {showMemory && (
          <div className="aiw-ov">
            <div className="aiw-ovh">
              <span className="aiw-ovt">🧠 Memory Recall</span>
              <button className="aiw-x" onClick={() => setShowMemory(false)}>✕</button>
            </div>
            <div className="aiw-ovl">
              {memory.length === 0
                ? <div className="aiw-el">No memories yet. Start chatting!</div>
                : memory.map((m, i) => (
                  <div className="aiw-mi" key={i}>
                    <div className="aiw-mb" />{m}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Contact selector overlay */}
        {showContacts && (
          <div className="aiw-ov">
            <div className="aiw-ovh">
              <span className="aiw-ovt">🌱 Select Contact</span>
              <button className="aiw-x" onClick={() => setShowContacts(false)}>✕</button>
            </div>
            <div className="aiw-ovl">
              {contactsLoading
                ? <div className="aiw-el">Loading leads…</div>
                : contacts.length === 0
                ? <div className="aiw-el">No leads found.</div>
                : contacts.map((c) => (
                  <div
                    key={c.id}
                    className={`aiw-cc ${selectedContact?.id === c.id ? "sel" : ""}`}
                    onClick={() => { setSelectedContact(c); setShowContacts(false); }}
                  >
                    <div className="aiw-cn">{c.name}</div>
                    <div className="aiw-cm">
                      <span className="aiw-ct">
                        <span className="aiw-dot" style={{ background: stageDot(c.stage) }} />
                        {c.stage}
                      </span>
                      <span className="aiw-ct">💰 {c.value}</span>
                      <span className="aiw-ct">📅 {c.days}d ago</span>
                      <span className="aiw-ct">📍 {c.source}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="aiw-header">
          <div className="aiw-header-top">
            <div className="aiw-logo">AI Front Desk <span>Helper</span></div>
            <div className="aiw-hbts">
              <button className="aiw-ibt" onClick={() => setShowMemory(true)}>🧠</button>
              <button className="aiw-ibt" onClick={reset}>↺</button>
              <button className="aiw-x" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="aiw-tabs">
            {Object.entries(MODES).map(([key, val]) => (
              <button
                key={key}
                className={`aiw-tab ${mode === key ? (key === "nurture" ? "n" : "c") : ""}`}
                onClick={() => { setMode(key); reset(); }}
              >
                {val.icon} {val.label}
              </button>
            ))}
          </div>
        </div>

        {/* Context / level bar */}
        <div className="aiw-ctx">
          {mode === "nurture" ? (
            <div className="aiw-pill" onClick={() => setShowContacts(true)}>
              <span className="aiw-dot" style={{ background: stageDot(selectedContact?.stage) }} />
              <span className="aiw-pt">
                {selectedContact ? `${selectedContact.name} · ${selectedContact.stage}` : "Select a lead"} ▾
              </span>
            </div>
          ) : (
            <div className="aiw-lvls">
              {COACHING_LEVELS.map((l) => (
                <button
                  key={l}
                  className={`aiw-lvl ${coachLevel === l ? "on" : ""}`}
                  onClick={() => setCoachLevel(l)}
                >{l}</button>
              ))}
            </div>
          )}
        </div>

        {/* Live data bar — coaching mode only */}
        {mode === "coaching" && (
          <div className="aiw-ctxbar">
            {contextLoading ? (
              <div className="aiw-stlbl" style={{ alignSelf: "center" }}>Loading context…</div>
            ) : (
              <>
                {monthGoal > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stlbl">{MONTH_NAME} Goal</div>
                    <div className="aiw-stval">${monthGoal.toLocaleString()}</div>
                  </div>
                )}
                {monthActual > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stlbl">Actual</div>
                    <div className="aiw-stval" style={{ color: monthActual >= monthGoal ? "#22c55e" : "#ef4444" }}>
                      ${monthActual.toLocaleString()}
                    </div>
                  </div>
                )}
                {bookingRate > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stlbl">Booking Rate</div>
                    <div className="aiw-stval">{bookingRate}%</div>
                  </div>
                )}
                {closeRate > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stlbl">Close Rate</div>
                    <div className="aiw-stval">{closeRate}%</div>
                  </div>
                )}
                {openLeads > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stlbl">Open Leads</div>
                    <div className="aiw-stval">{openLeads}</div>
                  </div>
                )}
                {!monthGoal && !bookingRate && !closeRate && (
                  <div className="aiw-stlbl" style={{ alignSelf: "center" }}>No data yet</div>
                )}
              </>
            )}
          </div>
        )}

        {/* Messages */}
        <div className="aiw-msgs">
          {messages.length === 0 && !streamText ? (
            <div className="aiw-empty">
              <div className="aiw-ei">{MODES[mode].icon}</div>
              <div className="aiw-et">
                {mode === "nurture"
                  ? selectedContact ? `Nurturing ${selectedContact.name}` : "Select a lead to start"
                  : `${coachLevel} Revenue Coach`}
              </div>
              <div className="aiw-es">
                {mode === "nurture"
                  ? "AI-powered outreach for your pipeline.\nPick a quick action or type anything."
                  : "Answers powered by your live goals,\nactuals, and pipeline data."}
              </div>
              <div className="aiw-qg">
                {(mode === "nurture" ? NURTURE_QUICK : COACHING_QUICK).map((a) => (
                  <button key={a} className="aiw-qb" onClick={() => send(a)}>{a}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div key={i} className={`aiw-bw ${m.role}`}>
                  <div className={`aiw-b ${m.role}`}>{m.content}</div>
                  <div className="aiw-bm">{m.role === "user" ? "You" : "AI Coach"}</div>
                </div>
              ))}
              {streamText && (
                <div className="aiw-bw assistant">
                  <div className="aiw-b assistant streaming">
                    {streamText}<span className="aiw-cur" />
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="aiw-inp">
          <div className="aiw-ir">
            <textarea
              ref={inputRef}
              className="aiw-ta"
              placeholder={mode === "nurture" ? "Ask to draft a message…" : "Ask about your business…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              rows={1}
            />
            <button className="aiw-sb" onClick={() => send()} disabled={loading || !input.trim()}>
              {loading ? "⏳" : "↑"}
            </button>
          </div>
          <div className="aiw-pw">POWERED BY AI FRONT DESK HELPER</div>
        </div>
      </div>
    </>
  );
}

import { useState, useRef, useEffect, useCallback } from "react";
import { getMetrics, getLeadsByTenant, api } from "../api";

// ── Constants ──────────────────────────────────────────────────────────────
const MODES = {
  nurture:  { label: "Nurture",  icon: "🌱" },
  coaching: { label: "Coach",    icon: "🏆" },
  history:  { label: "History",  icon: "📋" },
};

const COACHING_LEVELS = ["Starter", "Growth", "Franchise"];

const NURTURE_QUICK = [
  "Draft follow-up text",
  "Re-engage cold lead",
  "Pre-appointment reminder",
  "Post-job thank you + referral ask",
];

const COACHING_QUICK = [
  "🔥 What's killing my revenue right now?",
  "📞 Analyze my call & booking performance",
  "💰 How do I close more estimates?",
  "👥 Build my team accountability system",
  "📈 Fastest path to hit my annual goal",
  "🚨 Where is my biggest revenue leak?",
  "📋 Give me a morning huddle script",
  "🎯 What should my team focus on this week?",
];

const MONTH_NAME = new Date().toLocaleString("default", { month: "long" });
const YEAR       = new Date().getFullYear();
const NOW_MONTH  = new Date().getMonth();

// ── History helpers ────────────────────────────────────────────────────────
function getHistoryKey(tenantId) { return `aicoach_history_${tenantId}`; }

function loadHistory(tenantId) {
  try { return JSON.parse(localStorage.getItem(getHistoryKey(tenantId)) || "[]"); }
  catch { return []; }
}

function saveSession(tenantId, session) {
  try {
    const all = loadHistory(tenantId);
    const idx = all.findIndex((s) => s.id === session.id);
    const updated = idx >= 0
      ? all.map((s, i) => (i === idx ? session : s))
      : [session, ...all];
    localStorage.setItem(getHistoryKey(tenantId), JSON.stringify(updated.slice(0, 20)));
  } catch {}
}

// ── Nurture system prompt ──────────────────────────────────────────────────
function buildNurturePrompt(contact, memory) {
  const memCtx = memory.length
    ? `\n\nSession memory:\n${memory.map((m) => `- ${m}`).join("\n")}`
    : "";
  return `You are an AI contact nurturing specialist for home service contractors inside AI Front Desk Helper.
${contact ? `\nActive contact: ${contact.name} | Stage: ${contact.stage} | Est. Value: ${contact.value} | Days since contact: ${contact.days} | Lead source: ${contact.source}` : ""}
Write specific, human, conversion-focused outreach (texts, emails, or voicemail scripts). Short, warm, action-oriented. Reference the contact's stage and source. Never robotic. Always include a clear next step.${memCtx}`;
}

// ── Typewriter helper — simulates streaming for non-streaming responses ────
async function typewrite(text, onChunk, delayMs = 8) {
  let current = "";
  for (const char of text) {
    current += char;
    onChunk(current);
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return text;
}

// ── Coaching call — uses existing /api/coaching/chat (rich DB context) ─────
async function callCoach(message, history, tenantId, onChunk) {
  const token = localStorage.getItem("token");
  const res = await fetch(
    `/api/coaching/chat?tenant_id=${tenantId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        message,
        conversation_history: history.map((m) => ({ role: m.role, content: m.content })),
      }),
    }
  );
  if (!res.ok) throw new Error(`Coach error: ${res.status}`);
  const data = await res.json();
  const reply = data.reply || "No response received.";
  // Typewrite the reply for a streaming-like feel
  await typewrite(reply, onChunk, 6);
  return reply;
}

// ── Nurture call — uses /api/ai-coach (true streaming) ────────────────────
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
  if (!res.ok) throw new Error(`AI service error: ${res.status}`);

  const reader  = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    for (const line of chunk.split("\n").filter((l) => l.startsWith("data: "))) {
      const data = line.slice(6).trim();
      if (data === "[DONE]") break;
      try {
        const text = JSON.parse(data).choices?.[0]?.delta?.content;
        if (text) { full += text; onChunk(full); }
      } catch {}
    }
  }
  return full;
}

// ── Main Widget ────────────────────────────────────────────────────────────
export default function AICoachWidget({ tenantId }) {
  const [open, setOpen]             = useState(false);
  const [mode, setMode]             = useState("nurture");
  const [coachLevel, setCoachLevel] = useState("Growth");

  // Nurture
  const [contacts, setContacts]               = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [showContacts, setShowContacts]       = useState(false);

  // Metrics for data bar (lightweight)
  const [metrics, setMetrics]           = useState(null);
  const [metricsLoading, setMetricsLoading] = useState(false);

  // Goals for data bar
  const [goals, setGoals]     = useState(null);

  // Chat
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState("");
  const [loading, setLoading]       = useState(false);
  const [streamText, setStreamText] = useState("");
  const [memory, setMemory]         = useState([]);
  const [sessionId]                 = useState(() => `session_${Date.now()}`);

  // History
  const [history, setHistory]               = useState([]);
  const [selectedSession, setSelectedSession] = useState(null);

  // UI
  const [showMemory, setShowMemory] = useState(false);

  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // ── Load history ─────────────────────────────────────────────────────
  useEffect(() => {
    if (tenantId) setHistory(loadHistory(tenantId));
  }, [tenantId]);

  // ── Fetch leads for Nurture ──────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || tenantId === "all") return;
    setContactsLoading(true);
    getLeadsByTenant(tenantId, 20, 0)
      .then((data) => {
        const rows = Array.isArray(data) ? data : (data.leads || []);
        const mapped = rows.map((l) => {
          const ref  = l.last_contact_at || l.created_at;
          const days = ref ? Math.floor((Date.now() - new Date(ref)) / 86400000) : 0;
          const cents = l.estimated_revenue_cents || l.estimate_value_cents || 0;
          return {
            id:     l.id,
            name:   l.name || l.contact_name || "Unknown",
            stage:  l.status || "new_lead",
            value:  cents ? `$${(cents / 100).toLocaleString()}` : "N/A",
            days,
            source: l.lead_source || "Unknown",
          };
        });
        setContacts(mapped);
        if (mapped.length > 0) setSelectedContact(mapped[0]);
      })
      .catch(() => {})
      .finally(() => setContactsLoading(false));
  }, [tenantId]);

  // ── Fetch metrics + goals for data bar when coaching mode opens ───────
  useEffect(() => {
    if (!tenantId || tenantId === "all" || mode !== "coaching") return;
    setMetricsLoading(true);
    Promise.all([
      getMetrics(tenantId, "30d").catch(() => null),
      api(`/api/coaching/annual?year=${YEAR}&tenant_id=${tenantId}`).catch(() => null),
    ]).then(([m, g]) => {
      setMetrics(m);
      setGoals(g);
    }).finally(() => setMetricsLoading(false));
  }, [tenantId, mode]);

  // ── Auto-save session ────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || messages.length < 2) return;
    saveSession(tenantId, {
      id:        sessionId,
      date:      new Date().toLocaleDateString(),
      timestamp: Date.now(),
      mode,
      level:     coachLevel,
      preview:   messages.find((m) => m.role === "user")?.content?.slice(0, 80) || "",
      messages,
    });
    setHistory(loadHistory(tenantId));
  }, [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const reset = () => { setMessages([]); setStreamText(""); setSelectedSession(null); };

  // ── Send ──────────────────────────────────────────────────────────────
  const send = useCallback(async (text) => {
    const userText = text || input.trim();
    if (!userText || loading) return;
    setInput("");
    setLoading(true);
    setStreamText("");

    const userMsg     = { role: "user", content: userText };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);

    try {
      let full = "";

      if (mode === "coaching") {
        // Use the existing coaching endpoint — it has full DB context
        full = await callCoach(
          userText,
          messages, // conversation history (excludes latest user msg — coaching.js appends it)
          tenantId,
          (partial) => setStreamText(partial)
        );
      } else {
        // Nurture mode — use streaming AI with contact context
        full = await callAI(
          newMessages.map((m) => ({ role: m.role, content: m.content })),
          buildNurturePrompt(selectedContact, memory),
          (partial) => setStreamText(partial)
        );
      }

      setStreamText("");
      setMessages((prev) => [...prev, { role: "assistant", content: full }]);
      setMemory((prev) => [
        `[${mode}/${coachLevel}] ${full.slice(0, 120).replace(/\n/g, " ")}…`,
        ...prev.slice(0, 9),
      ]);
    } catch (err) {
      console.error("[AICoachWidget] send error:", err);
      setStreamText("");
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "⚠️ Connection error. Please try again." },
      ]);
    }
    setLoading(false);
  }, [input, loading, messages, mode, coachLevel, selectedContact, tenantId, memory]);

  // ── Data bar values ───────────────────────────────────────────────────
  const monthRow    = goals?.months?.find((m) => m.month === NOW_MONTH);
  const monthGoal   = monthRow ? Math.round((monthRow.revenue_goal   || 0) / 100) : 0;
  const monthActual = monthRow ? Math.round((monthRow.actual_revenue || 0) / 100) : 0;
  const bookingRate = metrics?.totals?.booking_rate    || 0;
  const closeRate   = metrics?.sales?.close_rate       || 0;
  const openLeads   = metrics?.pipeline?.open_estimates || 0;

  const stageDot = (s) =>
    s === "booked" ? "#22c55e" : s === "estimate_sent" ? "#f59e0b" : "#6b7280";

  // ─────────────────────────────────────────────────────────────────────
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');
        .aiw *{box-sizing:border-box;margin:0;padding:0;}
        .aiw-fab-wrap{position:fixed;bottom:24px;right:20px;z-index:9999;}
        .aiw-fab{width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#f59e0b,#ea580c);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:24px;animation:aiw-pulse 2.5s infinite;transition:transform .2s;}
        .aiw-fab:hover{transform:scale(1.08);}
        @keyframes aiw-pulse{0%,100%{box-shadow:0 0 0 0 rgba(245,158,11,.4)}50%{box-shadow:0 0 0 14px rgba(245,158,11,0)}}
        .aiw-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:10px;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-family:'Syne',sans-serif;font-weight:700;}
        .aiw-panel{position:fixed;bottom:0;right:0;width:100vw;height:100dvh;background:#0d0d14;display:flex;flex-direction:column;border-top:2px solid #f59e0b;transform:translateY(100%);transition:transform .35s cubic-bezier(.16,1,.3,1);z-index:9998;font-family:'DM Mono',monospace;}
        @media(min-width:520px){.aiw-panel{bottom:24px;right:20px;width:440px;height:720px;border-radius:20px;border:1.5px solid #1e1e2e;border-top:2px solid #f59e0b;}}
        .aiw-panel.open{transform:translateY(0);}
        .aiw-hdr{padding:13px 15px 10px;border-bottom:1px solid #1e1e2e;display:flex;flex-direction:column;gap:8px;background:#0d0d14;flex-shrink:0;}
        .aiw-hdr-top{display:flex;align-items:center;justify-content:space-between;}
        .aiw-logo{font-family:'Syne',sans-serif;font-size:12px;font-weight:800;color:#f59e0b;letter-spacing:.05em;text-transform:uppercase;}
        .aiw-logo span{color:#4b5563;font-weight:600;}
        .aiw-hbtns{display:flex;gap:5px;align-items:center;}
        .aiw-ibt{background:#1a1a28;border:1px solid #2a2a3e;border-radius:7px;width:28px;height:28px;display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:#9ca3af;transition:border-color .15s,color .15s;}
        .aiw-ibt:hover{border-color:#f59e0b;color:#f59e0b;}
        .aiw-x{background:none;border:none;cursor:pointer;color:#6b7280;font-size:18px;padding:2px;}
        .aiw-tabs{display:flex;gap:4px;}
        .aiw-tab{flex:1;padding:6px 0;border-radius:7px;font-family:'Syne',sans-serif;font-size:11px;font-weight:700;border:1.5px solid #1e1e2e;background:transparent;color:#6b7280;cursor:pointer;transition:all .15s;letter-spacing:.02em;}
        .aiw-tab.tn{background:#052e16;border-color:#22c55e;color:#22c55e;}
        .aiw-tab.tc{background:#1c1007;border-color:#f59e0b;color:#f59e0b;}
        .aiw-tab.th{background:#0a0a1f;border-color:#6366f1;color:#818cf8;}
        .aiw-ctx{display:flex;align-items:center;gap:6px;padding:8px 15px;background:#0a0a10;border-bottom:1px solid #1e1e2e;flex-shrink:0;}
        .aiw-pill{background:#1a1a28;border:1px solid #2a2a3e;border-radius:20px;padding:4px 10px;font-size:11px;color:#9ca3af;cursor:pointer;display:flex;align-items:center;gap:4px;transition:border-color .15s;max-width:100%;overflow:hidden;}
        .aiw-pill:hover{border-color:#f59e0b;color:#f59e0b;}
        .aiw-dot{width:6px;height:6px;border-radius:50%;flex-shrink:0;}
        .aiw-pt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
        .aiw-lvls{display:flex;gap:3px;flex:1;}
        .aiw-lvl{flex:1;padding:4px 0;border-radius:6px;font-size:10px;font-family:'Syne',sans-serif;font-weight:700;border:1px solid #2a2a3e;background:transparent;color:#6b7280;cursor:pointer;transition:all .15s;}
        .aiw-lvl.on{background:#1c1007;border-color:#f59e0b;color:#f59e0b;}
        .aiw-databar{display:flex;gap:14px;padding:8px 15px;background:#08080f;border-bottom:1px solid #1e1e2e;overflow-x:auto;flex-shrink:0;}
        .aiw-databar::-webkit-scrollbar{display:none;}
        .aiw-stat{flex-shrink:0;}
        .aiw-stl{font-size:8px;color:#374151;letter-spacing:.07em;text-transform:uppercase;}
        .aiw-stv{font-size:12px;font-weight:700;color:#e5e7eb;margin-top:1px;}
        .aiw-stv.warn{color:#ef4444;}
        .aiw-stv.good{color:#22c55e;}
        .aiw-msgs{flex:1;overflow-y:auto;padding:12px 13px 6px;display:flex;flex-direction:column;gap:9px;min-height:0;}
        .aiw-msgs::-webkit-scrollbar{width:2px;}
        .aiw-msgs::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px;}
        .aiw-empty{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:16px;}
        .aiw-ei{font-size:32px;}
        .aiw-et{font-family:'Syne',sans-serif;font-size:14px;font-weight:700;color:#e5e7eb;text-align:center;}
        .aiw-es{font-size:11px;color:#6b7280;text-align:center;line-height:1.6;}
        .aiw-qg{display:flex;flex-wrap:wrap;gap:5px;justify-content:center;margin-top:8px;}
        .aiw-qb{background:#1a1a28;border:1px solid #2a2a3e;border-radius:8px;padding:6px 10px;font-size:11px;color:#9ca3af;cursor:pointer;font-family:'DM Mono',monospace;transition:all .15s;text-align:left;}
        .aiw-qb:hover{border-color:#f59e0b;color:#f59e0b;background:#1c1007;}
        .aiw-bw{display:flex;flex-direction:column;gap:2px;}
        .aiw-bw.user{align-items:flex-end;}
        .aiw-bw.assistant{align-items:flex-start;}
        .aiw-b{max-width:88%;padding:9px 12px;border-radius:13px;font-size:12px;line-height:1.65;white-space:pre-wrap;font-family:'DM Mono',monospace;}
        .aiw-b.user{background:linear-gradient(135deg,#f59e0b22,#ea580c22);border:1px solid #f59e0b44;color:#fde68a;border-bottom-right-radius:4px;}
        .aiw-b.assistant{background:#15151f;border:1px solid #1e1e2e;color:#d1d5db;border-bottom-left-radius:4px;}
        .aiw-b.streaming{border-color:#f59e0b55;}
        .aiw-bm{font-size:9px;color:#374151;margin:2px 4px;font-family:'DM Mono',monospace;}
        .aiw-cur{display:inline-block;width:2px;height:12px;background:#f59e0b;margin-left:2px;vertical-align:middle;animation:aiw-blink .7s infinite;}
        @keyframes aiw-blink{0%,100%{opacity:1}50%{opacity:0}}
        .aiw-ov{position:absolute;top:0;left:0;right:0;bottom:0;background:#0d0d14;z-index:10;border-radius:inherit;display:flex;flex-direction:column;}
        .aiw-ovh{padding:13px 15px;border-bottom:1px solid #1e1e2e;display:flex;align-items:center;justify-content:space-between;flex-shrink:0;}
        .aiw-ovt{font-family:'Syne',sans-serif;font-size:13px;font-weight:700;color:#f59e0b;}
        .aiw-ovl{flex:1;overflow-y:auto;padding:11px 13px;display:flex;flex-direction:column;gap:7px;min-height:0;}
        .aiw-ovl::-webkit-scrollbar{width:2px;}
        .aiw-ovl::-webkit-scrollbar-thumb{background:#2a2a3e;border-radius:2px;}
        .aiw-mi{background:#1a1a28;border:1px solid #2a2a3e;border-radius:9px;padding:8px 10px 8px 14px;font-size:11px;color:#9ca3af;line-height:1.5;position:relative;font-family:'DM Mono',monospace;}
        .aiw-mb{position:absolute;left:0;top:4px;bottom:4px;width:3px;background:#f59e0b;border-radius:0 2px 2px 0;}
        .aiw-cc{background:#1a1a28;border:1.5px solid #2a2a3e;border-radius:10px;padding:10px 12px;cursor:pointer;transition:border-color .15s;}
        .aiw-cc:hover,.aiw-cc.sel{border-color:#22c55e;}
        .aiw-cn{font-family:'Syne',sans-serif;font-size:12px;font-weight:700;color:#e5e7eb;}
        .aiw-cm{display:flex;gap:8px;margin-top:4px;flex-wrap:wrap;}
        .aiw-ct{font-size:10px;color:#6b7280;display:flex;align-items:center;gap:3px;font-family:'DM Mono',monospace;}
        .aiw-el{color:#374151;font-size:11px;padding:16px;text-align:center;font-family:'DM Mono',monospace;}
        .aiw-hiscard{background:#1a1a28;border:1.5px solid #2a2a3e;border-radius:10px;padding:10px 12px;cursor:pointer;transition:border-color .15s;}
        .aiw-hiscard:hover{border-color:#6366f1;}
        .aiw-hisdate{font-size:9px;color:#4b5563;font-family:'DM Mono',monospace;letter-spacing:.05em;}
        .aiw-hisprev{font-size:11px;color:#9ca3af;margin-top:3px;line-height:1.4;font-family:'DM Mono',monospace;}
        .aiw-hisbadge{display:inline-flex;align-items:center;gap:4px;margin-top:5px;font-size:9px;font-family:'Syne',sans-serif;font-weight:700;padding:2px 7px;border-radius:20px;background:#1c1007;color:#f59e0b;border:1px solid #2a2a3e;}
        .aiw-inp{padding:9px 12px 13px;border-top:1px solid #1e1e2e;background:#0d0d14;flex-shrink:0;}
        .aiw-ir{display:flex;gap:6px;align-items:flex-end;}
        .aiw-ta{flex:1;background:#1a1a28;border:1.5px solid #2a2a3e;border-radius:10px;padding:8px 12px;color:#e5e7eb;font-size:12px;font-family:'DM Mono',monospace;resize:none;max-height:90px;min-height:38px;line-height:1.5;transition:border-color .15s;outline:none;}
        .aiw-ta:focus{border-color:#f59e0b55;}
        .aiw-ta::placeholder{color:#374151;}
        .aiw-sb{width:38px;height:38px;border-radius:10px;flex-shrink:0;background:linear-gradient(135deg,#f59e0b,#ea580c);border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;color:white;transition:opacity .15s,transform .15s;}
        .aiw-sb:disabled{opacity:.4;cursor:default;}
        .aiw-sb:not(:disabled):hover{transform:scale(1.07);}
        .aiw-pw{text-align:center;font-size:9px;color:#1f2937;margin-top:4px;letter-spacing:.06em;font-family:'DM Mono',monospace;}
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
              <span className="aiw-ovt">🧠 Session Memory</span>
              <button className="aiw-x" onClick={() => setShowMemory(false)}>✕</button>
            </div>
            <div className="aiw-ovl">
              {memory.length === 0
                ? <div className="aiw-el">No memory yet. Start a coaching session.</div>
                : memory.map((m, i) => (
                  <div className="aiw-mi" key={i}><div className="aiw-mb" />{m}</div>
                ))}
            </div>
          </div>
        )}

        {/* Contact selector */}
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
                      <span className="aiw-ct"><span className="aiw-dot" style={{ background: stageDot(c.stage) }} />{c.stage}</span>
                      <span className="aiw-ct">💰 {c.value}</span>
                      <span className="aiw-ct">📅 {c.days}d ago</span>
                      <span className="aiw-ct">📍 {c.source}</span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* History session viewer */}
        {selectedSession && (
          <div className="aiw-ov">
            <div className="aiw-ovh">
              <span className="aiw-ovt">📋 {selectedSession.date} · {selectedSession.level}</span>
              <button className="aiw-x" onClick={() => setSelectedSession(null)}>✕</button>
            </div>
            <div className="aiw-ovl">
              {selectedSession.messages.map((m, i) => (
                <div key={i} className={`aiw-bw ${m.role}`}>
                  <div className={`aiw-b ${m.role}`}>{m.content}</div>
                  <div className="aiw-bm">{m.role === "user" ? "You" : "Alex · AI Coach"}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Header */}
        <div className="aiw-hdr">
          <div className="aiw-hdr-top">
            <div className="aiw-logo">AI Front Desk <span>Helper</span></div>
            <div className="aiw-hbtns">
              <button className="aiw-ibt" title="Session memory" onClick={() => setShowMemory(true)}>🧠</button>
              <button className="aiw-ibt" title="New conversation" onClick={reset}>↺</button>
              <button className="aiw-x" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="aiw-tabs">
            {Object.entries(MODES).map(([key, val]) => (
              <button
                key={key}
                className={`aiw-tab ${mode === key ? (key === "nurture" ? "tn" : key === "coaching" ? "tc" : "th") : ""}`}
                onClick={() => { setMode(key); if (key !== "history") reset(); }}
              >
                {val.icon} {val.label}
                {key === "history" && history.length > 0 && (
                  <span style={{ marginLeft: 3, fontSize: 9, background: "#6366f133", color: "#818cf8", padding: "1px 5px", borderRadius: 10 }}>
                    {history.length}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Context / level bar */}
        {mode !== "history" && (
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
                  <button key={l} className={`aiw-lvl ${coachLevel === l ? "on" : ""}`} onClick={() => setCoachLevel(l)}>{l}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Live data bar — coaching only */}
        {mode === "coaching" && (
          <div className="aiw-databar">
            {metricsLoading ? (
              <div className="aiw-stl" style={{ alignSelf: "center" }}>Loading intel…</div>
            ) : (
              <>
                {monthGoal > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">{MONTH_NAME} Goal</div>
                    <div className="aiw-stv">${monthGoal.toLocaleString()}</div>
                  </div>
                )}
                {monthGoal > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Actual</div>
                    <div className={`aiw-stv ${monthActual >= monthGoal ? "good" : monthActual < monthGoal * 0.7 ? "warn" : ""}`}>
                      ${monthActual.toLocaleString()}
                    </div>
                  </div>
                )}
                {bookingRate > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Booking %</div>
                    <div className={`aiw-stv ${bookingRate >= 50 ? "good" : bookingRate < 35 ? "warn" : ""}`}>{bookingRate}%</div>
                  </div>
                )}
                {closeRate > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Close %</div>
                    <div className={`aiw-stv ${closeRate >= 50 ? "good" : closeRate < 35 ? "warn" : ""}`}>{closeRate}%</div>
                  </div>
                )}
                {openLeads > 0 && (
                  <div className="aiw-stat">
                    <div className="aiw-stl">Open Est.</div>
                    <div className="aiw-stv">{openLeads}</div>
                  </div>
                )}
                {!monthGoal && !bookingRate && !closeRate && (
                  <div className="aiw-stl" style={{ alignSelf: "center" }}>Set goals in Metrics to unlock full coaching</div>
                )}
              </>
            )}
          </div>
        )}

        {/* History tab */}
        {mode === "history" ? (
          <div className="aiw-msgs">
            {history.length === 0 ? (
              <div className="aiw-empty">
                <div className="aiw-ei">📋</div>
                <div className="aiw-et">No sessions yet</div>
                <div className="aiw-es">Your coaching sessions save here automatically.</div>
              </div>
            ) : (
              history.map((session) => (
                <div key={session.id} className="aiw-hiscard" onClick={() => setSelectedSession(session)}>
                  <div className="aiw-hisdate">{session.date} · {session.messages.length} messages</div>
                  <div className="aiw-hisprev">{session.preview || "Session started"}</div>
                  <div>
                    <span className="aiw-hisbadge">
                      {session.mode === "nurture" ? "🌱" : "🏆"} {session.mode}{session.level ? ` · ${session.level}` : ""}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          /* Chat */
          <div className="aiw-msgs">
            {messages.length === 0 && !streamText ? (
              <div className="aiw-empty">
                <div className="aiw-ei">{MODES[mode].icon}</div>
                <div className="aiw-et">
                  {mode === "nurture"
                    ? selectedContact ? `Nurturing ${selectedContact.name}` : "Select a lead to start"
                    : "Alex · Your Revenue Coach"}
                </div>
                <div className="aiw-es">
                  {mode === "nurture"
                    ? "AI-powered outreach for your pipeline."
                    : "Direct, data-driven coaching powered by\nyour live goals, pipeline & team activity."}
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
                    <div className="aiw-bm">{m.role === "user" ? "You" : mode === "coaching" ? "Alex · AI Coach" : "AI"}</div>
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
        )}

        {/* Input */}
        {mode !== "history" && (
          <div className="aiw-inp">
            <div className="aiw-ir">
              <textarea
                ref={inputRef}
                className="aiw-ta"
                placeholder={mode === "nurture" ? "Draft a message for this lead…" : "Ask Alex anything…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                rows={1}
              />
              <button className="aiw-sb" onClick={() => send()} disabled={loading || !input.trim()}>
                {loading ? "⏳" : "↑"}
              </button>
            </div>
            <div className="aiw-pw">POWERED BY AI FRONT DESK HELPER · GPT-4o</div>
          </div>
        )}
      </div>
    </>
  );
}

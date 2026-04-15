import { useState, useRef, useEffect, useCallback } from "react";
import { getLeadsByTenant } from "../api";

// ── Palette & constants ────────────────────────────────────────────────────
const MODES = {
  nurture: { label: "Nurture", icon: "🌱", color: "#22c55e" },
  coaching: { label: "Coaching", icon: "🏆", color: "#f59e0b" },
};

const COACHING_LEVELS = ["Starter", "Growth", "Franchise"];

const QUICK_ACTIONS = {
  nurture: ["Draft follow-up", "Re-engage cold lead", "Pre-appt reminder", "Post-job thank you"],
  coaching: ["Speed-to-lead tips", "Close rate by source", "Franchise expansion", "Revenue recovery"],
};

// ── System prompts ─────────────────────────────────────────────────────────
function buildSystemPrompt(mode, level, contact, memory) {
  const memCtx = memory.length
    ? `\n\nPrevious session context:\n${memory.map((m) => `- ${m}`).join("\n")}`
    : "";

  if (mode === "nurture") {
    return `You are an AI contact nurturing specialist for ${contact ? contact.name : "home service leads"}, embedded inside AI Front Desk Helper — a SaaS platform for painting contractors and franchise businesses.
${contact ? `\nActive contact: ${contact.name} | Stage: ${contact.stage} | Est. Value: ${contact.value} | Days since contact: ${contact.days} | Source: ${contact.source}` : ""}
Your job: craft specific, human, conversion-focused outreach messages (texts, emails, or voicemail scripts). Keep messages short, warm, and action-oriented. Reference the contact's stage and source. Never sound robotic. Always suggest a clear next step.${memCtx}`;
  }
  return `You are an elite business coach for home service contractors and franchise operators, embedded inside AI Front Desk Helper. The user is at the ${level} tier.

Coaching philosophy by tier:
- Starter: Focus on speed-to-lead (answer within 5 min), booking rate basics, first AI automation wins.
- Growth: Focus on close rate by lead source, estimate recovery sequences, team KPI visibility.
- Franchise: Focus on HQ rollup dashboards, multi-location benchmarking, white-label positioning, SOC 2 readiness.

Be direct, data-driven, and specific to painting/home services. Reference real metrics when relevant (e.g., industry avg close rate 35–50%). Always end with one concrete action the owner can take today.${memCtx}`;
}

// ── API call ───────────────────────────────────────────────────────────────
async function callClaude(messages, systemPrompt, onChunk) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value);
    const lines = chunk.split("\n").filter((l) => l.startsWith("data: "));
    for (const line of lines) {
      try {
        const json = JSON.parse(line.slice(6));
        if (json.type === "content_block_delta" && json.delta?.text) {
          full += json.delta.text;
          onChunk(full);
        }
      } catch {}
    }
  }
  return full;
}

// ── Main Widget ────────────────────────────────────────────────────────────
export default function AICoachWidget({ tenantId }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("nurture");
  const [coachLevel, setCoachLevel] = useState("Growth");
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [selectedContact, setSelectedContact] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [memory, setMemory] = useState([
    "Owner focuses on Google Organic + Yelp lead sources",
    "Gladiators Painting uses AI Front Desk Helper Elite plan",
    "Close rate goal: improve from 42% → 55% by Q3",
  ]);
  const [showMemory, setShowMemory] = useState(false);
  const [showContacts, setShowContacts] = useState(false);
  const [streamText, setStreamText] = useState("");
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // ── Fetch real leads ───────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || tenantId === "all") return;
    setContactsLoading(true);
    getLeadsByTenant(tenantId, 20, 0)
      .then((data) => {
        const rows = Array.isArray(data) ? data : (data.leads || []);
        const mapped = rows.map((l) => {
          const ref = l.last_contact_at || l.created_at;
          const days = ref
            ? Math.floor((Date.now() - new Date(ref)) / 86400000)
            : 0;
          const cents =
            l.estimated_revenue_cents || l.estimate_value_cents || 0;
          return {
            id: l.id,
            name: l.name || l.contact_name || "Unknown",
            stage: l.status || "New Lead",
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

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamText]);

  const send = useCallback(
    async (text) => {
      const userText = text || input.trim();
      if (!userText || loading) return;
      setInput("");
      setLoading(true);
      setStreamText("");

      const userMsg = { role: "user", content: userText };
      const newMessages = [...messages, userMsg];
      setMessages(newMessages);

      const systemPrompt = buildSystemPrompt(
        mode,
        coachLevel,
        mode === "nurture" ? selectedContact : null,
        memory
      );

      try {
        const full = await callClaude(
          newMessages.map((m) => ({ role: m.role, content: m.content })),
          systemPrompt,
          (partial) => setStreamText(partial)
        );
        setStreamText("");
        setMessages((prev) => [...prev, { role: "assistant", content: full }]);
        const insight = full.slice(0, 120).replace(/\n/g, " ");
        setMemory((prev) => [`[${mode}] ${insight}…`, ...prev.slice(0, 7)]);
      } catch (e) {
        setStreamText("");
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "⚠️ Connection error. Please try again." },
        ]);
      }
      setLoading(false);
    },
    [input, loading, messages, mode, coachLevel, selectedContact, memory]
  );

  const reset = () => {
    setMessages([]);
    setStreamText("");
  };

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
          box-shadow: 0 0 0 0 rgba(245,158,11,0.4);
          animation: aiw-pulse 2.5s infinite;
          transition: transform .2s;
        }
        .aiw-fab:hover { transform: scale(1.08); }
        @keyframes aiw-pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,.4); }
          50% { box-shadow: 0 0 0 14px rgba(245,158,11,0); }
        }
        .aiw-badge {
          position: absolute; top: -4px; right: -4px;
          background: #ef4444; color: #fff; font-size: 10px;
          width: 18px; height: 18px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Syne', sans-serif; font-weight: 700;
        }

        .aiw-panel {
          position: fixed; bottom: 0; right: 0;
          width: 100vw; height: 100dvh;
          background: #0d0d14;
          display: flex; flex-direction: column;
          border-top: 2px solid #f59e0b;
          transform: translateY(100%);
          transition: transform .35s cubic-bezier(.16,1,.3,1);
          z-index: 9998;
          font-family: 'DM Mono', monospace;
        }
        @media(min-width:520px) {
          .aiw-panel {
            bottom: 24px; right: 20px;
            width: 400px; height: 680px;
            border-radius: 20px;
            border: 1.5px solid #1e1e2e;
            border-top: 2px solid #f59e0b;
          }
        }
        .aiw-panel.open { transform: translateY(0); }

        .aiw-header {
          padding: 16px 18px 12px;
          border-bottom: 1px solid #1e1e2e;
          display: flex; flex-direction: column; gap: 10px;
          background: #0d0d14; flex-shrink: 0;
        }
        .aiw-header-top { display: flex; align-items: center; justify-content: space-between; }
        .aiw-logo { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 800;
          color: #f59e0b; letter-spacing: .04em; text-transform: uppercase; }
        .aiw-logo span { color: #6b7280; font-weight: 600; }
        .aiw-hactions { display: flex; gap: 8px; align-items: center; }
        .aiw-icon-btn {
          background: #1a1a28; border: 1px solid #2a2a3e; border-radius: 8px;
          width: 32px; height: 32px; display: flex; align-items: center;
          justify-content: center; cursor: pointer; font-size: 14px;
          color: #9ca3af; transition: border-color .15s, color .15s;
        }
        .aiw-icon-btn:hover { border-color: #f59e0b; color: #f59e0b; }
        .aiw-close { background: none; border: none; cursor: pointer;
          color: #6b7280; font-size: 20px; line-height: 1; padding: 4px; }

        .aiw-mode-tabs { display: flex; gap: 6px; }
        .aiw-mode-tab {
          flex: 1; padding: 7px 0; border-radius: 8px;
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          border: 1.5px solid #1e1e2e; background: transparent;
          color: #6b7280; cursor: pointer;
          transition: all .15s; letter-spacing: .03em;
        }
        .aiw-mode-tab.active-nurture { background: #052e16; border-color: #22c55e; color: #22c55e; }
        .aiw-mode-tab.active-coaching { background: #1c1007; border-color: #f59e0b; color: #f59e0b; }

        .aiw-ctx {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 18px; background: #0a0a10;
          border-bottom: 1px solid #1e1e2e; flex-shrink: 0;
        }
        .aiw-pill {
          background: #1a1a28; border: 1px solid #2a2a3e;
          border-radius: 20px; padding: 5px 12px;
          font-size: 11px; color: #9ca3af; cursor: pointer;
          display: flex; align-items: center; gap: 5px;
          transition: border-color .15s; font-family: 'DM Mono', monospace;
          max-width: 100%; overflow: hidden;
        }
        .aiw-pill:hover { border-color: #f59e0b; color: #f59e0b; }
        .aiw-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
        .aiw-pill-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

        .aiw-lvl-tabs { display: flex; gap: 4px; flex: 1; }
        .aiw-lvl-tab {
          flex: 1; padding: 5px 0; border-radius: 6px; font-size: 10px;
          font-family: 'Syne', sans-serif; font-weight: 700; border: 1px solid #2a2a3e;
          background: transparent; color: #6b7280; cursor: pointer; transition: all .15s;
        }
        .aiw-lvl-tab.active { background: #1c1007; border-color: #f59e0b; color: #f59e0b; }

        .aiw-messages {
          flex: 1; overflow-y: auto; padding: 16px 16px 8px;
          display: flex; flex-direction: column; gap: 12px; min-height: 0;
        }
        .aiw-messages::-webkit-scrollbar { width: 3px; }
        .aiw-messages::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 2px; }

        .aiw-empty {
          flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 8px; padding: 20px;
        }
        .aiw-empty-icon { font-size: 36px; }
        .aiw-empty-title { font-family: 'Syne', sans-serif; font-size: 15px;
          font-weight: 700; color: #e5e7eb; text-align: center; }
        .aiw-empty-sub { font-size: 11px; color: #6b7280; text-align: center; line-height: 1.6; }
        .aiw-quick-grid { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 8px; }
        .aiw-quick-btn {
          background: #1a1a28; border: 1px solid #2a2a3e; border-radius: 8px;
          padding: 7px 12px; font-size: 11px; color: #9ca3af;
          cursor: pointer; font-family: 'DM Mono', monospace; transition: all .15s;
        }
        .aiw-quick-btn:hover { border-color: #f59e0b; color: #f59e0b; background: #1c1007; }

        .aiw-bwrap { display: flex; flex-direction: column; gap: 2px; }
        .aiw-bwrap.user { align-items: flex-end; }
        .aiw-bwrap.assistant { align-items: flex-start; }
        .aiw-bubble {
          max-width: 84%; padding: 10px 14px; border-radius: 14px;
          font-size: 13px; line-height: 1.6; white-space: pre-wrap;
          font-family: 'DM Mono', monospace;
        }
        .aiw-bubble.user {
          background: linear-gradient(135deg, #f59e0b22, #ea580c22);
          border: 1px solid #f59e0b44; color: #fde68a;
          border-bottom-right-radius: 4px;
        }
        .aiw-bubble.assistant {
          background: #15151f; border: 1px solid #1e1e2e; color: #d1d5db;
          border-bottom-left-radius: 4px;
        }
        .aiw-bubble.streaming { border-color: #f59e0b55; }
        .aiw-meta { font-size: 10px; color: #374151; margin: 2px 4px;
          font-family: 'DM Mono', monospace; }
        .aiw-cursor { display: inline-block; width: 2px; height: 14px;
          background: #f59e0b; margin-left: 2px; vertical-align: middle;
          animation: aiw-blink .7s infinite; }
        @keyframes aiw-blink { 0%,100%{opacity:1} 50%{opacity:0} }

        .aiw-overlay {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: #0d0d14; z-index: 10;
          border-radius: inherit; display: flex; flex-direction: column;
        }
        .aiw-overlay-header {
          padding: 16px 18px; border-bottom: 1px solid #1e1e2e;
          display: flex; align-items: center; justify-content: space-between;
          flex-shrink: 0;
        }
        .aiw-overlay-title { font-family: 'Syne', sans-serif; font-size: 14px;
          font-weight: 700; color: #f59e0b; }
        .aiw-overlay-list {
          flex: 1; overflow-y: auto; padding: 14px 16px;
          display: flex; flex-direction: column; gap: 8px; min-height: 0;
        }
        .aiw-overlay-list::-webkit-scrollbar { width: 3px; }
        .aiw-overlay-list::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 2px; }

        .aiw-mem-item {
          background: #1a1a28; border: 1px solid #2a2a3e; border-radius: 10px;
          padding: 10px 12px 10px 18px; font-size: 11px; color: #9ca3af;
          line-height: 1.5; position: relative; font-family: 'DM Mono', monospace;
        }
        .aiw-mem-bar {
          position: absolute; left: 0; top: 4px; bottom: 4px;
          width: 3px; background: #f59e0b; border-radius: 0 2px 2px 0;
        }
        .aiw-empty-list { color: #374151; font-size: 12px; padding: 20px;
          text-align: center; font-family: 'DM Mono', monospace; }

        .aiw-contact-card {
          background: #1a1a28; border: 1.5px solid #2a2a3e; border-radius: 12px;
          padding: 12px 14px; cursor: pointer; transition: border-color .15s;
        }
        .aiw-contact-card:hover, .aiw-contact-card.selected { border-color: #22c55e; }
        .aiw-contact-name { font-family: 'Syne', sans-serif; font-size: 13px;
          font-weight: 700; color: #e5e7eb; }
        .aiw-contact-meta { display: flex; gap: 10px; margin-top: 5px;
          flex-wrap: wrap; }
        .aiw-contact-tag { font-size: 10px; color: #6b7280;
          display: flex; align-items: center; gap: 4px;
          font-family: 'DM Mono', monospace; }

        .aiw-input-area {
          padding: 12px 14px 16px; border-top: 1px solid #1e1e2e;
          background: #0d0d14; flex-shrink: 0;
        }
        .aiw-input-row { display: flex; gap: 8px; align-items: flex-end; }
        .aiw-input {
          flex: 1; background: #1a1a28; border: 1.5px solid #2a2a3e;
          border-radius: 12px; padding: 10px 14px;
          color: #e5e7eb; font-size: 13px; font-family: 'DM Mono', monospace;
          resize: none; max-height: 100px; min-height: 42px; line-height: 1.5;
          transition: border-color .15s; outline: none;
        }
        .aiw-input:focus { border-color: #f59e0b55; }
        .aiw-input::placeholder { color: #374151; }
        .aiw-send {
          width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, #f59e0b, #ea580c);
          border: none; cursor: pointer; display: flex; align-items: center;
          justify-content: center; font-size: 16px;
          transition: opacity .15s, transform .15s; color: white;
        }
        .aiw-send:disabled { opacity: .4; cursor: default; }
        .aiw-send:not(:disabled):hover { transform: scale(1.05); }
        .aiw-powered { text-align: center; font-size: 10px; color: #1f2937;
          margin-top: 6px; letter-spacing: .05em;
          font-family: 'DM Mono', monospace; }
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

      {/* Panel */}
      <div className={`aiw aiw-panel ${open ? "open" : ""}`}>

        {/* Memory overlay */}
        {showMemory && (
          <div className="aiw-overlay">
            <div className="aiw-overlay-header">
              <span className="aiw-overlay-title">🧠 Memory Recall</span>
              <button className="aiw-close" onClick={() => setShowMemory(false)}>✕</button>
            </div>
            <div className="aiw-overlay-list">
              {memory.length === 0 ? (
                <div className="aiw-empty-list">No memories yet. Start chatting!</div>
              ) : memory.map((m, i) => (
                <div className="aiw-mem-item" key={i}>
                  <div className="aiw-mem-bar" />
                  {m}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact selector overlay */}
        {showContacts && (
          <div className="aiw-overlay">
            <div className="aiw-overlay-header">
              <span className="aiw-overlay-title">🌱 Select Contact</span>
              <button className="aiw-close" onClick={() => setShowContacts(false)}>✕</button>
            </div>
            <div className="aiw-overlay-list">
              {contactsLoading ? (
                <div className="aiw-empty-list">Loading leads…</div>
              ) : contacts.length === 0 ? (
                <div className="aiw-empty-list">No leads found.</div>
              ) : contacts.map((c) => (
                <div
                  key={c.id}
                  className={`aiw-contact-card ${selectedContact?.id === c.id ? "selected" : ""}`}
                  onClick={() => { setSelectedContact(c); setShowContacts(false); }}
                >
                  <div className="aiw-contact-name">{c.name}</div>
                  <div className="aiw-contact-meta">
                    <span className="aiw-contact-tag">
                      <span className="aiw-dot" style={{
                        background: c.stage === "booked" ? "#22c55e"
                          : c.stage === "estimate_sent" ? "#f59e0b"
                          : "#6b7280"
                      }} />
                      {c.stage}
                    </span>
                    <span className="aiw-contact-tag">💰 {c.value}</span>
                    <span className="aiw-contact-tag">📅 {c.days}d ago</span>
                    <span className="aiw-contact-tag">📍 {c.source}</span>
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
            <div className="aiw-hactions">
              <button className="aiw-icon-btn" title="Memory" onClick={() => setShowMemory(true)}>🧠</button>
              <button className="aiw-icon-btn" title="Clear chat" onClick={reset}>↺</button>
              <button className="aiw-close" onClick={() => setOpen(false)}>✕</button>
            </div>
          </div>
          <div className="aiw-mode-tabs">
            {Object.entries(MODES).map(([key, val]) => (
              <button
                key={key}
                className={`aiw-mode-tab ${mode === key ? `active-${key}` : ""}`}
                onClick={() => { setMode(key); reset(); }}
              >
                {val.icon} {val.label}
              </button>
            ))}
          </div>
        </div>

        {/* Context bar */}
        <div className="aiw-ctx">
          {mode === "nurture" ? (
            <div className="aiw-pill" onClick={() => setShowContacts(true)}>
              <span className="aiw-dot" style={{
                background: selectedContact?.stage === "booked" ? "#22c55e"
                  : selectedContact?.stage === "estimate_sent" ? "#f59e0b"
                  : "#6b7280"
              }} />
              <span className="aiw-pill-text">
                {selectedContact ? `${selectedContact.name} · ${selectedContact.stage}` : "Select a lead"} ▾
              </span>
            </div>
          ) : (
            <div className="aiw-lvl-tabs">
              {COACHING_LEVELS.map((l) => (
                <button
                  key={l}
                  className={`aiw-lvl-tab ${coachLevel === l ? "active" : ""}`}
                  onClick={() => setCoachLevel(l)}
                >{l}</button>
              ))}
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="aiw-messages">
          {messages.length === 0 && !streamText ? (
            <div className="aiw-empty">
              <div className="aiw-empty-icon">{MODES[mode].icon}</div>
              <div className="aiw-empty-title">
                {mode === "nurture"
                  ? selectedContact ? `Nurturing ${selectedContact.name}` : "Select a lead to start"
                  : `${coachLevel} Coaching`}
              </div>
              <div className="aiw-empty-sub">
                {mode === "nurture"
                  ? "AI-powered outreach for your pipeline.\nPick a quick action or ask anything."
                  : `Business coaching tuned to your ${coachLevel} tier.\nAsk about KPIs, tactics, or expansion.`}
              </div>
              <div className="aiw-quick-grid">
                {QUICK_ACTIONS[mode].map((a) => (
                  <button key={a} className="aiw-quick-btn" onClick={() => send(a)}>{a}</button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div key={i} className={`aiw-bwrap ${m.role}`}>
                  <div className={`aiw-bubble ${m.role}`}>{m.content}</div>
                  <div className="aiw-meta">{m.role === "user" ? "You" : "AI Coach"}</div>
                </div>
              ))}
              {streamText && (
                <div className="aiw-bwrap assistant">
                  <div className="aiw-bubble assistant streaming">
                    {streamText}<span className="aiw-cursor" />
                  </div>
                </div>
              )}
            </>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="aiw-input-area">
          <div className="aiw-input-row">
            <textarea
              ref={inputRef}
              className="aiw-input"
              placeholder={mode === "nurture" ? "Ask to draft a message…" : "Ask your coach…"}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
              }}
              rows={1}
            />
            <button
              className="aiw-send"
              onClick={() => send()}
              disabled={loading || !input.trim()}
            >
              {loading ? "⏳" : "↑"}
            </button>
          </div>
          <div className="aiw-powered">POWERED BY AI FRONT DESK HELPER</div>
        </div>
      </div>
    </>
  );
}

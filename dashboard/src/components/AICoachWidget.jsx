import { useState, useRef, useEffect, useCallback } from "react";

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

const CONTACTS = [
  { id: 1, name: "Mike Larson", stage: "Estimate Sent", value: "$4,200", days: 3, source: "Google" },
  { id: 2, name: "Sara Chen", stage: "Cold Lead", value: "$1,800", days: 12, source: "Referral" },
  { id: 3, name: "Tom Rivera", stage: "Booked", value: "$6,500", days: 0, source: "Yelp" },
];

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
export default function AICoachWidget() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("nurture");
  const [coachLevel, setCoachLevel] = useState("Growth");
  const [selectedContact, setSelectedContact] = useState(CONTACTS[0]);
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
        // Auto-save key insight to memory
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

  const reset = () => { setMessages([]); setStreamText(""); };

  return (
    <>
      {/* Global styles */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Syne:wght@600;700;800&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #0a0a0f; font-family: 'DM Mono', monospace; }

        .widget-root { position: fixed; bottom: 24px; right: 20px; z-index: 9999; }

        /* FAB */
        .fab {
          width: 60px; height: 60px; border-radius: 50%;
          background: linear-gradient(135deg, #f59e0b, #ea580c);
          border: none; cursor: pointer; display: flex; align-items: center;
          justify-content: center; font-size: 24px;
          box-shadow: 0 0 0 0 rgba(245,158,11,0.4);
          animation: pulse 2.5s infinite;
          transition: transform .2s;
        }
        .fab:hover { transform: scale(1.08); }
        @keyframes pulse {
          0%,100% { box-shadow: 0 0 0 0 rgba(245,158,11,.4); }
          50% { box-shadow: 0 0 0 14px rgba(245,158,11,0); }
        }
        .fab-badge {
          position: absolute; top: -4px; right: -4px;
          background: #ef4444; color: #fff; font-size: 10px;
          width: 18px; height: 18px; border-radius: 50%;
          display: flex; align-items: center; justify-content: center;
          font-family: 'Syne', sans-serif; font-weight: 700;
        }

        /* Panel */
        .panel {
          position: fixed; bottom: 0; right: 0;
          width: 100vw; height: 100dvh;
          background: #0d0d14;
          display: flex; flex-direction: column;
          border-top: 2px solid #f59e0b;
          transform: translateY(100%);
          transition: transform .35s cubic-bezier(.16,1,.3,1);
        }
        @media(min-width:520px) {
          .panel {
            bottom: 24px; right: 20px;
            width: 400px; height: 680px;
            border-radius: 20px; border: 1.5px solid #1e1e2e;
            border-top: 2px solid #f59e0b;
          }
        }
        .panel.open { transform: translateY(0); }

        /* Header */
        .panel-header {
          padding: 16px 18px 12px;
          border-bottom: 1px solid #1e1e2e;
          display: flex; flex-direction: column; gap: 10px;
          background: #0d0d14;
        }
        .header-top { display: flex; align-items: center; justify-content: space-between; }
        .logo { font-family: 'Syne', sans-serif; font-size: 13px; font-weight: 800;
          color: #f59e0b; letter-spacing: .04em; text-transform: uppercase; }
        .logo span { color: #6b7280; font-weight: 600; }
        .header-actions { display: flex; gap: 8px; align-items: center; }
        .icon-btn {
          background: #1a1a28; border: 1px solid #2a2a3e; border-radius: 8px;
          width: 32px; height: 32px; display: flex; align-items: center;
          justify-content: center; cursor: pointer; font-size: 14px;
          color: #9ca3af; transition: border-color .15s, color .15s;
        }
        .icon-btn:hover { border-color: #f59e0b; color: #f59e0b; }
        .close-btn { background: none; border: none; cursor: pointer;
          color: #6b7280; font-size: 20px; line-height: 1; padding: 4px; }

        /* Mode tabs */
        .mode-tabs { display: flex; gap: 6px; }
        .mode-tab {
          flex: 1; padding: 7px 0; border-radius: 8px;
          font-family: 'Syne', sans-serif; font-size: 12px; font-weight: 700;
          border: 1.5px solid #1e1e2e; background: transparent;
          color: #6b7280; cursor: pointer;
          transition: all .15s; letter-spacing: .03em;
        }
        .mode-tab.active-nurture { background: #052e16; border-color: #22c55e; color: #22c55e; }
        .mode-tab.active-coaching { background: #1c1007; border-color: #f59e0b; color: #f59e0b; }

        /* Context bar */
        .context-bar {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 18px; background: #0a0a10;
          border-bottom: 1px solid #1e1e2e;
        }
        .context-pill {
          background: #1a1a28; border: 1px solid #2a2a3e;
          border-radius: 20px; padding: 5px 12px;
          font-size: 11px; color: #9ca3af; cursor: pointer;
          display: flex; align-items: center; gap: 5px;
          transition: border-color .15s;
        }
        .context-pill:hover { border-color: #f59e0b; color: #f59e0b; }
        .context-pill .dot { width: 7px; height: 7px; border-radius: 50%; }

        /* Level selector */
        .level-tabs { display: flex; gap: 4px; flex: 1; }
        .level-tab {
          flex: 1; padding: 5px 0; border-radius: 6px; font-size: 10px;
          font-family: 'Syne', sans-serif; font-weight: 700; border: 1px solid #2a2a3e;
          background: transparent; color: #6b7280; cursor: pointer; transition: all .15s;
        }
        .level-tab.active { background: #1c1007; border-color: #f59e0b; color: #f59e0b; }

        /* Messages */
        .messages { flex: 1; overflow-y: auto; padding: 16px 16px 8px; display: flex; flex-direction: column; gap: 12px; }
        .messages::-webkit-scrollbar { width: 3px; }
        .messages::-webkit-scrollbar-thumb { background: #2a2a3e; border-radius: 2px; }

        /* Empty state */
        .empty-state { flex: 1; display: flex; flex-direction: column;
          align-items: center; justify-content: center; gap: 8px; padding: 20px; }
        .empty-icon { font-size: 36px; }
        .empty-title { font-family: 'Syne', sans-serif; font-size: 15px;
          font-weight: 700; color: #e5e7eb; text-align: center; }
        .empty-sub { font-size: 11px; color: #6b7280; text-align: center; line-height: 1.6; }

        /* Quick actions */
        .quick-grid { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin-top: 8px; }
        .quick-btn {
          background: #1a1a28; border: 1px solid #2a2a3e; border-radius: 8px;
          padding: 7px 12px; font-size: 11px; color: #9ca3af;
          cursor: pointer; font-family: 'DM Mono', monospace;
          transition: all .15s;
        }
        .quick-btn:hover { border-color: #f59e0b; color: #f59e0b; background: #1c1007; }

        /* Bubbles */
        .bubble-wrap { display: flex; flex-direction: column; gap: 2px; }
        .bubble-wrap.user { align-items: flex-end; }
        .bubble-wrap.assistant { align-items: flex-start; }
        .bubble {
          max-width: 84%; padding: 10px 14px; border-radius: 14px;
          font-size: 13px; line-height: 1.6; white-space: pre-wrap;
        }
        .bubble.user {
          background: linear-gradient(135deg, #f59e0b22, #ea580c22);
          border: 1px solid #f59e0b44; color: #fde68a;
          border-bottom-right-radius: 4px;
        }
        .bubble.assistant {
          background: #15151f; border: 1px solid #1e1e2e; color: #d1d5db;
          border-bottom-left-radius: 4px;
        }
        .bubble.streaming { border-color: #f59e0b55; }
        .bubble-meta { font-size: 10px; color: #374151; margin: 2px 4px; }

        /* Cursor blink */
        .cursor { display: inline-block; width: 2px; height: 14px;
          background: #f59e0b; margin-left: 2px; vertical-align: middle;
          animation: blink .7s infinite; }
        @keyframes blink { 0%,100%{opacity:1} 50%{opacity:0} }

        /* Memory panel */
        .memory-panel {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: #0d0d14; z-index: 10; border-radius: inherit;
          display: flex; flex-direction: column;
        }
        .memory-header { padding: 16px 18px; border-bottom: 1px solid #1e1e2e;
          display: flex; align-items: center; justify-content: space-between; }
        .memory-title { font-family: 'Syne', sans-serif; font-size: 14px;
          font-weight: 700; color: #f59e0b; }
        .memory-list { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
        .memory-item {
          background: #1a1a28; border: 1px solid #2a2a3e; border-radius: 10px;
          padding: 10px 12px; font-size: 11px; color: #9ca3af; line-height: 1.5;
          position: relative;
        }
        .memory-item-bar {
          position: absolute; left: 0; top: 4px; bottom: 4px;
          width: 3px; background: #f59e0b; border-radius: 0 2px 2px 0;
        }
        .memory-empty { color: #374151; font-size: 12px; padding: 20px; text-align: center; }

        /* Contact panel */
        .contact-panel {
          position: absolute; top: 0; left: 0; right: 0; bottom: 0;
          background: #0d0d14; z-index: 10; border-radius: inherit;
          display: flex; flex-direction: column;
        }
        .contact-list { flex: 1; overflow-y: auto; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
        .contact-card {
          background: #1a1a28; border: 1.5px solid #2a2a3e; border-radius: 12px;
          padding: 12px 14px; cursor: pointer; transition: border-color .15s;
        }
        .contact-card:hover, .contact-card.selected { border-color: #22c55e; }
        .contact-name { font-family: 'Syne', sans-serif; font-size: 13px;
          font-weight: 700; color: #e5e7eb; }
        .contact-meta { display: flex; gap: 12px; margin-top: 5px; flex-wrap: wrap; }
        .contact-tag {
          font-size: 10px; color: #6b7280;
          display: flex; align-items: center; gap: 4px;
        }
        .stage-dot { width: 6px; height: 6px; border-radius: 50%; }

        /* Input area */
        .input-area {
          padding: 12px 14px 16px; border-top: 1px solid #1e1e2e;
          background: #0d0d14;
        }
        .input-row { display: flex; gap: 8px; align-items: flex-end; }
        .input-box {
          flex: 1; background: #1a1a28; border: 1.5px solid #2a2a3e;
          border-radius: 12px; padding: 10px 14px;
          color: #e5e7eb; font-size: 13px; font-family: 'DM Mono', monospace;
          resize: none; max-height: 100px; min-height: 42px; line-height: 1.5;
          transition: border-color .15s; outline: none;
        }
        .input-box:focus { border-color: #f59e0b55; }
        .input-box::placeholder { color: #374151; }
        .send-btn {
          width: 42px; height: 42px; border-radius: 12px; flex-shrink: 0;
          background: linear-gradient(135deg, #f59e0b, #ea580c);
          border: none; cursor: pointer; display: flex; align-items: center;
          justify-content: center; font-size: 16px;
          transition: opacity .15s, transform .15s;
        }
        .send-btn:disabled { opacity: .4; cursor: default; }
        .send-btn:not(:disabled):hover { transform: scale(1.05); }
        .powered { text-align: center; font-size: 10px; color: #1f2937; margin-top: 6px; letter-spacing: .05em; }
      `}</style>

      <div className="widget-root">
        {/* FAB */}
        {!open && (
          <div style={{ position: "relative" }}>
            <button className="fab" onClick={() => setOpen(true)}>🤖</button>
            <div className="fab-badge">2</div>
          </div>
        )}

        {/* Panel */}
        <div className={`panel ${open ? "open" : ""}`}>
          {/* Memory overlay */}
          {showMemory && (
            <div className="memory-panel">
              <div className="memory-header">
                <span className="memory-title">🧠 Memory Recall</span>
                <button className="close-btn" onClick={() => setShowMemory(false)}>✕</button>
              </div>
              <div className="memory-list">
                {memory.length === 0 ? (
                  <div className="memory-empty">No memories stored yet. Start chatting!</div>
                ) : memory.map((m, i) => (
                  <div className="memory-item" key={i}>
                    <div className="memory-item-bar" />
                    <span style={{ paddingLeft: 8 }}>{m}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Contact selector overlay */}
          {showContacts && (
            <div className="contact-panel">
              <div className="memory-header">
                <span className="memory-title">🌱 Select Contact</span>
                <button className="close-btn" onClick={() => setShowContacts(false)}>✕</button>
              </div>
              <div className="contact-list">
                {CONTACTS.map((c) => (
                  <div
                    key={c.id}
                    className={`contact-card ${selectedContact?.id === c.id ? "selected" : ""}`}
                    onClick={() => { setSelectedContact(c); setShowContacts(false); }}
                  >
                    <div className="contact-name">{c.name}</div>
                    <div className="contact-meta">
                      <span className="contact-tag">
                        <span className="stage-dot" style={{
                          background: c.stage === "Booked" ? "#22c55e" : c.stage === "Estimate Sent" ? "#f59e0b" : "#6b7280"
                        }} />
                        {c.stage}
                      </span>
                      <span className="contact-tag">💰 {c.value}</span>
                      <span className="contact-tag">📅 {c.days}d ago</span>
                      <span className="contact-tag">📍 {c.source}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Header */}
          <div className="panel-header">
            <div className="header-top">
              <div className="logo">AI Front Desk <span>Helper</span></div>
              <div className="header-actions">
                <button className="icon-btn" title="Memory" onClick={() => setShowMemory(true)}>🧠</button>
                <button className="icon-btn" title="Clear" onClick={reset}>↺</button>
                <button className="close-btn" onClick={() => setOpen(false)}>✕</button>
              </div>
            </div>
            <div className="mode-tabs">
              {Object.entries(MODES).map(([key, val]) => (
                <button
                  key={key}
                  className={`mode-tab ${mode === key ? `active-${key}` : ""}`}
                  onClick={() => { setMode(key); reset(); }}
                >
                  {val.icon} {val.label}
                </button>
              ))}
            </div>
          </div>

          {/* Context bar */}
          <div className="context-bar">
            {mode === "nurture" ? (
              <div className="context-pill" onClick={() => setShowContacts(true)}>
                <span className="dot" style={{
                  background: selectedContact?.stage === "Booked" ? "#22c55e"
                    : selectedContact?.stage === "Estimate Sent" ? "#f59e0b" : "#6b7280"
                }} />
                {selectedContact?.name} · {selectedContact?.stage} ▾
              </div>
            ) : (
              <div className="level-tabs">
                {COACHING_LEVELS.map((l) => (
                  <button
                    key={l}
                    className={`level-tab ${coachLevel === l ? "active" : ""}`}
                    onClick={() => setCoachLevel(l)}
                  >{l}</button>
                ))}
              </div>
            )}
          </div>

          {/* Messages */}
          <div className="messages">
            {messages.length === 0 && !streamText ? (
              <div className="empty-state">
                <div className="empty-icon">{MODES[mode].icon}</div>
                <div className="empty-title">
                  {mode === "nurture" ? `Nurturing ${selectedContact?.name}` : `${coachLevel} Coaching`}
                </div>
                <div className="empty-sub">
                  {mode === "nurture"
                    ? `AI-powered outreach for ${selectedContact?.stage} leads.\nPick a quick action or ask anything.`
                    : `Business coaching tuned to your ${coachLevel} tier.\nAsk about KPIs, tactics, or expansion.`}
                </div>
                <div className="quick-grid">
                  {QUICK_ACTIONS[mode].map((a) => (
                    <button key={a} className="quick-btn" onClick={() => send(a)}>{a}</button>
                  ))}
                </div>
              </div>
            ) : (
              <>
                {messages.map((m, i) => (
                  <div key={i} className={`bubble-wrap ${m.role}`}>
                    <div className={`bubble ${m.role}`}>{m.content}</div>
                    <div className="bubble-meta">{m.role === "user" ? "You" : "AI"}</div>
                  </div>
                ))}
                {streamText && (
                  <div className="bubble-wrap assistant">
                    <div className="bubble assistant streaming">
                      {streamText}<span className="cursor" />
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="input-area">
            <div className="input-row">
              <textarea
                ref={inputRef}
                className="input-box"
                placeholder={mode === "nurture" ? "Ask to draft a message…" : "Ask your coach…"}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
                }}
                rows={1}
              />
              <button className="send-btn" onClick={() => send()} disabled={loading || !input.trim()}>
                {loading ? "⏳" : "↑"}
              </button>
            </div>
            <div className="powered">POWERED BY AI FRONT DESK HELPER · AIFRONTDESKHELPER.COM</div>
          </div>
        </div>
      </div>
    </>
  );
}

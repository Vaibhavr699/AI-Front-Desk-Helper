// CoachingChat.jsx
// Place in: dashboard/src/components/coaching/CoachingChat.jsx

import { useState, useEffect, useRef } from "react";

const API_BASE = process.env.REACT_APP_API_URL || "https://ai-front-desk-backend.onrender.com";

const MONTH = new Date().toLocaleString("default", { month: "long" });
const YEAR = new Date().getFullYear();

const SUGGESTED = [
  "Why am I behind on my goal this month?",
  "How is my team performing this week?",
  "Am I going to hit my annual goal?",
  "Which lead source is converting best?",
  "What should I focus on this week?",
  "How many more leads do I need to hit my goal?",
  "How can I produce more leads?",
  "What lead source is working the best right now?",
];

function TypingIndicator() {
  return (
    <div style={{ display: "flex", gap: 4, padding: "14px 16px", alignItems: "center" }}>
      {[0,1,2].map(i => (
        <div key={i} style={{
          width: 8, height: 8, borderRadius: "50%", background: "#ddd",
          animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

function Message({ msg }) {
  const isUser = msg.role === "user";
  return (
    <div style={{ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start", marginBottom: 12 }}>
      {!isUser && (
        <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(232,96,10,0.1)", border: "1.5px solid rgba(232,96,10,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, marginRight: 10, marginTop: 2 }}>
          🎯
        </div>
      )}
      <div style={{
        maxWidth: "75%",
        padding: "12px 16px",
        borderRadius: isUser ? "16px 16px 4px 16px" : "16px 16px 16px 4px",
        background: isUser ? "#E8600A" : "#fff",
        color: isUser ? "#fff" : "#222",
        fontSize: 14,
        lineHeight: 1.7,
        border: isUser ? "none" : "1px solid #e8e6e0",
        boxShadow: isUser ? "none" : "0 1px 3px rgba(0,0,0,0.04)",
        whiteSpace: "pre-wrap",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

export default function CoachingChat() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(true);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const headers = { Authorization: `Bearer ${token}` };
    Promise.all([
      fetch(`${API_BASE}/api/goals/annual?year=${YEAR}`, { headers }).then(r => r.json()).catch(() => null),
      fetch(`${API_BASE}/api/dashboard/metrics?period=30d`, { headers }).then(r => r.json()).catch(() => null),
    ]).then(([goals, metrics]) => {
      setContext({ goals, metrics });
      setContextLoading(false);
    });
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function sendMessage(text) {
    const msg = (text || input).trim();
    if (!msg || loading) return;
    setInput("");
    const updated = [...messages, { role: "user", content: msg }];
    setMessages(updated);
    setLoading(true);
    try {
      const token = localStorage.getItem("token");
      const res = await fetch(`${API_BASE}/api/coaching/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: msg, conversation_history: messages }),
      });
      const data = await res.json();
      setMessages([...updated, { role: "assistant", content: data.reply || "Sorry, couldn't get a response." }]);
    } catch {
      setMessages([...updated, { role: "assistant", content: "Connection error. Please try again." }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  }

  const nowM = new Date().getMonth();
  const currentGoalEntry = context?.goals?.months?.find(m => m.month === nowM);
  const monthGoal = currentGoalEntry?.revenue_goal || 0;
  const monthActual = currentGoalEntry?.actual_revenue || 0;
  const calls = context?.metrics?.totals?.calls || 0;
  const closeRate = context?.metrics?.sales?.close_rate || 0;
  const openLeads = context?.metrics?.pipeline?.open_estimates || 0;

  return (
    <div style={{ background: "#F5F4F2", minHeight: "100vh", fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{`
        @keyframes bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-5px)} }
        .cc-sugg:hover { background: #fff7ed !important; border-color: rgba(232,96,10,0.35) !important; color: #C85208 !important; }
        .cc-send:hover { background: #C85208 !important; }
        .cc-input:focus { border-color: #E8600A !important; outline: none; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e8e6e0", padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: "50%", background: "rgba(232,96,10,0.08)", border: "1.5px solid rgba(232,96,10,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🎯</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#111" }}>AI Revenue Coach</div>
            <div style={{ fontSize: 11, color: "#999" }}>Powered by your goals, actuals & team activity</div>
          </div>
        </div>
        <div style={{ fontSize: 10, color: "#ccc", fontFamily: "monospace" }}>
          {contextLoading ? "Loading context..." : `Context loaded · ${MONTH} ${YEAR}`}
        </div>
      </div>

      {/* Context bar */}
      {!contextLoading && (
        <div style={{ background: "#fff", borderBottom: "1px solid #e8e6e0", padding: "10px 24px", display: "flex", gap: 28, overflowX: "auto" }}>
          {monthGoal > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#bbb", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>{MONTH} Goal</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>${Math.round(monthGoal).toLocaleString()}</div>
            </div>
          )}
          {monthActual > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#bbb", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Actual</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: monthActual >= monthGoal ? "#16a34a" : "#dc2626" }}>${Math.round(monthActual).toLocaleString()}</div>
            </div>
          )}
          {calls > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#bbb", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Calls (30d)</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{calls}</div>
            </div>
          )}
          {closeRate > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#bbb", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Close Rate</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{closeRate}%</div>
            </div>
          )}
          {openLeads > 0 && (
            <div>
              <div style={{ fontSize: 9, color: "#bbb", fontFamily: "monospace", textTransform: "uppercase", letterSpacing: "0.07em" }}>Open Leads</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{openLeads}</div>
            </div>
          )}
        </div>
      )}

      {/* Chat area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px", maxWidth: 760, width: "100%", margin: "0 auto", boxSizing: "border-box" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 0 32px" }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🎯</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 8 }}>Your AI Revenue Coach</div>
            <div style={{ fontSize: 13, color: "#999", maxWidth: 380, margin: "0 auto", lineHeight: 1.7, marginBottom: 32 }}>
              Ask anything about your business performance. I have your goals, actuals, pipeline, and team activity — so answers are specific to your numbers.
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              {SUGGESTED.map((q, i) => (
                <button key={i} className="cc-sugg" onClick={() => sendMessage(q)} style={{ background: "#fff", border: "1.5px solid #e0ddd8", borderRadius: 20, padding: "8px 16px", fontSize: 12, color: "#555", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }}>
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => <Message key={i} msg={m} />)}

        {loading && (
          <div style={{ display: "flex", alignItems: "flex-start", marginBottom: 12 }}>
            <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(232,96,10,0.08)", border: "1.5px solid rgba(232,96,10,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, flexShrink: 0, marginRight: 10 }}>🎯</div>
            <div style={{ background: "#fff", border: "1px solid #e8e6e0", borderRadius: "16px 16px 16px 4px", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" }}>
              <TypingIndicator />
            </div>
          </div>
        )}

        {messages.length > 0 && !loading && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 16 }}>
            {SUGGESTED.slice(0, 3).map((q, i) => (
              <button key={i} className="cc-sugg" onClick={() => sendMessage(q)} style={{ background: "#fff", border: "1.5px solid #e0ddd8", borderRadius: 20, padding: "6px 14px", fontSize: 11, color: "#888", cursor: "pointer", fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s" }}>
                {q}
              </button>
            ))}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ background: "#fff", borderTop: "1px solid #e8e6e0", padding: "16px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end" }}>
          <textarea
            ref={inputRef}
            className="cc-input"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask your coach anything about your business..."
            rows={1}
            style={{ flex: 1, background: "#fafaf9", border: "1.5px solid #e0ddd8", borderRadius: 12, padding: "12px 16px", fontSize: 14, fontFamily: "'DM Sans', sans-serif", resize: "none", color: "#111", lineHeight: 1.5, maxHeight: 120 }}
          />
          <button
            className="cc-send"
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            style={{ width: 44, height: 44, borderRadius: 12, background: input.trim() ? "#E8600A" : "#e0ddd8", border: "none", color: "#fff", cursor: input.trim() ? "pointer" : "default", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 18, transition: "background 0.15s" }}
          >
            ↑
          </button>
        </div>
        <div style={{ maxWidth: 760, margin: "6px auto 0", fontSize: 10, color: "#ccc", textAlign: "center" }}>
          Shift+Enter for new line · Enter to send
        </div>
      </div>
    </div>
  );
}

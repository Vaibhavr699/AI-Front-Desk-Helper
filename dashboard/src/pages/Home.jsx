import { useState, useEffect, useRef } from "react";

const ORANGE = "#E8702A";
const DARK = "#111010";
const CARD_DARK = "#1A1918";
const CARD_MID = "#242120";
const OFF_WHITE = "#F5F0EB";
const MUTED = "#8A8480";

const style = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,400&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    background: ${DARK};
    color: ${OFF_WHITE};
    font-family: 'DM Sans', sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .syne { font-family: 'Syne', sans-serif; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(-20px); }
    to   { opacity: 1; transform: translateX(0); }
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.4; }
  }
  @keyframes ticker {
    0%   { transform: translateX(0); }
    100% { transform: translateX(-50%); }
  }
  @keyframes glow {
    0%, 100% { box-shadow: 0 0 24px rgba(232,112,42,0.25); }
    50%       { box-shadow: 0 0 48px rgba(232,112,42,0.5); }
  }

  .fade-up   { animation: fadeUp 0.65s ease both; }
  .d1 { animation-delay: 0.05s; }
  .d2 { animation-delay: 0.15s; }
  .d3 { animation-delay: 0.25s; }
  .d4 { animation-delay: 0.35s; }
  .d5 { animation-delay: 0.45s; }

  .btn-primary {
    background: ${ORANGE};
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 14px 28px;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 15px;
    cursor: pointer;
    transition: background 0.2s, transform 0.15s;
    letter-spacing: 0.01em;
  }
  .btn-primary:hover { background: #d15f20; transform: translateY(-1px); }

  .btn-ghost {
    background: transparent;
    color: ${OFF_WHITE};
    border: 1.5px solid rgba(245,240,235,0.25);
    border-radius: 6px;
    padding: 13px 26px;
    font-family: 'DM Sans', sans-serif;
    font-weight: 500;
    font-size: 15px;
    cursor: pointer;
    transition: border-color 0.2s, color 0.2s;
  }
  .btn-ghost:hover { border-color: ${OFF_WHITE}; }

  .tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(232,112,42,0.12);
    border: 1px solid rgba(232,112,42,0.3);
    color: ${ORANGE};
    border-radius: 100px;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .section { padding: 88px 24px; max-width: 480px; margin: 0 auto; }

  .divider {
    width: 100%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(245,240,235,0.1), transparent);
    margin: 0 24px;
  }

  .feature-card {
    background: ${CARD_DARK};
    border: 1px solid rgba(245,240,235,0.07);
    border-radius: 14px;
    padding: 28px 24px;
    transition: border-color 0.25s, transform 0.2s;
  }
  .feature-card:hover {
    border-color: rgba(232,112,42,0.3);
    transform: translateY(-2px);
  }

  .stat-card {
    background: ${CARD_MID};
    border-radius: 14px;
    padding: 24px;
    border: 1px solid rgba(245,240,235,0.06);
  }

  .pipeline-step {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    padding: 20px 0;
    border-bottom: 1px solid rgba(245,240,235,0.07);
  }
  .pipeline-step:last-child { border-bottom: none; }

  .step-num {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    border: 1.5px solid ${ORANGE};
    display: flex;
    align-items: center;
    justify-content: center;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: ${ORANGE};
    flex-shrink: 0;
    margin-top: 2px;
  }

  .pill-badge {
    display: inline-block;
    background: rgba(232,112,42,0.15);
    color: ${ORANGE};
    border-radius: 4px;
    padding: 2px 8px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .ticker-wrap {
    overflow: hidden;
    width: 100%;
    padding: 14px 0;
    background: rgba(232,112,42,0.08);
    border-top: 1px solid rgba(232,112,42,0.15);
    border-bottom: 1px solid rgba(232,112,42,0.15);
  }
  .ticker-inner {
    display: flex;
    gap: 0;
    animation: ticker 22s linear infinite;
    white-space: nowrap;
  }
  .ticker-item {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 0 28px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: ${ORANGE};
    opacity: 0.85;
  }

  .price-card {
    background: ${CARD_DARK};
    border: 1px solid rgba(245,240,235,0.08);
    border-radius: 16px;
    padding: 28px 24px;
    margin-bottom: 16px;
  }
  .price-card.featured {
    border-color: ${ORANGE};
    position: relative;
    animation: glow 3s ease-in-out infinite;
  }

  .check-list li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 10px;
    font-size: 14px;
    color: rgba(245,240,235,0.8);
    list-style: none;
  }
  .check-list li::before {
    content: '✓';
    color: ${ORANGE};
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .not-a-bot-box {
    background: linear-gradient(135deg, rgba(232,112,42,0.08), rgba(232,112,42,0.03));
    border: 1px solid rgba(232,112,42,0.2);
    border-radius: 14px;
    padding: 28px 24px;
  }

  .vs-row {
    display: flex;
    align-items: center;
    gap: 0;
    margin-bottom: 12px;
  }
  .vs-cell {
    flex: 1;
    font-size: 13px;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(245,240,235,0.07);
  }
  .vs-cell.bad { color: #888; text-decoration: line-through; }
  .vs-cell.good { color: ${OFF_WHITE}; font-weight: 500; }
  .vs-cell.label { color: ${MUTED}; font-size: 12px; }

  .live-dot {
    width: 8px; height: 8px;
    background: #4ade80;
    border-radius: 50%;
    display: inline-block;
    animation: pulse 2s ease-in-out infinite;
    margin-right: 6px;
  }

  /* MOBILE */
  @media (max-width: 600px) {
    .nav-bar { padding: 12px 16px; }
    .logo-name { font-size: 13px; }
    .btn-ghost { padding: 7px 12px !important; font-size: 12px !important; }
    .btn-primary { padding: 7px 14px !important; font-size: 12px !important; }
    .section { padding: 56px 18px; }
    .feature-card { padding: 20px 18px; }
    .price-card { padding: 22px 18px; }
    .mockup-sidebar { display: none !important; }
    .mockup-stats { flex-direction: column !important; }
  }

  .gradient-text {
    background: linear-gradient(135deg, ${OFF_WHITE} 40%, ${ORANGE});
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .section-eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: ${ORANGE};
    margin-bottom: 14px;
  }

  .big-quote {
    font-size: 22px;
    font-family: 'Syne', sans-serif;
    font-weight: 700;
    line-height: 1.4;
    color: ${OFF_WHITE};
  }
  .big-quote em {
    font-style: normal;
    color: ${ORANGE};
  }

  .nav-bar {
    position: sticky;
    top: 0;
    z-index: 100;
    background: rgba(17,16,16,0.92);
    backdrop-filter: blur(12px);
    border-bottom: 1px solid rgba(245,240,235,0.06);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 20px;
  }

  .logo-box {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .logo-icon {
    width: 36px; height: 36px;
    background: ${OFF_WHITE};
    border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    font-family: 'Syne', sans-serif;
    font-weight: 800;
    font-size: 13px;
    color: #222;
  }
  .logo-name {
    font-family: 'Syne', sans-serif;
    font-size: 14px;
    font-weight: 700;
  }

  .coaching-card {
    background: linear-gradient(145deg, ${CARD_MID}, ${CARD_DARK});
    border: 1px solid rgba(245,240,235,0.08);
    border-radius: 14px;
    padding: 22px 20px;
    margin-bottom: 12px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .icon-box {
    width: 40px; height: 40px; border-radius: 10px;
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
    flex-shrink: 0;
  }

  .review-mockup {
    background: #fff;
    border-radius: 12px;
    padding: 16px;
    color: #111;
    margin-top: 20px;
  }
  .star-row { color: #FBBC04; font-size: 16px; letter-spacing: 2px; }

  /* MODAL */
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    backdrop-filter: blur(4px);
    z-index: 999;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding: 0;
  }
  .modal-sheet {
    background: #fff;
    border-radius: 24px 24px 0 0;
    padding: 28px 24px 40px;
    width: 100%;
    max-width: 480px;
    animation: slideUp 0.3s ease both;
  }
  @keyframes slideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .modal-icon-wrap {
    width: 48px; height: 48px;
    background: #FFF0E6;
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 22px;
    margin-bottom: 16px;
  }
  .modal-policy-box {
    background: #F7F7F7;
    border-radius: 10px;
    padding: 16px;
    font-size: 14px;
    color: #333;
    line-height: 1.65;
    margin: 20px 0;
  }
  .modal-checkbox-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin-bottom: 24px;
    cursor: pointer;
  }
  .modal-checkbox {
    width: 20px; height: 20px;
    border: 2px solid #ccc;
    border-radius: 4px;
    flex-shrink: 0;
    margin-top: 1px;
    display: flex; align-items: center; justify-content: center;
    transition: border-color 0.15s, background 0.15s;
    cursor: pointer;
  }
  .modal-checkbox.checked {
    background: ${ORANGE};
    border-color: ${ORANGE};
  }
  .modal-btn-row {
    display: flex;
    gap: 12px;
  }
  .modal-cancel {
    flex: 1;
    background: #fff;
    border: 1.5px solid #ddd;
    border-radius: 10px;
    padding: 14px;
    font-size: 15px;
    font-weight: 600;
    color: #333;
    cursor: pointer;
    transition: border-color 0.15s;
  }
  .modal-cancel:hover { border-color: #aaa; }
  .modal-continue {
    flex: 1.4;
    background: ${ORANGE};
    border: none;
    border-radius: 10px;
    padding: 14px;
    font-size: 15px;
    font-weight: 700;
    color: #fff;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    font-family: 'Syne', sans-serif;
  }
  .modal-continue:disabled {
    background: #ccc;
    cursor: not-allowed;
  }
  .modal-continue:not(:disabled):hover { background: #d15f20; }
`;


const Ticker = () => {
  const items = [
    "Inbound AI Receptionist",
    "Outbound Script Retiring",
    "Follow-Up Automation",
    "AI Revenue Coaching",
    "Review Response Writer (SEO)",
    "Objection Detection",
    "Lead Source Tracking",
    "Estimate Recovery",
  ];
  const doubled = [...items, ...items];
  return (
    <div className="ticker-wrap">
      <div className="ticker-inner">
        {doubled.map((item, i) => (
          <span className="ticker-item" key={i}>
            <span style={{ color: ORANGE, fontSize: 16 }}>◆</span>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
};

export default function App() {
  const [showModal, setShowModal] = useState(false);
  const [agreed, setAgreed] = useState(false);

  const openModal = () => { setAgreed(false); setShowModal(true); };
  const closeModal = () => setShowModal(false);
  const handleContinue = () => {
    if (agreed) {
      closeModal();
      window.location.href = "https://aifrontdeskhelper.com/signup";
    }
  };

  return (
    <div style={{ background: DARK, minHeight: "100vh", width: "100%", position: "relative", overflowX: "hidden" }}>
      <style>{style}</style>

      {/* SMS COMPLIANCE MODAL */}
      {showModal && (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal-sheet">
            {/* Header row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div className="modal-icon-wrap">💬</div>
              <button
                onClick={closeModal}
                style={{ background: "none", border: "none", fontSize: 20, color: "#aaa", cursor: "pointer", padding: 4, lineHeight: 1 }}
              >✕</button>
            </div>

            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: "#111", marginBottom: 6 }}>
              Before you get started
            </h2>
            <p style={{ fontSize: 15, color: "#777", lineHeight: 1.5 }}>
              Please review and agree to our messaging policy.
            </p>

            {/* Policy box */}
            <div className="modal-policy-box">
              By submitting this form, you agree to receive SMS text messages from{" "}
              <strong>AI Front Desk Helper</strong> related to your inquiry, including
              appointment scheduling, follow-ups, and service notifications. Message
              frequency may vary. Message and data rates may apply. Reply{" "}
              <strong>STOP</strong> to opt out or <strong>HELP</strong> for assistance.
              Consent is not required as a condition of purchasing services.{" "}
              <a href="https://aifrontdeskhelper.com/privacy" style={{ color: ORANGE, fontWeight: 600 }}>
                Privacy Policy
              </a>.
            </div>

            {/* Checkbox */}
            <div className="modal-checkbox-row" onClick={() => setAgreed(!agreed)}>
              <div className={`modal-checkbox ${agreed ? "checked" : ""}`}>
                {agreed && <span style={{ color: "#fff", fontSize: 13, fontWeight: 700, lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 14, color: "#333", lineHeight: 1.55 }}>
                I have read and agree to the SMS messaging terms above.
              </span>
            </div>

            {/* Buttons */}
            <div className="modal-btn-row">
              <button className="modal-cancel" onClick={closeModal}>Cancel</button>
              <button
                className="modal-continue"
                disabled={!agreed}
                onClick={handleContinue}
              >
                Continue to sign up →
              </button>
            </div>
          </div>
        </div>
      )}
      <nav className="nav-bar">
        <div className="logo-box">
          <div className="logo-icon">FD</div>
          <span className="logo-name">AI Front Desk Helper</span>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-ghost" style={{ padding: "8px 16px", fontSize: 13 }}>Sign in</button>
          <button className="btn-primary" style={{ padding: "8px 16px", fontSize: 13 }} onClick={openModal}>Start setup</button>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ padding: "80px 24px 0", textAlign: "center", maxWidth: 1100, margin: "0 auto" }}>

        {/* Not-a-bot tag */}
        <div className="fade-up d1" style={{ marginBottom: 28 }}>
          <span className="tag">
            <span style={{ fontSize: 14 }}>⚡</span>
            Not another call bot
          </span>
        </div>

        {/* Headline */}
        <h1 className="syne fade-up d2" style={{
          fontSize: "clamp(44px, 7vw, 88px)",
          fontWeight: 800,
          lineHeight: 1.05,
          letterSpacing: "-0.03em",
          marginBottom: 24,
          maxWidth: 820,
          margin: "0 auto 24px",
        }}>
          The revenue <span style={{ color: ORANGE }}>machine</span><br/>
          for home service pros
        </h1>

        <p className="fade-up d3" style={{
          fontSize: "clamp(15px, 1.8vw, 18px)",
          lineHeight: 1.7,
          color: "rgba(245,240,235,0.6)",
          maxWidth: 560,
          margin: "0 auto 36px",
        }}>
          Inbound AI. Outbound campaigns. Estimate recovery. AI coaching.
          Review responses. All in one revenue system built by a painting contractor.
        </p>

        {/* CTAs */}
        <div className="fade-up d4" style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 56 }}>
          <button className="btn-primary" style={{ fontSize: 17, padding: "16px 36px" }} onClick={openModal}>
            Start free →
          </button>
          <button className="btn-ghost" style={{ fontSize: 16, padding: "15px 30px" }}>
            Get in touch ☎
          </button>
        </div>

        {/* Live proof stats bar */}
        <div className="fade-up d5" style={{
          background: CARD_DARK,
          border: "1px solid rgba(245,240,235,0.08)",
          borderRadius: 14,
          padding: "20px 40px",
          display: "flex",
          justifyContent: "space-around",
          alignItems: "center",
          gap: 12,
          maxWidth: 760,
          margin: "0 auto",
        }}>
          {[
            { val: "28", label: "Calls / mo" },
            { val: "53%", label: "Booking rate" },
            { val: "$11.5k", label: "Tracked rev" },
          ].map((s, i) => (
            <div key={i} style={{ textAlign: "center" }}>
              <div className="syne" style={{ fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 800, color: ORANGE, lineHeight: 1 }}>{s.val}</div>
              <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{s.label}</div>
            </div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginTop: 10, textAlign: "center", marginBottom: 48 }}>
          <span className="live-dot" />
          Live on Gladiators Painting · Omaha, NE
        </div>

        {/* Dashboard Mockup */}
        <div style={{
          position: "relative",
          maxWidth: 960,
          margin: "0 auto",
          borderRadius: "20px 20px 0 0",
          overflow: "hidden",
          border: "1px solid rgba(245,240,235,0.1)",
          borderBottom: "none",
          boxShadow: "0 -8px 80px rgba(232,112,42,0.12), 0 0 0 1px rgba(245,240,235,0.06)",
          background: "#1a1918",
        }}>
          {/* App chrome top bar */}
          <div style={{
            background: "#111",
            padding: "12px 20px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            borderBottom: "1px solid rgba(245,240,235,0.08)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div style={{
                width: 32, height: 32, borderRadius: 8,
                background: OFF_WHITE,
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 11, color: "#222",
              }}>FD</div>
              <div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: OFF_WHITE }}>Gladiators Painting</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", display: "inline-block" }} />
                  <span style={{ fontSize: 11, color: MUTED }}>AI Receptionist Active</span>
                </div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 20 }}>
              {[["📞", "14 Calls Today"], ["📅", "3 Bookings"]].map(([icon, label], i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: MUTED }}>
                  <span>{icon}</span>{label}
                </div>
              ))}
            </div>
          </div>

          {/* App body */}
          <div style={{ display: "flex", minHeight: 340 }}>
            {/* Sidebar — hidden on small screens */}
            <div style={{
              width: 180,
              background: "#161514",
              borderRight: "1px solid rgba(245,240,235,0.06)",
              padding: "16px 0",
              flexShrink: 0,
              display: "var(--sidebar-display, flex)",
              flexDirection: "column",
            }}
            className="mockup-sidebar"
            >
              {[
                { icon: "📞", label: "Live Calls", active: true },
                { icon: "📅", label: "Calendar" },
                { icon: "💬", label: "SMS Follow-ups" },
                { icon: "📊", label: "Revenue" },
                { icon: "🎯", label: "Coaching" },
              ].map((item, i) => (
                <div key={i} style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 18px",
                  background: item.active ? `rgba(232,112,42,0.15)` : "transparent",
                  borderLeft: item.active ? `3px solid ${ORANGE}` : "3px solid transparent",
                  cursor: "default",
                }}>
                  <span style={{ fontSize: 14 }}>{item.icon}</span>
                  <span style={{
                    fontSize: 13,
                    fontWeight: item.active ? 600 : 400,
                    color: item.active ? OFF_WHITE : MUTED,
                  }}>{item.label}</span>
                </div>
              ))}
            </div>

            {/* Main panel */}
            <div style={{ flex: 1, padding: "20px 24px", overflow: "hidden" }}>
              {/* Live transcript card */}
              <div style={{
                background: "#111",
                borderRadius: 12,
                padding: "16px 18px",
                border: "1px solid rgba(245,240,235,0.08)",
                marginBottom: 16,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                  <div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: OFF_WHITE }}>Live Transcript</div>
                    <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>+1 (713) 555-0199 · Houston, TX</div>
                  </div>
                  <div style={{
                    background: "#1a3a5c",
                    color: "#60b4ff",
                    fontSize: 11,
                    fontWeight: 700,
                    padding: "4px 10px",
                    borderRadius: 20,
                    display: "flex", alignItems: "center", gap: 5,
                  }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#60b4ff", display: "inline-block", animation: "pulse 2s ease-in-out infinite" }} />
                    LIVE
                  </div>
                </div>

                {/* Chat bubbles */}
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "rgba(232,112,42,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, flexShrink: 0,
                    }}>🤖</div>
                    <div style={{
                      background: CARD_MID,
                      borderRadius: "4px 14px 14px 14px",
                      padding: "10px 14px",
                      fontSize: 13,
                      color: OFF_WHITE,
                      lineHeight: 1.5,
                      maxWidth: "75%",
                    }}>
                      Thank you for calling Gladiators Painting! Are you looking to schedule a free painting estimate?
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: "flex-end" }}>
                    <div style={{
                      background: ORANGE,
                      borderRadius: "14px 4px 14px 14px",
                      padding: "10px 14px",
                      fontSize: 13,
                      color: "#fff",
                      lineHeight: 1.5,
                      maxWidth: "75%",
                    }}>
                      Yes, I need the exterior of my house painted. It's a two-story home.
                    </div>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "#333",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, flexShrink: 0,
                    }}>👤</div>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%",
                      background: "rgba(232,112,42,0.2)",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 13, flexShrink: 0,
                    }}>🤖</div>
                    <div style={{
                      background: CARD_MID,
                      borderRadius: "4px 14px 14px 14px",
                      padding: "10px 14px",
                      fontSize: 13,
                      color: OFF_WHITE,
                      lineHeight: 1.5,
                      maxWidth: "75%",
                    }}>
                      Great! I can get you scheduled. What's the best date this week for an estimate?
                    </div>
                  </div>
                </div>
              </div>

              {/* Bottom row mini cards */}
              <div className="mockup-stats" style={{ display: "flex", gap: 12 }}>
                {[
                  { label: "Booking rate", val: "53%", sub: "vs 20–30% avg", up: true },
                  { label: "Est. recovered", val: "$4,200", sub: "last 30 days", up: true },
                  { label: "Follow-ups sent", val: "47", sub: "this month", up: false },
                ].map((card, i) => (
                  <div key={i} style={{
                    flex: 1,
                    background: "#111",
                    border: "1px solid rgba(245,240,235,0.07)",
                    borderRadius: 10,
                    padding: "12px 14px",
                  }}>
                    <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{card.label}</div>
                    <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 18, color: card.up ? ORANGE : OFF_WHITE }}>{card.val}</div>
                    <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{card.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TICKER */}
      <Ticker />

      {/* NOT A CALL BOT SECTION */}
      <section className="section" style={{ paddingTop: 72, paddingBottom: 64 }}>
        <div className="section-eyebrow">Why this is different</div>
        <h2 className="syne" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2, marginBottom: 20 }}>
          Call bots answer the phone.<br/>
          <span style={{ color: ORANGE }}>We close more revenue.</span>
        </h2>
        <p style={{ fontSize: 14, color: "rgba(245,240,235,0.6)", lineHeight: 1.7, marginBottom: 28 }}>
          Tools like Goodcall and Smith.ai stop at inbound. That's the table stakes.
          The real money is in what happens <em style={{ color: OFF_WHITE, fontStyle: "normal" }}>after</em> the call — follow-up, recovery, coaching, and referrals.
        </p>

        {/* Comparison table */}
        <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(245,240,235,0.08)" }}>
          {/* Header */}
          <div style={{ display: "flex", background: CARD_MID, padding: "10px 12px" }}>
            <div style={{ flex: 1, fontSize: 11, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Feature</div>
            <div style={{ width: 90, textAlign: "center", fontSize: 11, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Call bots</div>
            <div style={{ width: 90, textAlign: "center", fontSize: 11, color: ORANGE, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>AFDH</div>
          </div>
          {[
            ["Answers inbound calls", true, true],
            ["Books appointments", true, true],
            ["Outbound campaigns", false, true],
            ["Script retiring (win-backs)", false, true],
            ["Estimate follow-up sequence", false, true],
            ["AI revenue coaching", false, true],
            ["Review writer", false, true],
            ["Close rate by lead source", false, true],
          ].map(([label, callBot, us], i) => (
            <div key={i} style={{
              display: "flex",
              padding: "11px 12px",
              borderTop: "1px solid rgba(245,240,235,0.05)",
              background: i % 2 === 0 ? CARD_DARK : "transparent"
            }}>
              <div style={{ flex: 1, fontSize: 13, color: "rgba(245,240,235,0.75)" }}>{label}</div>
              <div style={{ width: 90, textAlign: "center", fontSize: 15 }}>{callBot ? "✓" : <span style={{ color: "#444" }}>✕</span>}</div>
              <div style={{ width: 90, textAlign: "center", fontSize: 15, color: ORANGE }}>{us ? "✓" : "✕"}</div>
            </div>
          ))}
        </div>
      </section>

      <div className="divider" />

      {/* FEATURES / REVENUE PIPELINE — card layout matching live site */}
      <section className="section">
        <div className="section-eyebrow">Features</div>
        <h2 className="syne" style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, lineHeight: 1.15, marginBottom: 8 }}>
          The full revenue pipeline
        </h2>
        <p style={{ fontSize: 15, color: MUTED, marginBottom: 40, lineHeight: 1.6 }}>
          Every step automates something your team was dropping.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {[
            {
              icon: "🎧",
              title: "AI Receptionist",
              desc: "Natural conversations 24/7. Answers calls, asks the right questions, and sounds like a real team member. Live transcripts of every call in your dashboard.",
              highlight: false,
            },
            {
              icon: "📅",
              title: "Book & Transfer",
              desc: "Books estimates directly into Google Calendar and your CRM. Live-transfer to your team when the caller needs a human.",
              highlight: false,
            },
            {
              icon: "⚡",
              title: "Objection Detection",
              desc: "When someone says 'too expensive' or 'need to think about it' the AI detects it and automatically switches to the right recovery sequence.",
              highlight: false,
            },
            {
              icon: "💬",
              title: "SMS Follow-ups",
              desc: "Automated follow-ups at 24h, 3d, 5d, and 10d so quotes don't go cold. Intelligent sequences — not generic blasts.",
              highlight: false,
            },
            {
              icon: "📞",
              title: "Outbound Campaigns",
              desc: "AI calls your past customer list — win-backs, seasonal reactivation, referral asks. You set the campaign; AI dials.",
              highlight: true,
            },
            {
              icon: "📊",
              title: "AI Revenue Coaching",
              desc: "Every phone number is tagged to a lead source. AI tells you which marketing channels are producing booked revenue — and where to stop spending.",
              highlight: true,
            },
            {
              icon: "⭐",
              title: "Review Response Writer",
              desc: "Customer leaves a Google review — one click generates an SEO-optimized owner response. Every review gets replied to automatically.",
              highlight: true,
            },
            {
              icon: "👥",
              title: "Referral Autopilot",
              desc: "AI texts your happy customers asking for a referral by name. Captures the contact and calls the referral within minutes.",
              highlight: true,
            },
          ].map((feat, i) => (
            <div
              key={i}
              style={{
                background: CARD_DARK,
                border: `1px solid ${feat.highlight ? "rgba(232,112,42,0.25)" : "rgba(245,240,235,0.07)"}`,
                borderRadius: 14,
                padding: "22px 24px",
                display: "flex",
                gap: 18,
                alignItems: "flex-start",
                transition: "border-color 0.2s, transform 0.15s",
                cursor: "default",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(232,112,42,0.4)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = feat.highlight ? "rgba(232,112,42,0.25)" : "rgba(245,240,235,0.07)"; e.currentTarget.style.transform = "translateY(0)"; }}
            >
              <div style={{
                width: 42, height: 42, borderRadius: 10, flexShrink: 0,
                background: feat.highlight ? "rgba(232,112,42,0.15)" : "rgba(245,240,235,0.06)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 18,
              }}>{feat.icon}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span className="syne" style={{ fontSize: 16, fontWeight: 700, color: OFF_WHITE }}>{feat.title}</span>
                  {feat.highlight && (
                    <span style={{
                      background: ORANGE, color: "#fff",
                      fontSize: 9, fontWeight: 700,
                      padding: "2px 7px", borderRadius: 3,
                      letterSpacing: "0.06em", textTransform: "uppercase",
                    }}>Elite</span>
                  )}
                </div>
                <p style={{ fontSize: 13, color: "rgba(245,240,235,0.6)", lineHeight: 1.65, margin: 0 }}>{feat.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* STICKY ELITE CTA BAR */}
      <div style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 200,
        background: "linear-gradient(90deg, #1a1008, #2a1505)",
        borderTop: `2px solid ${ORANGE}`,
        padding: "14px 24px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        boxShadow: "0 -4px 32px rgba(232,112,42,0.2)",
      }}>
        <div>
          <div style={{
            fontSize: 10, fontWeight: 700, color: ORANGE,
            letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2,
          }}>Elite Plan · Full Revenue Machine</div>
          <div className="syne" style={{ fontSize: "clamp(14px, 2.5vw, 18px)", fontWeight: 800, color: OFF_WHITE }}>
            Do it all for you — <span style={{ color: ORANGE }}>$997/mo</span> →
          </div>
        </div>
        <button
          className="btn-primary"
          style={{ padding: "12px 24px", fontSize: 14, whiteSpace: "nowrap", flexShrink: 0 }}
          onClick={openModal}
        >
          Start now
        </button>
      </div>

      <div className="divider" />

      {/* HOW IT WORKS — SET UP IN MINUTES */}
      <section className="section">
        <div className="section-eyebrow">How it works</div>
        <h2 className="syne" style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 800, lineHeight: 1.15, marginBottom: 8 }}>
          Set up in minutes
        </h2>
        <p style={{ fontSize: 14, color: MUTED, marginBottom: 40, lineHeight: 1.6 }}>
          Your existing number or a new one — we handle the rest.
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {[
            {
              step: "STEP 1",
              icon: "📞",
              iconBg: "#1a1918",
              title: "Connect your number",
              desc: "Point your Twilio number to AI Front Desk Helper. No new hardware — works with your current phone system.",
            },
            {
              step: "STEP 2",
              icon: "⚙️",
              iconBg: "#1a1410",
              title: "Configure once",
              desc: "Set your welcome message, transfer numbers, and CRM webhook in the dashboard. The AI follows your playbook.",
            },
            {
              step: "STEP 3",
              icon: "⚡",
              iconBg: "#0f1a0f",
              title: "Let it run",
              desc: "Every call is answered, recorded, and transcribed. Review calls and metrics anytime from your dashboard.",
            },
          ].map((item, i) => (
            <div key={i} style={{
              background: CARD_DARK,
              border: "1px solid rgba(245,240,235,0.07)",
              borderRadius: 16,
              padding: "28px 24px",
              textAlign: "center",
            }}>
              <div style={{
                width: 56, height: 56, borderRadius: 14,
                background: "rgba(232,112,42,0.15)",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 24, margin: "0 auto 16px",
              }}>{item.icon}</div>
              <div style={{
                fontSize: 11, fontWeight: 700, color: MUTED,
                letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10,
              }}>{item.step}</div>
              <div className="syne" style={{ fontSize: 18, fontWeight: 700, color: OFF_WHITE, marginBottom: 10 }}>
                {item.title}
              </div>
              <p style={{ fontSize: 13, color: "rgba(245,240,235,0.6)", lineHeight: 1.65, margin: 0 }}>
                {item.desc}
              </p>
            </div>
          ))}
        </div>
      </section>

      <div className="divider" />

      {/* OUTBOUND / SCRIPT RETIRING — big feature */}
      <section className="section">
        <div className="section-eyebrow">Outbound AI</div>
        <h2 className="syne" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2, marginBottom: 16 }}>
          Retire the call script.<br/>
          <span style={{ color: ORANGE }}>Let AI dial for you.</span>
        </h2>
        <p style={{ fontSize: 14, color: "rgba(245,240,235,0.65)", lineHeight: 1.7, marginBottom: 28 }}>
          Your past customer list is money sitting untouched. AI Front Desk Helper runs
          outbound campaigns to win back cold leads, re-engage past customers, and
          ask for referrals — without a salesperson picking up a phone.
        </p>

        {[
          { icon: "🔁", title: "Win-back campaigns", desc: "Re-engage customers who got a quote but never booked. Automated, personalized outreach." },
          { icon: "📅", title: "Seasonal reactivation", desc: "Spring exterior, fall interior — AI reaches out to your past customers on schedule." },
          { icon: "🤝", title: "Referral campaigns", desc: "AI asks happy customers for a referral by name. Captures the contact and calls them automatically." },
          { icon: "📋", title: "Estimate recovery", desc: "Quotes that went cold get a follow-up call at 24h, 3d, 5d, 10d. Intelligent objection handling included." },
        ].map((item, i) => (
          <div key={i} className="coaching-card" style={{ marginBottom: 10 }}>
            <div className="icon-box" style={{ background: "rgba(232,112,42,0.12)" }}>
              {item.icon}
            </div>
            <div>
              <div className="syne" style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{item.title}</div>
              <div style={{ fontSize: 13, color: "rgba(245,240,235,0.6)", lineHeight: 1.6 }}>{item.desc}</div>
            </div>
          </div>
        ))}
      </section>

      <div className="divider" />

      {/* AI COACHING */}
      <section className="section">
        <div className="section-eyebrow">AI Revenue Coaching</div>
        <h2 className="syne" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2, marginBottom: 16 }}>
          Know which marketing<br/>
          <span style={{ color: ORANGE }}>is actually working</span>
        </h2>
        <p style={{ fontSize: 14, color: "rgba(245,240,235,0.65)", lineHeight: 1.7, marginBottom: 28 }}>
          Every phone number is tagged to a lead source. AI connects that to call outcomes,
          bookings, and revenue — then tells you exactly where to put your marketing dollars
          and what to stop spending on.
        </p>

        {/* Coaching UI mockup */}
        <div style={{
          background: CARD_DARK,
          border: "1px solid rgba(245,240,235,0.08)",
          borderRadius: 16,
          overflow: "hidden"
        }}>
          <div style={{
            background: CARD_MID,
            padding: "14px 18px",
            borderBottom: "1px solid rgba(245,240,235,0.07)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center"
          }}>
            <span className="syne" style={{ fontSize: 13, fontWeight: 700 }}>AI Coaching — This Week</span>
            <span style={{ fontSize: 11, color: MUTED }}>Updated daily</span>
          </div>
          {[
            {
              icon: "📊",
              label: "Marketing strategy",
              insight: "Yard signs produced 14 leads at $0 cost — your highest ROI source. Google Ads delivered 9 leads at ~$38/lead. Consider shifting budget toward physical signage this quarter.",
              type: "good"
            },
            {
              icon: "📉",
              label: "Estimate recovery",
              insight: "Facebook leads are booking at 28% vs 61% for Google Organic. Facebook follow-up sequence may need a stronger hook on day 3.",
              type: "warn"
            },
            {
              icon: "✅",
              label: "Close rate trend",
              insight: "Leads who hear a price range on call 1 book 2× more. Your AI is already doing this.",
              type: "good"
            },
            {
              icon: "💡",
              label: "Objection pattern",
              insight: "'Too expensive' detected on 6 calls this week. Consider adding a financing mention to your playbook.",
              type: "info"
            },
          ].map((item, i) => (
            <div key={i} style={{
              padding: "14px 18px",
              borderBottom: i < 3 ? "1px solid rgba(245,240,235,0.06)" : "none",
              display: "flex",
              gap: 12,
              alignItems: "flex-start"
            }}>
              <span style={{ fontSize: 16, marginTop: 1 }}>{item.icon}</span>
              <div>
                <div style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: item.type === "warn" ? "#FFA040" : item.type === "good" ? "#4ade80" : "#60a5fa",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  marginBottom: 3
                }}>{item.label}</div>
                <div style={{ fontSize: 13, color: "rgba(245,240,235,0.7)", lineHeight: 1.55 }}>{item.insight}</div>
              </div>
            </div>
          ))}
        </div>

        <p style={{ fontSize: 12, color: MUTED, textAlign: "center", marginTop: 12 }}>
          Franchise owners get coaching across all locations in one HQ view.
        </p>
      </section>

      <div className="divider" />

      {/* REVIEW WRITER */}
      <section className="section">
        <div className="section-eyebrow">Review Response Writer</div>
        <h2 className="syne" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2, marginBottom: 16 }}>
          Every review gets an<br/>
          <span style={{ color: ORANGE }}>SEO-optimized response.</span>
        </h2>
        <p style={{ fontSize: 14, color: "rgba(245,240,235,0.65)", lineHeight: 1.7, marginBottom: 12 }}>
          When a customer leaves a Google review, AI writes your owner response — naturally
          weaving in your business name, city, and service keywords. More visibility in local search.
          Zero time spent staring at a blank reply box.
        </p>

        {/* Review + Response mockup */}
        <div className="review-mockup">
          {/* Customer review */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 38, height: 38, borderRadius: "50%",
              background: "#4285F4",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontWeight: 700, fontSize: 15
            }}>S</div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "#111" }}>Sarah M.</div>
              <div className="star-row">★★★★★</div>
            </div>
          </div>
          <p style={{ fontSize: 13, color: "#333", lineHeight: 1.6, marginBottom: 14 }}>
            Gladiators Painting did an incredible job on our exterior. Team was punctual and
            the color matching was perfect. Will absolutely use them again.
          </p>

          {/* Owner response */}
          <div style={{
            background: "#F8F8F8",
            borderLeft: "3px solid #E8702A",
            borderRadius: "0 8px 8px 0",
            padding: "12px 14px",
          }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Response from the owner
            </div>
            <p style={{ fontSize: 12, color: "#444", lineHeight: 1.65 }}>
              Thank you so much, Sarah! We're thrilled the exterior painting turned out exactly
              how you envisioned. Gladiators Painting takes pride in clean, professional work
              for homeowners throughout Omaha — it means the world to hear this feedback.
              We'd love to help with that interior project next spring. 🎨
            </p>
            <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{
                background: "#FFF3E8",
                color: ORANGE,
                fontSize: 10,
                padding: "2px 7px",
                borderRadius: 3,
                fontWeight: 700,
                letterSpacing: "0.05em",
                textTransform: "uppercase"
              }}>AI-written · SEO optimized</span>
            </div>
          </div>
        </div>
      </section>

      <div className="divider" />

      {/* GLADIATORS PROOF */}
      <section className="section" style={{ background: "none" }}>
        <div style={{
          background: CARD_DARK,
          border: "1px solid rgba(245,240,235,0.07)",
          borderRadius: 20,
          padding: "32px 24px",
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: ORANGE, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>
            Real results — Gladiators Painting
          </div>
          <h3 className="syne" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.3, marginBottom: 12 }}>
            Running live on a real painting company right now
          </h3>
          <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.65, marginBottom: 28 }}>
            We didn't build this for contractors — we built it as one.
            Every feature was tested on a real painting business before it shipped.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
            {[
              { val: "28", label: "Calls answered by AI last month" },
              { val: "53%", label: "Booking rate (industry avg: 20-30%)" },
              { val: "$11,500", label: "Revenue tracked in dashboard" },
              { val: "15", label: "AI-booked estimates, last 30 days" },
            ].map((s, i) => (
              <div key={i} className="stat-card">
                <div className="syne" style={{ fontSize: i === 2 ? 22 : 28, fontWeight: 800, color: ORANGE, lineHeight: 1.1, marginBottom: 4 }}>{s.val}</div>
                <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{
            borderLeft: `3px solid ${ORANGE}`,
            paddingLeft: 16,
          }}>
            <p style={{ fontSize: 15, fontStyle: "italic", lineHeight: 1.7, color: "rgba(245,240,235,0.8)" }}>
              "I built this for my own painting company because I was losing jobs to voicemail every day on the job site.
              Now it answers every call, follows up on every cold estimate, and coaches me on what to fix."
            </p>
            <div style={{ marginTop: 10, fontSize: 13, color: MUTED }}>Drew — Owner, Gladiators Painting & Founder, AFDH</div>
          </div>
        </div>
      </section>

      <div className="divider" />

      {/* WHO IT'S FOR */}
      <section className="section">
        <div className="section-eyebrow">Built for</div>
        <h2 className="syne" style={{ fontSize: 28, fontWeight: 800, marginBottom: 28 }}>
          Home service pros who are done leaving money on the table
        </h2>
        {[
          { trade: "Painting contractors", line: "Answer every estimate call. Follow up every cold quote. Retire the call script." },
          { trade: "Roofing companies", line: "Speed-to-lead wins in roofing. AI answers in 2 rings, books the inspection." },
          { trade: "HVAC & plumbing", line: "Emergency after-hours calls captured automatically. Never miss an urgent job." },
          { trade: "Fencing & landscaping", line: "Outbound AI calls your seasonal past customers. Reactivation on autopilot." },
          { trade: "Franchise groups", line: "HQ dashboard with AI coaching across all locations. Built for multi-unit scale." },
        ].map((item, i) => (
          <div key={i} style={{
            display: "flex",
            gap: 14,
            padding: "16px 0",
            borderBottom: i < 4 ? "1px solid rgba(245,240,235,0.07)" : "none",
          }}>
            <span style={{ color: ORANGE, fontSize: 18, marginTop: 2 }}>→</span>
            <div>
              <div className="syne" style={{ fontSize: 15, fontWeight: 700, marginBottom: 3 }}>{item.trade}</div>
              <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55 }}>{item.line}</div>
            </div>
          </div>
        ))}
      </section>

      <div className="divider" />

      {/* PRICING */}
      <section className="section">
        <div className="section-eyebrow">Pricing</div>
        <h2 className="syne" style={{ fontSize: 28, fontWeight: 800, marginBottom: 8 }}>
          Let the system do it all.
        </h2>
        <p style={{ fontSize: 14, color: MUTED, marginBottom: 36, lineHeight: 1.6 }}>
          Basic gets you in the door. Elite is where the real revenue machine runs —
          outbound, coaching, reviews, and full pipeline automation. Most contractors
          who try Pro move to Elite within 60 days.
        </p>

        {[
          {
            tier: "Basic",
            label: "SMALL OPS",
            tagline: "AI Front Desk Starter",
            price: "$297",
            setup: "+$197 setup",
            desc: "For contractors who want to stop missing calls.",
            features: ["24/7 AI call answering", "Missed call text-back", "Lead capture & CRM sync", "Call transcripts"],
            featured: false
          },
          {
            tier: "Pro",
            label: "GROWING TEAMS",
            tagline: "AI Booking Assistant",
            price: "$497",
            setup: "+$297 setup",
            desc: "Full booking, follow-up, and multi-channel coverage.",
            features: ["Everything in Basic", "Google Calendar booking", "SMS follow-up sequences", "Website AI chat widget", "Appointment reminders", "Facebook Messenger"],
            featured: false
          },
          {
            tier: "Elite",
            label: "THE FULL SYSTEM",
            tagline: "AI Revenue Machine",
            price: "$997",
            setup: "+$497 setup",
            desc: "Everything. Inbound, outbound, coaching, reviews, and franchise-ready HQ tools.",
            features: ["Everything in Pro", "Outbound AI campaigns", "Script retiring & win-backs", "AI revenue coaching", "Lead source marketing insights", "Review response writer (SEO)", "Objection detection", "Referral autopilot", "HQ franchise rollup"],
            featured: true
          },
        ].map((plan, i) => (
          <div key={i} className={`price-card ${plan.featured ? "featured" : ""}`}>
            {plan.featured && (
              <div style={{
                position: "absolute",
                top: -12,
                left: "50%",
                transform: "translateX(-50%)",
                background: ORANGE,
                color: "#fff",
                fontSize: 11,
                fontWeight: 700,
                padding: "4px 14px",
                borderRadius: 100,
                letterSpacing: "0.08em",
                textTransform: "uppercase"
              }}>Best value — do it all</div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{plan.label}</div>
                <div className="syne" style={{ fontSize: 22, fontWeight: 800 }}>{plan.tier}</div>
                <div style={{ fontSize: 13, color: MUTED }}>{plan.tagline}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div className="syne" style={{ fontSize: 26, fontWeight: 800 }}>{plan.price}<span style={{ fontSize: 14, fontWeight: 500, color: MUTED }}>/mo</span></div>
                <div style={{ fontSize: 12, color: ORANGE }}>{plan.setup}</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "rgba(245,240,235,0.55)", marginBottom: 16, lineHeight: 1.5 }}>{plan.desc}</p>
            <ul className="check-list">
              {plan.features.map((f, j) => <li key={j}>{f}</li>)}
            </ul>
            <button
              className={plan.featured ? "btn-primary" : "btn-ghost"}
              style={{ width: "100%", marginTop: 20, fontSize: 15, padding: "14px" }}
              onClick={openModal}
            >
              Get started
            </button>
          </div>
        ))}
      </section>

      {/* FINAL CTA */}
      <section style={{ padding: "72px 24px 120px", textAlign: "center" }}>
        <div style={{
          background: `radial-gradient(ellipse at center, rgba(232,112,42,0.15) 0%, transparent 70%)`,
          paddingBottom: 8
        }}>
          <h2 className="syne" style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.2, marginBottom: 14 }}>
            Ready to stop <span style={{ color: ORANGE }}>missing revenue?</span>
          </h2>
          <p style={{ fontSize: 15, color: MUTED, marginBottom: 32, lineHeight: 1.6 }}>
            Create your account and connect your first number in minutes.
          </p>
          <button className="btn-primary" style={{ fontSize: 17, padding: "16px 40px", marginBottom: 14 }} onClick={openModal}>
            Get Started →
          </button>
          <div style={{ marginTop: 12 }}>
            <button className="btn-ghost" style={{ fontSize: 14 }}>I already have an account</button>
          </div>
          <p style={{ fontSize: 11, color: MUTED, marginTop: 18 }}>
            By signing up you agree to receive SMS messages from AI Front Desk Helper.
          </p>
        </div>
      </section>
    </div>
  );
}

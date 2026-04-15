import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { SiteHeader, SmsConsentModal } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";

// ─── Design tokens (match existing site) ─────────────────────────────────────
const ORANGE   = "#E8702A";
const DARK     = "#111010";
const CARD_DARK = "#1A1918";
const CARD_MID  = "#242120";
const OFF_WHITE = "#F5F0EB";
const MUTED     = "#8A8480";

// ─── Page-level CSS (hero, sections, ticker, cards, etc.) ────────────────────
const pageStyle = `
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700;800&family=DM+Sans:ital,wght@0,300;0,400;0,500;1,400&display=swap');

  .syne { font-family: 'Syne', sans-serif; }

  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(28px); }
    to   { opacity: 1; transform: translateY(0); }
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

  .fade-up { animation: fadeUp 0.65s ease both; }
  .d1 { animation-delay: 0.05s; }
  .d2 { animation-delay: 0.15s; }
  .d3 { animation-delay: 0.25s; }
  .d4 { animation-delay: 0.35s; }
  .d5 { animation-delay: 0.45s; }

  .lp-btn-primary {
    background: #E8702A;
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
  .lp-btn-primary:hover { background: #d15f20; transform: translateY(-1px); }

  .lp-btn-ghost {
    background: transparent;
    color: #F5F0EB;
    border: 1.5px solid rgba(245,240,235,0.25);
    border-radius: 6px;
    padding: 13px 26px;
    font-family: 'DM Sans', sans-serif;
    font-weight: 500;
    font-size: 15px;
    cursor: pointer;
    transition: border-color 0.2s;
  }
  .lp-btn-ghost:hover { border-color: #F5F0EB; }

  .lp-tag {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: rgba(232,112,42,0.12);
    border: 1px solid rgba(232,112,42,0.3);
    color: #E8702A;
    border-radius: 100px;
    padding: 5px 12px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .lp-section { padding: 88px 24px; max-width: 800px; margin: 0 auto; }

  .lp-divider {
    width: 100%;
    height: 1px;
    background: linear-gradient(90deg, transparent, rgba(245,240,235,0.1), transparent);
  }

  .lp-eyebrow {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: #E8702A;
    margin-bottom: 14px;
  }

  .lp-ticker-wrap {
    overflow: hidden;
    width: 100%;
    padding: 14px 0;
    background: rgba(232,112,42,0.08);
    border-top: 1px solid rgba(232,112,42,0.15);
    border-bottom: 1px solid rgba(232,112,42,0.15);
  }
  .lp-ticker-inner {
    display: flex;
    animation: ticker 22s linear infinite;
    white-space: nowrap;
  }
  .lp-ticker-item {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    padding: 0 28px;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #E8702A;
    opacity: 0.85;
  }

  .lp-price-card {
    background: #1A1918;
    border: 1px solid rgba(245,240,235,0.08);
    border-radius: 16px;
    padding: 28px 24px;
    margin-bottom: 16px;
    position: relative;
  }
  .lp-price-card.featured {
    border-color: #E8702A;
    animation: glow 3s ease-in-out infinite;
  }

  .lp-check-list { list-style: none; padding: 0; margin: 0; }
  .lp-check-list li {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    margin-bottom: 10px;
    font-size: 14px;
    color: rgba(245,240,235,0.8);
  }
  .lp-check-list li::before {
    content: '✓';
    color: #E8702A;
    font-weight: 700;
    flex-shrink: 0;
    margin-top: 1px;
  }

  .lp-coaching-card {
    background: linear-gradient(145deg, #242120, #1A1918);
    border: 1px solid rgba(245,240,235,0.08);
    border-radius: 14px;
    padding: 22px 20px;
    margin-bottom: 12px;
    display: flex;
    align-items: flex-start;
    gap: 14px;
  }

  .lp-live-dot {
    width: 8px; height: 8px;
    background: #4ade80;
    border-radius: 50%;
    display: inline-block;
    animation: pulse 2s ease-in-out infinite;
    margin-right: 6px;
  }

  .lp-stat-card {
    background: #242120;
    border-radius: 14px;
    padding: 24px;
    border: 1px solid rgba(245,240,235,0.06);
  }

  .lp-review-mockup {
    background: #fff;
    border-radius: 12px;
    padding: 16px;
    color: #111;
    margin-top: 20px;
  }
  .lp-star-row { color: #FBBC04; font-size: 16px; letter-spacing: 2px; }

  /* MOBILE */
  @media (max-width: 600px) {
    .lp-section { padding: 56px 18px; }
    .lp-btn-ghost { padding: 10px 16px !important; font-size: 13px !important; }
    .lp-btn-primary { padding: 10px 18px !important; font-size: 13px !important; }
    .lp-mockup-sidebar { display: none !important; }
    .lp-mockup-stats { flex-direction: column !important; }
  }

  /* CONTACT MODAL */
  .lp-contact-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.65);
    backdrop-filter: blur(4px);
    z-index: 999;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .lp-contact-sheet {
    background: #fff;
    border-radius: 24px 24px 0 0;
    padding: 28px 24px 40px;
    width: 100%;
    max-width: 480px;
    max-height: 92vh;
    overflow-y: auto;
    animation: lpSlideUp 0.3s ease both;
    font-family: 'DM Sans', sans-serif;
  }
  @keyframes lpSlideUp {
    from { transform: translateY(100%); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }
  .lp-contact-input {
    width: 100%;
    border: 1.5px solid #e0ddd9;
    border-radius: 10px;
    padding: 12px 14px;
    font-size: 14px;
    font-family: 'DM Sans', sans-serif;
    color: #111;
    background: #fafafa;
    outline: none;
    transition: border-color 0.15s;
    box-sizing: border-box;
    margin-bottom: 12px;
  }
  .lp-contact-input:focus { border-color: #E8702A; background: #fff; }
  .lp-contact-input::placeholder { color: #aaa; }
  textarea.lp-contact-input { resize: vertical; min-height: 90px; }

  /* BILLING TOGGLE */
  .lp-toggle-track {
    width: 48px;
    height: 26px;
    border-radius: 100px;
    background: #333;
    position: relative;
    cursor: pointer;
    transition: background 0.2s;
    flex-shrink: 0;
  }
  .lp-toggle-track.on { background: #22c55e; }
  .lp-toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: #fff;
    transition: transform 0.2s;
    box-shadow: 0 1px 4px rgba(0,0,0,0.3);
  }
  .lp-toggle-track.on .lp-toggle-thumb { transform: translateX(22px); }

`;

// ─── Ticker component ─────────────────────────────────────────────────────────
function Ticker() {
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
    <div className="lp-ticker-wrap">
      <div className="lp-ticker-inner">
        {doubled.map((item, i) => (
          <span className="lp-ticker-item" key={i}>
            <span style={{ color: ORANGE, fontSize: 16 }}>◆</span>
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function Home() {
  const navigate = useNavigate();
  const [showModal, setShowModal] = useState(false);
  const [annual, setAnnual] = useState(true);
  const [showContact, setShowContact] = useState(false);
  const [contactForm, setContactForm] = useState({ name: "", email: "", phone: "", message: "" });
  const [contactSent, setContactSent] = useState(false);

  function handleContactSubmit() {
    if (!contactForm.name || !contactForm.email) return;
    // Replace this with your real form submission / API call
    setContactSent(true);
    setTimeout(() => {
      setShowContact(false);
      setContactSent(false);
      setContactForm({ name: "", email: "", phone: "", message: "" });
    }, 2500);
  }

  const openModal  = () => setShowModal(true);
  const closeModal = () => setShowModal(false);
  function handleConsentAccepted() {
    setShowModal(false);
    navigate("/login");
  }

  return (
    <>
      <style>{pageStyle}</style>

      {/* HEADER — uses your real SiteHeader */}
      <SiteHeader onStartSetup={openModal} />

      {/* SMS MODAL — uses your real SmsConsentModal */}
      <SmsConsentModal
        isOpen={showModal}
        onClose={closeModal}
        onAccept={handleConsentAccepted}
      />

      {/* CONTACT MODAL */}
      {showContact && (
        <div
          className="lp-contact-overlay"
          onClick={(e) => { if (e.target === e.currentTarget) setShowContact(false); }}
        >
          <div className="lp-contact-sheet">

            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <div style={{ width: 48, height: 48, background: "#FFF0E6", borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 22, marginBottom: 14 }}>☎️</div>
                <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 800, color: "#111", marginBottom: 4 }}>Get in touch</h2>
                <p style={{ fontSize: 14, color: "#777", lineHeight: 1.5 }}>We'll get back to you within one business day.</p>
              </div>
              <button
                onClick={() => setShowContact(false)}
                style={{ background: "none", border: "none", fontSize: 20, color: "#aaa", cursor: "pointer", padding: 4, lineHeight: 1, flexShrink: 0 }}
              >✕</button>
            </div>

            {contactSent ? (
              <div style={{ textAlign: "center", padding: "32px 0" }}>
                <div style={{ fontSize: 40, marginBottom: 14 }}>✅</div>
                <div style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 700, color: "#111", marginBottom: 8 }}>Message sent!</div>
                <p style={{ fontSize: 14, color: "#777" }}>We'll be in touch shortly.</p>
              </div>
            ) : (
              <>
                <input
                  className="lp-contact-input"
                  placeholder="Your name *"
                  value={contactForm.name}
                  onChange={e => setContactForm({ ...contactForm, name: e.target.value })}
                />
                <input
                  className="lp-contact-input"
                  placeholder="Email address *"
                  type="email"
                  value={contactForm.email}
                  onChange={e => setContactForm({ ...contactForm, email: e.target.value })}
                />
                <input
                  className="lp-contact-input"
                  placeholder="Phone number"
                  type="tel"
                  value={contactForm.phone}
                  onChange={e => setContactForm({ ...contactForm, phone: e.target.value })}
                />
                <textarea
                  className="lp-contact-input"
                  placeholder="What can we help you with?"
                  value={contactForm.message}
                  onChange={e => setContactForm({ ...contactForm, message: e.target.value })}
                />

                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <button
                    onClick={() => setShowContact(false)}
                    style={{ flex: 1, background: "#fff", border: "1.5px solid #ddd", borderRadius: 10, padding: 14, fontSize: 15, fontWeight: 600, color: "#333", cursor: "pointer", fontFamily: "'DM Sans', sans-serif" }}
                  >Cancel</button>
                  <button
                    onClick={handleContactSubmit}
                    disabled={!contactForm.name || !contactForm.email}
                    style={{
                      flex: 1.4,
                      background: contactForm.name && contactForm.email ? ORANGE : "#ccc",
                      border: "none",
                      borderRadius: 10,
                      padding: 14,
                      fontSize: 15,
                      fontWeight: 700,
                      color: "#fff",
                      cursor: contactForm.name && contactForm.email ? "pointer" : "not-allowed",
                      fontFamily: "'Syne', sans-serif",
                      transition: "background 0.15s",
                    }}
                  >Send message →</button>
                </div>

                <p style={{ fontSize: 11, color: "#bbb", textAlign: "center", marginTop: 14 }}>
                  By submitting you agree to receive SMS messages from AI Front Desk Helper. Reply STOP to opt out.
                </p>
              </>
            )}
          </div>
        </div>
      )}

      <div style={{ background: DARK, minHeight: "100vh" }}>

        {/* ── HERO ─────────────────────────────────────────────────────────── */}
        <section style={{ padding: "80px 24px 0", textAlign: "center", maxWidth: 1100, margin: "0 auto" }}>

          <div className="fade-up d1" style={{ marginBottom: 28 }}>
            <span className="lp-tag">
              <span style={{ fontSize: 14 }}>⚡</span>
              Not another call bot
            </span>
          </div>

          <h1 className="syne fade-up d2" style={{
            fontSize: "clamp(44px, 7vw, 88px)",
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: "-0.03em",
            color: OFF_WHITE,
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

          <div className="fade-up d4" style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 56 }}>
            <button className="lp-btn-primary" style={{ fontSize: 17, padding: "16px 36px" }} onClick={openModal}>
              Start free →
            </button>
            <button className="lp-btn-ghost" style={{ fontSize: 16, padding: "15px 30px" }} onClick={() => setShowContact(true)}>
              Get in touch ☎
            </button>
          </div>

          {/* Stats bar */}
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
              { val: "28",    label: "Calls / mo" },
              { val: "53%",   label: "Booking rate" },
              { val: "$11.5k",label: "Tracked rev" },
            ].map((s, i) => (
              <div key={i} style={{ textAlign: "center" }}>
                <div className="syne" style={{ fontSize: "clamp(26px, 3.5vw, 38px)", fontWeight: 800, color: ORANGE, lineHeight: 1 }}>{s.val}</div>
                <div style={{ fontSize: 13, color: MUTED, marginTop: 4 }}>{s.label}</div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 10, textAlign: "center", marginBottom: 48 }}>
            <span className="lp-live-dot" />
            Live on Gladiators Painting · Omaha, NE
          </div>

          {/* Dashboard mockup */}
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
            {/* Top bar */}
            <div style={{ background: "#111", padding: "12px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid rgba(245,240,235,0.08)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: OFF_WHITE, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 11, color: "#222" }}>FD</div>
                <div>
                  <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 13, color: OFF_WHITE }}>Gladiators Painting</div>
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

            {/* Body */}
            <div style={{ display: "flex", minHeight: 340 }}>
              {/* Sidebar */}
              <div className="lp-mockup-sidebar" style={{ width: 180, background: "#161514", borderRight: "1px solid rgba(245,240,235,0.06)", padding: "16px 0", flexShrink: 0, display: "flex", flexDirection: "column" }}>
                {[
                  { icon: "📞", label: "Live Calls", active: true },
                  { icon: "📅", label: "Calendar" },
                  { icon: "💬", label: "SMS Follow-ups" },
                  { icon: "📊", label: "Revenue" },
                  { icon: "🎯", label: "Coaching" },
                ].map((item, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px", background: item.active ? "rgba(232,112,42,0.15)" : "transparent", borderLeft: item.active ? `3px solid ${ORANGE}` : "3px solid transparent" }}>
                    <span style={{ fontSize: 14 }}>{item.icon}</span>
                    <span style={{ fontSize: 13, fontWeight: item.active ? 600 : 400, color: item.active ? OFF_WHITE : MUTED }}>{item.label}</span>
                  </div>
                ))}
              </div>

              {/* Main panel */}
              <div style={{ flex: 1, padding: "20px 24px", overflow: "hidden" }}>
                <div style={{ background: "#111", borderRadius: 12, padding: "16px 18px", border: "1px solid rgba(245,240,235,0.08)", marginBottom: 16 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <div>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: 14, color: OFF_WHITE }}>Live Transcript</div>
                      <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>+1 (713) 555-0199 · Houston, TX</div>
                    </div>
                    <div style={{ background: "#1a3a5c", color: "#60b4ff", fontSize: 11, fontWeight: 700, padding: "4px 10px", borderRadius: 20, display: "flex", alignItems: "center", gap: 5 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#60b4ff", display: "inline-block" }} />
                      LIVE
                    </div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {[
                      { from: "ai",   text: "Thank you for calling Gladiators Painting! Are you looking to schedule a free painting estimate?" },
                      { from: "user", text: "Yes, I need the exterior of my house painted. It's a two-story home." },
                      { from: "ai",   text: "Great! I can get you scheduled. What's the best date this week for an estimate?" },
                    ].map((msg, i) => (
                      <div key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start", justifyContent: msg.from === "user" ? "flex-end" : "flex-start" }}>
                        {msg.from === "ai" && <div style={{ width: 28, height: 28, borderRadius: "50%", background: "rgba(232,112,42,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>🤖</div>}
                        <div style={{ background: msg.from === "ai" ? CARD_MID : ORANGE, borderRadius: msg.from === "ai" ? "4px 14px 14px 14px" : "14px 4px 14px 14px", padding: "10px 14px", fontSize: 13, color: "#fff", lineHeight: 1.5, maxWidth: "75%" }}>{msg.text}</div>
                        {msg.from === "user" && <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#333", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>👤</div>}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="lp-mockup-stats" style={{ display: "flex", gap: 12 }}>
                  {[
                    { label: "Booking rate", val: "53%",    sub: "vs 20–30% avg" },
                    { label: "Est. recovered", val: "$4,200", sub: "last 30 days" },
                    { label: "Follow-ups sent", val: "47",   sub: "this month" },
                  ].map((card, i) => (
                    <div key={i} style={{ flex: 1, background: "#111", border: "1px solid rgba(245,240,235,0.07)", borderRadius: 10, padding: "12px 14px" }}>
                      <div style={{ fontSize: 11, color: MUTED, marginBottom: 4 }}>{card.label}</div>
                      <div style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: 18, color: ORANGE }}>{card.val}</div>
                      <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>{card.sub}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── TICKER ───────────────────────────────────────────────────────── */}
        <Ticker />

        {/* ── NOT A CALL BOT ───────────────────────────────────────────────── */}
        <section className="lp-section" style={{ paddingTop: 72, paddingBottom: 64 }}>
          <div className="lp-eyebrow">Why this is different</div>
          <h2 className="syne" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2, marginBottom: 20, color: OFF_WHITE }}>
            Call bots answer the phone.<br/>
            <span style={{ color: ORANGE }}>We close more revenue.</span>
          </h2>
          <p style={{ fontSize: 14, color: "rgba(245,240,235,0.6)", lineHeight: 1.7, marginBottom: 28 }}>
            Tools like Goodcall and Smith.ai stop at inbound. That's table stakes.
            The real money is in what happens <span style={{ color: OFF_WHITE }}>after</span> the call — follow-up, recovery, coaching, and referrals.
          </p>
          <div style={{ borderRadius: 14, overflow: "hidden", border: "1px solid rgba(245,240,235,0.08)" }}>
            <div style={{ display: "flex", background: CARD_MID, padding: "10px 12px" }}>
              <div style={{ flex: 1, fontSize: 11, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Feature</div>
              <div style={{ width: 90, textAlign: "center", fontSize: 11, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em" }}>Call bots</div>
              <div style={{ width: 90, textAlign: "center", fontSize: 11, color: ORANGE, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>AFDH</div>
            </div>
            {[
              ["Answers inbound calls",       true,  true],
              ["Books appointments",          true,  true],
              ["Outbound campaigns",          false, true],
              ["Script retiring (win-backs)", false, true],
              ["Estimate follow-up sequence", false, true],
              ["AI revenue coaching",         false, true],
              ["Review response writer",      false, true],
              ["Close rate by lead source",   false, true],
            ].map(([label, callBot, us], i) => (
              <div key={i} style={{ display: "flex", padding: "11px 12px", borderTop: "1px solid rgba(245,240,235,0.05)", background: i % 2 === 0 ? CARD_DARK : "transparent" }}>
                <div style={{ flex: 1, fontSize: 13, color: "rgba(245,240,235,0.75)" }}>{label}</div>
                <div style={{ width: 90, textAlign: "center", fontSize: 15, color: callBot ? OFF_WHITE : "#444" }}>{callBot ? "✓" : "✕"}</div>
                <div style={{ width: 90, textAlign: "center", fontSize: 15, color: ORANGE }}>{us ? "✓" : "✕"}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── FEATURES ─────────────────────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-eyebrow">Features</div>
          <h2 className="syne" style={{ fontSize: "clamp(28px, 4vw, 40px)", fontWeight: 800, lineHeight: 1.15, marginBottom: 8, color: OFF_WHITE }}>
            The full revenue pipeline
          </h2>
          <p style={{ fontSize: 15, color: MUTED, marginBottom: 40, lineHeight: 1.6 }}>
            Every step automates something your team was dropping.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {[
              { icon: "🎧", title: "AI Receptionist",        desc: "Natural conversations 24/7. Answers calls, asks the right questions, and sounds like a real team member. Live transcripts in your dashboard.", highlight: false },
              { icon: "📅", title: "Book & Transfer",         desc: "Books estimates directly into Google Calendar and your CRM. Live-transfer to your team when the caller needs a human.", highlight: false },
              { icon: "⚡", title: "Objection Detection",     desc: "When someone says 'too expensive' or 'need to think about it' the AI detects it and switches to the right recovery sequence.", highlight: false },
              { icon: "💬", title: "SMS Follow-ups",          desc: "Automated follow-ups at 24h, 3d, 5d, and 10d so quotes don't go cold. Intelligent sequences — not generic blasts.", highlight: false },
              { icon: "📞", title: "Outbound Campaigns",      desc: "AI calls your past customer list — win-backs, seasonal reactivation, referral asks. You set the campaign; AI dials.", highlight: true },
              { icon: "📊", title: "AI Revenue Coaching",     desc: "Every phone number is tagged to a lead source. AI tells you which marketing channels are producing booked revenue — and where to stop spending.", highlight: true },
              { icon: "⭐", title: "Review Response Writer",  desc: "Customer leaves a Google review — one click generates an SEO-optimized owner response. Every review gets replied to.", highlight: true },
              { icon: "👥", title: "Referral Autopilot",      desc: "AI texts your happy customers asking for a referral by name. Captures the contact and calls the referral within minutes.", highlight: true },
            ].map((feat, i) => (
              <div
                key={i}
                style={{ background: CARD_DARK, border: `1px solid ${feat.highlight ? "rgba(232,112,42,0.25)" : "rgba(245,240,235,0.07)"}`, borderRadius: 14, padding: "22px 24px", display: "flex", gap: 18, alignItems: "flex-start", transition: "border-color 0.2s, transform 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor = "rgba(232,112,42,0.4)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor = feat.highlight ? "rgba(232,112,42,0.25)" : "rgba(245,240,235,0.07)"; e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <div style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, background: feat.highlight ? "rgba(232,112,42,0.15)" : "rgba(245,240,235,0.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>{feat.icon}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                    <span className="syne" style={{ fontSize: 16, fontWeight: 700, color: OFF_WHITE }}>{feat.title}</span>
                    {feat.highlight && <span style={{ background: ORANGE, color: "#fff", fontSize: 9, fontWeight: 700, padding: "2px 7px", borderRadius: 3, letterSpacing: "0.06em", textTransform: "uppercase" }}>Elite</span>}
                  </div>
                  <p style={{ fontSize: 13, color: "rgba(245,240,235,0.6)", lineHeight: 1.65, margin: 0 }}>{feat.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* ── STICKY ELITE BAR ─────────────────────────────────────────────── */}
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 200, background: "linear-gradient(90deg, #1a1008, #2a1505)", borderTop: `2px solid ${ORANGE}`, padding: "14px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, boxShadow: "0 -4px 32px rgba(232,112,42,0.2)" }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: ORANGE, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 2 }}>Elite Plan · Full Revenue Machine</div>
            <div className="syne" style={{ fontSize: "clamp(14px, 2.5vw, 18px)", fontWeight: 800, color: OFF_WHITE }}>
              Do it all for you — <span style={{ color: ORANGE }}>$997/mo</span> →
            </div>
          </div>
          <button className="lp-btn-primary" style={{ padding: "12px 24px", fontSize: 14, whiteSpace: "nowrap", flexShrink: 0 }} onClick={openModal}>
            Start now
          </button>
        </div>

        <div className="lp-divider" />

        {/* ── HOW IT WORKS ─────────────────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-eyebrow">How it works</div>
          <h2 className="syne" style={{ fontSize: "clamp(28px, 5vw, 40px)", fontWeight: 800, lineHeight: 1.15, marginBottom: 8, color: OFF_WHITE }}>
            Set up in minutes
          </h2>
          <p style={{ fontSize: 14, color: MUTED, marginBottom: 40, lineHeight: 1.6 }}>
            Your existing number or a new one — we handle the rest.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {[
              { step: "STEP 1", icon: "📞", title: "Connect your number",  desc: "Point your Twilio number to AI Front Desk Helper. No new hardware — works with your current phone system." },
              { step: "STEP 2", icon: "⚙️", title: "Configure once",        desc: "Set your welcome message, transfer numbers, and CRM webhook in the dashboard. The AI follows your playbook." },
              { step: "STEP 3", icon: "⚡", title: "Let it run",            desc: "Every call is answered, recorded, and transcribed. Review calls and metrics anytime from your dashboard." },
            ].map((item, i) => (
              <div key={i} style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.07)", borderRadius: 16, padding: "28px 24px", textAlign: "center" }}>
                <div style={{ width: 56, height: 56, borderRadius: 14, background: "rgba(232,112,42,0.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24, margin: "0 auto 16px" }}>{item.icon}</div>
                <div style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>{item.step}</div>
                <div className="syne" style={{ fontSize: 18, fontWeight: 700, color: OFF_WHITE, marginBottom: 10 }}>{item.title}</div>
                <p style={{ fontSize: 13, color: "rgba(245,240,235,0.6)", lineHeight: 1.65, margin: 0 }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── OUTBOUND ─────────────────────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-eyebrow">Outbound AI</div>
          <h2 className="syne" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2, marginBottom: 16, color: OFF_WHITE }}>
            Retire the call script.<br/>
            <span style={{ color: ORANGE }}>Let AI dial for you.</span>
          </h2>
          <p style={{ fontSize: 14, color: "rgba(245,240,235,0.65)", lineHeight: 1.7, marginBottom: 28 }}>
            Your past customer list is money sitting untouched. AI Front Desk Helper runs outbound campaigns to win back cold leads, re-engage past customers, and ask for referrals — without a salesperson picking up a phone.
          </p>
          {[
            { icon: "🔁", title: "Win-back campaigns",    desc: "Re-engage customers who got a quote but never booked. Automated, personalized outreach." },
            { icon: "📅", title: "Seasonal reactivation", desc: "Spring exterior, fall interior — AI reaches out to your past customers on schedule." },
            { icon: "🤝", title: "Referral campaigns",    desc: "AI asks happy customers for a referral by name. Captures the contact and calls them automatically." },
            { icon: "📋", title: "Estimate recovery",     desc: "Quotes that went cold get a follow-up call at 24h, 3d, 5d, 10d. Intelligent objection handling included." },
          ].map((item, i) => (
            <div key={i} className="lp-coaching-card">
              <div style={{ width: 40, height: 40, borderRadius: 10, background: "rgba(232,112,42,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, flexShrink: 0 }}>{item.icon}</div>
              <div>
                <div className="syne" style={{ fontWeight: 700, fontSize: 15, marginBottom: 4, color: OFF_WHITE }}>{item.title}</div>
                <div style={{ fontSize: 13, color: "rgba(245,240,235,0.6)", lineHeight: 1.6 }}>{item.desc}</div>
              </div>
            </div>
          ))}
        </section>

        <div className="lp-divider" />

        {/* ── AI COACHING ──────────────────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-eyebrow">AI Revenue Coaching</div>
          <h2 className="syne" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2, marginBottom: 16, color: OFF_WHITE }}>
            Know which marketing<br/>
            <span style={{ color: ORANGE }}>is actually working</span>
          </h2>
          <p style={{ fontSize: 14, color: "rgba(245,240,235,0.65)", lineHeight: 1.7, marginBottom: 28 }}>
            Every phone number is tagged to a lead source. AI connects that to call outcomes, bookings, and revenue — then tells you exactly where to put your marketing dollars and what to stop spending on.
          </p>
          <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.08)", borderRadius: 16, overflow: "hidden" }}>
            <div style={{ background: CARD_MID, padding: "14px 18px", borderBottom: "1px solid rgba(245,240,235,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="syne" style={{ fontSize: 13, fontWeight: 700, color: OFF_WHITE }}>AI Coaching — This Week</span>
              <span style={{ fontSize: 11, color: MUTED }}>Updated daily</span>
            </div>
            {[
              { icon: "📊", label: "Marketing strategy",  insight: "Yard signs produced 14 leads at $0 cost — your highest ROI source. Google Ads delivered 9 leads at ~$38/lead. Consider shifting budget toward physical signage this quarter.", type: "good" },
              { icon: "📉", label: "Estimate recovery",   insight: "Facebook leads are booking at 28% vs 61% for Google Organic. Facebook follow-up sequence may need a stronger hook on day 3.", type: "warn" },
              { icon: "✅", label: "Close rate trend",    insight: "Leads who hear a price range on call 1 book 2× more. Your AI is already doing this.", type: "good" },
              { icon: "💡", label: "Objection pattern",   insight: "'Too expensive' detected on 6 calls this week. Consider adding a financing mention to your playbook.", type: "info" },
            ].map((item, i) => (
              <div key={i} style={{ padding: "14px 18px", borderBottom: i < 3 ? "1px solid rgba(245,240,235,0.06)" : "none", display: "flex", gap: 12, alignItems: "flex-start" }}>
                <span style={{ fontSize: 16, marginTop: 1 }}>{item.icon}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: item.type === "warn" ? "#FFA040" : item.type === "good" ? "#4ade80" : "#60a5fa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{item.label}</div>
                  <div style={{ fontSize: 13, color: "rgba(245,240,235,0.7)", lineHeight: 1.55 }}>{item.insight}</div>
                </div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 12, color: MUTED, textAlign: "center", marginTop: 12 }}>Franchise owners get coaching across all locations in one HQ view.</p>
        </section>

        <div className="lp-divider" />

        {/* ── REVIEW RESPONSE ──────────────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-eyebrow">Review Response Writer</div>
          <h2 className="syne" style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.2, marginBottom: 16, color: OFF_WHITE }}>
            Every review gets an<br/>
            <span style={{ color: ORANGE }}>SEO-optimized response.</span>
          </h2>
          <p style={{ fontSize: 14, color: "rgba(245,240,235,0.65)", lineHeight: 1.7, marginBottom: 12 }}>
            When a customer leaves a Google review, AI writes your owner response — naturally weaving in your business name, city, and service keywords. More visibility in local search. Zero time staring at a blank reply box.
          </p>
          <div className="lp-review-mockup">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: "50%", background: "#4285F4", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700, fontSize: 15 }}>S</div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, color: "#111" }}>Sarah M.</div>
                <div className="lp-star-row">★★★★★</div>
              </div>
            </div>
            <p style={{ fontSize: 13, color: "#333", lineHeight: 1.6, marginBottom: 14 }}>
              Gladiators Painting did an incredible job on our exterior. Team was punctual and the color matching was perfect. Will absolutely use them again.
            </p>
            <div style={{ background: "#F8F8F8", borderLeft: "3px solid #E8702A", borderRadius: "0 8px 8px 0", padding: "12px 14px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#555", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.05em" }}>Response from the owner</div>
              <p style={{ fontSize: 12, color: "#444", lineHeight: 1.65 }}>
                Thank you so much, Sarah! We're thrilled the exterior painting turned out exactly how you envisioned. Gladiators Painting takes pride in clean, professional work for homeowners throughout Omaha — it means the world to hear this feedback. We'd love to help with that interior project next spring. 🎨
              </p>
              <div style={{ marginTop: 8 }}>
                <span style={{ background: "#FFF3E8", color: ORANGE, fontSize: 10, padding: "2px 7px", borderRadius: 3, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>AI-written · SEO optimized</span>
              </div>
            </div>
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── GLADIATORS PROOF ─────────────────────────────────────────────── */}
        <section className="lp-section">
          <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.07)", borderRadius: 20, padding: "32px 24px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: ORANGE, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>Real results — Gladiators Painting</div>
            <h3 className="syne" style={{ fontSize: 24, fontWeight: 800, lineHeight: 1.3, marginBottom: 12, color: OFF_WHITE }}>Running live on a real painting company right now</h3>
            <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.65, marginBottom: 28 }}>We didn't build this for contractors — we built it as one. Every feature was tested on a real painting business before it shipped.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 20 }}>
              {[
                { val: "28",     label: "Calls answered by AI last month" },
                { val: "53%",    label: "Booking rate (industry avg: 20–30%)" },
                { val: "$11,500",label: "Revenue tracked in dashboard" },
                { val: "15",     label: "AI-booked estimates, last 30 days" },
              ].map((s, i) => (
                <div key={i} className="lp-stat-card">
                  <div className="syne" style={{ fontSize: i === 2 ? 22 : 28, fontWeight: 800, color: ORANGE, lineHeight: 1.1, marginBottom: 4 }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: MUTED, lineHeight: 1.5 }}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{ borderLeft: `3px solid ${ORANGE}`, paddingLeft: 16 }}>
              <p style={{ fontSize: 15, fontStyle: "italic", lineHeight: 1.7, color: "rgba(245,240,235,0.8)" }}>
                "I built this for my own painting company because I was losing jobs to voicemail every day on the job site. Now it answers every call, follows up on every cold estimate, and coaches me on what to fix."
              </p>
              <div style={{ marginTop: 10, fontSize: 13, color: MUTED }}>Drew — Owner, Gladiators Painting & Founder, AFDH</div>
            </div>
          </div>
        </section>

        <div className="lp-divider" />

        {/* ── WHO IT'S FOR ─────────────────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-eyebrow">Built for</div>
          <h2 className="syne" style={{ fontSize: 28, fontWeight: 800, marginBottom: 28, color: OFF_WHITE }}>
            Home service pros who are done leaving money on the table
          </h2>
          {[
            { trade: "Painting contractors", line: "Answer every estimate call. Follow up every cold quote. Retire the call script." },
            { trade: "Roofing companies",    line: "Speed-to-lead wins in roofing. AI answers in 2 rings, books the inspection." },
            { trade: "HVAC & plumbing",      line: "Emergency after-hours calls captured automatically. Never miss an urgent job." },
            { trade: "Fencing & landscaping",line: "Outbound AI calls your seasonal past customers. Reactivation on autopilot." },
            { trade: "Franchise groups",     line: "HQ dashboard with AI coaching across all locations. Built for multi-unit scale." },
          ].map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 14, padding: "16px 0", borderBottom: i < 4 ? "1px solid rgba(245,240,235,0.07)" : "none" }}>
              <span style={{ color: ORANGE, fontSize: 18, marginTop: 2 }}>→</span>
              <div>
                <div className="syne" style={{ fontSize: 15, fontWeight: 700, marginBottom: 3, color: OFF_WHITE }}>{item.trade}</div>
                <div style={{ fontSize: 13, color: MUTED, lineHeight: 1.55 }}>{item.line}</div>
              </div>
            </div>
          ))}
        </section>

        <div className="lp-divider" />

        {/* ── PRICING ──────────────────────────────────────────────────────── */}
        <section className="lp-section">
          <div className="lp-eyebrow">Pricing</div>
          <h2 className="syne" style={{ fontSize: 28, fontWeight: 800, marginBottom: 8, color: OFF_WHITE }}>Let the system do it all.</h2>
          <p style={{ fontSize: 14, color: MUTED, marginBottom: 32, lineHeight: 1.6 }}>
            Basic gets you in the door. Elite is where the real revenue machine runs — outbound, coaching, reviews, and full pipeline automation. Most contractors who try Pro move to Elite within 60 days.
          </p>

          {/* Billing toggle */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, marginBottom: 36 }}>
            <span style={{ fontSize: 14, fontWeight: annual ? 400 : 700, color: annual ? MUTED : OFF_WHITE, transition: "color 0.2s" }}>Monthly</span>
            <div
              className={`lp-toggle-track ${annual ? "on" : ""}`}
              onClick={() => setAnnual(!annual)}
              role="switch"
              aria-checked={annual}
            >
              <div className="lp-toggle-thumb" />
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: annual ? 700 : 400, color: annual ? OFF_WHITE : MUTED, transition: "color 0.2s" }}>Annual</span>
              <span style={{
                background: annual ? "rgba(34,197,94,0.12)" : "rgba(245,240,235,0.06)",
                color: annual ? "#22c55e" : MUTED,
                border: `1px solid ${annual ? "rgba(34,197,94,0.3)" : "rgba(245,240,235,0.1)"}`,
                borderRadius: 100,
                fontSize: 11,
                fontWeight: 700,
                padding: "3px 10px",
                letterSpacing: "0.05em",
                transition: "all 0.2s",
              }}>2 months free</span>
            </div>
          </div>

          {[
            {
              tier: "Basic",
              label: "SMALL OPS",
              tagline: "AI Front Desk Starter",
              monthlyPrice: 297,
              annualPrice: 248,
              annualTotal: 2976,
              setup: "+$197 setup",
              desc: "For contractors who want to stop missing calls.",
              features: ["24/7 AI call answering", "Missed call text-back", "Lead capture & CRM sync", "Call transcripts"],
              featured: false,
            },
            {
              tier: "Pro",
              label: "GROWING TEAMS",
              tagline: "AI Booking Assistant",
              monthlyPrice: 497,
              annualPrice: 414,
              annualTotal: 4968,
              setup: "+$297 setup",
              desc: "Full booking, follow-up, and multi-channel coverage.",
              features: ["Everything in Basic", "Google Calendar booking", "SMS follow-up sequences", "Website AI chat widget", "Appointment reminders", "Facebook Messenger"],
              featured: false,
            },
            {
              tier: "Elite",
              label: "THE FULL SYSTEM",
              tagline: "AI Revenue Machine",
              monthlyPrice: 997,
              annualPrice: 831,
              annualTotal: 9972,
              setup: "+$497 setup",
              desc: "Everything. Inbound, outbound, coaching, reviews, and franchise-ready HQ tools.",
              features: ["Everything in Pro", "Outbound AI campaigns", "Script retiring & win-backs", "AI revenue coaching", "Lead source marketing insights", "Review response writer (SEO)", "Objection detection", "Referral autopilot", "HQ franchise rollup"],
              featured: true,
            },
          ].map((plan, i) => {
            const displayPrice = annual ? plan.annualPrice : plan.monthlyPrice;
            const saving = plan.monthlyPrice * 12 - plan.annualTotal;
            return (
              <div key={i} className={`lp-price-card ${plan.featured ? "featured" : ""}`}>
                {plan.featured && (
                  <div style={{ position: "absolute", top: -12, left: "50%", transform: "translateX(-50%)", background: ORANGE, color: "#fff", fontSize: 11, fontWeight: 700, padding: "4px 14px", borderRadius: 100, letterSpacing: "0.08em", textTransform: "uppercase", whiteSpace: "nowrap" }}>
                    Best value — do it all
                  </div>
                )}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontSize: 11, color: MUTED, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>{plan.label}</div>
                    <div className="syne" style={{ fontSize: 22, fontWeight: 800, color: OFF_WHITE }}>{plan.tier}</div>
                    <div style={{ fontSize: 13, color: MUTED }}>{plan.tagline}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 4, justifyContent: "flex-end" }}>
                      {annual && (
                        <span style={{ fontSize: 15, color: MUTED, textDecoration: "line-through", fontWeight: 400 }}>
                          ${plan.monthlyPrice}
                        </span>
                      )}
                      <span className="syne" style={{ fontSize: 26, fontWeight: 800, color: OFF_WHITE }}>
                        ${displayPrice}
                      </span>
                      <span style={{ fontSize: 14, fontWeight: 500, color: MUTED }}>/mo</span>
                    </div>
                    {annual ? (
                      <div style={{ fontSize: 11, color: "#22c55e", marginTop: 2 }}>
                        Billed ${plan.annualTotal.toLocaleString()}/yr · save ${saving.toLocaleString()}
                      </div>
                    ) : (
                      <div style={{ fontSize: 12, color: ORANGE }}>{plan.setup}</div>
                    )}
                  </div>
                </div>
                <p style={{ fontSize: 13, color: "rgba(245,240,235,0.55)", marginBottom: 16, lineHeight: 1.5 }}>{plan.desc}</p>
                <ul className="lp-check-list">
                  {plan.features.map((f, j) => <li key={j}>{f}</li>)}
                </ul>
                <button
                  className={plan.featured ? "lp-btn-primary" : "lp-btn-ghost"}
                  style={{ width: "100%", marginTop: 20, fontSize: 15, padding: "14px", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
                  onClick={openModal}
                >
                  {annual ? (
                    <>
                      Get started
                      <span style={{ background: "rgba(34,197,94,0.2)", color: "#22c55e", fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 100, letterSpacing: "0.04em" }}>
                        save ${saving.toLocaleString()}
                      </span>
                    </>
                  ) : "Get started"}
                </button>
              </div>
            );
          })}
        </section>

        {/* ── FINAL CTA ────────────────────────────────────────────────────── */}
        <section style={{ padding: "72px 24px 160px", textAlign: "center" }}>
          <div style={{ background: "radial-gradient(ellipse at center, rgba(232,112,42,0.15) 0%, transparent 70%)", paddingBottom: 8 }}>
            <h2 className="syne" style={{ fontSize: 36, fontWeight: 800, lineHeight: 1.2, marginBottom: 14, color: OFF_WHITE }}>
              Ready to stop <span style={{ color: ORANGE }}>missing revenue?</span>
            </h2>
            <p style={{ fontSize: 15, color: MUTED, marginBottom: 32, lineHeight: 1.6 }}>
              Create your account and connect your first number in minutes.
            </p>
            <button className="lp-btn-primary" style={{ fontSize: 17, padding: "16px 40px", marginBottom: 14 }} onClick={openModal}>
              Get Started →
            </button>
            <div style={{ marginTop: 12 }}>
              <Link to="/login" className="lp-btn-ghost" style={{ fontSize: 14, textDecoration: "none", display: "inline-block" }}>
                I already have an account
              </Link>
            </div>
            <p style={{ fontSize: 11, color: MUTED, marginTop: 18 }}>
              By signing up you agree to receive SMS messages from AI Front Desk Helper.
            </p>
          </div>
        </section>

      </div>

      {/* FOOTER — uses your real SiteFooter */}
      <SiteFooter onGetStarted={openModal} />
    </>
  );
}

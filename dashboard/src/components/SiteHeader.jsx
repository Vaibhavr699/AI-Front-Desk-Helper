import { Link, useNavigate } from "react-router-dom";
import { useState } from "react";

const ORANGE = "#E8702A";

/* ─────────────────────────────────────────────────────────────
   SMS CONSENT MODAL — dark design
───────────────────────────────────────────────────────────── */
export function SmsConsentModal({ isOpen, onClose, onAccept }) {
  const [checked, setChecked] = useState(false);
  if (!isOpen) return null;

  function handleAccept() {
    if (!checked) return;
    onAccept();
    setChecked(false);
  }
  function handleClose() {
    setChecked(false);
    onClose();
  }

  return (
    <div
      style={{ position:"fixed", inset:0, zIndex:600, display:"flex", alignItems:"flex-end", justifyContent:"center", background:"rgba(0,0,0,0.65)", backdropFilter:"blur(4px)" }}
      role="dialog" aria-modal="true" aria-labelledby="sms-consent-title"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div style={{ background:"#fff", borderRadius:"24px 24px 0 0", padding:"28px 24px 40px", width:"100%", maxWidth:480, maxHeight:"92vh", overflowY:"auto" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:20 }}>
          <div>
            <div style={{ width:48, height:48, background:"#FFF0E6", borderRadius:12, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22, marginBottom:14 }}>💬</div>
            <h2 id="sms-consent-title" style={{ fontFamily:"'Syne',sans-serif", fontSize:22, fontWeight:800, color:"#111", marginBottom:4 }}>Before you get started</h2>
            <p style={{ fontSize:14, color:"#777", lineHeight:1.5 }}>Please review and agree to our messaging policy.</p>
          </div>
          <button type="button" onClick={handleClose} style={{ background:"none", border:"none", fontSize:20, color:"#aaa", cursor:"pointer", padding:4 }} aria-label="Close">✕</button>
        </div>

        <div style={{ background:"#F7F7F7", borderRadius:10, padding:"14px 16px", fontSize:13, color:"#444", lineHeight:1.65, marginBottom:20 }}>
          By submitting this form, you agree to receive SMS text messages from{" "}
          <strong style={{ color:"#111" }}>AI Front Desk Helper</strong>{" "}
          related to your inquiry, including appointment scheduling, follow-ups, and service notifications.
          Message frequency may vary. Message and data rates may apply. Reply <strong>STOP</strong> to opt out or{" "}
          <strong>HELP</strong> for assistance. Consent is not required as a condition of purchasing services.{" "}
          <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color:ORANGE, fontWeight:600, textDecoration:"underline" }}>Privacy Policy</a>.
        </div>

        <div style={{ display:"flex", alignItems:"flex-start", gap:12, marginBottom:24, cursor:"pointer" }} onClick={() => setChecked(!checked)}>
          <div style={{ width:20, height:20, border:checked?`2px solid ${ORANGE}`:"2px solid #ccc", borderRadius:4, background:checked?ORANGE:"transparent", flexShrink:0, marginTop:1, display:"flex", alignItems:"center", justifyContent:"center", transition:"all 0.15s" }}>
            {checked && <span style={{ color:"#fff", fontSize:12, fontWeight:700 }}>✓</span>}
          </div>
          <span style={{ fontSize:14, color:"#333", lineHeight:1.55 }}>I have read and agree to the SMS messaging terms above.</span>
        </div>

        <div style={{ display:"flex", gap:12 }}>
          <button type="button" onClick={handleClose} style={{ flex:1, background:"#fff", border:"1.5px solid #ddd", borderRadius:10, padding:14, fontSize:15, fontWeight:600, color:"#333", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" }}>Cancel</button>
          <button type="button" onClick={handleAccept} disabled={!checked} style={{ flex:1.4, background:checked?ORANGE:"#ccc", border:"none", borderRadius:10, padding:14, fontSize:15, fontWeight:700, color:"#fff", cursor:checked?"pointer":"not-allowed", fontFamily:"'Syne',sans-serif" }}>
            Continue to sign up →
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   SITE HEADER — dark design
───────────────────────────────────────────────────────────── */
export function SiteHeader({ onStartSetup }) {
  const navigate = useNavigate();
  const [isSmsOpen, setIsSmsOpen] = useState(false);

  function handleStartSetup() {
    if (onStartSetup) { onStartSetup(); return; }
    setIsSmsOpen(true);
  }
  function handleConsentAccepted() {
    setIsSmsOpen(false);
    navigate("/login?signup=1");
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&family=DM+Sans:wght@400;500;600&display=swap');
        .afdh-header-signin:hover { color: #F5F0EB !important; }
        .afdh-start-btn:hover { background: #d15f20 !important; transform: translateY(-1px); }
      `}</style>
      <header style={{ position:"sticky", top:0, zIndex:500, background:"rgba(17,16,16,0.92)", backdropFilter:"blur(12px)", borderBottom:"1px solid rgba(245,240,235,0.06)", fontFamily:"'DM Sans',sans-serif" }}>
        <div style={{ maxWidth:480, margin:"0 auto", padding:"0 20px" }}>
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", height:60 }}>

            {/* Logo */}
            <Link to="/" style={{ display:"flex", alignItems:"center", gap:10, textDecoration:"none" }}>
              <div style={{ width:36, height:36, background:"#F5F0EB", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", overflow:"hidden", padding:3 }}>
                <img src="/favicon.png" alt="AI Front Desk Helper Logo" style={{ width:"100%", height:"100%", objectFit:"contain" }} />
              </div>
              <span style={{ fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13, color:"#F5F0EB", lineHeight:1.2 }}>
                AI Front Desk Helper
              </span>
            </Link>

            {/* Actions */}
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <Link to="/login" className="afdh-header-signin" style={{ fontSize:13, fontWeight:600, color:"rgba(245,240,235,0.65)", textDecoration:"none", padding:"8px 10px", transition:"color 0.2s" }}>
                Sign in
              </Link>
              <button
                className="afdh-start-btn"
                onClick={handleStartSetup}
                style={{ background:ORANGE, color:"#fff", border:"none", borderRadius:8, padding:"9px 18px", fontFamily:"'Syne',sans-serif", fontWeight:700, fontSize:13, cursor:"pointer", transition:"background 0.2s, transform 0.15s", boxShadow:"0 2px 12px rgba(232,112,42,0.35)", letterSpacing:"0.01em" }}
              >
                Start setup
              </button>
            </div>
          </div>
        </div>
      </header>

      <SmsConsentModal
        isOpen={isSmsOpen}
        onClose={() => setIsSmsOpen(false)}
        onAccept={handleConsentAccepted}
      />
    </>
  );
}

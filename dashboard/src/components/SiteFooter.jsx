import { Link } from "react-router-dom";

const ORANGE = "#E8702A";
const DARK = "#111010";
const CARD_DARK = "#1A1918";
const OFF_WHITE = "#F5F0EB";
const MUTED = "#8A8480";

export function SiteFooter({ onGetStarted }) {
  return (
    <footer style={{ background: CARD_DARK, borderTop: "1px solid rgba(245,240,235,0.06)", fontFamily: "'DM Sans', sans-serif", padding: "48px 24px 32px" }}>
      <div style={{ maxWidth: 480, margin: "0 auto" }}>

        {/* Logo + tagline */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
            <div style={{ width: 32, height: 32, background: OFF_WHITE, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", padding: 3 }}>
              <img src="/favicon.png" alt="Logo" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: OFF_WHITE }}>
              AI Front Desk Helper
            </span>
          </div>
          <p style={{ fontSize: 12, color: MUTED, lineHeight: 1.65, maxWidth: 320 }}>
            The AI revenue system built by a painting contractor, for home service pros who are done leaving money on the table.
          </p>
        </div>

        {/* Links */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 0", marginBottom: 32 }}>
          <Link
            to="/login"
            style={{ fontSize: 13, color: MUTED, textDecoration: "none", padding: "4px 0", transition: "color 0.2s" }}
            onMouseEnter={e => e.target.style.color = OFF_WHITE}
            onMouseLeave={e => e.target.style.color = MUTED}
          >
            Sign in
          </Link>
          <button
            onClick={onGetStarted}
            style={{ fontSize: 13, color: MUTED, background: "none", border: "none", padding: "4px 0", textAlign: "left", cursor: "pointer", transition: "color 0.2s", fontFamily: "'DM Sans', sans-serif" }}
            onMouseEnter={e => e.target.style.color = OFF_WHITE}
            onMouseLeave={e => e.target.style.color = MUTED}
          >
            Start free
          </button>
          <Link
            to="/privacy-policy"
            style={{ fontSize: 13, color: MUTED, textDecoration: "none", padding: "4px 0", transition: "color 0.2s" }}
            onMouseEnter={e => e.target.style.color = OFF_WHITE}
            onMouseLeave={e => e.target.style.color = MUTED}
          >
            Privacy Policy
          </Link>
          <Link
            to="/terms"
            style={{ fontSize: 13, color: MUTED, textDecoration: "none", padding: "4px 0", transition: "color 0.2s" }}
            onMouseEnter={e => e.target.style.color = OFF_WHITE}
            onMouseLeave={e => e.target.style.color = MUTED}
          >
            Terms of Service
          </Link>
          <Link
            to="/sms-terms"
            style={{ fontSize: 13, color: MUTED, textDecoration: "none", padding: "4px 0", transition: "color 0.2s" }}
            onMouseEnter={e => e.target.style.color = OFF_WHITE}
            onMouseLeave={e => e.target.style.color = MUTED}
          >
            SMS Policy
          </Link>
          <Link
            to="/contact"
            style={{ fontSize: 13, color: MUTED, textDecoration: "none", padding: "4px 0", transition: "color 0.2s" }}
            onMouseEnter={e => e.target.style.color = OFF_WHITE}
            onMouseLeave={e => e.target.style.color = MUTED}
          >
            Contact
          </Link>
        </div>

        {/* Divider */}
        <div style={{ height: 1, background: "rgba(245,240,235,0.06)", marginBottom: 20 }} />

        {/* SMS compliance */}
        <div style={{ background: "rgba(245,240,235,0.03)", border: "1px solid rgba(245,240,235,0.06)", borderRadius: 10, padding: "12px 14px", marginBottom: 20 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            SMS Messaging Policy
          </div>
          <p style={{ fontSize: 11, color: MUTED, lineHeight: 1.65 }}>
            By using our service, you agree to receive SMS messages from AI Front Desk Helper related to your account, appointments, and service notifications.
            Message frequency may vary. Message and data rates may apply.
            Reply <strong style={{ color: OFF_WHITE }}>STOP</strong> to opt out or <strong style={{ color: OFF_WHITE }}>HELP</strong> for assistance.
            Consent is not required as a condition of purchase.{" "}
            <Link to="/privacy-policy" style={{ color: ORANGE, textDecoration: "none" }}>Privacy Policy</Link>
            {" · "}
            <Link to="/sms-terms" style={{ color: ORANGE, textDecoration: "none" }}>SMS Terms</Link>
          </p>
        </div>

        {/* Bottom */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <p style={{ fontSize: 11, color: "rgba(138,132,128,0.5)" }}>
            © {new Date().getFullYear()} AI Front Desk Helper · aifrontdeskhelper.com
          </p>
          <p style={{ fontSize: 11, color: "rgba(138,132,128,0.4)" }}>
            Built in Omaha, NE
          </p>
        </div>
      </div>
    </footer>
  );
}

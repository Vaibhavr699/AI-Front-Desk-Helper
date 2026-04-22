import { Link } from "react-router-dom";

/**
 * Public-facing documentation page for 10DLC / A2P compliance
 * reviewers at Twilio. Built Apr 19, 2026 after campaign rejection
 * 30909. The goal is that a reviewer landing here — WITHOUT clicking
 * anything — can verify the full opt-in experience.
 *
 * Keep this page publicly accessible (no auth), keep all required
 * disclosures inline, keep the screenshot as a static asset served
 * from /public so reviewers don't hit a broken link.
 */

const DARK = "#111010";
const OFF_WHITE = "#F5F0EB";
const MUTED = "#8A8480";
const ORANGE = "#E8702A";
const CARD_DARK = "#1A1918";

export default function SmsConsent() {
  return (
    <div style={{ background: DARK, minHeight: "100vh", color: OFF_WHITE, fontFamily: "'DM Sans', sans-serif", padding: "48px 24px 80px" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>

        {/* Header */}
        <div style={{ marginBottom: 40, paddingBottom: 24, borderBottom: "1px solid rgba(245,240,235,0.08)" }}>
          <p style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.12em", marginBottom: 10, fontWeight: 700 }}>
            SMS Opt-In Documentation
          </p>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 32, fontWeight: 700, lineHeight: 1.15, marginBottom: 12 }}>
            How users consent to receive SMS from AI Front Desk Helper
          </h1>
          <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.6 }}>
            This page documents the complete SMS opt-in flow used on aifrontdeskhelper.com and the AI Front Desk Helper chat widget. All consent is collected through an active, affirmative checkbox — passive disclaimers alone are never relied upon.
          </p>
        </div>

        {/* Flow 1 — Website */}
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: ORANGE, textTransform: "uppercase", letterSpacing: "0.1em" }}>Flow 1</span>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700 }}>Marketing website (aifrontdeskhelper.com)</h2>
          </div>

          <ol style={{ fontSize: 15, color: MUTED, lineHeight: 1.75, paddingLeft: 20, marginBottom: 24 }}>
            <li style={{ marginBottom: 8 }}>User visits <a href="https://aifrontdeskhelper.com" style={{ color: ORANGE, textDecoration: "none" }}>aifrontdeskhelper.com</a> and clicks the <strong style={{ color: OFF_WHITE }}>Get Started</strong> button.</li>
            <li style={{ marginBottom: 8 }}>A modal appears immediately (shown in screenshot below) that <strong style={{ color: OFF_WHITE }}>blocks the signup flow</strong> until an unchecked consent checkbox is actively checked.</li>
            <li style={{ marginBottom: 8 }}>The <strong style={{ color: OFF_WHITE }}>Continue to sign up</strong> button remains disabled until the checkbox is checked.</li>
            <li style={{ marginBottom: 8 }}>The modal cannot be bypassed — clicking outside it or attempting to proceed without consent is not possible.</li>
            <li>Upon consent and form submission, the user receives a welcome SMS confirming opt-in and describing how to opt out.</li>
          </ol>

          {/* Screenshot */}
          <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.08)", borderRadius: 12, padding: 16, marginBottom: 16 }}>
            <p style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 12 }}>
              Live consent modal
            </p>
            <img
              src="/sms-consent-modal.png"
              alt="Screenshot of the AI Front Desk Helper SMS consent modal showing an unchecked checkbox and disabled Continue button"
              style={{ width: "100%", borderRadius: 8, border: "1px solid rgba(245,240,235,0.1)", display: "block" }}
            />
          </div>
        </section>

        {/* Exact consent language */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
            Exact consent language shown to every user
          </h2>
          <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.08)", borderRadius: 12, padding: 20, fontSize: 14, lineHeight: 1.7, color: OFF_WHITE }}>
            "By submitting this form, you agree to receive SMS text messages from <strong>AI Front Desk Helper</strong> related to your inquiry, including appointment scheduling, follow-ups, and service notifications. Message frequency may vary. Message and data rates may apply. Reply <strong>STOP</strong> to opt out or <strong>HELP</strong> for assistance. Consent is not required as a condition of purchasing services."
          </div>
        </section>

        {/* Flow 2 — Chat widget */}
        <section style={{ marginBottom: 48 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: ORANGE, textTransform: "uppercase", letterSpacing: "0.1em" }}>Flow 2</span>
            <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700 }}>Chat widget on client websites</h2>
          </div>
          <p style={{ fontSize: 15, color: MUTED, lineHeight: 1.7 }}>
            AI Front Desk Helper provides an embeddable chat widget deployed on customer websites (primarily home service businesses). When an end user interacts with the widget and opts to receive SMS follow-up, the same pre-SMS consent modal — with an unchecked checkbox and disabled submit button — is required before any SMS is sent. The consent language is identical to the language shown above.
          </p>
        </section>

        {/* Message samples */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
            Sample messages
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.08)", borderRadius: 10, padding: "14px 18px" }}>
              <p style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 6 }}>Appointment confirmation</p>
              <p style={{ fontSize: 14, color: OFF_WHITE, lineHeight: 1.6 }}>
                "Hi [Name], this is [Business Name] confirming your estimate on [Date] at [Time]. Reply STOP to opt out, HELP for help."
              </p>
            </div>
            <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.08)", borderRadius: 10, padding: "14px 18px" }}>
              <p style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 6 }}>Follow-up</p>
              <p style={{ fontSize: 14, color: OFF_WHITE, lineHeight: 1.6 }}>
                "Hi [Name], following up on your recent inquiry with [Business Name]. Let us know if you have questions. Reply STOP to opt out."
              </p>
            </div>
          </div>
        </section>

        {/* Keywords */}
        <section style={{ marginBottom: 48 }}>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 22, fontWeight: 700, marginBottom: 16 }}>
            Opt-out &amp; help keywords
          </h2>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.08)", borderRadius: 10, padding: 16 }}>
              <p style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8 }}>Opt-out keywords</p>
              <p style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.7 }}>STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT</p>
            </div>
            <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.08)", borderRadius: 10, padding: 16 }}>
              <p style={{ fontSize: 11, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 700, marginBottom: 8 }}>Help keywords</p>
              <p style={{ fontSize: 13, color: OFF_WHITE, lineHeight: 1.7 }}>HELP, INFO</p>
            </div>
          </div>
        </section>

        {/* Links */}
        <section style={{ paddingTop: 32, borderTop: "1px solid rgba(245,240,235,0.08)" }}>
          <h2 style={{ fontFamily: "'Syne', sans-serif", fontSize: 18, fontWeight: 700, marginBottom: 16 }}>
            Related policies
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Link to="/privacy-policy" style={{ color: ORANGE, fontSize: 14, textDecoration: "none" }}>→ Privacy Policy</Link>
            <Link to="/sms-terms" style={{ color: ORANGE, fontSize: 14, textDecoration: "none" }}>→ Full SMS Terms of Service</Link>
            <Link to="/terms" style={{ color: ORANGE, fontSize: 14, textDecoration: "none" }}>→ Terms of Service</Link>
            <a href="https://aifrontdeskhelper.com" style={{ color: ORANGE, fontSize: 14, textDecoration: "none" }}>→ Live opt-in flow (click "Get Started")</a>
          </div>
        </section>

      </div>
    </div>
  );
}

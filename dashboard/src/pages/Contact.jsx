import { useState } from "react";
import { SiteHeader } from "../components/SiteHeader";
import { SiteFooter } from "../components/SiteFooter";

const ORANGE = "#E8702A";
const DARK = "#111010";
const CARD_DARK = "#1A1918";
const OFF_WHITE = "#F5F0EB";
const MUTED = "#8A8480";

export default function Contact({ onGetStarted }) {
  const [form, setForm] = useState({ name: "", email: "", message: "" });
  const [status, setStatus] = useState("idle");

  function handleChange(e) {
    setForm({ ...form, [e.target.name]: e.target.value });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus("sending");
    try {
      const res = await fetch("https://formspree.io/f/YOUR_FORM_ID", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setStatus("sent");
        setForm({ name: "", email: "", message: "" });
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }

  return (
    <div style={{ background: DARK, minHeight: "100vh", fontFamily: "'DM Sans', sans-serif" }}>
      <SiteHeader onStartSetup={onGetStarted} />

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "64px 24px 80px" }}>

        {/* Heading */}
        <div style={{ marginBottom: 36 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: ORANGE, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 10 }}>
            Contact
          </div>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontSize: 36, fontWeight: 800, color: OFF_WHITE, lineHeight: 1.1, margin: "0 0 12px" }}>
            We're real people.<br />Talk to us.
          </h1>
          <p style={{ fontSize: 14, color: MUTED, lineHeight: 1.65, margin: 0 }}>
            Questions about the product, pricing, or getting set up — we respond fast.
          </p>
        </div>

        {/* Contact info card */}
        <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.07)", borderRadius: 16, padding: 28, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
            <div style={{ width: 36, height: 36, background: "rgba(232,112,42,0.12)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15 }}>✉</div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 3px" }}>Email</p>
              <a href="mailto:drew@aifrontdeskhelper.com" style={{ fontSize: 14, color: ORANGE, textDecoration: "none" }}>drew@aifrontdeskhelper.com</a>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
            <div style={{ width: 36, height: 36, background: "rgba(232,112,42,0.12)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15 }}>⏱</div>
            <div>
              <p style={{ fontSize: 11, fontWeight: 700, color: MUTED, textTransform: "uppercase", letterSpacing: "0.08em", margin: "0 0 3px" }}>Response time</p>
              <p style={{ fontSize: 14, color: OFF_WHITE, margin: 0 }}>Usually within a few hours, Mon–Fri</p>
            </div>
          </div>
        </div>

        {/* Form card */}
        <div style={{ background: CARD_DARK, border: "1px solid rgba(245,240,235,0.07)", borderRadius: 16, padding: 28 }}>
          <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 13, fontWeight: 700, color: OFF_WHITE, margin: "0 0 20px" }}>Send a message</p>

          {status === "sent" ? (
            <div style={{ textAlign: "center", padding: "32px 0" }}>
              <div style={{ fontSize: 28, marginBottom: 12 }}>✅</div>
              <p style={{ fontSize: 15, fontWeight: 700, color: OFF_WHITE, margin: "0 0 6px" }}>Message sent!</p>
              <p style={{ fontSize: 13, color: MUTED, margin: 0 }}>We'll get back to you shortly.</p>
            </div>
          ) : (
            <>
              {[
                { label: "Your name", name: "name", type: "text", placeholder: "John Smith" },
                { label: "Email", name: "email", type: "email", placeholder: "john@yourcompany.com" },
              ].map(f => (
                <div key={f.name} style={{ marginBottom: 14 }}>
                  <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>{f.label}</label>
                  <input
                    type={f.type}
                    name={f.name}
                    value={form[f.name]}
                    onChange={handleChange}
                    placeholder={f.placeholder}
                    style={{ width: "100%", background: "rgba(245,240,235,0.04)", border: "1px solid rgba(245,240,235,0.09)", borderRadius: 9, padding: "10px 13px", fontSize: 14, color: OFF_WHITE, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box", outline: "none" }}
                  />
                </div>
              ))}
              <div style={{ marginBottom: 18 }}>
                <label style={{ display: "block", fontSize: 12, fontWeight: 600, color: MUTED, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Message</label>
                <textarea
                  name="message"
                  value={form.message}
                  onChange={handleChange}
                  placeholder="What can we help you with?"
                  rows={4}
                  style={{ width: "100%", background: "rgba(245,240,235,0.04)", border: "1px solid rgba(245,240,235,0.09)", borderRadius: 9, padding: "10px 13px", fontSize: 14, color: OFF_WHITE, fontFamily: "'DM Sans', sans-serif", boxSizing: "border-box", resize: "none", outline: "none" }}
                />
              </div>
              {status === "error" && (
                <p style={{ fontSize: 12, color: "#e05a5a", marginBottom: 12 }}>Something went wrong — try emailing directly.</p>
              )}
              <button
                onClick={handleSubmit}
                disabled={status === "sending"}
                style={{ width: "100%", background: ORANGE, border: "none", borderRadius: 9, padding: 13, fontSize: 14, fontWeight: 700, color: "#fff", fontFamily: "'Syne', sans-serif", cursor: "pointer" }}
              >
                {status === "sending" ? "Sending..." : "Send message →"}
              </button>
              <p style={{ fontSize: 11, color: MUTED, textAlign: "center", marginTop: 10, marginBottom: 0 }}>No spam. Just a real reply from Drew.</p>
            </>
          )}
        </div>
      </div>

      <SiteFooter onGetStarted={onGetStarted} />
    </div>
  );
}

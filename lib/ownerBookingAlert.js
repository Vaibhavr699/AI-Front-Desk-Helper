"use strict";

/**
 * lib/ownerBookingAlert.js
 *
 * Jun 15, 2026 — Owner text + email alert on every new booking.
 *
 * The in-app bell (notificationService.notifyNewBooking) already fires for
 * every booking, but it's ONLY a dashboard bell — no text, no email. Owners
 * asked to actually be pinged. This sends:
 *   - SMS  → tenant.pre_visit_sms_recipient_phone  (the proven owner-SMS
 *            destination; briefings already text it)
 *   - EMAIL→ owner email (getTenantOwnerEmail → support_email fallback)
 *
 * Called from services/bookings.js createBooking AFTER the booking row is
 * saved, so it fires for EVERY channel (voice, SMS, widget, REST API, MCP,
 * public page) — they all flow through createBooking.
 *
 * GATING (Drew's choice, Jun 15 — no toggle, send-when-populated):
 *   - SMS sends only if pre_visit_sms_recipient_phone is set.
 *   - Email sends only if an owner email resolves.
 *   - Each leg also skips if its destination equals the CUSTOMER's own
 *     number/email (so an owner booking themselves doesn't double-send), and
 *     SMS never goes to the tenant's twilio line.
 *
 * Fire-and-forget by contract: never throws, never blocks a booking. Errors
 * are logged and swallowed. No dedupe table here — createBooking is the single
 * call site and runs once per booking; the in-app bell handles its own dedupe.
 */

const db = require("./db");
const twilio = require("./twilio");
const { getLast10Digits } = require("./phone");

// Resolve owner email the same way email.js does (calendar email → admin user),
// then fall back to support_email. Kept local to avoid a circular require with
// email.js (which requires services/bookings indirectly).
async function resolveOwnerEmail(tenant) {
  if (tenant.google_calendar_email) return tenant.google_calendar_email;
  try {
    const r = await db.query(
      "SELECT email FROM dashboard_users WHERE tenant_id = $1 ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1",
      [tenant.id]
    );
    if (r.rows[0]?.email) return r.rows[0].email;
  } catch (e) {
    console.error("[ownerAlert] owner email lookup failed tenant=%s: %s", tenant.id, e.message);
  }
  return tenant.support_email || null;
}

function fmtDate(dateStr) {
  if (!dateStr) return "an upcoming date";
  try {
    return new Date(`${dateStr}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  } catch {
    return String(dateStr);
  }
}

/**
 * Send the owner SMS + email for a booking. Best-effort, never throws.
 * @param {object} tenant  - full tenant row (needs pre_visit_sms_recipient_phone, company_name, etc.)
 * @param {object} booking - the saved booking row
 */
async function notifyOwnerOfBooking(tenant, booking) {
  if (!tenant || !booking) return;

  const company = tenant.company_name || tenant.name || "your business";
  const customer = booking.contact_name && booking.contact_name !== "New Lead" ? booking.contact_name : "A new customer";
  const dateLabel = fmtDate(booking.preferred_date);
  const timeLabel = booking.appointment_time || "";
  const when = timeLabel ? `${dateLabel} at ${timeLabel}` : dateLabel;
  const proj = booking.scope || booking.job_type || "";

  const custLast10 = getLast10Digits(booking.contact_phone || "");

  // ── Owner SMS → booking_notify_sms_phone (toggle-gated) ────────────────
  // Sends only if the SMS toggle is on AND a destination is set. Falls back
  // to pre_visit_sms_recipient_phone if the dedicated field is blank (covers
  // tenants pre-backfill). Blank everywhere = off.
  const smsEnabled = tenant.booking_notify_sms_enabled !== false; // default on
  const ownerPhone = String(tenant.booking_notify_sms_phone || tenant.pre_visit_sms_recipient_phone || "").trim();
  if (smsEnabled && ownerPhone) {
    const ownerLast10 = getLast10Digits(ownerPhone);
    // Don't text the owner if it's literally the customer's number, and never
    // the AI's own twilio line.
    const twilioLast10 = getLast10Digits(tenant.twilio_number || "");
    if (ownerLast10 && ownerLast10 !== custLast10 && ownerLast10 !== twilioLast10) {
      try {
        const fullTenant = await db.query(
          `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) AS matched_phone
             FROM tenants t WHERE t.id = $1`,
          [tenant.id]
        ).then((r) => r.rows[0]);
        const client = fullTenant ? twilio.getClientForTenant(fullTenant) : null;
        const from = fullTenant?.matched_phone || process.env.TWILIO_PHONE_NUMBER;
        if (client && from) {
          const body = `New booking: ${customer} — ${when}${proj ? ` (${proj})` : ""}. — ${company}`;
          await client.messages.create({ to: ownerPhone, from, body });
          console.log("[ownerAlert] SMS sent tenant=%s to=%s booking=%s", tenant.id, ownerPhone, booking.id);
        }
      } catch (e) {
        console.error("[ownerAlert] owner SMS failed tenant=%s: %s", tenant.id, e.message);
      }
    }
  }

  // ── Owner email (toggle-gated) ─────────────────────────────────────────
  // Sends only if the email toggle is on AND a destination resolves. Prefers
  // the dedicated booking_notify_email field, then falls back to the resolved
  // owner email (calendar → admin → support_email). Blank everywhere = off.
  try {
    const emailEnabled = tenant.booking_notify_email_enabled !== false; // default on
    if (!emailEnabled) return;
    const ownerEmail = String(tenant.booking_notify_email || "").trim() || await resolveOwnerEmail(tenant);
    if (ownerEmail && ownerEmail.toLowerCase() !== String(booking.contact_email || "").toLowerCase()) {
      // Lazy-require email.js to avoid any circular-require timing issues.
      const emailService = require("../services/email");
      const addr = [booking.address, booking.city, booking.state].filter(Boolean).join(", ") || "—";
      const html = `
        <h2 style="margin:0 0 12px">📅 New booking</h2>
        <p>A new appointment was booked for <strong>${esc(company)}</strong>.</p>
        <table style="border-collapse:collapse;font-size:14px;line-height:1.6;width:100%;margin-top:8px">
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold;width:140px">Customer</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(customer)}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Phone</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(booking.contact_phone || "—")}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Email</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(booking.contact_email || "—")}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">When</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(when)}</td></tr>
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Address</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(addr)}</td></tr>
          ${proj ? `<tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Project</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(proj)}</td></tr>` : ""}
          <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Source</td><td style="padding:8px 0;border-bottom:1px solid #eee">${esc(booking.lead_source || "—")}</td></tr>
        </table>
      `;
      // No tenantId/leadId → stays an internal owner alert, out of the customer
      // conversation view (same pattern as the cancellation owner email).
      await emailService.sendEmail({
        to: ownerEmail,
        subject: `📅 New booking: ${customer} (${when}) — ${company}`,
        html,
      });
      console.log("[ownerAlert] email sent tenant=%s to=%s booking=%s", tenant.id, ownerEmail, booking.id);
    }
  } catch (e) {
    console.error("[ownerAlert] owner email failed tenant=%s: %s", tenant.id, e.message);
  }
}

function esc(s) {
  if (s == null) return "";
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

module.exports = { notifyOwnerOfBooking };

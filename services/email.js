"use strict";

const { Resend } = require("resend");

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM;
const resend = apiKey && fromEmail ? new Resend(apiKey) : null;

async function sendEmail({ to, subject, html, text }) {
  if (!resend) return { ok: false, error: "Email not configured" };
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: Array.isArray(to) ? to : [to],
    subject,
    html: html || undefined,
    text: text || undefined,
  });
  if (error) {
    console.error("Resend error:", error.message);
    return { ok: false, error: error.message };
  }
  return { ok: true, id: data?.id };
}

async function sendBookingConfirmationEmail(tenant, booking) {
  if (!booking.contact_email) return { ok: false };
  const name = booking.contact_name || "there";
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your free on-site estimate with <strong>${escapeHtml(tenant.company_name)}</strong> is scheduled.</p>
    <p>We'll reach out to confirm details. If you have questions, reply to this email or give us a call.</p>
    <p>Thanks,<br/>${escapeHtml(tenant.company_name)}</p>
  `;
  return sendEmail({
    to: booking.contact_email,
    subject: `Your estimate is scheduled – ${tenant.company_name}`,
    html,
  });
}

async function sendTransferNotificationEmail(tenant, call, reason, summary, extras = {}) {
  const to = process.env.TRANSFER_NOTIFICATION_EMAIL;
  if (!to) return { ok: false };
  const REASON_LABELS = {
    commercial_job: "Commercial Job",
    high_value_over_10k: "High-Value Project ($10k+)",
    frustrated_caller: "Frustrated Caller",
    vip_repeat_customer: "VIP / Repeat Customer",
    caller_requested_human: "Caller Requested Live Agent",
  };
  const reasonLabel = REASON_LABELS[reason] || reason || "—";
  const html = `
    <h2 style="margin:0 0 8px">🔔 AI Transfer — ${escapeHtml(reasonLabel)}</h2>
    <table style="border-collapse:collapse;font-size:14px;line-height:1.6">
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Caller</td><td>${escapeHtml(extras.caller_name || "Unknown")} (${escapeHtml(call.from_number || "—")})</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Reason</td><td>${escapeHtml(reasonLabel)}</td></tr>
      ${extras.project_type ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Project</td><td>${escapeHtml(extras.project_type)}</td></tr>` : ""}
      ${extras.budget_estimate ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Budget</td><td>${escapeHtml(extras.budget_estimate)}</td></tr>` : ""}
      ${extras.sentiment ? `<tr><td style="padding:4px 12px 4px 0;font-weight:bold">Sentiment</td><td>${escapeHtml(extras.sentiment)}</td></tr>` : ""}
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Tenant</td><td>${escapeHtml(tenant.company_name)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;font-weight:bold">Time</td><td>${escapeHtml(String(call.started_at || new Date().toISOString()))}</td></tr>
    </table>
    ${summary ? `<p style="margin:12px 0 0"><strong>AI Summary:</strong> ${escapeHtml(summary)}</p>` : ""}
  `;
  return sendEmail({
    to,
    subject: `🔔 Transfer: ${tenant.company_name} – ${extras.caller_name || call.from_number || "Unknown"} (${reasonLabel})`,
    html,
  });
}

async function sendPasswordResetEmail(email, resetLink) {
  const html = `
    <p>Hi,</p>
    <p>We received a request to reset your password for the AI Front Desk Dashboard.</p>
    <p>Click the link below to set a new password:</p>
    <p><a href="${resetLink}">${resetLink}</a></p>
    <p>If you didn't request this, you can safely ignore this email.</p>
    <p>Thanks,<br/>AI Front Desk Team</p>
  `;
  return sendEmail({
    to: email,
    subject: "Reset your AI Front Desk password",
    html,
  });
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = {
  sendEmail,
  sendBookingConfirmationEmail,
  sendTransferNotificationEmail,
  sendPasswordResetEmail,
};

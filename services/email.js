"use strict";

const { Resend } = require("resend");

const apiKey = process.env.RESEND_API_KEY;
const fromEmail = process.env.EMAIL_FROM;
const resend = apiKey && fromEmail ? new Resend(apiKey) : null;
if (!resend) {
  if (!apiKey) console.warn("[Email] RESEND_API_KEY is not set – password reset and contact emails will not be sent.");
  if (!fromEmail) console.warn("[Email] EMAIL_FROM is not set – password reset and contact emails will not be sent.");
} else {
  console.log("[Email] Resend configured. From:", fromEmail);
}

// Home page contact form and website chat notifications go here (sent via Resend).
const CONTACT_EMAIL = process.env.CONTACT_EMAIL || "drew@aifrontdeskhelper.com";

async function sendEmail({ to, subject, html, text }) {
  if (!resend) {
    console.warn("[Email] Not sending – Resend not configured (check RESEND_API_KEY and EMAIL_FROM).");
    return { ok: false, error: "Email not configured" };
  }
  const toList = Array.isArray(to) ? to : [to];
  console.log("[Email] Calling Resend API: to=", toList.join(", "), "subject=", subject);
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: toList,
    subject,
    html: html || undefined,
    text: text !== undefined ? text : undefined,
  });
  if (error) {
    console.error("[Email] Resend API error:", error.message, error);
    return { ok: false, error: error.message };
  }
  console.log("[Email] Sent to", toList.join(", "), "id:", data?.id);
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
  const safeLink = escapeHtml(resetLink);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Reset your password</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f4f4f5; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); overflow: hidden;">
          <tr>
            <td style="padding: 32px 40px 24px; text-align: center; border-bottom: 1px solid #e5e7eb;">
              <span style="font-size: 20px; font-weight: 700; color: #111827;">AI Front Desk</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #374151;">Hi,</p>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #374151;">We received a request to reset your password for the AI Front Desk Dashboard.</p>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #374151;">Click the button below to set a new password:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td style="border-radius: 8px; background-color: #2563eb;">
                    <a href="${resetLink}" target="_blank" rel="noopener" style="display: inline-block; padding: 14px 28px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">Reset password</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 13px; line-height: 1.5; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="margin: 8px 0 0; font-size: 12px; line-height: 1.5; word-break: break-all; color: #9ca3af;">${safeLink}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 32px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.5; color: #6b7280;">If you didn't request this, you can safely ignore this email. Your password will not be changed.</p>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #374151;">Thanks,<br><strong>AI Front Desk Team</strong></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return sendEmail({
    to: email,
    subject: "Reset your AI Front Desk password",
    html,
    text: "",
  });
}

/** Send a single test email to verify Resend is working (e.g. from deployed server). */
async function sendTestEmail(to) {
  const address = (to || CONTACT_EMAIL || "").trim();
  if (!address) return { ok: false, error: "No recipient" };
  return sendEmail({
    to: address,
    subject: "AI Front Desk – test email",
    html: `<p>This is a test email from your AI Front Desk backend. Resend is working.</p><p>Sent at ${new Date().toISOString()}</p>`,
  });
}

async function sendWebsiteChatNotificationEmail(data) {
  const to = CONTACT_EMAIL;
  const message = data.message != null ? String(data.message) : "";
  const reply = data.reply != null ? String(data.reply) : "";
  const sessionId = data.sessionId != null ? String(data.sessionId) : "";
  const tenantName = data.tenantName != null ? String(data.tenantName) : "—";
  const html = `
    <h2 style="margin:0 0 16px">💬 Website chat message</h2>
    <table style="border-collapse:collapse;font-size:14px;line-height:1.6;width:100%">
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold;width:140px">Session</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(sessionId)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Tenant</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(tenantName)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">User said</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(message)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Reply sent</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(reply)}</td></tr>
    </table>
    <p style="margin-top:24px;font-size:12px;color:#666">${new Date().toLocaleString()}</p>
  `;
  const subjectPreview = message.length > 50 ? message.slice(0, 50).replace(/\n/g, " ") + "…" : message.replace(/\n/g, " ") || "Website chat";
  return sendEmail({
    to,
    subject: "💬 Website chat: " + subjectPreview,
    html,
  });
}

async function sendContactLeadEmail(data) {
  const to = CONTACT_EMAIL;
  const enquiry = data.enquiry != null ? String(data.enquiry) : (data.businessName != null ? String(data.businessName) : "");
  const html = `
    <h2 style="margin:0 0 16px">📩 New enquiry from landing page</h2>
    <table style="border-collapse:collapse;font-size:14px;line-height:1.6;width:100%">
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold;width:150px">Name</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(data.name)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Phone</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(data.phone)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Email</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(data.email)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Enquiry</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(enquiry)}</td></tr>
      <tr><td style="padding:8px 0;border-bottom:1px solid #eee;font-weight:bold">Best time to reach</td><td style="padding:8px 0;border-bottom:1px solid #eee">${escapeHtml(data.bestTime || "—")}</td></tr>
    </table>
    <p style="margin-top:24px;font-size:12px;color:#666">Submitted at: ${new Date().toLocaleString()}</p>
  `;
  const subjectLine = enquiry.length > 40 ? `${enquiry.slice(0, 40).replace(/\n/g, " ")}…` : enquiry.replace(/\n/g, " ") || "No details";
  return sendEmail({
    to,
    subject: `📩 Enquiry from ${data.name}: ${subjectLine}`,
    html,
  });
}

/** Send job assignment details to a technician (when assigned in Bookings). */
async function sendTechnicianAssignmentEmail(tenant, technician, booking) {
  const to = (technician.email || "").trim();
  if (!to) return { ok: false, error: "Technician has no email" };
  const company = (tenant && (tenant.company_name || tenant.name)) || "Your company";
  const techName = (technician.name || "there").trim() || "there";
  const dateStr = booking.preferred_date
    ? new Date(booking.preferred_date).toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" })
    : "TBD";
  const timeStr = booking.appointment_time || "Not set";
  const addressParts = [booking.address, booking.city].filter(Boolean);
  const addressLine = addressParts.length ? addressParts.join(", ") : "—";
  const notesHtml = booking.notes
    ? `<div style="margin-top: 20px; padding: 14px 16px; background-color: #f8fafc; border-radius: 8px; border-left: 4px solid #94a3b8; font-size: 14px; line-height: 1.6; color: #334155; white-space: pre-wrap; word-break: break-word;">${escapeHtml(booking.notes)}</div>`
    : "";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Job assigned</title></head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr><td align="center" style="padding: 32px 20px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 560px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.07); overflow: hidden;">
        <tr><td style="padding: 28px 32px 20px; border-bottom: 1px solid #e5e7eb;">
          <span style="font-size: 18px; font-weight: 700; color: #111827;">Job assigned – ${escapeHtml(company)}</span>
        </td></tr>
        <tr><td style="padding: 24px 32px;">
          <p style="margin: 0 0 20px; font-size: 16px; line-height: 1.5; color: #374151;">Hi ${escapeHtml(techName)},</p>
          <p style="margin: 0 0 20px; font-size: 15px; line-height: 1.5; color: #4b5563;">You've been assigned to the following job. Details are below.</p>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size: 14px; line-height: 1.6; border-collapse: collapse;">
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; color: #6b7280; width: 140px;">Customer</td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${escapeHtml(booking.contact_name || "—")}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; color: #6b7280;">Phone</td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${escapeHtml(booking.contact_phone || "—")}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; color: #6b7280;">Email</td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${escapeHtml(booking.contact_email || "—")}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; color: #6b7280;">Address</td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${escapeHtml(addressLine)}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; color: #6b7280;">Date</td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${escapeHtml(dateStr)}</td></tr>
            <tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; color: #6b7280;">Time</td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${escapeHtml(timeStr)}</td></tr>
            ${booking.job_type ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; color: #6b7280;">Job type</td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${escapeHtml(booking.job_type)}</td></tr>` : ""}
            ${booking.scope ? `<tr><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; font-weight: 600; color: #6b7280;">Scope</td><td style="padding: 10px 0; border-bottom: 1px solid #f3f4f6; color: #111827;">${escapeHtml(booking.scope)}</td></tr>` : ""}
          </table>
          ${notesHtml}
          <div style="margin-top: 28px; padding-top: 24px; border-top: 1px solid #e5e7eb;">
            <p style="margin: 0 0 12px; font-size: 13px; font-weight: 600; color: #475569;">What to do next</p>
            <ul style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 1.7; color: #64748b;">
              <li>Reach out to the customer to confirm the date and time if needed.</li>
              <li>Reply to this email or contact the office if you have questions or need to reschedule.</li>
            </ul>
          </div>
          <p style="margin: 24px 0 0; font-size: 14px; color: #374151;">Thank you for your hard work.</p>
          <p style="margin: 8px 0 0; font-size: 13px; color: #6b7280;">— ${escapeHtml(company)}</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  return sendEmail({
    to,
    subject: `Job assigned – ${company} – ${booking.contact_name || "Customer"} – ${dateStr}`,
    html,
    text: "",
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
  sendTechnicianAssignmentEmail,
  sendTestEmail,
  sendContactLeadEmail,
  sendWebsiteChatNotificationEmail,
};

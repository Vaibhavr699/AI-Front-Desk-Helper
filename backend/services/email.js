"use strict";

const { Resend } = require("resend");
const db = require("../lib/db");


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

// Default fallback support address used in location-billing emails when a
// tenant doesn't have a tenant.support_email configured.
const SUPPORT_EMAIL_DEFAULT = "support@aifrontdeskhelper.com";

async function sendEmail({ to, subject, html, text, bcc, replyTo }) {
  if (!resend) {
    console.warn("[Email] Not sending – Resend not configured (check RESEND_API_KEY and EMAIL_FROM).");
    return { ok: false, error: "Email not configured" };
  }
  const toList = Array.isArray(to) ? to : [to];
  const bccList = bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined;
  
  console.log("[Email] Calling Resend API: to=", toList.join(", "), "subject=", subject, "bcc=", bccList?.join(", "));
  const { data, error } = await resend.emails.send({
    from: fromEmail,
    to: toList,
    bcc: bccList,
    reply_to: replyTo,
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

/** Get the business owner email for a tenant (calendar email or admin user). */
async function getTenantOwnerEmail(tenant) {
  if (tenant.google_calendar_email) return tenant.google_calendar_email;
  
  try {
    const adminRes = await db.query(
      "SELECT email FROM dashboard_users WHERE tenant_id = $1 ORDER BY (role = 'admin') DESC, created_at ASC LIMIT 1",
      [tenant.id]
    );
    if (adminRes.rows.length > 0) return adminRes.rows[0].email;
  } catch (err) {
    console.error("[Email] Failed to fetch owner email for tenant %s:", tenant.id, err.message);
  }
  return null;
}

async function sendBookingConfirmationEmail(tenant, booking) {
  if (!booking.contact_email) return { ok: false };

  // Fetch tenant phone number for footer
  let phone = "";
  try {
    const phoneRes = await db.query(
      "SELECT phone FROM phone_numbers WHERE tenant_id = $1 ORDER BY is_primary DESC NULLS LAST LIMIT 1",
      [tenant.id]
    );
    if (phoneRes.rows.length > 0) {
      phone = phoneRes.rows[0].phone;
    }
  } catch (err) {
    console.error("[Email] Failed to fetch tenant phone:", err.message);
  }

  const name = booking.contact_name || "there";

  
  // Format date for better readability (e.g., "Tuesday, March 24")
  let dateDisplay = "—";
  if (booking.preferred_date) {
    try {
      const d = new Date(booking.preferred_date);
      dateDisplay = d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
    } catch (e) {
      dateDisplay = booking.preferred_date;
    }
  }

  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Your free on-site estimate with <strong>${escapeHtml(tenant.company_name)}</strong> is scheduled.</p>
    <div style="margin: 20px 0; padding: 15px; background-color: #f8fafc; border-radius: 8px; border-left: 4px solid #2563eb;">
      <p style="margin: 0; font-size: 16px; font-weight: 600; color: #1e293b;">📅 Date: ${escapeHtml(dateDisplay)}</p>
      <p style="margin: 8px 0 0; font-size: 16px; font-weight: 600; color: #1e293b;">⏰ Time: ${escapeHtml(booking.appointment_time || "Not specified")}</p>
    </div>
    <p>We'll reach out to confirm details. If you have questions, reply to this email or give us a call at <strong>${escapeHtml(phone || "")}</strong>.</p>

    <p>Thanks,<br/>${escapeHtml(tenant.company_name)}</p>
  `;
  const ownerEmail = await getTenantOwnerEmail(tenant);

  return sendEmail({
    to: booking.contact_email,
    bcc: ownerEmail || undefined,
    replyTo: ownerEmail || undefined,
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

async function sendAdminInvitationEmail(email, inviteLink) {
  const safeLink = escapeHtml(inviteLink);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Admin Invitation</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); overflow: hidden;">
          <tr>
            <td style="padding: 32px 40px 24px; text-align: center; border-bottom: 1px solid #e5e7eb; background-color: #111827;">
              <span style="font-size: 20px; font-weight: 700; color: #ffffff;">AI Front Desk | Platform Console</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #374151;">Hello,</p>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #374151;">You have been invited to join the <strong>AI Front Desk</strong> platform as a Super Admin.</p>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #374151;">Click the button below to set up your account and password:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td style="border-radius: 8px; background-color: #111827;">
                    <a href="${inviteLink}" target="_blank" rel="noopener" style="display: inline-block; padding: 14px 28px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">Accept Invitation</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 13px; line-height: 1.5; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="margin: 8px 0 0; font-size: 12px; line-height: 1.5; word-break: break-all; color: #9ca3af;">${safeLink}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 32px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #374151;">Welcome to the team,<br><strong>AI Front Desk Admins</strong></p>
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
    subject: "Invitation to join AI Front Desk as Admin",
    html,
    text: `You have been invited as an admin. Set your password here: ${inviteLink}`,
  });
}

async function sendTeamInviteEmail(email, inviteLink, locationName, roleName) {
  const safeLink = escapeHtml(inviteLink);
  const safeLocation = escapeHtml(locationName);
  const safeRole = escapeHtml(roleName);
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Team Invitation</title>
</head>
<body style="margin:0; padding:0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; color: #1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f4f4f5;">
    <tr>
      <td align="center" style="padding: 40px 20px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.07); overflow: hidden;">
          <tr>
            <td style="padding: 32px 40px 24px; text-align: center; border-bottom: 1px solid #e5e7eb; background-color: #2563eb;">
              <span style="font-size: 20px; font-weight: 700; color: #ffffff;">AI Front Desk | Team Invitation</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px 40px;">
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #374151;">Hello,</p>
              <p style="margin: 0 0 16px; font-size: 16px; line-height: 1.6; color: #374151;">You have been invited to join the AI Front Desk platform.</p>
              <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 0 0 24px;">
                <p style="margin: 0 0 8px; font-size: 15px; color: #475569;"><strong>Location:</strong> ${safeLocation}</p>
                <p style="margin: 0; font-size: 15px; color: #475569;"><strong>Role:</strong> ${safeRole}</p>
              </div>
              <p style="margin: 0 0 24px; font-size: 16px; line-height: 1.6; color: #374151;">Click the button below to set up your account and password:</p>
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 0 auto;">
                <tr>
                  <td style="border-radius: 8px; background-color: #2563eb;">
                    <a href="${inviteLink}" target="_blank" rel="noopener" style="display: inline-block; padding: 14px 28px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">Accept Invitation</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 24px 0 0; font-size: 13px; line-height: 1.5; color: #6b7280;">If the button doesn't work, copy and paste this link into your browser:</p>
              <p style="margin: 8px 0 0; font-size: 12px; line-height: 1.5; word-break: break-all; color: #9ca3af;">${safeLink}</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px 32px; border-top: 1px solid #e5e7eb;">
              <p style="margin: 0 0 8px; font-size: 14px; line-height: 1.5; color: #6b7280;">If you're not expecting this invitation, you can safely ignore this email.</p>
              <p style="margin: 0; font-size: 14px; line-height: 1.5; color: #374151;">Welcome to the team,<br><strong>AI Front Desk</strong></p>
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
    subject: `Invitation to join ${locationName} on AI Front Desk`,
    html,
    text: `You have been invited to ${locationName} as ${roleName}. Set your password here: ${inviteLink}`,
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
  const subjectPrefix = tenantName && tenantName !== "—" ? `💬 ${tenantName}` : "💬 Website chat";
  return sendEmail({
    to,
    subject: `${subjectPrefix}: ${subjectPreview}`,
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
  const ownerEmail = await getTenantOwnerEmail(tenant);
  return sendEmail({
    to,
    replyTo: ownerEmail || undefined,
    subject: `Job assigned – ${company} – ${booking.contact_name || "Customer"} – ${dateStr}`,
    html,
    text: "",
  });
}

/** Nurturing: post-service follow-up (1 day after Completed). */
async function sendPostServiceFollowUpEmail(companyName, customerName, to, replyTo) {
  const name = (customerName || "there").trim() || "there";
  const company = (companyName || "We").trim() || "We";
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Quick follow-up from <strong>${escapeHtml(company)}</strong> — we hope you're happy with the work we did. If you have any questions or need a follow-up, just reply to this email or give us a call.</p>
    <p>Thanks,<br/>${escapeHtml(company)}</p>
  `;
  const body = `Quick follow-up from ${company} — we hope you're happy with the work we did.`;
  const result = await sendEmail({
    to,
    replyTo: replyTo || undefined,
    subject: `Quick follow-up – ${company}`,
    html,
  });
  return { ok: result.ok, body, error: result.error };
}

/** Nurturing: referral request (e.g. 5 days after service). */
async function sendReferralRequestEmail(companyName, customerName, to, replyTo) {
  const name = (customerName || "there").trim() || "there";
  const company = (companyName || "We").trim() || "We";
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Quick favor from <strong>${escapeHtml(company)}</strong> — know anyone who could use our help? Reply with their name and number and we'll reach out. Thank you!</p>
    <p>Thanks,<br/>${escapeHtml(company)}</p>
  `;
  const body = `Quick favor — know anyone who could use our help? Reply with their name and number.`;
  const result = await sendEmail({
    to,
    replyTo: replyTo || undefined,
    subject: `Quick favor – ${company}`,
    html,
  });
  return { ok: result.ok, body, error: result.error };
}

/** Nurturing: maintenance reminder (e.g. 6 months after service). */
async function sendMaintenanceReminderEmail(companyName, customerName, to, replyTo) {
  const name = (customerName || "there").trim() || "there";
  const company = (companyName || "We").trim() || "We";
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>It's been a while since we last saw you. <strong>${escapeHtml(company)}</strong> is here when you're ready for your next project or a quick check-in. Reply to this email or give us a call.</p>
    <p>Thanks,<br/>${escapeHtml(company)}</p>
  `;
  const body = "Maintenance reminder — we're here when you're ready for your next project.";
  const result = await sendEmail({
    to,
    replyTo: replyTo || undefined,
    subject: `We're here when you're ready – ${company}`,
    html,
  });
  return { ok: result.ok, body, error: result.error };
}

/** Nurturing: re-engagement / dormant (e.g. 12 months after service). */
async function sendReengagementEmail(companyName, customerName, to, replyTo) {
  const name = (customerName || "there").trim() || "there";
  const company = (companyName || "We").trim() || "We";
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>Quick check-in from <strong>${escapeHtml(company)}</strong> — we'd love to hear how things are going and if you have any upcoming needs. Just reply or give us a call.</p>
    <p>Thanks,<br/>${escapeHtml(company)}</p>
  `;
  const body = "Quick check-in — we'd love to hear how things are going.";
  const result = await sendEmail({
    to,
    replyTo: replyTo || undefined,
    subject: `Quick check-in – ${company}`,
    html,
  });
  return { ok: result.ok, body, error: result.error };
}

/** Nurturing: seasonal campaign (month-based). */
async function sendSeasonalCampaignEmail(companyName, customerName, subjectLine, bodyHtml, to, replyTo) {
  const name = (customerName || "there").trim() || "there";
  const company = (companyName || "We").trim() || "We";
  const html = `
    <p>Hi ${escapeHtml(name)},</p>
    <p>${bodyHtml}</p>
    <p>Thanks,<br/>${escapeHtml(company)}</p>
  `;
  const result = await sendEmail({
    to,
    replyTo: replyTo || undefined,
    subject: subjectLine || `News from ${company}`,
    html,
  });
  return { ok: result.ok, error: result.error };
}

async function sendUsageAlertEmail(email, tenantName, percent, limits, current) {
  const html = `
    <h2 style="margin:0 0 16px; color: ${percent >= 100 ? '#e11d48' : '#d97706'}">⚠️ Usage Alert: ${percent}% limit reached</h2>
    <p>Your account for <strong>${escapeHtml(tenantName)}</strong> has reached <strong>${percent}%</strong> of your monthly allowance.</p>
    <div style="margin: 24px 0; padding: 20px; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b;">Resource</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b;">Current Usage</td>
          <td style="padding: 10px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; color: #64748b;">Monthly Limit</td>
        </tr>
        <tr>
          <td style="padding: 12px 0;">🎙️ AI Voice Minutes</td>
          <td style="padding: 12px 0; font-weight: 700; color: #1e293b;">${current.minutes.toLocaleString()}</td>
          <td style="padding: 12px 0; color: #64748b;">${limits.minutes.toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 12px 0;">💬 AI SMS Messages</td>
          <td style="padding: 12px 0; font-weight: 700; color: #1e293b;">${current.sms.toLocaleString()}</td>
          <td style="padding: 12px 0; color: #64748b;">${limits.sms.toLocaleString()}</td>
        </tr>
      </table>
    </div>
    <p style="margin-top: 24px;">Please log in to your dashboard to manage your subscription or upgrade your plan to avoid any disruption in service.</p>
    <p>Thanks,<br/><strong>AI Front Desk Team</strong></p>
  `;
  return sendEmail({
    to: email,
    subject: `⚠️ Usage Alert: ${percent}% of limit reached – ${tenantName}`,
    html,
  });
}

// ═════════════════════════════════════════════════════════════════════════
// LOCATION BILLING EMAILS (Apr 19, 2026)
// Sent on add/remove/rate-change events for child locations under a parent
// tenant. All four go to the parent's primary user + any users with role
// in ('owner', 'admin') on the parent. For franchisee_invite emails, sent
// to the email address provided by the franchisor when they invited.
// ═════════════════════════════════════════════════════════════════════════

/** Format cents → human "$X,XXX.XX". Used in all 4 location billing emails. */
function formatMoneyCents(cents) {
  if (cents == null || isNaN(cents)) return "$0.00";
  const dollars = cents / 100;
  return `$${dollars.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format ISO date → "April 28, 2026". Used in all 4 location billing emails. */
function formatLocationBillingDate(isoString) {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

/**
 * Get all email recipients for a parent tenant — owners and admins. Returns
 * an array of email strings (deduped, lowercased). If empty, caller should
 * skip sending and log a warning.
 */
async function getParentBillingRecipients(parentTenantId) {
  try {
    const r = await db.query(
      `SELECT DISTINCT LOWER(email) AS email
         FROM dashboard_users
        WHERE tenant_id = $1
          AND role IN ('owner', 'admin')
          AND email IS NOT NULL
          AND email != ''`,
      [parentTenantId]
    );
    return r.rows.map((row) => row.email);
  } catch (err) {
    console.error("[Email] getParentBillingRecipients failed for tenant %s:", parentTenantId, err.message);
    return [];
  }
}

/**
 * 1. LOCATION ADDED — sent when a parent_pays location is successfully
 * added to the parent's subscription.
 *
 * @param {object} params
 * @param {object} params.parentTenant - Parent row
 * @param {object} params.newLocation - Newly created child row
 * @param {number} params.proratedTodayCents - Charged immediately
 * @param {number} params.locationRateCents - Recurring monthly cost
 * @param {string} params.nextChargeDate - ISO string of next full charge
 * @param {number} params.newRecurringMonthlyCents - Parent's NEW total /mo
 */
async function sendLocationAddedEmail({
  parentTenant,
  newLocation,
  proratedTodayCents,
  locationRateCents,
  nextChargeDate,
  newRecurringMonthlyCents,
}) {
  const recipients = await getParentBillingRecipients(parentTenant.id);
  if (recipients.length === 0) {
    console.warn("[Email] sendLocationAddedEmail: no recipients for parent %s", parentTenant.id);
    return { ok: false, reason: "no_recipients" };
  }

  const parentName = parentTenant.company_name || parentTenant.name || "Your account";
  const locationName = newLocation.company_name || newLocation.name || "New Location";
  const supportEmail = parentTenant.support_email || SUPPORT_EMAIL_DEFAULT;

  const subject = `New location added: ${locationName}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">New location added to your account</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #555;">
        <strong>${escapeHtml(locationName)}</strong> has been added under ${escapeHtml(parentName)}.
        Here's the billing summary for your records.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 24px 0; background: #f8f7f2; border-radius: 12px; overflow: hidden;">
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #e8e6dc;">Location</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #e8e6dc;">${escapeHtml(locationName)}</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #e8e6dc;">Charged today (prorated)</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #e8e6dc;">${formatMoneyCents(proratedTodayCents)}</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #e8e6dc;">Recurring location cost</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #e8e6dc;">${formatMoneyCents(locationRateCents)} /mo</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #e8e6dc;">Next charge date</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #e8e6dc;">${formatLocationBillingDate(nextChargeDate)}</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555;">Your new total recurring</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 700; text-align: right; color: #1a1a1a;">${formatMoneyCents(newRecurringMonthlyCents)} /mo</td>
        </tr>
      </table>

      <p style="font-size: 13px; line-height: 1.6; color: #777;">
        The new location is now active. Sign in to configure its phone number, AI behavior, business hours, and team.
      </p>
      <p style="font-size: 13px; line-height: 1.6; color: #777;">
        Questions about your bill? Reply to this email or contact ${escapeHtml(supportEmail)}.
      </p>
    </div>
  `;

  const result = await Promise.all(
    recipients.map((email) => sendEmail({ to: email, subject, html }))
  );
  const okCount = result.filter((r) => r.ok).length;
  console.log("[Email] sendLocationAddedEmail parent=%s child=%s sent=%d/%d", parentTenant.id, newLocation.id, okCount, recipients.length);
  return { ok: okCount > 0, sent: okCount, total: recipients.length };
}

/**
 * 2. FRANCHISEE INVITE — sent to the franchisee's email when a rollup_only
 * HQ adds a self_pays location. Contains the invite link with token.
 *
 * @param {object} params
 * @param {object} params.parentTenant - Franchisor HQ row
 * @param {object} params.newLocation - Pending franchisee tenant row
 * @param {string} params.franchiseeEmail - Where to send the invite
 * @param {string} params.inviteUrl - Full URL like https://app.aifrontdeskhelper.com/franchisee-invite/{token}
 * @param {string} params.expiresAt - ISO string when invite expires
 */
async function sendFranchiseeInviteEmail({
  parentTenant,
  newLocation,
  franchiseeEmail,
  inviteUrl,
  expiresAt,
}) {
  if (!franchiseeEmail) {
    console.warn("[Email] sendFranchiseeInviteEmail: no franchiseeEmail provided");
    return { ok: false, reason: "no_recipient" };
  }

  const parentName = parentTenant.company_name || parentTenant.name || "Your franchisor";
  const locationName = newLocation.company_name || newLocation.name || "your location";
  const supportEmail = parentTenant.support_email || SUPPORT_EMAIL_DEFAULT;

  const subject = `${parentName} invited you to set up your AI Front Desk`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="font-size: 22px; font-weight: 700; margin-bottom: 8px;">You're invited 👋</h2>
      <p style="font-size: 15px; line-height: 1.6; color: #333;">
        <strong>${escapeHtml(parentName)}</strong> has set up an AI Front Desk account for <strong>${escapeHtml(locationName)}</strong>.
        Click the button below to choose your plan and complete setup. You'll be billed directly — your franchisor does not pay for your subscription.
      </p>

      <div style="text-align: center; margin: 32px 0;">
        <a href="${escapeHtml(inviteUrl)}" style="display: inline-block; padding: 14px 32px; background: #1a1a1a; color: #ffffff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 14px;">
          Set Up My Account
        </a>
      </div>

      <p style="font-size: 13px; line-height: 1.6; color: #777;">
        This invite expires on <strong>${formatLocationBillingDate(expiresAt)}</strong>. If you need a fresh link, ask your franchisor to resend.
      </p>
      <p style="font-size: 13px; line-height: 1.6; color: #777;">
        Once you complete checkout, your dashboard will be live immediately. You'll get your own login, your own phone number, and your own AI configuration — all branded under ${escapeHtml(parentName)}.
      </p>
      <p style="font-size: 13px; line-height: 1.6; color: #777; margin-top: 24px;">
        Questions? Contact ${escapeHtml(supportEmail)}.
      </p>
    </div>
  `;

  const result = await sendEmail({ to: franchiseeEmail, subject, html });
  console.log("[Email] sendFranchiseeInviteEmail parent=%s child=%s to=%s ok=%s", parentTenant.id, newLocation.id, franchiseeEmail, result.ok);
  return result;
}

/**
 * 3. LOCATION REMOVAL CONFIRMATION — sent when a child location is removed
 * from a parent. Per Apr 19 spec: immediate deactivation, no refund, 30-day
 * data retention before hard delete.
 *
 * @param {object} params
 * @param {object} params.parentTenant
 * @param {object} params.removedLocation
 * @param {string} params.dataRetentionUntil - ISO string when data is hard-deleted
 */
async function sendLocationRemovalConfirmationEmail({
  parentTenant,
  removedLocation,
  dataRetentionUntil,
}) {
  const recipients = await getParentBillingRecipients(parentTenant.id);
  if (recipients.length === 0) {
    console.warn("[Email] sendLocationRemovalConfirmationEmail: no recipients for parent %s", parentTenant.id);
    return { ok: false, reason: "no_recipients" };
  }

  const parentName = parentTenant.company_name || parentTenant.name || "Your account";
  const locationName = removedLocation.company_name || removedLocation.name || "Location";
  const supportEmail = parentTenant.support_email || SUPPORT_EMAIL_DEFAULT;

  const subject = `Location removed: ${locationName}`;
  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Location removed</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #555;">
        <strong>${escapeHtml(locationName)}</strong> has been removed from ${escapeHtml(parentName)}. Here's what happens next.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 24px 0; background: #fef9f4; border-radius: 12px; overflow: hidden; border: 1px solid #f5e6d3;">
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #f5e6d3;">Status</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #f5e6d3; color: #c2410c;">Deactivated immediately</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #f5e6d3;">Refund for remaining period</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #f5e6d3;">None — billed period stays active</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555;">Data retention until</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 700; text-align: right;">${formatLocationBillingDate(dataRetentionUntil)}</td>
        </tr>
      </table>

      <p style="font-size: 13px; line-height: 1.6; color: #777;">
        Calls, leads, bookings, and message history for this location are retained for 30 days, then permanently deleted. If you need to export the data, contact us before ${formatLocationBillingDate(dataRetentionUntil)}.
      </p>
      <p style="font-size: 13px; line-height: 1.6; color: #777;">
        If this removal was a mistake, contact ${escapeHtml(supportEmail)} immediately — we can restore the location at any time during the 30-day retention window.
      </p>
    </div>
  `;

  const result = await Promise.all(
    recipients.map((email) => sendEmail({ to: email, subject, html }))
  );
  const okCount = result.filter((r) => r.ok).length;
  console.log("[Email] sendLocationRemovalConfirmationEmail parent=%s child=%s sent=%d/%d", parentTenant.id, removedLocation.id, okCount, recipients.length);
  return { ok: okCount > 0, sent: okCount, total: recipients.length };
}

/**
 * 4. LOCATION RATE CHANGED — sent when a superadmin or plan upgrade changes
 * the per-location rate. Per Apr 19 spec, increases require 30-day notice;
 * decreases (rare) take effect on next bill cycle. Caller computes the
 * effective date and passes it in.
 *
 * @param {object} params
 * @param {object} params.parentTenant
 * @param {object} params.location
 * @param {number} params.oldRateCents - previous monthly rate
 * @param {number} params.newRateCents - new monthly rate
 * @param {string} params.effectiveDate - ISO string when new rate kicks in
 * @param {string} params.reason - "plan_upgrade" | "admin_override" | "annual_renewal"
 */
async function sendLocationRateChangeNoticeEmail({
  parentTenant,
  location,
  oldRateCents,
  newRateCents,
  effectiveDate,
  reason,
}) {
  const recipients = await getParentBillingRecipients(parentTenant.id);
  if (recipients.length === 0) {
    console.warn("[Email] sendLocationRateChangeNoticeEmail: no recipients for parent %s", parentTenant.id);
    return { ok: false, reason: "no_recipients" };
  }

  const parentName = parentTenant.company_name || parentTenant.name || "Your account";
  const locationName = location.company_name || location.name || "Location";
  const supportEmail = parentTenant.support_email || SUPPORT_EMAIL_DEFAULT;
  const isIncrease = newRateCents > oldRateCents;
  const reasonLabel = ({
    plan_upgrade: "Your plan was upgraded, which changes the per-location rate.",
    admin_override: "Your account administrator updated the rate for this location.",
    annual_renewal: "Your annual subscription is renewing at a new rate.",
  })[reason] || "Your per-location rate has been updated.";

  const subject = isIncrease
    ? `Notice: rate change for ${locationName}`
    : `Rate decrease confirmed for ${locationName}`;
  const accentColor = isIncrease ? "#c2410c" : "#15803d";

  const html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 580px; margin: 0 auto; color: #1a1a1a;">
      <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 8px;">Per-location rate ${isIncrease ? "change" : "decrease"} for ${escapeHtml(locationName)}</h2>
      <p style="font-size: 14px; line-height: 1.6; color: #555;">
        ${escapeHtml(reasonLabel)} Here are the details for ${escapeHtml(parentName)}.
      </p>

      <table style="width: 100%; border-collapse: collapse; margin: 24px 0; background: #f8f7f2; border-radius: 12px; overflow: hidden;">
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #e8e6dc;">Location</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #e8e6dc;">${escapeHtml(locationName)}</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #e8e6dc;">Previous rate</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 600; text-align: right; border-bottom: 1px solid #e8e6dc; text-decoration: line-through; color: #888;">${formatMoneyCents(oldRateCents)} /mo</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555; border-bottom: 1px solid #e8e6dc;">New rate</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 700; text-align: right; border-bottom: 1px solid #e8e6dc; color: ${accentColor};">${formatMoneyCents(newRateCents)} /mo</td>
        </tr>
        <tr>
          <td style="padding: 14px 20px; font-size: 13px; color: #555;">Effective date</td>
          <td style="padding: 14px 20px; font-size: 14px; font-weight: 700; text-align: right;">${formatLocationBillingDate(effectiveDate)}</td>
        </tr>
      </table>

      ${isIncrease ? `
        <p style="font-size: 13px; line-height: 1.6; color: #777;">
          Per our terms, rate increases take effect at least 30 days from notice. If you'd prefer to remove this location before the new rate kicks in, you can do so from the Locations page in your dashboard.
        </p>
      ` : `
        <p style="font-size: 13px; line-height: 1.6; color: #777;">
          The new lower rate takes effect on your next billing cycle. No action needed.
        </p>
      `}
      <p style="font-size: 13px; line-height: 1.6; color: #777;">
        Questions? Contact ${escapeHtml(supportEmail)}.
      </p>
    </div>
  `;

  const result = await Promise.all(
    recipients.map((email) => sendEmail({ to: email, subject, html }))
  );
  const okCount = result.filter((r) => r.ok).length;
  console.log("[Email] sendLocationRateChangeNoticeEmail parent=%s child=%s old=%d new=%d sent=%d/%d", parentTenant.id, location.id, oldRateCents, newRateCents, okCount, recipients.length);
  return { ok: okCount > 0, sent: okCount, total: recipients.length };
}

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  sendPostServiceFollowUpEmail,
  sendReferralRequestEmail,
  sendMaintenanceReminderEmail,
  sendReengagementEmail,
  sendSeasonalCampaignEmail,
  sendAdminInvitationEmail,
  sendTeamInviteEmail,
  sendUsageAlertEmail,
  sendLocationAddedEmail,
  sendFranchiseeInviteEmail,
  sendLocationRemovalConfirmationEmail,
  sendLocationRateChangeNoticeEmail,
};

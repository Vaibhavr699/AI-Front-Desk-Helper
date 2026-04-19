"use strict";

// ============================================================================
// services/resellerEmail.js
// Apr 20, 2026 — Phase 2 WL Reseller email senders
// ============================================================================
// Sends via Resend (already configured per [Email] Resend configured log line).
// All emails are single-file inline HTML — no external template dependency.
// Safe to call; sendEmail() catches/logs failures, never throws to caller.
//
// Exports:
//   sendResellerWelcomeEmail          — reseller completed checkout
//   sendResellerCustomerWelcomeEmail  — customer added (or self-signed-up)
//   sendResellerCustomerRemovedEmail  — reseller removed a customer
//   sendResellerNewCustomerNotification — notify reseller of new public signup
//   sendResellerChurnTransferEmail    — reseller canceled, customer transferred
// ============================================================================

const { Resend } = require('resend');

const resend = new Resend(process.env.RESEND_API_KEY);
const FROM = process.env.RESEND_FROM_EMAIL || 'noreply@aifrontdeskhelper.com';
const APP_URL = process.env.APP_URL || 'https://aifrontdeskhelper.com';

// ---------------------------------------------------------------------------
// Internal: wrapped send (never throws)
// ---------------------------------------------------------------------------
async function send({ to, subject, html, replyTo }) {
  try {
    const payload = { from: FROM, to, subject, html };
    if (replyTo) payload.reply_to = replyTo;
    const result = await resend.emails.send(payload);
    if (result?.error) {
      console.error(`[resellerEmail] send failed to=${to} subject="${subject}":`, result.error);
      return { ok: false, error: result.error };
    }
    console.log(`[resellerEmail] sent to=${to} subject="${subject}"`);
    return { ok: true, id: result?.data?.id };
  } catch (err) {
    console.error(`[resellerEmail] exception to=${to} subject="${subject}":`, err.message);
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Internal: white-label CSS wrapper. Uses reseller's brand color if provided.
// ---------------------------------------------------------------------------
function wrap({ title, bodyHtml, brandColor = '#1a1a1a', logoUrl = null, footerText = '' }) {
  const logoBlock = logoUrl
    ? `<img src="${logoUrl}" alt="" style="max-height:40px;margin-bottom:16px;" />`
    : '';
  const footer = footerText
    ? `<p style="font-size:12px;color:#888;margin-top:32px;">${footerText}</p>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f6f6f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:40px;box-shadow:0 2px 8px rgba(0,0,0,0.04);">
        <tr><td>
          ${logoBlock}
          <div style="height:4px;width:48px;background:${brandColor};border-radius:2px;margin-bottom:24px;"></div>
          ${bodyHtml}
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function button(label, href, color = '#1a1a1a') {
  return `<a href="${href}" style="display:inline-block;background:${color};color:#ffffff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin:16px 0;">${label}</a>`;
}

// ===========================================================================
// sendResellerWelcomeEmail
// Fires when reseller completes initial Stripe checkout
// ===========================================================================
async function sendResellerWelcomeEmail({
  to,
  reseller_name,
  tier_name,
  reseller_code,
}) {
  const signupUrl = `${APP_URL}/reseller/${reseller_code}/signup`;
  const dashboardUrl = `${APP_URL}/dashboard`;

  const body = `
    <h1 style="font-size:24px;margin:0 0 16px;color:#1a1a1a;">Welcome, ${reseller_name}!</h1>
    <p style="color:#444;line-height:1.6;">Your <strong>${tier_name}</strong> reseller plan is now active. You can start onboarding customers immediately.</p>
    <p style="color:#444;line-height:1.6;">Your unique signup link to share with prospects:</p>
    <p style="background:#f0f0f0;padding:12px;border-radius:6px;font-family:monospace;word-break:break-all;">${signupUrl}</p>
    ${button('Open Reseller Dashboard', dashboardUrl)}
    <p style="color:#666;font-size:14px;line-height:1.6;">Need anything? Just reply to this email.</p>
  `;

  return send({
    to,
    subject: `Welcome — your ${tier_name} reseller plan is active`,
    html: wrap({ title: 'Welcome', bodyHtml: body }),
  });
}

// ===========================================================================
// sendResellerCustomerWelcomeEmail
// Fires when reseller adds a customer OR customer self-signs-up
// ===========================================================================
async function sendResellerCustomerWelcomeEmail({
  to,
  customer_name,
  reseller_name,
  reseller_contact_email,
  reseller_brand_color,
  reseller_logo_url,
  set_password_url,
}) {
  const body = `
    <h1 style="font-size:24px;margin:0 0 16px;color:#1a1a1a;">Welcome, ${customer_name}!</h1>
    <p style="color:#444;line-height:1.6;">Your account with <strong>${reseller_name}</strong> has been created. Click below to set your password and log in.</p>
    ${button('Set Your Password', set_password_url, reseller_brand_color || '#1a1a1a')}
    <p style="color:#666;font-size:14px;line-height:1.6;">Questions? Reach out to ${reseller_name} directly at <a href="mailto:${reseller_contact_email}">${reseller_contact_email}</a>.</p>
  `;

  return send({
    to,
    replyTo: reseller_contact_email,
    subject: `Welcome to ${reseller_name}`,
    html: wrap({
      title: 'Welcome',
      bodyHtml: body,
      brandColor: reseller_brand_color,
      logoUrl: reseller_logo_url,
      footerText: `Sent by ${reseller_name}. If you didn't expect this, please ignore this email.`,
    }),
  });
}

// ===========================================================================
// sendResellerCustomerRemovedEmail
// Fires when reseller removes a customer
// ===========================================================================
async function sendResellerCustomerRemovedEmail({
  to,
  customer_name,
  reseller_name,
  reseller_contact_email,
  reseller_brand_color,
  reseller_logo_url,
}) {
  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;color:#1a1a1a;">Account Closed</h1>
    <p style="color:#444;line-height:1.6;">Hi ${customer_name},</p>
    <p style="color:#444;line-height:1.6;">Your account with <strong>${reseller_name}</strong> has been closed. If you believe this was in error or would like to continue service, please contact them directly:</p>
    <p><a href="mailto:${reseller_contact_email}" style="color:${reseller_brand_color || '#1a1a1a'};">${reseller_contact_email}</a></p>
  `;

  return send({
    to,
    replyTo: reseller_contact_email,
    subject: `Your ${reseller_name} account has been closed`,
    html: wrap({
      title: 'Account Closed',
      bodyHtml: body,
      brandColor: reseller_brand_color,
      logoUrl: reseller_logo_url,
    }),
  });
}

// ===========================================================================
// sendResellerNewCustomerNotification
// Fires when a customer self-signs-up via public link
// ===========================================================================
async function sendResellerNewCustomerNotification({
  to,
  reseller_name,
  customer_name,
  customer_email,
  customer_phone,
}) {
  const dashboardUrl = `${APP_URL}/reseller/customers`;

  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;color:#1a1a1a;">New Customer Signup 🎉</h1>
    <p style="color:#444;line-height:1.6;">A new customer just signed up through your reseller link:</p>
    <table cellpadding="8" style="background:#f7f7f7;border-radius:6px;margin:12px 0;">
      <tr><td style="color:#666;">Name:</td><td><strong>${customer_name}</strong></td></tr>
      <tr><td style="color:#666;">Email:</td><td>${customer_email}</td></tr>
      ${customer_phone ? `<tr><td style="color:#666;">Phone:</td><td>${customer_phone}</td></tr>` : ''}
    </table>
    ${button('View in Dashboard', dashboardUrl)}
  `;

  return send({
    to,
    subject: `New customer signup — ${customer_name}`,
    html: wrap({ title: 'New Signup', bodyHtml: body }),
  });
}

// ===========================================================================
// sendResellerChurnTransferEmail
// Fires when reseller cancels → customer is being transferred to direct billing
// ===========================================================================
async function sendResellerChurnTransferEmail({
  to,
  customer_name,
  reseller_name,
  direct_billing_url,
}) {
  const body = `
    <h1 style="font-size:22px;margin:0 0 16px;color:#1a1a1a;">Important update about your account</h1>
    <p style="color:#444;line-height:1.6;">Hi ${customer_name},</p>
    <p style="color:#444;line-height:1.6;">Your service provider <strong>${reseller_name}</strong> has ended their partnership with AI Front Desk Helper. To avoid interruption to your service, your account will transition to direct billing with us.</p>
    <p style="color:#444;line-height:1.6;">Click below to set up your direct billing and continue service without interruption:</p>
    ${button('Set Up Direct Billing', direct_billing_url)}
    <p style="color:#666;font-size:14px;line-height:1.6;">If you do nothing, your service will be paused after 30 days. Questions? Reply to this email.</p>
  `;

  return send({
    to,
    subject: 'Action required: your service is being transferred',
    html: wrap({
      title: 'Service Transfer',
      bodyHtml: body,
      footerText: 'AI Front Desk Helper · aifrontdeskhelper.com',
    }),
  });
}

module.exports = {
  sendResellerWelcomeEmail,
  sendResellerCustomerWelcomeEmail,
  sendResellerCustomerRemovedEmail,
  sendResellerNewCustomerNotification,
  sendResellerChurnTransferEmail,
};

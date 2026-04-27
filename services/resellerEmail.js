"use strict";

// ============================================================================
// services/resellerEmail.js
// Apr 20, 2026 — Phase 2 WL Reseller email senders
// Apr 27, 2026 — Added sendResellerCapWarningEmail (cap threshold alerts
//                fired by services/reportResellerUsage.js cron at 80% / 100%)
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
//   sendResellerCapWarningEmail       — cap usage at 80% or 100% threshold
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

// ===========================================================================
// sendResellerCapWarningEmail
// Apr 27, 2026 — Fires from cron/reportResellerUsage.js when a reseller
// crosses 80% or 100% of their voice or SMS cap for the current billing
// month. The email tells the reseller exactly which metric tripped the
// threshold, what their projected overage cost would be (at 100%), and
// suggests upgrading to the next tier when it would save money.
//
// At 80%: friendly heads-up, "you're approaching your cap"
// At 100%: matter-of-fact "you're now in overage, here's the math"
//          — service is NOT blocked at 100% (per Drew Apr 27 decision),
//          customer continues using and gets billed for overage on their
//          next Stripe invoice.
// ===========================================================================
async function sendResellerCapWarningEmail({
  to,
  reseller_name,
  tier_name,
  metric,                     // 'voice' or 'sms'
  threshold,                  // 80 or 100
  used,                       // raw usage value (e.g. 2400)
  cap,                        // raw cap value (e.g. 3000)
  overage_rate_cents,         // e.g. 15 = $0.15
  projected_overage_cents,    // calculated by caller, can be 0 at 80%
  next_tier_name,             // 'Growth' / 'Scale' / null if at top
  next_tier_monthly_cents,    // for upgrade math, null if at top
  current_tier_monthly_cents, // for upgrade math
}) {
  const dashboardUrl = `${APP_URL}/reseller`;
  const upgradeUrl   = `${APP_URL}/reseller/plans`;

  const metricLabel = metric === 'voice' ? 'voice minutes' : 'SMS messages';
  const metricUnit  = metric === 'voice' ? 'min' : 'msg';
  const usedFmt = Number(used).toLocaleString('en-US');
  const capFmt  = Number(cap).toLocaleString('en-US');
  const rateDisplay = `$${(overage_rate_cents / 100).toFixed(2)}/${metricUnit}`;

  const isAt100 = threshold >= 100;
  const subject = isAt100
    ? `⚠️ ${metric === 'voice' ? 'Voice' : 'SMS'} cap reached — overage charges now active`
    : `Heads up: you're at 80% of your ${metric === 'voice' ? 'voice' : 'SMS'} cap`;

  // Build upgrade-math block only when next tier exists AND would save money
  // at the current run rate. We project the customer's cost both ways:
  //   stay = current flat + (projected overage)
  //   upgrade = next tier flat
  // If upgrade < stay, recommend it. Otherwise, omit the upgrade pitch
  // entirely (the customer's overage is profitable for them at current usage).
  let upgradeBlock = '';
  if (isAt100 && next_tier_name && next_tier_monthly_cents) {
    const stayCostCents    = current_tier_monthly_cents + projected_overage_cents;
    const upgradeCostCents = next_tier_monthly_cents;
    if (upgradeCostCents < stayCostCents) {
      const savingsCents = stayCostCents - upgradeCostCents;
      const savingsDollars = (savingsCents / 100).toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      });
      upgradeBlock = `
        <div style="background:#fff7e6;border:1px solid #ffd591;border-radius:8px;padding:16px;margin:24px 0;">
          <p style="margin:0 0 8px;font-weight:600;color:#874d00;">💡 Upgrading would save you ~$${savingsDollars}/month at this usage rate.</p>
          <p style="margin:0;color:#666;font-size:14px;">Switch to <strong>${next_tier_name}</strong> to lock in a higher cap before next month's bill.</p>
          ${button(`Upgrade to ${next_tier_name}`, upgradeUrl, '#fa8c16')}
        </div>
      `;
    }
  }

  const usageBar = `
    <div style="background:#f0f0f0;border-radius:8px;height:24px;width:100%;margin:12px 0;overflow:hidden;">
      <div style="background:${isAt100 ? '#ff4d4f' : '#fa8c16'};height:100%;width:${Math.min(100, (used / cap) * 100)}%;"></div>
    </div>
    <p style="margin:0;color:#666;font-size:14px;">
      <strong>${usedFmt}</strong> of <strong>${capFmt}</strong> ${metricLabel} used (${Math.round((used / cap) * 100)}%)
    </p>
  `;

  let mainMessage;
  if (isAt100) {
    const projDollars = (projected_overage_cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    mainMessage = `
      <h1 style="font-size:22px;margin:0 0 16px;color:#1a1a1a;">You've hit your ${metricLabel} cap</h1>
      <p style="color:#444;line-height:1.6;">Heads up, ${reseller_name} — your network just exceeded the ${capFmt} ${metricLabel} included in your <strong>${tier_name}</strong> plan for this billing month.</p>
      ${usageBar}
      <p style="color:#444;line-height:1.6;margin-top:16px;">
        Service continues uninterrupted. Additional usage is billed at <strong>${rateDisplay}</strong> on your next invoice.
        ${projected_overage_cents > 0 ? `Projected overage so far: <strong>$${projDollars}</strong>.` : ''}
      </p>
      ${upgradeBlock}
    `;
  } else {
    mainMessage = `
      <h1 style="font-size:22px;margin:0 0 16px;color:#1a1a1a;">You're at 80% of your ${metricLabel} cap</h1>
      <p style="color:#444;line-height:1.6;">Hey ${reseller_name} — wanted to give you a heads-up that your network has used 80% of the ${capFmt} ${metricLabel} included in your <strong>${tier_name}</strong> plan for this billing month.</p>
      ${usageBar}
      <p style="color:#444;line-height:1.6;margin-top:16px;">
        If you go over, additional usage is billed at <strong>${rateDisplay}</strong> on your next invoice. No action needed unless you want to upgrade to a higher tier ahead of time.
      </p>
    `;
  }

  const body = `
    ${mainMessage}
    ${button('View Usage Dashboard', dashboardUrl)}
    <p style="color:#666;font-size:14px;line-height:1.6;margin-top:24px;">Questions? Reply to this email — we're here to help.</p>
  `;

  return send({
    to,
    subject,
    html: wrap({
      title: subject,
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
  sendResellerCapWarningEmail,
};

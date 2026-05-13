"use strict";

/**
 * services/touchUp.js
 *
 * Routes touch-up requests to a human team member instead of letting
 * the AI auto-book. Discovered May 13, 2026 via Miranda Hopkins
 * transcript — AI tried to schedule a touch-up appointment with bogus
 * same-day past-time logic when she asked about fixing a cabinet spot.
 * Touch-ups involve warranty / scope / crew decisions the booking AI
 * doesn't understand, so we hand them off cleanly.
 *
 * Detection: keyword match on touch-up vocabulary. Customer status
 * (existing vs. new) is captured for the team email but isn't required
 * for routing — keyword match alone triggers handoff.
 *
 * Side effects on a match:
 *   1. Polite "team member will reach out" reply to the customer
 *   2. Team email with full context (name, phone, address, history)
 *   3. Owner dashboard notification (type: touch_up_request)
 *   4. Skips the AI orchestrator entirely (no risk of auto-booking)
 */

const db = require("../lib/db");

const TOUCH_UP_PHRASES = [
  /\btouch[- ]?ups?\b/i,                                  // touch-up, touchup, touch up
  /\bmissed (a |an )?(spot|area|section)/i,               // missed a spot
  /\bsecond coat\b/i,                                     // second coat
  /\b(left ?over|extra) paint\b/i,                        // leftover paint, extra paint
  /\bredo (a |the )?(small |tiny )?(spot|area|section)/i, // redo a small spot
  /\bfix (a |an )?(small |tiny )?(spot|area|section)\b/i, // fix a spot
  /\bsmall (spot|area|section) (that|where|on|in)/i,      // small spot that...
  /\bone (spot|area) (in|on|by)/i,                        // one spot in the kitchen
];

function hasTouchUpKeyword(text) {
  if (!text || typeof text !== "string") return false;
  return TOUCH_UP_PHRASES.some((rx) => rx.test(text));
}

/**
 * Detect whether an inbound message is a touch-up request. Returns
 * null when no match, otherwise an object with context for the handler.
 */
async function detectTouchUpRequest(thread, incomingText) {
  if (!hasTouchUpKeyword(incomingText)) return null;

  // Look up the lead for additional context so the team email can
  // tell the rep "this is an existing customer, last serviced X".
  let leadContext = null;
  if (thread.leadId) {
    try {
      const r = await db.query(
        `SELECT id, name, phone, email, address, last_service_date, status
           FROM leads WHERE id = $1 LIMIT 1`,
        [thread.leadId]
      );
      leadContext = r.rows[0] || null;
    } catch (e) {
      console.error("[TouchUp] Lead lookup failed:", e.message);
    }
  }

  const isExistingCustomer = !!(leadContext && leadContext.last_service_date);

  return {
    matched: true,
    isExistingCustomer,
    leadContext,
  };
}

/**
 * Handle a touch-up request. Sends the customer-facing reply, fires
 * team email + owner notification (both fire-and-forget). Returns
 * the reply string for the caller to send via SMS.
 */
async function handleTouchUpRequest(thread, incomingText, tenant, detection) {
  const customerName =
    detection.leadContext?.name ||
    thread.leadCapture?.full_name ||
    null;
  const firstName = customerName ? customerName.split(/\s+/)[0] : "there";
  const companyName = tenant.company_name || tenant.name || "us";

  // Slightly different copy when we recognize them. Either way, NO
  // commitment to a specific time, NO auto-booking, NO "what day works?"
  // — that's exactly the trap Miranda fell into.
  const replyText = detection.isExistingCustomer
    ? `Hi ${firstName} — thanks for letting us know! A team member from ${companyName} will reach out to you shortly to schedule that touch-up.`
    : `Hi${customerName ? ` ${firstName}` : ""}! Thanks for reaching out — a team member from ${companyName} will get back to you shortly to help with that.`;

  // Best-effort side effects — never block the customer reply on these
  sendTouchUpTeamEmail(tenant, thread, incomingText, detection).catch((e) =>
    console.error("[TouchUp] Team email failed:", e.message)
  );
  fireTouchUpNotification(tenant, thread, incomingText, detection).catch((e) =>
    console.error("[TouchUp] Notification failed:", e.message)
  );

  console.log(
    "[TouchUp] Routed leadId=%s tenant=%s existing=%s text=%s",
    thread.leadId || "(none)",
    tenant.id,
    detection.isExistingCustomer,
    incomingText.slice(0, 100)
  );

  return replyText;
}

async function sendTouchUpTeamEmail(tenant, thread, incomingText, detection) {
  const emailService = require("./email");

  const customerName =
    detection.leadContext?.name ||
    thread.leadCapture?.full_name ||
    "Unknown customer";
  const customerPhone =
    thread.leadCapture?.phone || thread.phone || "Unknown";
  const customerEmail =
    thread.leadCapture?.email ||
    detection.leadContext?.email ||
    "(not provided)";

  // Prefer tenant.support_email. Fall back to env, then to Drew as
  // last resort. Matches existing /api/contact pattern in server.js.
  const teamEmail =
    tenant.support_email ||
    process.env.CONTACT_EMAIL ||
    "drew@aifrontdeskhelper.com";

  const subject = `Touch-up requested: ${customerName}`;

  const statusLine = detection.isExistingCustomer
    ? `<p><strong>Customer status:</strong> Existing customer (last service: ${detection.leadContext?.last_service_date || "date not recorded"})</p>`
    : `<p><strong>Customer status:</strong> Not found in our system — may need to verify identity</p>`;

  const addressLine = detection.leadContext?.address
    ? `<p><strong>Address on file:</strong> ${escapeHtml(detection.leadContext.address)}</p>`
    : "";

  const html = `
    <h2 style="margin: 0 0 12px 0;">Touch-up request from ${escapeHtml(customerName)}</h2>
    <p><strong>Customer:</strong> ${escapeHtml(customerName)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(customerPhone)}</p>
    <p><strong>Email:</strong> ${escapeHtml(customerEmail)}</p>
    ${statusLine}
    ${addressLine}
    <p><strong>What they said:</strong></p>
    <blockquote style="border-left: 3px solid #E8702A; padding-left: 12px; color: #555; margin: 8px 0;">
      ${escapeHtml(incomingText)}
    </blockquote>
    <p>The AI told them a team member will reach out shortly. Please follow up to schedule the touch-up.</p>
    <hr style="border: none; border-top: 1px solid #eee; margin: 16px 0;" />
    <p style="color: #888; font-size: 12px;">Sent automatically by AI Front Desk Helper. Touch-up requests are routed to a human because they typically involve warranty, scope, or crew decisions the AI doesn't handle.</p>
  `;

  return emailService.sendEmail({
    to: teamEmail,
    subject,
    html,
  });
}

async function fireTouchUpNotification(tenant, thread, incomingText, detection) {
  const notificationsService = require("./notifications");

  const customerName =
    detection.leadContext?.name ||
    thread.leadCapture?.full_name ||
    "A customer";

  return notificationsService.createNotification(tenant.id, {
    type: "touch_up_request",
    title: "Touch-up requested",
    body: `${customerName} asked for a touch-up. The AI told them a team member will reach out — please follow up to schedule.`,
    data: {
      leadId: thread.leadId || null,
      customerName,
      customerPhone: thread.leadCapture?.phone || thread.phone || null,
      incomingText: incomingText.slice(0, 500),
      isExistingCustomer: detection.isExistingCustomer,
      lastServiceDate: detection.leadContext?.last_service_date || null,
    },
  });
}

// Cheap HTML escaper — mirrors escapeXml in server.js
function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

module.exports = {
  detectTouchUpRequest,
  handleTouchUpRequest,
  hasTouchUpKeyword,
  // exported for unit testing
  TOUCH_UP_PHRASES,
};

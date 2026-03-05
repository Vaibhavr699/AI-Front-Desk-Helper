"use strict";

const twilio = require("../lib/twilio");
const db = require("../lib/db");
const emailService = require("./email");
const { getCallByTwilioSid, updateCallByTwilioSid } = require("./calls");

const BASE_URL = process.env.BASE_URL;

function replaceTemplate(template, vars) {
  let s = template || "";
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`{{${k}}}`, "g"), String(v == null ? "" : v));
  }
  return s;
}

// Human-readable labels for transfer reasons
const REASON_LABELS = {
  commercial_job: "Commercial Job",
  high_value_over_10k: "High-Value Project ($10k+)",
  frustrated_caller: "Frustrated Caller",
  vip_repeat_customer: "VIP / Repeat Customer",
  caller_requested_human: "Caller Requested Live Agent",
};

/**
 * Build a rich pre-brief SMS body with all available context.
 * If the tenant has a custom template, use that with variable substitution.
 * Otherwise, build a structured brief with all available fields.
 */
function buildPreBriefBody(tenant, callerPhone, summary, reason, extras = {}) {
  // If tenant has a custom template, use it with all available variables
  const customTemplate = tenant.transfer_sms_brief && tenant.transfer_sms_brief.trim();
  if (customTemplate) {
    return replaceTemplate(customTemplate, {
      summary: summary || "AI transfer",
      caller_phone: callerPhone || "—",
      caller_name: extras.caller_name || "Unknown",
      project_type: extras.project_type || "—",
      budget_estimate: extras.budget_estimate || "Not stated",
      sentiment: extras.sentiment || "neutral",
      reason: REASON_LABELS[reason] || reason || "Transfer",
      notes: reason || "",
    });
  }

  // Build structured pre-brief
  const lines = [];
  lines.push(`🔔 AI TRANSFER — ${REASON_LABELS[reason] || reason || "Transfer"}`);
  lines.push("");
  if (extras.caller_name) lines.push(`👤 ${extras.caller_name}`);
  lines.push(`📞 ${callerPhone || "Unknown number"}`);
  if (extras.project_type) lines.push(`🏗️ ${extras.project_type}`);
  if (extras.budget_estimate) lines.push(`💰 ${extras.budget_estimate}`);
  if (extras.sentiment && extras.sentiment !== "neutral" && extras.sentiment !== "positive") {
    const sentimentEmoji = extras.sentiment === "angry" ? "🔴" : "🟡";
    lines.push(`${sentimentEmoji} Sentiment: ${extras.sentiment}`);
  }
  if (summary) {
    lines.push("");
    lines.push(`📝 ${summary}`);
  }

  return lines.join("\n");
}

async function sendPreBriefSms(tenant, callerPhone, summary, reason, transferTo, extras = {}) {
  const client = twilio.getClientForTenant(tenant);
  if (!client) return;
  const numbers = tenant.transfer_numbers && Array.isArray(tenant.transfer_numbers)
    ? tenant.transfer_numbers
    : (tenant.transfer_to ? [tenant.transfer_to] : []);
  const toNumber = transferTo || numbers[0];
  if (!toNumber) return;

  const body = buildPreBriefBody(tenant, callerPhone, summary, reason, extras);

  try {
    await twilio.client.messages.create({
      to: toNumber,
      from: tenant.matched_phone || process.env.TWILIO_PHONE_NUMBER,
      body,
    });
    console.log("[Transfer] Pre-brief SMS sent to=%s reason=%s", toNumber, reason);
  } catch (e) {
    console.error("[Transfer] Pre-brief SMS failed:", e.message);
  }
}

/**
 * Live transfer: pre-brief via SMS (and optional email/dashboard notification), then redirect
 * call to transfer number. Call remains recorded (AI leg already recorded; transfer leg
 * recorded via transfer-dial TwiML).
 *
 * @param {string} callSid - Twilio call SID
 * @param {string|null} transferToNumber - Override transfer number (null = use tenant config)
 * @param {string} reason - Transfer reason (commercial_job, high_value_over_10k, etc.)
 * @param {string} callerSummary - AI-generated summary of the conversation
 * @param {object} extras - Additional context: { caller_name, caller_phone, project_type, budget_estimate, sentiment }
 */
async function initiateTransfer(callSid, transferToNumber, reason, callerSummary, extras = {}) {
  const call = await getCallByTwilioSid(callSid);
  if (!call) return { success: false, error: "Call not found" };

  const tenant = await db.query(
    `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
     FROM tenants t WHERE t.id = $1`,
    [call.tenant_id]
  ).then((r) => r.rows[0]);
  if (!tenant) return { success: false, error: "Tenant not found" };

  const toDial = transferToNumber || (tenant.transfer_numbers && tenant.transfer_numbers[0]) || null;
  if (!toDial) return { success: false, error: "No transfer number configured" };

  // Pre-brief: SMS to transfer number with full context
  await sendPreBriefSms(
    tenant,
    extras.caller_phone || call.from_number,
    callerSummary,
    reason,
    toDial,
    extras
  );

  // Email notification (fire and forget)
  emailService.sendTransferNotificationEmail(tenant, call, reason, callerSummary, extras).catch((e) => console.error("[Transfer] Email error:", e.message));

  // Redirect the call to the transfer-dial TwiML
  const twimlUrl = `${BASE_URL}/twilio/transfer-dial?to=${encodeURIComponent(toDial)}`;
  await client.calls(callSid).update({
    url: twimlUrl,
    method: "GET",
  });

  // Update call record with transfer details
  await updateCallByTwilioSid(callSid, {
    transferred: true,
    transfer_to: toDial,
    transfer_reason: reason,
    disposition: "transferred",
  });

  console.log(
    "[Transfer] Initiated callSid=%s to=%s reason=%s caller=%s",
    callSid, toDial, reason, extras.caller_name || call.from_number
  );

  return { success: true };
}

module.exports = {
  sendPreBriefSms,
  initiateTransfer,
};

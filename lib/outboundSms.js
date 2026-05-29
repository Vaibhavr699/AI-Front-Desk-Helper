"use strict";

const db = require("../lib/db");
const twilio = require("./twilio");
const smsService = require("../services/sms");
const messagesService = require("../services/messages");

/**
 * Central outbound SMS helper.
 *
 * Every AI-initiated outbound SMS in the codebase should go through this
 * function. It:
 *   1. Sends via Twilio (using tenant credentials when present)
 *   2. Writes a row to `messages` so the dashboard's lead timeline + thread
 *      view show what the AI sent
 *   3. Returns the same shape services/sms.js used to return so callers
 *      don't need to change their error handling
 *
 * Required args:
 *   tenant   - full tenant row (id, twilio_account_sid, twilio_auth_token,
 *              company_name, etc.) — caller is responsible for the lookup
 *   to       - recipient phone, any format Twilio accepts
 *   body     - the message text
 *   source   - one of "recovery" | "briefing" | "missed_call" |
 *              "cancellation_confirm" | "estimate_link" | "owner_alert" |
 *              "notification" | "manual" — stored in messages.meta.source
 *              so the dashboard can filter/badge each type
 *   leadId   - REQUIRED for the row to show on the lead timeline. Caller
 *              must resolve the lead first. If you genuinely have no lead
 *              (e.g. owner-alert SMS to the tenant's own phone), pass null
 *              and the row is written without lead_id (visible in the
 *              activity feed but not on any lead timeline).
 *
 * Optional args:
 *   sourceId - feature-specific ID (recovery_id, booking_id, etc.) — stored
 *              in meta for traceability
 *   meta     - additional metadata merged into the messages.meta jsonb
 *
 * Returns:
 *   { ok: true, sid }   on success
 *   { ok: false, reason, error? } on failure
 *
 * Never throws.
 */
async function send({ tenant, to, body, source, leadId = null, sourceId = null, meta = {} }) {
  if (!tenant?.id || !to || !body) {
    return { ok: false, reason: "missing_args" };
  }

  const client = twilio.getClientForTenant(tenant);
  if (!client) {
    return { ok: false, reason: "no_twilio_client" };
  }

  const fromPhone = await smsService.getTenantPrimaryPhone(tenant.id);
  if (!fromPhone) {
    return { ok: false, reason: "no_from_phone" };
  }

  let sid = null;
  try {
    const message = await client.messages.create({ to, from: fromPhone, body });
    sid = message.sid;
  } catch (err) {
    console.error("[outboundSms] Twilio send failed source=%s tenant=%s to=%s code=%s err=%s",
      source, tenant.id, to, err.code || "unknown", err.message);
    return { ok: false, reason: "twilio_error", error: err.message };
  }

  // Write to messages so the dashboard sees it. Non-fatal if it fails —
  // the SMS already went out, we just can't show it in the UI. Log and
  // continue so the caller still gets an "ok" result for the send.
  try {
    const fullMeta = {
      ...meta,
      source,
      source_id: sourceId,
      twilio_sid: sid,
      from_phone: fromPhone,
      ai_initiated: true,
    };
    await messagesService.saveMessage(
      tenant.id,
      leadId,
      "sms",
      "outbound",
      body,
      fullMeta
    );
  } catch (err) {
    console.error("[outboundSms] messages write failed (SMS already sent) source=%s tenant=%s sid=%s err=%s",
      source, tenant.id, sid, err.message);
  }

  console.log("[outboundSms] sent source=%s tenant=%s to=%s leadId=%s sid=%s",
    source, tenant.id, to, leadId || "(none)", sid);

  return { ok: true, sid };
}

module.exports = { send };

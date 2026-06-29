"use strict";

/**
 * lib/outboundSms.js
 *
 * Central outbound SMS helper. Every AI-initiated outbound SMS in the
 * codebase should go through this function — not call client.messages.create
 * directly. Doing so ensures:
 *
 *   1. The SMS is sent via Twilio using tenant credentials when present
 *   2. A row is written to the `messages` table so the dashboard's lead
 *      timeline, messages thread, and activity feed show what the AI sent
 *   3. Metadata (source, source_id, twilio_sid) is captured for filtering
 *      and traceability
 *
 * This is the foundation of the May 28, 2026 outbound visibility refactor.
 * Before this helper existed, AI-initiated SMS (recovery touches, pre-visit
 * briefings, missed-call follow-ups, owner alerts) were invisible to tenant
 * admins because the senders called Twilio's REST API directly and never
 * wrote to `messages`.
 *
 * Rollout pattern: each AI sender (services/preVisitBriefing.js,
 * services/estimateRecovery.js sendRecoverySms, routes/twilio.js missed-call
 * SMS, etc.) is migrated to this helper one at a time, lowest-risk first.
 *
 * Required args:
 *   tenant   - full tenant row (must have id, twilio_account_sid/auth_token
 *              if BYO Twilio). Caller is responsible for the lookup.
 *   to       - recipient phone, any format Twilio accepts
 *   body     - the message text
 *   source   - one of "recovery" | "briefing" | "missed_call" |
 *              "cancellation_confirm" | "estimate_link" | "owner_alert" |
 *              "notification" | "manual" — stored in messages.metadata.source
 *              so the dashboard can filter/badge each type
 *
 * Optional args:
 *   leadId   - REQUIRED for the row to show on the lead timeline. Caller
 *              must resolve the lead first. If you genuinely have no lead
 *              (e.g. owner-alert SMS to the tenant's own phone), pass null
 *              and the row is written without lead_id — visible in activity
 *              feed/admin views but not on any individual lead timeline.
 *   sourceId - feature-specific ID (recovery_id, booking_id, etc.) — stored
 *              in metadata.source_id for traceability
 *   meta     - additional metadata merged into the messages.metadata jsonb
 *
 * Returns:
 *   { ok: true, sid }                       on success
 *   { ok: false, reason, error? }           on failure
 *
 * Never throws. The Twilio failure modes (invalid number, unsubscribed,
 * region-blocked) are returned as { ok: false, reason: "twilio_error",
 * error: e.message } so callers can decide how to log/handle.
 */

const twilio = require("./twilio");
const smsService = require("../services/sms");
const messagesService = require("../services/messages");

async function send({ tenant, to, body, source, leadId = null, sourceId = null, meta = {} }) {
  if (!tenant?.id || !to || !body || !source) {
    console.warn(
      "[outboundSms] Missing required args tenant=%s to=%s source=%s bodyLen=%s",
      tenant ? "ok" : "MISSING",
      to || "MISSING",
      source || "MISSING",
      body ? body.length : "MISSING"
    );
    return { ok: false, reason: "missing_args" };
  }

  const client = twilio.getClientForTenant(tenant);
  if (!client) {
    console.warn("[outboundSms] No Twilio client for tenant=%s source=%s", tenant.id, source);
    return { ok: false, reason: "no_twilio_client" };
  }

  const fromPhone = await smsService.getTenantPrimaryPhone(tenant.id);
  if (!fromPhone) {
    console.warn("[outboundSms] No primary phone for tenant=%s source=%s", tenant.id, source);
    return { ok: false, reason: "no_from_phone" };
  }

  let sid = null;
  try {
    const message = await client.messages.create({ to, from: fromPhone, body });
    sid = message.sid;
  } catch (err) {
    console.error(
      "[outboundSms] Twilio send failed source=%s tenant=%s to=%s code=%s err=%s",
      source, tenant.id, to, err.code || "unknown", err.message
    );
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
    console.error(
      "[outboundSms] messages write failed (SMS already sent) source=%s tenant=%s sid=%s err=%s",
      source, tenant.id, sid, err.message
    );
  }

  console.log(
    "[outboundSms] sent source=%s tenant=%s to=%s leadId=%s sid=%s",
    source, tenant.id, to, leadId || "(none)", sid
  );

  return { ok: true, sid };
}

module.exports = { send };

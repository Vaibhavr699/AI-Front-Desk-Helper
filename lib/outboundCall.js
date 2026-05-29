"use strict";

/**
 * lib/outboundCall.js
 *
 * Central outbound call helper. Companion to lib/outboundSms.js. Every
 * AI-initiated outbound call in the codebase should go through this
 * function — not call client.calls.create directly. Doing so ensures:
 *
 *   1. The call is dialed via Twilio using tenant credentials when present
 *   2. A row is written to the `calls` table IMMEDIATELY on dial (so the
 *      dashboard's call list shows it even before answer/voicemail)
 *   3. Metadata (source, source_id) is captured for filtering
 *   4. The status-callback URL is configured so call completion writes
 *      duration/disposition back to the calls row via existing
 *      routes/twilio.js handlers
 *
 * What this DOES NOT do:
 *   - Configure machineDetection or TwiML URLs — caller passes those in.
 *     Different senders have different voicemail scripts and different
 *     TwiML routes (recovery vs missed-call callback vs nurturing).
 *
 * Recording + transcript: those land on the calls row through existing
 * flows — Twilio status callbacks update `recording_sid`, and the WS
 * media stream handler in server.js writes `transcript` via
 * safeUpdateCallSummary. We just need the row to exist first so those
 * updates have something to attach to.
 *
 * Required args:
 *   tenant       - full tenant row (id, twilio_account_sid/auth_token,
 *                  matched_phone or process.env.TWILIO_PHONE_NUMBER)
 *   to           - recipient phone
 *   twimlUrl     - the URL Twilio fetches when the call connects
 *                  (full https URL with query params already encoded)
 *   source       - "recovery" | "missed_call_callback" | "nurturing" | etc
 *
 * Optional args:
 *   leadId         - lead row this call belongs to (for the calls.lead_id FK
 *                    so the call appears on the lead timeline)
 *   sourceId       - feature-specific ID (recovery_id, schedule_id)
 *   meta           - additional metadata merged into calls.metadata jsonb
 *   statusCallback - URL for Twilio to POST status updates to
 *   machineDetection - "Enable" | undefined (caller decides whether to
 *                      detect voicemail)
 *   leadSource     - "missed_call" | "recovery" | etc — populates the
 *                    calls.lead_source column for analytics
 *
 * Returns:
 *   { ok: true, callSid, callId }   on success
 *   { ok: false, reason, error? }   on failure
 *
 * Never throws.
 */

const twilio = require("./twilio");
const callsService = require("../services/calls");
const db = require("./db");

async function create({
  tenant,
  to,
  twimlUrl,
  source,
  leadId = null,
  sourceId = null,
  meta = {},
  statusCallback = null,
  machineDetection = undefined,
  machineDetectionTimeout = undefined,
  leadSource = null,
  timeout = 30,
}) {
  if (!tenant?.id || !to || !twimlUrl || !source) {
    console.warn(
      "[outboundCall] Missing required args tenant=%s to=%s twimlUrl=%s source=%s",
      tenant ? "ok" : "MISSING",
      to || "MISSING",
      twimlUrl ? "ok" : "MISSING",
      source || "MISSING"
    );
    return { ok: false, reason: "missing_args" };
  }

  const client = twilio.getClientForTenant(tenant);
  if (!client) {
    console.warn("[outboundCall] No Twilio client for tenant=%s source=%s", tenant.id, source);
    return { ok: false, reason: "no_twilio_client" };
  }

  const fromPhone = tenant.matched_phone || process.env.TWILIO_PHONE_NUMBER;
  if (!fromPhone) {
    console.warn("[outboundCall] No from phone for tenant=%s source=%s", tenant.id, source);
    return { ok: false, reason: "no_from_phone" };
  }

  // Dial via Twilio
  const callOpts = {
    to,
    from: fromPhone,
    url: twimlUrl,
    method: "GET",
    timeout,
  };
  if (machineDetection)        callOpts.machineDetection = machineDetection;
  if (machineDetectionTimeout) callOpts.machineDetectionTimeout = machineDetectionTimeout;
  if (statusCallback) {
    callOpts.statusCallback       = statusCallback;
    callOpts.statusCallbackMethod = "POST";
    callOpts.statusCallbackEvent  = ["completed"];
  }

  let callSid = null;
  try {
    const call = await client.calls.create(callOpts);
    callSid = call.sid;
  } catch (err) {
    console.error(
      "[outboundCall] Twilio dial failed source=%s tenant=%s to=%s code=%s err=%s",
      source, tenant.id, to, err.code || "unknown", err.message
    );
    return { ok: false, reason: "twilio_error", error: err.message };
  }

  // Write calls row immediately. Uses callsService.createCall's ON CONFLICT
  // behavior — if routes/twilio.js#/recovery-call (or similar TwiML handler)
  // also writes a row for this CallSid when the call connects, the second
  // write is an UPDATE not a duplicate.
  let callId = null;
  try {
    const callRow = await callsService.createCall(
      tenant.id,
      callSid,
      fromPhone,
      to,
      "outbound"
    );
    callId = callRow?.id || null;

    // Add metadata + lead_id + lead_source in a follow-up update (createCall
    // doesn't take these args). Using raw SQL since callsService.updateCall's
    // allowed list doesn't include lead_id/lead_source.
    if (callId) {
      const fullMeta = {
        ...meta,
        source,
        source_id: sourceId,
        ai_initiated: true,
      };
      await db.query(
        `UPDATE calls
            SET metadata = $1::jsonb,
                lead_id = COALESCE($2, lead_id),
                lead_source = COALESCE($3, lead_source),
                updated_at = now()
          WHERE id = $4`,
        [JSON.stringify(fullMeta), leadId, leadSource, callId]
      );
    }
  } catch (err) {
    console.error(
      "[outboundCall] calls write failed (call already dialed) source=%s tenant=%s sid=%s err=%s",
      source, tenant.id, callSid, err.message
    );
  }

  console.log(
    "[outboundCall] dialed source=%s tenant=%s to=%s leadId=%s callSid=%s callId=%s",
    source, tenant.id, to, leadId || "(none)", callSid, callId || "(none)"
  );

  return { ok: true, callSid, callId };
}

module.exports = { create };

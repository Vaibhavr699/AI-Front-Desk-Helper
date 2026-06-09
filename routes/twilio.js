"use strict";

const express = require("express");
const { getTenantByPhone, getTenantById, getTenantBySlug } = require("../lib/tenant");
const callsService = require("../services/calls");
const recordingService = require("../services/recording");
const { updateCallByTwilioSid, getCallByTwilioSid } = require("../services/calls");
const { getLast10Digits, normalizeE164Phone } = require("../lib/phone");
const franchiseRouter = require("../lib/franchiseRouter");

const router = express.Router();
const BASE_URL = process.env.BASE_URL;

function sendVoiceError(res, message = "Something went wrong. Goodbye.") {
  const twiml = `<Response><Say voice="Polly.Joanna">${escapeXml(message)}</Say><Hangup/></Response>`;
  res.type("text/xml").send(twiml);
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

router.post("/voice/:tenantId?", async (req, res) => {
  const { CallSid, From, To } = req.body || {};
  const toNumber = To || req.body?.To;
  const fromNumber = From || req.body?.From;
  console.log("[AI-Desk] Voice webhook CallSid=%s From=%s To=%s", CallSid, fromNumber, toNumber);
  try {
    let tenant = null;
    if (req.params.tenantId) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.tenantId);
      if (isUuid) {
        tenant = await getTenantById(req.params.tenantId);
      } else {
        tenant = await getTenantBySlug(req.params.tenantId);
      }
    }
    const tenantByTo   = await getTenantByPhone(toNumber);
    const tenantByFrom = await getTenantByPhone(fromNumber);
    if (!tenant) tenant = tenantByTo;
    if (!tenant) tenant = tenantByFrom;
    if (!tenant) {
      console.log("[AI-Desk] Voice webhook no tenant for To=%s From=%s", toNumber, fromNumber);
      sendVoiceError(res, "We're sorry, this number is not configured. Goodbye.");
      return;
    }

    let direction = req.body?.Direction === "inbound" ? "inbound" : "outbound";
    if (req.body?.Direction === "outbound-api") direction = "outbound";
    if (req.query.direction === "inbound")  direction = "inbound";
    if (req.query.direction === "outbound") direction = "outbound";
    if (!req.query.direction && !req.body?.Direction) {
      direction = tenantByFrom ? "outbound" : "inbound";
    }

    // ── Franchisor shared-number check (Jun 9, 2026) ───────────────────────
    // If the dialed number belongs to a franchisor parent with the master
    // toggle ON and ≥1 live child, route in "franchisor mode": force the
    // stream onto the PARENT tenant id and tag the WS URL with franchise=1 so
    // the WS handler in server.js opens the neutral opener and arms the
    // capture_service_zip tool. resolveInboundContext returns mode "direct"
    // for every existing tenant, so this is a no-op for them. Never throws.
    let franchiseMode = false;
    try {
      const fctx = await franchiseRouter.resolveInboundContext(toNumber);
      if (fctx.mode === "franchisor") {
        franchiseMode = true;
        tenant = fctx.parent;
        console.log("[AI-Desk] Franchisor mode engaged (routes/twilio) parent=%s children=%d to=%s",
          fctx.parent.id, fctx.children.length, toNumber);
      }
    } catch (e) {
      console.error("[AI-Desk] Franchisor resolve failed (continuing direct):", e.message);
    }

    await callsService.createCall(tenant.id, CallSid, fromNumber, toNumber, direction);
    console.log("[AI-Desk] Voice webhook call created CallSid=%s tenantId=%s direction=%s", CallSid, tenant.id, direction);

    const wsUrl = (BASE_URL || "").replace("https://", "wss://").replace("http://", "ws://") + "/twilio-media";
    // Franchisor flag goes in the PATH, not the query string. Twilio drops
    // query params on <Stream url> in some configs (same reason outbound/
    // recovery use path segments), so query-string franchise=1 never reached
    // the WS handler. Path: /twilio-media/{tenantId}/franchise/{callSid}
    let streamUrl;
    if (franchiseMode) {
      streamUrl = `${wsUrl}/${tenant.id}/franchise/${CallSid}?From=${encodeURIComponent(fromNumber)}&To=${encodeURIComponent(toNumber)}&direction=${direction}&franchise=1`;
    } else {
      streamUrl = `${wsUrl}/${tenant.id}/${CallSid}?From=${encodeURIComponent(fromNumber)}&To=${encodeURIComponent(toNumber)}&direction=${direction}`;
    }
    const testCallFrom = (process.env.TEST_CALL_FROM || "").replace(/\s/g, "");
    if (testCallFrom && fromNumber && fromNumber.replace(/\D/g, "") === testCallFrom.replace(/\D/g, "")) {
      streamUrl += "&turnBased=1";
    }
    const actionUrl = BASE_URL ? `${BASE_URL}/twilio/status` : null;

    let twiml = `<Response>`;
    if (actionUrl) {
      twiml += `<Connect action="${escapeXml(actionUrl)}" method="POST">`;
    } else {
      twiml += `<Connect>`;
    }
    twiml += `<Stream url="${escapeXml(streamUrl)}" /></Connect></Response>`;

    res.type("text/xml").send(twiml);
  } catch (err) {
    console.error("Voice webhook error:", err);
    sendVoiceError(res, "We're sorry, something went wrong. Please try again later.");
  }
});

router.post("/recording-status", (req, res) => {
  recordingService.handleRecordingStatus(req.body).catch((e) => console.error("Recording callback error:", e));
  res.status(200).send();
});

router.get("/transfer-dial", async (req, res) => {
  const to = req.query.to;
  if (!to) {
    res.type("text/xml").send('<Response><Say>Transfer failed.</Say><Hangup/></Response>');
    return;
  }
  const number = to.replace(/\D/g, "").replace(/^(\d{10})$/, "+1$1").replace(/^1(\d{10})$/, "+1$1");
  const recordingCallback = BASE_URL ? `${BASE_URL}/twilio/recording-status` : "";
  const recordingAttrs = recordingCallback
    ? ` record="record-from-answer" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackEvent="completed"`
    : ' record="record-from-answer"';

  // 🔄 Transfer requested notification (non-blocking, runs after TwiML response sent)
  setImmediate(async () => {
    try {
      const callSid = req.query.CallSid || req.body?.CallSid || null;
      if (!callSid) return;

      const db = require("../lib/db");
      const callRes = await db.query(
        "SELECT tenant_id, from_number FROM calls WHERE twilio_call_sid = $1 LIMIT 1",
        [callSid]
      );
      const call = callRes.rows[0];
      if (!call?.tenant_id) return;

      // Dedup per CallSid
      const dup = await db.query(
        `SELECT id FROM notifications
         WHERE tenant_id = $1 AND type = 'transfer_requested'
           AND data->>'callSid' = $2 LIMIT 1`,
        [call.tenant_id, callSid]
      );
      if (dup.rows.length > 0) return;

      await db.query(
        `INSERT INTO notifications (tenant_id, type, title, body, data, created_at)
         VALUES ($1, $2, $3, $4, $5, now())`,
        [
          call.tenant_id,
          'transfer_requested',
          'Call Transferred to Human',
          call.from_number
            ? `Caller ${call.from_number} asked to speak with a team member — call is being connected now.`
            : `A caller asked to speak with a team member — call is being connected now.`,
          JSON.stringify({ callSid, from_number: call.from_number, transfer_to: number }),
        ]
      );
      console.log("[Notification] transfer_requested fired for tenant=%s callSid=%s", call.tenant_id, callSid);
    } catch (e) {
      console.error("[Notification] transfer_requested failed:", e.message);
    }
  });

  res.type("text/xml").send(`
    <Response>
      <Say voice="Polly.Joanna">Please hold while we connect you to a team member.</Say>
      <Dial timeout="30"${recordingAttrs}>
        <Number>${number}</Number>
      </Dial>
      <Say voice="Polly.Joanna">The transfer could not be completed. Please call back.</Say>
      <Hangup/>
    </Response>
  `);
});

// ─────────────────────────────────────────────────────────
// Call status callback — fires when Twilio sees call end
//
// Updates the call row's status. For missed inbound calls (busy/failed/no-answer),
// triggers the Option B missed-call recovery flow:
//   1. Creates a lead with source='missed_call' (fires new-lead bell notification)
//   2. Sends IMMEDIATE SMS: "Sorry we missed your call..."
//   3. Fires startMissedCallRecovery → AI callback at 30 min + 24h
//
// Deduped per phone number over 24h so a caller who keeps trying only gets one
// recovery flow, not five.
// ─────────────────────────────────────────────────────────
function processStatusPayload(payload = {}) {
  const CallSid    = payload.CallSid;
  const CallStatus = payload.CallStatus;
  const From       = payload.From;

  // ── Update call row with final status (existing behavior) ─────────────
  if (CallSid && (CallStatus === "completed" || CallStatus === "busy" || CallStatus === "failed" || CallStatus === "no-answer")) {
    const endedAt = new Date().toISOString();
    updateCallByTwilioSid(CallSid, {
      status:           CallStatus,
      ended_at:         endedAt,
      duration_minutes: payload.CallDuration ? parseFloat(payload.CallDuration) / 60 : null,
    }).catch(() => {});
  }

  // ── 🆕 MISSED-CALL RECOVERY (Option B) ─────────────────────────────────
  // Triggered when the AI didn't answer the inbound call. Runs async so
  // Twilio's status callback isn't blocked. Flow:
  //   - Immediate SMS to caller ("sorry we missed your call")
  //   - 30-min AI callback (if they haven't replied by then)
  //   - 24h second AI callback
  if (CallSid && ["busy", "failed", "no-answer"].includes(CallStatus) && From) {
    setImmediate(async () => {
      try {
        const db                  = require("../lib/db");
        const twilioLib           = require("../lib/twilio");
        const { getOrCreateLead } = require("../services/leads");
        const estimateRecovery    = require("../services/estimateRecovery");

        // Get the call row to find tenant_id and verify it's inbound
        const call = await getCallByTwilioSid(CallSid);
        if (!call?.tenant_id) {
          console.log("[Missed-call] No tenant_id for CallSid=%s, skipping recovery", CallSid);
          return;
        }

        // Only trigger for inbound calls — a failed outbound call isn't
        // a "missed call" from a caller's perspective
        if (call.direction !== "inbound") {
          return;
        }

        // Dedupe: if this phone already has ANY active recovery, skip.
        // Handled inside startMissedCallRecovery but we also check here
        // to avoid creating duplicate leads unnecessarily.
        const normalizedFrom = normalizeE164Phone(From) || From;
        const fromLast10 = getLast10Digits(From);
        const recent = await db.query(
          `SELECT 1 FROM estimate_recoveries
           WHERE tenant_id = $1
             AND (
               contact_phone = $2
               OR right(regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10) = $3
             )
             AND status = 'active'
             AND created_at > now() - interval '24 hours' LIMIT 1`,
          [call.tenant_id, normalizedFrom, fromLast10]
        );
        if (recent.rows.length > 0) {
          console.log("[Missed-call] Dedupe hit for %s tenant=%s — active recovery exists", From, call.tenant_id);
          return;
        }

        // Fetch tenant info for immediate SMS
        const tenantRow = await db.query(
          `SELECT t.*,
                  (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
           FROM tenants t WHERE t.id = $1`,
          [call.tenant_id]
        ).then((r) => r.rows[0]);
        if (!tenantRow) return;

        // Get or create the lead — fires notifyNewLead bell automatically
        const lead = await getOrCreateLead(call.tenant_id, From, null, "missed_call", 'voice');
        if (!lead) return;

        // 1️⃣  IMMEDIATE "sorry we missed you" SMS
        //
        // Phase 8B visibility refactor (May 28, 2026): routes through
        // lib/outboundSms so this message appears on the lead timeline +
        // messages thread. Before this change, missed-call immediate SMS
        // were invisible to tenant admins.
        const companyName = tenantRow.company_name || tenantRow.name || "us";
        const immediateMsg = `Hi! This is ${companyName}. Sorry we missed your call — we'll text or call you back shortly. If you have a specific question, just reply here and we'll help right away.`;
        const outboundSms = require("../lib/outboundSms");
        const smsResult = await outboundSms.send({
          tenant:   tenantRow,
          to:       From,
          body:     immediateMsg,
          source:   "missed_call",
          leadId:   lead.id,
          sourceId: call.id,
          meta: {
            call_id:     call.id,
            twilio_call_sid: CallSid,
            from_number: From,
          },
        });
        if (smsResult.ok) {
          console.log("[Missed-call] Immediate SMS sent to %s tenant=%s sid=%s",
            From, call.tenant_id, smsResult.sid);
        } else {
          console.error("[Missed-call] Immediate SMS failed reason=%s err=%s",
            smsResult.reason || "unknown", smsResult.error || "(none)");
        }

        // 2️⃣  Fire the Option B missed-call recovery sequence
        //    30 min later: first AI callback (voicemail detected → scripted VM)
        //    24h later:    second AI callback
        await estimateRecovery.startMissedCallRecovery(call.tenant_id, lead, {
          call_id: call.id,
        });

        console.log("[Missed-call] Recovery triggered for %s tenant=%s lead_id=%s", From, call.tenant_id, lead.id);
      } catch (err) {
        console.error("[Missed-call] Recovery failed:", err.message);
      }
    });
  }
}

// ── Estimate Recovery Outbound Calls ──────────────────────────────────────
//
// Twilio calls this URL when the outbound recovery call connects.
// With machineDetection="Enable", Twilio adds an AnsweredBy param:
//   • "human"            → real person answered → connect to AI stream
//   • "machine_*"        → voicemail detected → play voicemail script + hang up
//   • "fax" / "unknown"  → play voicemail as fallback
//
router.get("/recovery-call", async (req, res) => {
  const recoveryId = req.query.recoveryId || "";
  const script     = req.query.script     || "";
  const voicemail  = req.query.voicemail  || script; // falls back to script if no voicemail provided
  const answeredBy = req.query.AnsweredBy || "";     // set by Twilio when machineDetection="Enable"

  console.log("[Recovery-Call] recoveryId=%s answeredBy=%s", recoveryId, answeredBy || "unknown");

  // ── Voicemail detected — leave message and hang up ─────────────────────
  const isMachine = answeredBy.startsWith("machine") || answeredBy === "fax";

  if (isMachine && voicemail) {
    console.log("[Recovery-Call] Voicemail detected — playing voicemail script");
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">${escapeXml(voicemail)}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>`;
    res.type("text/xml").send(twiml);

    // Log the voicemail touch
    setImmediate(async () => {
      try {
        const db = require("../lib/db");
        await db.query(
          `UPDATE recovery_touches SET status = 'voicemail_left' WHERE call_sid = $1 AND recovery_id = $2`,
          [req.query.CallSid || "", recoveryId]
        );
        console.log("[Recovery-Call] Voicemail left for recoveryId=%s", recoveryId);
      } catch (e) {
        console.error("[Recovery-Call] Voicemail log error:", e.message);
      }
    });
    return;
  }

  // ── Human answered (or detection unknown) — connect to AI stream ───────
  const db    = require("../lib/db");
  const wsUrl = (BASE_URL || "")
    .replace("https://", "wss://")
    .replace("http://", "ws://") + "/twilio-media";

  let tenantId = "";
  try {
    const r = await db.query(
      "SELECT tenant_id, contact_phone FROM estimate_recoveries WHERE id = $1",
      [recoveryId]
    );
    if (r.rows[0]) {
      tenantId = r.rows[0].tenant_id;
      const contactPhone = r.rows[0].contact_phone;
      const callSid = req.query.CallSid || "";
      if (callSid) {
        // Look up the tenant's actual primary phone for from_number —
        // previously this passed the literal string "RECOVERY" which
        // mis-attributed every outbound recovery call in the calls list.
        // Phase 8B visibility refactor (May 28, 2026).
        //
        // Note: lib/outboundCall.create may have already inserted the
        // calls row when makeRecoveryCall dialed. The createCall ON
        // CONFLICT handler will UPDATE rather than duplicate, so we just
        // make sure from_number reflects the actual phone.
        let fromPhone = "";
        try {
          const phoneRes = await db.query(
            `SELECT phone FROM phone_numbers
              WHERE tenant_id = $1
              ORDER BY is_primary DESC NULLS LAST, created_at ASC
              LIMIT 1`,
            [tenantId]
          );
          fromPhone = phoneRes.rows[0]?.phone || "";
        } catch (phoneErr) {
          console.error("[Twilio] recovery-call primary phone lookup failed:", phoneErr.message);
        }
        await callsService.createCall(tenantId, callSid, fromPhone, contactPhone, "outbound");
      }
    }
  } catch (e) {
    console.error("[Twilio] recovery-call tenant/call setup failed:", e.message);
  }

  const streamUrl = `${wsUrl}${tenantId ? "/" + tenantId : ""}?type=recovery`
    + `&recoveryId=${encodeURIComponent(recoveryId)}`
    + `&script=${encodeURIComponent(script)}`
    + `&callSid=${encodeURIComponent(req.query.CallSid || "")}`;

  const actionUrl    = BASE_URL ? `${BASE_URL}/twilio/status` : "";
  const connectAttrs = actionUrl ? ` action="${escapeXml(actionUrl)}" method="POST"` : "";

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect${connectAttrs}>
    <Stream url="${escapeXml(streamUrl)}" />
  </Connect>
</Response>`;
  res.type("text/xml").send(twiml);
});

router.post("/recovery-call-status", (req, res) => {
  res.writeHead(200, { "Content-Length": "0" });
  res.end();

  const CallSid       = req.body && req.body.CallSid;
  const CallStatus    = req.body && req.body.CallStatus;
  const CallDuration  = req.body && req.body.CallDuration;
  const AnsweredBy    = req.body && req.body.AnsweredBy;
  const RecordingSid  = req.body && req.body.RecordingSid;
  const RecordingUrl       = req.body && req.body.RecordingUrl;
  const RecordingStatus    = req.body && req.body.RecordingStatus;
  const RecordingDuration  = req.body && req.body.RecordingDuration;
  const recoveryId    = req.query && req.query.recoveryId;

  // ── PR 3 (May 29, 2026): Recording-completed branch ──────────────────
  //
  // The recoveryCall TwiML sets recordingStatusCallback to this same URL.
  // Twilio fires this endpoint TWICE for a recorded call:
  //   1. Call-completed event — has CallStatus, AnsweredBy, etc.
  //   2. Recording-completed event — has RecordingStatus='completed',
  //      RecordingUrl, RecordingSid, RecordingDuration.
  //
  // For voicemail-only recovery calls (machine answered, no WS opened),
  // the existing recordingService.startRecording path NEVER fires — the
  // call never reached our WebSocket. So WITHOUT this branch, Twilio
  // captures the audio (because PR 2 set record:true on calls.create) but
  // we never write a recordings row, leaving CallDetail.jsx showing
  // "No recording yet" for every voicemail-left recovery touch.
  //
  // The branch below detects recording-completed events specifically and
  // hands them off to the existing recordingService.handleRecordingStatus
  // pipeline — same code path inbound calls already use. That pipeline:
  //   - Inserts a recordings row keyed to the call by CallSid
  //   - Downloads + S3-uploads the audio
  //   - Queues for Whisper transcription
  //
  // Calls that ANSWERED (human) and went through the WS already created
  // their recordings row via the existing path during server.js streaming.
  // This branch is purely additive for the voicemail-only case.
  //
  if (RecordingStatus === "completed" && RecordingUrl && CallSid) {
    recordingService.handleRecordingStatus({
      CallSid,
      RecordingSid,
      RecordingUrl,
      RecordingStatus,
      RecordingDuration,
    }).catch((e) =>
      console.error("[Recovery] Recording handoff failed callSid=%s err=%s", CallSid, e.message)
    );
    // Fall through to the existing call-status update logic below in case
    // both events arrive in the same payload (Twilio sometimes batches).
  }

  if (recoveryId && CallSid) {
    const statusMap = {
      completed:   "answered",
      busy:        "busy",
      failed:      "failed",
      "no-answer": "no_answer",
      canceled:    "failed",
    };
    const touchStatus = statusMap[CallStatus] || CallStatus;

    // Update recovery_touches (existing behavior)
    setImmediate(() => {
      const db = require("../lib/db");
      db.query(
        "UPDATE recovery_touches SET status = $1 WHERE call_sid = $2 AND recovery_id = $3",
        [touchStatus, CallSid, recoveryId]
      ).catch((e) => console.error("[Recovery] Call status update error:", e.message));
    });

    // Phase 8B visibility refactor (May 28, 2026): also update the calls
    // row with final status, duration, voicemail flag, and recording SID.
    // Before this change, outbound recovery calls had a calls row that
    // never closed out — status stayed 'in_progress' forever and
    // recording/voicemail info was lost.
    setImmediate(async () => {
      try {
        const db = require("../lib/db");
        const isVoicemail = AnsweredBy && AnsweredBy.startsWith("machine");
        const finalDisposition = isVoicemail
          ? "voicemail_left"
          : (CallStatus === "completed" ? "answered" : (statusMap[CallStatus] || CallStatus));
        const durationMinutes = CallDuration ? parseFloat(CallDuration) / 60 : null;

        // Merge metadata — preserve existing source/source_id from outboundCall
        await db.query(
          `UPDATE calls
              SET status = $1,
                  disposition = $2,
                  ended_at = COALESCE(ended_at, now()),
                  duration_minutes = COALESCE(duration_minutes, $3),
                  recording_sid = COALESCE(recording_sid, $4),
                  metadata = COALESCE(metadata, '{}'::jsonb) || $5::jsonb,
                  updated_at = now()
            WHERE twilio_call_sid = $6`,
          [
            CallStatus || "completed",
            finalDisposition,
            durationMinutes,
            RecordingSid || null,
            JSON.stringify({
              answered_by: AnsweredBy || null,
              voicemail_detected: !!isVoicemail,
            }),
            CallSid,
          ]
        );
        console.log("[Recovery] Calls row updated callSid=%s status=%s disposition=%s answered_by=%s",
          CallSid, CallStatus, finalDisposition, AnsweredBy || "(none)");
      } catch (err) {
        console.error("[Recovery] Calls row update failed callSid=%s err=%s", CallSid, err.message);
      }
    });
  }
});

// ── Nurturing outbound call TwiML ─────────────────────────────────────────
//
// Same voicemail detection logic for nurturing calls.
//
router.get("/nurturing-call", async (req, res) => {
  const scheduleId = req.query.scheduleId || "";
  const script     = req.query.script     || "";
  const answeredBy = req.query.AnsweredBy || "";

  console.log("[Nurturing-Call] scheduleId=%s answeredBy=%s", scheduleId, answeredBy || "unknown");

  const isMachine = answeredBy.startsWith("machine") || answeredBy === "fax";

  if (isMachine && script) {
    console.log("[Nurturing-Call] Voicemail detected — playing voicemail script");
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="1"/>
  <Say voice="Polly.Joanna">${escapeXml(script)}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>`;
    res.type("text/xml").send(twiml);

    setImmediate(async () => {
      try {
        const db = require("../lib/db");
        await db.query(
          "UPDATE nurturing_schedule SET status = 'voicemail_left' WHERE id = $1",
          [scheduleId]
        );
        console.log("[Nurturing-Call] Voicemail left for scheduleId=%s", scheduleId);
      } catch (e) {
        console.error("[Nurturing-Call] Voicemail log error:", e.message);
      }
    });
    return;
  }

  // Human answered — connect to AI stream
  const db    = require("../lib/db");
  const wsUrl = (BASE_URL || "")
    .replace("https://", "wss://")
    .replace("http://", "ws://") + "/twilio-media";

  let tenantId = "";
  try {
    const r = await db.query(
      "SELECT tenant_id FROM nurturing_schedule WHERE id = $1",
      [scheduleId]
    );
    if (r.rows[0]) tenantId = r.rows[0].tenant_id;
  } catch (e) {
    console.error("[Twilio] nurturing-call tenant setup failed:", e.message);
  }

  const streamUrl = `${wsUrl}${tenantId ? "/" + tenantId : ""}?type=nurturing`
    + `&scheduleId=${encodeURIComponent(scheduleId)}`
    + `&script=${encodeURIComponent(script)}`;

  const actionUrl    = BASE_URL ? `${BASE_URL}/twilio/status` : "";
  const connectAttrs = actionUrl ? ` action="${escapeXml(actionUrl)}" method="POST"` : "";

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect${connectAttrs}>
    <Stream url="${escapeXml(streamUrl)}" />
  </Connect>
</Response>`;
  res.type("text/xml").send(twiml);
});

// Status callback for nurturing calls
router.post("/nurturing-call-status", (req, res) => {
  res.writeHead(200, { "Content-Length": "0" });
  res.end();

  const CallStatus = req.body && req.body.CallStatus;
  const scheduleId = req.query && req.query.scheduleId;

  if (scheduleId && CallStatus) {
    setImmediate(() => {
      const db = require("../lib/db");
      const status = CallStatus === "completed" ? "sent" : "failed";
      db.query(
        "UPDATE nurturing_schedule SET status = $1 WHERE id = $2 AND status = 'pending'",
        [status, scheduleId]
      ).catch((e) => console.error("[Nurturing] Call status update error:", e.message));
    });
  }
});

// ── Outbound campaign TwiML ───────────────────────────────────────────────
//
// Apr 24, 2026: Added AMD (Answering Machine Detection) handling.
// When Twilio's machineDetection="Enable" is set on the dial, AnsweredBy is
// populated: "human" | "machine_start" | "machine_end_*" | "fax" | "unknown".
//
// Flow:
//   • machine/fax → play a short scripted voicemail, hang up
//   • human/unknown → connect to AI stream as normal
//
// NOTE: For this to work, the outbound dial code (services/outbound.js or
// outbound engine) MUST include: { machineDetection: "Enable" } when it
// creates the Twilio call. Without that flag, AnsweredBy will always be
// empty and every call falls through to the AI path — same as before.
//
router.all("/outbound", async (req, res) => {
  const campaignId = req.query.campaignId || req.body.campaignId;
  const contactId  = req.query.contactId  || req.body.contactId;
  const scriptId   = req.query.scriptId   || req.body.scriptId;
  const answeredBy = req.query.AnsweredBy || req.body.AnsweredBy || "";

  console.log("[Outbound-Call] campaignId=%s contactId=%s answeredBy=%s",
    campaignId, contactId, answeredBy || "unknown");

  // ── Voicemail detected — leave a short message and hang up ─────────────
  // Reuses the campaign's prompt_description as the voicemail message since
  // campaigns don't currently have a separate voicemail_script field. If
  // the description is long, we truncate to ~50 words for voicemail use.
  const isMachine = answeredBy.startsWith("machine") || answeredBy === "fax";

  if (isMachine && campaignId) {
    const db = require("../lib/db");
    let voicemailScript = "";

    try {
      const cRes = await db.query(
        "SELECT prompt_description, agent_name FROM outbound_campaigns WHERE id = $1",
        [campaignId]
      );
      const campaign = cRes.rows[0];
      if (campaign) {
        const agent = campaign.agent_name || "Alex";
        // Default voicemail if no good prompt to reuse
        voicemailScript = `Hi, this is ${agent}. Sorry we missed you — please give us a call back when you have a moment. Have a great day.`;
      }
    } catch (e) {
      console.error("[Outbound-Call] Voicemail script lookup failed:", e.message);
      voicemailScript = "Hi, sorry we missed you. Please call us back when you have a moment. Have a great day.";
    }

    console.log("[Outbound-Call] Voicemail detected — playing voicemail script (%d chars)", voicemailScript.length);

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Pause length="2"/>
  <Say voice="Polly.Joanna">${escapeXml(voicemailScript)}</Say>
  <Pause length="1"/>
  <Hangup/>
</Response>`;

    res.type("text/xml").send(twiml);

    // Log the voicemail touch on the contact row (non-blocking)
    if (contactId) {
      setImmediate(async () => {
        try {
          const db = require("../lib/db");
          await db.query(
            `UPDATE outbound_contacts
                SET last_status = 'voicemail_left', updated_at = now()
              WHERE id = $1`,
            [contactId]
          );
          console.log("[Outbound-Call] Voicemail status logged contactId=%s", contactId);
        } catch (e) {
          console.error("[Outbound-Call] Voicemail log error:", e.message);
        }
      });
    }
    return;
  }

  // ── Human answered (or detection disabled/unknown) — connect to AI ─────
  const db    = require("../lib/db");
  const wsUrl = (BASE_URL || "")
    .replace("https://", "wss://")
    .replace("http://", "ws://") + "/twilio-media";

  let tenantId = "";
  if (campaignId) {
    try {
      const campaignRes = await db.query(
        "SELECT tenant_id FROM outbound_campaigns WHERE id = $1",
        [campaignId]
      );
      if (campaignRes.rows[0]) {
        tenantId = campaignRes.rows[0].tenant_id;
        let contactPhone = "";
        if (contactId) {
          const contactRes = await db.query(
            "SELECT phone FROM outbound_contacts WHERE id = $1",
            [contactId]
          );
          contactPhone = contactRes.rows[0]?.phone || "";
        }
        const callSid = req.body.CallSid || req.query.CallSid;
        if (callSid && tenantId) {
          await callsService.createCall(tenantId, callSid, "CAMPAIGN", contactPhone, "outbound");
          console.log("[Twilio] Outbound call record created CallSid=%s tenantId=%s", callSid, tenantId);
        }
      }
    } catch (e) {
      console.error("[Twilio] outbound tenant/call setup failed:", e.message);
    }
  }

  let streamUrl = `${wsUrl}${tenantId ? "/" + tenantId : ""}/outbound/${req.body.CallSid || req.query.CallSid}`
    + `?campaignId=${encodeURIComponent(campaignId)}&contactId=${encodeURIComponent(contactId)}`;
  if (scriptId) streamUrl += `&scriptId=${encodeURIComponent(scriptId)}`;

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${escapeXml(streamUrl)}" />
  </Connect>
</Response>`;
  res.type("text/xml").send(twiml);
});

router.processStatusPayload = processStatusPayload;

router.post("/rep-call-connect", (req, res) => {
  const conf = req.query.conf || req.body.conf || "rep-call-default";
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">This call may be recorded for quality and training purposes.</Say>
  <Pause length="1"/>
  <Dial>
    <Conference startConferenceOnEnter="true" endConferenceOnExit="true" record="record-from-start">${conf}</Conference>
  </Dial>
</Response>`;
  res.type("text/xml").send(twiml);
});

router.post("/rep-recording-status", async (req, res) => {
  const db = require("../lib/db");
  const twilioLib = require("../lib/twilio");
  const { repUserId, leadId, tenantId } = req.query;
  const tenant = tenantId
    ? await db.query("SELECT * FROM tenants WHERE id = $1", [tenantId]).then((r) => r.rows[0]).catch(() => null)
    : null;
  if (!twilioLib.validateTwilioRequest(req, tenant)) {
    return res.status(403).json({ error: "Invalid signature" });
  }
  res.sendStatus(200);
  const { RecordingUrl, RecordingSid, RecordingStatus, RecordingDuration } = req.body || {};
  if (RecordingStatus !== "completed" || !RecordingUrl) return;
  if (!repUserId || !leadId || !tenantId || !tenant) return;
  try {
    const { transcribeBuffer } = require("../services/fieldRecording");
    const { analyzeConversation } = require("../lib/coachingEngine");
    const authInfo = twilioLib.getAuthForTenant(tenant);
    const auth = Buffer.from(`${authInfo.accountSid}:${authInfo.authToken}`).toString("base64");
    const mp3Url = RecordingUrl + ".mp3";
    const resp = await fetch(mp3Url, { headers: { Authorization: `Basic ${auth}` } });
    if (!resp.ok) { console.error("[rep-recording-status] fetch failed"); return; }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const result = await transcribeBuffer(buffer, "mp3");
    const convR = await db.query(
      `INSERT INTO coaching_conversations
         (tenant_id, source_type, rep_user_id, lead_id, transcript, duration_seconds)
       VALUES ($1, 'rep_call_outbound', $2, $3, $4::jsonb, $5)
       RETURNING id`,
      [tenantId, repUserId, leadId, JSON.stringify(result.segments), result.duration || parseInt(RecordingDuration, 10) || 0],
    );
    await analyzeConversation({ conversationId: convR.rows[0].id });
    console.log("[rep-recording-status] analyzed conversation=%s lead=%s", convR.rows[0].id, leadId);
  } catch (err) {
    console.error("[rep-recording-status] processing failed:", err.message);
  }
});

router.post("/rep-call-status", (req, res) => {
  res.sendStatus(200);
});

module.exports = router;

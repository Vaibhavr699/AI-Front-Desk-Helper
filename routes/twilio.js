"use strict";

const express = require("express");
const { getTenantByPhone, getTenantById, getTenantBySlug } = require("../lib/tenant");
const callsService = require("../services/calls");
const recordingService = require("../services/recording");
const { updateCallByTwilioSid } = require("../services/calls");

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

    await callsService.createCall(tenant.id, CallSid, fromNumber, toNumber, direction);
    console.log("[AI-Desk] Voice webhook call created CallSid=%s tenantId=%s direction=%s", CallSid, tenant.id, direction);

    const wsUrl = (BASE_URL || "").replace("https://", "wss://").replace("http://", "ws://") + "/twilio-media";
    let streamUrl = `${wsUrl}/${tenant.id}/${CallSid}?From=${encodeURIComponent(fromNumber)}&To=${encodeURIComponent(toNumber)}&direction=${direction}`;
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

router.post("/status", (req, res) => {
  const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  res.writeHead(200, {
    "Content-Type": "text/xml",
    "Content-Length": Buffer.byteLength(twiml).toString(),
  });
  res.end(twiml);

  const CallSid    = req.body && req.body.CallSid;
  const CallStatus = req.body && req.body.CallStatus;
  if (CallSid && (CallStatus === "completed" || CallStatus === "busy" || CallStatus === "failed" || CallStatus === "no-answer")) {
    const endedAt = new Date().toISOString();
    updateCallByTwilioSid(CallSid, {
      status:           CallStatus,
      ended_at:         endedAt,
      duration_minutes: req.body?.CallDuration ? parseFloat(req.body.CallDuration) / 60 : null,
    }).catch(() => {});
  }
});

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
        await callsService.createCall(tenantId, callSid, "RECOVERY", contactPhone, "outbound");
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

// Status callback for recovery outbound calls
router.post("/recovery-call-status", (req, res) => {
  res.writeHead(200, { "Content-Length": "0" });
  res.end();

  const CallSid    = req.body && req.body.CallSid;
  const CallStatus = req.body && req.body.CallStatus;
  const recoveryId = req.query && req.query.recoveryId;

  if (recoveryId && CallSid) {
    const statusMap = {
      completed:   "answered",
      busy:        "busy",
      failed:      "failed",
      "no-answer": "no_answer",
      canceled:    "failed",
    };
    const touchStatus = statusMap[CallStatus] || CallStatus;
    setImmediate(() => {
      const db = require("../lib/db");
      db.query(
        "UPDATE recovery_touches SET status = $1 WHERE call_sid = $2 AND recovery_id = $3",
        [touchStatus, CallSid, recoveryId]
      ).catch((e) => console.error("[Recovery] Call status update error:", e.message));
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
router.all("/outbound", async (req, res) => {
  const campaignId = req.query.campaignId || req.body.campaignId;
  const contactId  = req.query.contactId  || req.body.contactId;
  const scriptId   = req.query.scriptId   || req.body.scriptId;

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

module.exports = router;

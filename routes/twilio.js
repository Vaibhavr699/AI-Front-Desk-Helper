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
    const tenantByTo = await getTenantByPhone(toNumber);
    const tenantByFrom = await getTenantByPhone(fromNumber);
    if (!tenant) tenant = tenantByTo;
    if (!tenant) tenant = tenantByFrom;
    if (!tenant) {
      console.log("[AI-Desk] Voice webhook no tenant for To=%s From=%s", toNumber, fromNumber);
      sendVoiceError(res, "We're sorry, this number is not configured. Goodbye.");
      return;
    }
    const direction = tenantByFrom ? "outbound" : "inbound";
    await callsService.createCall(tenant.id, CallSid, fromNumber, toNumber, direction);
    console.log("[AI-Desk] Voice webhook call created CallSid=%s tenantId=%s direction=%s", CallSid, tenant.id, direction);

    const wsUrl = (BASE_URL || "")
      .replace("https://", "wss://")
      .replace("http://", "ws://") + "/twilio-media/" + tenant.id;
    let streamUrl = `${wsUrl}?CallSid=${encodeURIComponent(CallSid)}&From=${encodeURIComponent(fromNumber)}&To=${encodeURIComponent(toNumber)}`;
    const testCallFrom = (process.env.TEST_CALL_FROM || "").replace(/\s/g, "");
    if (testCallFrom && fromNumber && fromNumber.replace(/\D/g, "") === testCallFrom.replace(/\D/g, "")) {
      streamUrl += "&turnBased=1";
      console.log("[AI-Desk] Voice webhook using turn-based stream (TEST_CALL_FROM)");
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

// Live transfer: Dial transfer number. Call remains recorded (AI leg + this Dial leg via record/recordingStatusCallback).
router.get("/transfer-dial", (req, res) => {
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

// Twilio status / <Connect> action callback. Must return valid TwiML < 64KB.
router.post("/status", (req, res) => {
  const twiml = '<?xml version="1.0" encoding="UTF-8"?><Response/>';
  res.writeHead(200, {
    "Content-Type": "text/xml",
    "Content-Length": Buffer.byteLength(twiml).toString(),
  });
  res.end(twiml);

  const CallSid = req.body && req.body.CallSid;
  const CallStatus = req.body && req.body.CallStatus;
  if (CallSid && (CallStatus === "completed" || CallStatus === "busy" || CallStatus === "failed" || CallStatus === "no-answer")) {
    updateCallByTwilioSid(CallSid, { status: CallStatus, ended_at: new Date().toISOString() }).catch(() => {});
  }
});

// -------------------- Estimate Recovery Outbound Calls --------------------

// TwiML for recovery outbound calls — connects to live AI via WebSocket stream
router.get("/recovery-call", (req, res) => {
  const recoveryId = req.query.recoveryId || "";
  const script = req.query.script || "";

  const wsUrl = (BASE_URL || "")
    .replace("https://", "wss://")
    .replace("http://", "ws://") + "/twilio-media";

  const streamUrl = `${wsUrl}?type=recovery&recoveryId=${encodeURIComponent(recoveryId)}&script=${encodeURIComponent(script)}`;
  const actionUrl = BASE_URL ? `${BASE_URL}/twilio/status` : "";
  const connectAttrs = actionUrl
    ? ` action="${escapeXml(actionUrl)}" method="POST"`
    : "";

  const twiml = `
    <Response>
      <Connect${connectAttrs}>
        <Stream url="${escapeXml(streamUrl)}" />
      </Connect>
    </Response>
  `;
  res.type("text/xml").send(twiml);
});

// Status callback for recovery outbound calls — logs the outcome.
// Twilio requires response body < 64KB. Send empty 200 immediately with raw Node to avoid any middleware adding body.
router.post("/recovery-call-status", (req, res) => {
  res.writeHead(200, { "Content-Length": "0" });
  res.end();

  const CallSid = req.body && req.body.CallSid;
  const CallStatus = req.body && req.body.CallStatus;
  const recoveryId = req.query && req.query.recoveryId;

  if (recoveryId && CallSid) {
    const statusMap = {
      completed: "answered",
      busy: "busy",
      failed: "failed",
      "no-answer": "no_answer",
      canceled: "failed",
    };
    const touchStatus = statusMap[CallStatus] || CallStatus;
    setImmediate(() => {
      const db = require("../lib/db");
      db
        .query(
          "UPDATE recovery_touches SET status = $1 WHERE call_sid = $2 AND recovery_id = $3",
          [touchStatus, CallSid, recoveryId]
        )
        .catch((e) => console.error("[Recovery] Call status update error:", e.message));
    });
  }
});

module.exports = router;

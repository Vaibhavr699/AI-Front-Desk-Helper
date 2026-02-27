"use strict";

const express = require("express");
const { getTenantByPhone } = require("../lib/tenant");
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

router.post("/voice", async (req, res) => {
  try {
    const { CallSid, From, To } = req.body;
    const toNumber = To || req.body.To;
    const fromNumber = From || req.body.From;

    const tenantByTo = await getTenantByPhone(toNumber);
    const tenantByFrom = await getTenantByPhone(fromNumber);
    const tenant = tenantByTo || tenantByFrom;
    if (!tenant) {
      sendVoiceError(res, "We're sorry, this number is not configured. Goodbye.");
      return;
    }
    const direction = tenantByFrom ? "outbound" : "inbound";
    await callsService.createCall(tenant.id, CallSid, fromNumber, toNumber, direction);

    const wsUrl = (BASE_URL || "")
      .replace("https://", "wss://")
      .replace("http://", "ws://") + "/twilio-media";
    let streamUrl = `${wsUrl}?CallSid=${encodeURIComponent(CallSid)}&From=${encodeURIComponent(fromNumber)}&To=${encodeURIComponent(toNumber)}`;
    const testCallFrom = (process.env.TEST_CALL_FROM || "").replace(/\s/g, "");
    if (testCallFrom && fromNumber && fromNumber.replace(/\D/g, "") === testCallFrom.replace(/\D/g, "")) {
      streamUrl += "&turnBased=1";
    }
    const statusCallback = BASE_URL ? `${BASE_URL}/twilio/status` : null;

    let twiml = `<Response>`;
    if (statusCallback) {
      twiml += `<Connect statusCallback="${escapeXml(statusCallback)}" statusCallbackEvent="completed">`;
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

router.post("/status", (req, res) => {
  const { CallSid, CallStatus } = req.body;
  if (CallStatus === "completed" || CallStatus === "busy" || CallStatus === "failed" || CallStatus === "no-answer") {
    updateCallByTwilioSid(CallSid, { status: CallStatus, ended_at: new Date().toISOString() }).catch(() => { });
  }
  res.status(200).send();
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
  const statusCallback = BASE_URL ? `${BASE_URL}/twilio/status` : "";
  const connectAttrs = statusCallback
    ? ` statusCallback="${escapeXml(statusCallback)}" statusCallbackEvent="completed"`
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

// Status callback for recovery outbound calls — logs the outcome
router.post("/recovery-call-status", async (req, res) => {
  const { CallSid, CallStatus } = req.body;
  const recoveryId = req.query.recoveryId;
  if (recoveryId && CallSid) {
    try {
      const db = require("../lib/db");
      // Update the touch record with the call outcome
      const statusMap = {
        completed: "answered",
        busy: "busy",
        failed: "failed",
        "no-answer": "no_answer",
        canceled: "failed",
      };
      const touchStatus = statusMap[CallStatus] || CallStatus;
      await db.query(
        "UPDATE recovery_touches SET status = $1 WHERE call_sid = $2 AND recovery_id = $3",
        [touchStatus, CallSid, recoveryId]
      );
    } catch (e) {
      console.error("[Recovery] Call status update error:", e.message);
    }
  }
  res.status(200).send();
});

module.exports = router;

"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");
const { getCallByTwilioSid, updateCallByTwilioSid } = require("./calls");

const BASE_URL = process.env.BASE_URL;

async function startRecording(callSid, tenant = null) {
  if (!BASE_URL) {
    console.warn("[Recording] BASE_URL not set; Twilio recording-status callbacks will not work. Set BASE_URL so recordings and transcription run.");
    return null;
  }
  const client = twilio.getClientForTenant(tenant);
  if (!client) return null;
  const recording = await client.calls(callSid).recordings.create({
    recordingStatusCallback: `${BASE_URL.replace(/\/$/, "")}/twilio/recording-status`,
    recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
    recordingStatusCallbackMethod: "POST",
  });
  return recording;
}

async function handleRecordingStatus(reqBody) {
  const {
    CallSid,
    RecordingSid,
    RecordingUrl,
    RecordingStatus,
    RecordingDuration,
  } = reqBody;

  const call = await getCallByTwilioSid(CallSid);
  if (!call) return;

  if (RecordingStatus === "in-progress") {
    await db.query(
      `INSERT INTO recordings (call_id, tenant_id, twilio_sid, recording_url, status)
       VALUES ($1, $2, $3, $4, 'in_progress')
       ON CONFLICT (twilio_sid) DO UPDATE SET status = 'in_progress', updated_at = now()`,
      [call.id, call.tenant_id, RecordingSid, RecordingUrl || null]
    );
    await updateCallByTwilioSid(CallSid, { recording_sid: RecordingSid });
    return;
  }

  if (RecordingStatus === "completed" || RecordingStatus === "absent") {
    const duration = RecordingStatus === "completed" ? parseInt(RecordingDuration, 10) : null;
    const url = RecordingStatus === "completed" ? RecordingUrl : null;
    const status = RecordingStatus === "completed" ? "completed" : "absent";
    await db.query(
      `INSERT INTO recordings (call_id, tenant_id, twilio_sid, recording_url, duration_sec, status)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (twilio_sid) DO UPDATE SET
         recording_url = EXCLUDED.recording_url,
         duration_sec = EXCLUDED.duration_sec,
         status = EXCLUDED.status,
         updated_at = now()`,
      [call.id, call.tenant_id, RecordingSid, url, duration, status]
    );
    if (RecordingStatus === "completed") {
      const { transcribeRecording } = require("./transcription");
      const { uploadRecordingToS3 } = require("./s3");
      setImmediate(() => transcribeRecording(CallSid, RecordingSid).catch((e) => console.error("Transcribe error:", e)));
      setImmediate(() => uploadRecordingToS3(call.tenant_id, RecordingSid).catch((e) => console.error("S3 upload error:", e)));
    }
  }
}

async function getRecordingByTwilioSid(twilioSid) {
  const res = await db.query(
    "SELECT * FROM recordings WHERE twilio_sid = $1 LIMIT 1",
    [twilioSid]
  );
  return res.rows[0] || null;
}

module.exports = {
  startRecording,
  handleRecordingStatus,
  getRecordingByTwilioSid,
};

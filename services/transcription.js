"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const db = require("../lib/db");
const twilio = require("../lib/twilio");
const OpenAI = require("openai").default;

const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;

async function transcribeRecording(callSid, recordingSid) {
  const rec = await db.query(
    "SELECT id, call_id, tenant_id, recording_url FROM recordings WHERE twilio_sid = $1",
    [recordingSid]
  ).then((r) => r.rows[0]);
  if (!rec) return;

  const tenant = await db.query(
    "SELECT id, twilio_account_sid, twilio_auth_token FROM tenants WHERE id = $1",
    [rec.tenant_id]
  ).then((r) => r.rows[0]);
  const authInfo = twilio.getAuthForTenant(tenant);
  if (!authInfo || !openai) return;

  let tmpPath;
  try {
    const auth = Buffer.from(`${authInfo.accountSid}:${authInfo.authToken}`).toString("base64");
    const recordingUrl = `https://api.twilio.com/2010-04-01/Accounts/${authInfo.accountSid}/Recordings/${recordingSid}.json`;
    const recordingResp = await fetch(recordingUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!recordingResp.ok) throw new Error("Fetch recording meta failed");
    const recording = await recordingResp.json();
    let url = (recording.uri || "").replace(".json", ".mp3");
    if (url && !url.startsWith("http")) url = `https://api.twilio.com${url}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!resp.ok) throw new Error("Fetch recording failed");
    const buffer = Buffer.from(await resp.arrayBuffer());
    tmpPath = path.join(os.tmpdir(), `rec-${recordingSid}.mp3`);
    fs.writeFileSync(tmpPath, buffer);
    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tmpPath),
      model: "whisper-1",
    });
    const transcript = transcription && transcription.text ? transcription.text : "";
    await db.query(
      "UPDATE recordings SET transcript = $1, transcript_src = 'whisper', updated_at = now() WHERE id = $2",
      [transcript, rec.id]
    );
    if (rec.call_id && rec.tenant_id) {
      const crm = require("./crm");
      crm.sendCallDetailsToCrm(rec.tenant_id, rec.call_id).catch((e) => console.error("CRM call details:", e));
    }
  } catch (err) {
    console.error("Transcription error:", err);
    await db.query(
      "UPDATE recordings SET transcript_src = 'error', updated_at = now() WHERE id = $1",
      [rec.id]
    );
  } finally {
    if (tmpPath && fs.existsSync(tmpPath)) try { fs.unlinkSync(tmpPath); } catch (_) {}
  }
}

module.exports = { transcribeRecording };

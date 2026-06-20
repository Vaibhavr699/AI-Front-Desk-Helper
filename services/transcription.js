"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");

// NOTE (Jun 2026): We deliberately do NOT use the OpenAI SDK's HTTP client
// here. On this Render service the SDK routes through an old `node-fetch`,
// whose gzip stream handling intermittently dies mid-response with
// ERR_STREAM_PREMATURE_CLOSE while reading Whisper's reply. That silently
// left calls with transcript_src='error' and a null transcript.
//
// Instead we talk to the Whisper endpoint with Node's BUILT-IN global fetch
// (undici, Node 18+), uploading the audio as a buffered Blob in multipart
// FormData. Native fetch does not touch node-fetch, so the premature-close
// bug doesn't occur. The audio is short (a few minutes), so buffering the
// whole file in memory is fine.

const OPENAI_TRANSCRIBE_URL = "https://api.openai.com/v1/audio/transcriptions";
const WHISPER_MODEL = "whisper-1";

async function transcribeRecording(callSid, recordingSid) {
  const rec = await db.query(
    "SELECT id, call_id, tenant_id, recording_url FROM recordings WHERE twilio_sid = $1",
    [recordingSid]
  ).then((r) => r.rows[0]);
  if (!rec) return;

  if (!process.env.OPENAI_API_KEY) {
    console.warn("[Transcription] OPENAI_API_KEY not set — skipping.");
    return;
  }

  const tenant = await db.query(
    "SELECT id, twilio_account_sid, twilio_auth_token FROM tenants WHERE id = $1",
    [rec.tenant_id]
  ).then((r) => r.rows[0]);
  const authInfo = twilio.getAuthForTenant(tenant);
  if (!authInfo) return;

  try {
    const auth = Buffer.from(`${authInfo.accountSid}:${authInfo.authToken}`).toString("base64");

    // Wait 2 seconds for Twilio to finish processing the file.
    await new Promise((r) => setTimeout(r, 2000));

    // Resolve the actual recording media URL via the .json metadata.
    const metaUrl = `https://api.twilio.com/2010-04-01/Accounts/${authInfo.accountSid}/Recordings/${recordingSid}.json`;
    const metaResp = await globalThis.fetch(metaUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!metaResp.ok) throw new Error(`Fetch recording meta failed: ${metaResp.status}`);
    const recording = await metaResp.json();

    let url = (recording.uri || "").replace(".json", ".mp3");
    if (!url) throw new Error("No recording URI found");
    if (!url.startsWith("http")) url = `https://api.twilio.com${url}`;

    console.log("[Transcription] Fetching audio from:", url);
    // Use GLOBAL fetch (undici), NOT node-fetch.
    const audioResp = await globalThis.fetch(url, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!audioResp.ok) throw new Error(`Fetch recording audio failed: ${audioResp.status}`);

    const bytes = Buffer.from(await audioResp.arrayBuffer());
    if (bytes.length < 100) throw new Error("Recording buffer too small");

    // Buffered multipart upload via native FormData/Blob — no file stream,
    // no node-fetch. This is the path that fixed ERR_STREAM_PREMATURE_CLOSE.
    const form = new FormData();
    form.append("model", WHISPER_MODEL);
    form.append("file", new Blob([bytes], { type: "audio/mpeg" }), "rec.mp3");

    const oResp = await globalThis.fetch(OPENAI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form,
    });
    if (!oResp.ok) {
      const errTxt = await oResp.text().catch(() => "");
      throw new Error(`OpenAI transcription failed: ${oResp.status} ${errTxt}`);
    }
    const data = await oResp.json();
    const transcript = data && data.text ? data.text : "";

    await db.query(
      "UPDATE recordings SET transcript = $1, transcript_src = 'whisper', updated_at = now() WHERE id = $2",
      [transcript, rec.id]
    );

    if (rec.call_id && rec.tenant_id) {
      const crm = require("./crm");
      crm.sendCallDetailsToCrm(rec.tenant_id, rec.call_id).catch((e) =>
        console.error("CRM call details:", e)
      );
    }
  } catch (err) {
    console.error("Transcription error:", err);
    await db.query(
      "UPDATE recordings SET transcript_src = 'error', updated_at = now() WHERE id = $1",
      [rec.id]
    );
  }
}

module.exports = { transcribeRecording };

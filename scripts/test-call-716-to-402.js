"use strict";

require("dotenv").config();

const { client: twilioClient } = require("../lib/twilio");

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

/**
 * Place a test call FROM +1 716 413 3735 TO +1 402 773 8795 (AI number).
 * The AI number (402) "picks up" with the turn-based flow (Whisper → LLM → TTS).
 *
 * Default (override with env):
 *   From (caller): +1 716 413 3735
 *   To (AI number): +1 402 773 8795
 *
 * Turn-based mode is used when the caller (From) matches TEST_CALL_FROM.
 *
 * Usage:
 *   node scripts/test-call-716-to-402.js
 *   TEST_CALL_FROM=+17164133735 TEST_CALL_TO=+14027738795 node scripts/test-call-716-to-402.js
 *
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, BASE_URL, OPENAI_API_KEY.
 * For TTS playback you need ffmpeg (mp3 → 8kHz mulaw).
 */
async function main() {
  if (!twilioClient) {
    console.error("Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env");
    process.exit(1);
  }

  const fromNumber = (process.env.TEST_CALL_FROM || "+17164133735").replace(/\s/g, "");
  const toNumber = (process.env.TEST_CALL_TO || "+14027738795").replace(/\s/g, "");

  const voiceUrl = BASE_URL.replace(/\/$/, "") + "/twilio/voice";
  console.log("Placing call (716 → 402, turn-based AI):");
  console.log("  From (caller):", fromNumber);
  console.log("  To (AI number):", toNumber);
  console.log("  Webhook URL:", voiceUrl);

  const call = await twilioClient.calls.create({
    from: fromNumber,
    to: toNumber,
    url: voiceUrl,
    statusCallback: BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/twilio/status` : undefined,
    statusCallbackEvent: ["completed"],
  });

  console.log("\nCall created. SID:", call.sid);
  console.log("The AI number (402) picks up with the turn-based flow (Whisper → LLM → TTS).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

"use strict";

require("dotenv").config();

const { client: twilioClient } = require("../lib/twilio");

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

/**
 * Test call script – two modes:
 *
 * 1) RING MODE (recommended for hearing the AI): AI number calls you.
 *    Set TEST_RING_NUMBER to the phone that should RING (e.g. your mobile).
 *    Your phone rings, you answer, you hear the AI.
 *
 * 2) 716 → 402 MODE: Call from 716 to 402 (for SIP/trunk testing).
 *    No TEST_RING_NUMBER: script places call From 716 To 402. You need the 716
 *    leg to answer (e.g. SIP) to hear anything.
 *
 * Env:
 *   BASE_URL        – backend URL (e.g. https://ai-front-desk-backend.onrender.com). Twilio uses this for /twilio/voice.
 *   TEST_CALL_FROM  – caller number in 716→402 mode (default +17164133735)
 *   TEST_CALL_TO    – AI number (default +14027738795). In ring mode this is "From".
 *   TEST_RING_NUMBER – if set, AI number calls this number; that phone rings and you hear the AI.
 *
 * Bookings made during the call are synced to Zapier/DripJobs by the backend (tenant CRM Webhook URL or ZAPIER_WEBHOOK_URL).
 *
 * Examples:
 *   # Your mobile rings, you answer and hear the AI:
 *   TEST_RING_NUMBER=+15551234567 node scripts/test-call-716-to-402.js
 *
 *   # Classic 716 → 402 (SIP leg must answer to hear):
 *   node scripts/test-call-716-to-402.js
 */
async function main() {
  if (!twilioClient) {
    console.error("Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env");
    process.exit(1);
  }

  const ringNumber = (process.env.TEST_RING_NUMBER || "").replace(/\s/g, "");
  const aiNumber = (process.env.TEST_CALL_TO || "+14027738795").replace(/\s/g, "");
  const caller716 = (process.env.TEST_CALL_FROM || "+19187232665").replace(/\s/g, "");

  const voiceUrl = BASE_URL.replace(/\/$/, "") + "/twilio/voice";

  if (ringNumber) {
    console.log("Ring mode: AI number will call you. Answer to hear the AI.");
    console.log("  From (AI number):", aiNumber);
    console.log("  To (will ring):  ", ringNumber);
    console.log("  Webhook URL:", voiceUrl);

    const call = await twilioClient.calls.create({
      from: aiNumber,
      to: ringNumber,
      url: voiceUrl,
      statusCallback: BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/twilio/status` : undefined,
      statusCallbackEvent: ["completed"],
    });

    console.log("\nCall created. SID:", call.sid);
    console.log("Your phone (", ringNumber, ") should ring. Answer to talk to the AI.");
    console.log("");
    console.log("For bookings/recorded data to sync to Zapier/CRM: the BACKEND at", voiceUrl.replace("/twilio/voice", ""), "must have ZAPIER_WEBHOOK_URL set (or the tenant's CRM Webhook URL in Settings). Set it in Render → Environment if BASE_URL is Render.");
    return;
  }

  console.log("716 → 402 mode: call from 716 to AI number (SIP/trunk must answer 716 to hear).");
  console.log("  From (caller):", caller716);
  console.log("  To (AI number):", aiNumber);
  console.log("  Webhook URL:", voiceUrl);

  const call = await twilioClient.calls.create({
    from: caller716,
    to: aiNumber,
    url: voiceUrl,
    statusCallback: BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/twilio/status` : undefined,
    statusCallbackEvent: ["completed"],
  });

  console.log("\nCall created. SID:", call.sid);
  console.log("To hear the AI when testing, run with TEST_RING_NUMBER=your_mobile");
  console.log("");
  console.log("For bookings/recorded data to sync to Zapier/CRM: the BACKEND at", voiceUrl.replace("/twilio/voice", ""), "must have ZAPIER_WEBHOOK_URL set (or the tenant's CRM Webhook URL in Settings).");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

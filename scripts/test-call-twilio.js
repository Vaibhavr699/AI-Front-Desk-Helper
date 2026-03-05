"use strict";

require("dotenv").config();

const { client: twilioClient } = require("../lib/twilio");

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

/**
 * Places a REAL call via Twilio: your Twilio number calls the given phone.
 * When they answer, Twilio requests your /twilio/voice webhook and connects the AI stream.
 * The call will appear in Twilio call logs and the phone will ring.
 *
 * Usage:
 *   node scripts/test-call-twilio.js                    # call +14022907925 (default)
 *   node scripts/test-call-twilio.js +15551234567       # call this number
 *
 * Requires: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, BASE_URL, and a Twilio number in phone_numbers.
 */
async function main() {
  if (!twilioClient) {
    console.error("Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env");
    process.exit(1);
  }

  const toNumber = process.argv[2] || process.env.TEST_CALL_TO || "+14022907925";

  let fromNumber;
  const db = require("../lib/db");
  const r = await db.query(
    "SELECT phone FROM phone_numbers ORDER BY is_primary DESC NULLS LAST LIMIT 1"
  );
  if (!r.rows[0]) {
    console.error("No phone number in DB. Run db:seed first.");
    process.exit(1);
  }
  fromNumber = r.rows[0].phone;

  const voiceUrl = BASE_URL.replace(/\/$/, "") + "/twilio/voice";
  console.log("Placing call via Twilio:");
  console.log("  From (your Twilio number):", fromNumber);
  console.log("  To (will ring):", toNumber);
  console.log("  Webhook URL:", voiceUrl);

  const call = await twilioClient.calls.create({
    to: toNumber,
    from: fromNumber,
    url: voiceUrl,
    statusCallback: BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/twilio/status` : undefined,
    statusCallbackEvent: ["completed"],
  });

  console.log("\nCall created in Twilio. SID:", call.sid);
  console.log("The phone will ring; when answered, the AI stream will start.");
  console.log("Check Twilio Console → Monitor → Logs → Calls for the call.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

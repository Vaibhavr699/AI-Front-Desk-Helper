"use strict";

require("dotenv").config();

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

/**
 * Simulates an inbound call by POSTing to /twilio/voice (does NOT use Twilio).
 * - Creates a call record in your DB and returns TwiML.
 * - Does NOT place a real call, so nothing rings and nothing appears in Twilio call logs.
 * For a real call that rings and shows in Twilio, use: node scripts/test-call-twilio.js
 *
 * Use this to test the webhook and create a call record before testing the WebSocket stream.
 *
 * Usage:
 *   node scripts/test-create-call.js                    # use first phone number from DB
 *   node scripts/test-create-call.js +14027738795       # use this "To" number
 *   BASE_URL=http://116.202.210.102:3001 node scripts/test-create-call.js
 *   TEST_CALL_FROM=+15551234567 node scripts/test-create-call.js   # override From number
 */
async function main() {
  const toNumber = process.argv[2];

  let to = toNumber;
  if (!to) {
    const db = require("../lib/db");
    const r = await db.query(
      "SELECT pn.phone FROM phone_numbers pn ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1"
    );
    if (!r.rows[0]) {
      console.error("No phone number in DB. Run db:seed or pass a number: node scripts/test-create-call.js +14027738795");
      process.exit(1);
    }
    to = r.rows[0].phone;
    console.log("Using To number from DB:", to);
  }

  const callSid = "CA-test-" + Date.now();
  const fromNumber = process.env.TEST_CALL_FROM || "+14022907925";

  const url = BASE_URL.replace(/\/$/, "") + "/twilio/voice";
  const body = new URLSearchParams({
    CallSid: callSid,
    From: fromNumber,
    To: to,
    CallStatus: "ringing",
  });

  console.log("POST", url);
  console.log("CallSid:", callSid, "From:", fromNumber, "To:", to);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  console.log("Status:", res.status, res.statusText);
  console.log("Response:", text);

  if (res.ok) {
    console.log("\nCall created. To test the WebSocket stream, connect to:");
    const wsUrl = BASE_URL.replace(/^https:\/\//, "wss://").replace(/^http:\/\//, "ws://");
    console.log(
      `${wsUrl}/twilio-media?CallSid=${encodeURIComponent(callSid)}&From=${encodeURIComponent(fromNumber)}&To=${encodeURIComponent(to)}`
    );
  } else {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

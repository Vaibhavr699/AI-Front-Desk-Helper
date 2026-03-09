"use strict";

require("dotenv").config();

const readline = require("readline");
const { client: twilioClient } = require("../lib/twilio");
const db = require("../lib/db");

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

// Default tenant/called number for testing (AI calls this number). Override with TEST_RING_NUMBER in .env.
const DEFAULT_TEST_RING_NUMBER = "+918076055898";

async function placeCall() {
  const ringNumber = (process.env.TEST_RING_NUMBER || DEFAULT_TEST_RING_NUMBER).replace(/\s/g, "");
  const aiNumber = (process.env.TEST_CALL_TO || "+14027738795").replace(/\s/g, "");
  const caller716 = (process.env.TEST_CALL_FROM || "+14027738795").replace(/\s/g, "");
  const voiceUrl = BASE_URL.replace(/\/$/, "") + "/twilio/voice";

  if (ringNumber) {
    console.log("Ring mode: AI number will call you.");
    console.log("  From (AI number):", aiNumber);
    console.log("  To (will ring):  ", ringNumber);
    console.log("  Webhook:", voiceUrl.replace("/twilio/voice", ""));
    const call = await twilioClient.calls.create({
      from: aiNumber,
      to: ringNumber,
      url: voiceUrl,
      statusCallback: BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/twilio/status` : undefined,
      statusCallbackEvent: ["completed"],
    });
    console.log("\nCall created. SID:", call.sid);
    console.log("Your phone should ring. Answer and complete a booking (name, phone, address).\n");
    return;
  }

  console.log("716 → 402 mode.");
  console.log("  From:", caller716, "  To:", aiNumber);
  const call = await twilioClient.calls.create({
    from: caller716,
    to: aiNumber,
    url: voiceUrl,
    statusCallback: BASE_URL ? `${BASE_URL.replace(/\/$/, "")}/twilio/status` : undefined,
    statusCallbackEvent: ["completed"],
  });
  console.log("\nCall created. SID:", call.sid);
  console.log("Complete the call (answer on SIP if needed), then press Enter to check booking/CRM.\n");
}

async function checkBookingCrm() {
  const bookings = await db.query(
    `SELECT b.*, t.name as tenant_name, t.crm_webhook_url
     FROM bookings b
     JOIN tenants t ON t.id = b.tenant_id
     ORDER BY b.created_at DESC
     LIMIT 5`
  );

  if (!bookings.rows.length) {
    console.log("No bookings in the database. Book an appointment during the call and run this script again.");
    return;
  }

  console.log("--- Latest bookings (newest first) ---\n");
  for (const b of bookings.rows) {
    console.log("Booking ID:", b.id);
    console.log("Tenant:", b.tenant_name);
    console.log("Contact:", b.contact_name, "|", b.contact_phone);
    console.log("Address:", b.address || "(none)");
    console.log("Created at:", b.created_at);
    console.log("CRM synced at:", b.crm_synced_at || "(not synced)");
    console.log("");
  }

  const latest = bookings.rows[0];
  if (!latest.crm_synced_at) {
    console.log("→ Latest booking was NOT synced to CRM. Set ZAPIER_WEBHOOK_URL on the backend (e.g. Render → Environment).");
  } else {
    console.log("→ Latest booking was synced to CRM. Check Zapier task history and DripJobs.");
  }
}

/**
 * Combined script: place test call, wait for you to complete the call and book,
 * then show latest bookings and CRM sync status.
 *
 * Env: BASE_URL, TEST_RING_NUMBER (recommended), TEST_CALL_TO, TEST_CALL_FROM.
 * Same as test-call-716-to-402.js. Uses same DB as .env for the check step.
 *
 * Usage:
 *   node scripts/test-call-then-check.js
 */
async function main() {
  if (!twilioClient) {
    console.error("Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env");
    process.exit(1);
  }

  await placeCall();

  await ask("When you've finished the call (and completed a booking), press Enter to check results... ");

  console.log("");
  await checkBookingCrm();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

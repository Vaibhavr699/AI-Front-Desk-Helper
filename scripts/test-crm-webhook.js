"use strict";

require("dotenv").config();

const db = require("../lib/db");
const crm = require("../services/crm");

/**
 * Test the CRM/Zapier webhook flow using the real CRM service (same payloads as production).
 * Creates minimal test rows in the DB, then calls syncBookingToCrm and/or sendCallDetailsToCrm.
 *
 * Prerequisites:
 *   - DATABASE_URL (or your DB env) set in .env
 *   - Either set a tenant's crm_webhook_url in the DB (e.g. via Settings or SQL), or set
 *     ZAPIER_WEBHOOK_URL in .env to your Zapier "Catch Hook" URL
 *   - At least one tenant in the DB
 *
 * Usage:
 *   node scripts/test-crm-webhook.js booking      # send only booking (use this to test DripJobs lead creation)
 *   node scripts/test-crm-webhook.js call_details # send only call_details
 *   node scripts/test-crm-webhook.js              # send both
 *
 * For DripJobs: create leads only when event_type = "booking"; the booking payload
 * includes first_name, last_name, email, address, preferred_date, phone, notes.
 */
async function main() {
  const mode = (process.argv[2] || "both").toLowerCase();
  if (!["booking", "call_details", "both"].includes(mode)) {
    console.error("Usage: node scripts/test-crm-webhook.js [booking|call_details|both]");
    process.exit(1);
  }

  // Find a tenant: prefer one with crm_webhook_url; otherwise use first tenant (ZAPIER_WEBHOOK_URL will be used)
  const tenantRes = await db.query(
    `SELECT id, name, company_name, crm_webhook_url FROM tenants
     ORDER BY (crm_webhook_url IS NOT NULL AND crm_webhook_url != '') DESC
     LIMIT 1`
  );
  const tenant = tenantRes.rows[0];
  if (!tenant) {
    console.error("No tenant in DB. Create a business first (e.g. via dashboard or seed).");
    process.exit(1);
  }

  const webhookUrl = tenant.crm_webhook_url || process.env.ZAPIER_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error(
      "No webhook URL. Set a tenant's CRM Webhook URL in Settings, or set ZAPIER_WEBHOOK_URL in .env to your Zapier Catch Hook URL."
    );
    process.exit(1);
  }

  console.log("Tenant:", tenant.company_name || tenant.name, "(" + tenant.id + ")");
  console.log("Webhook:", webhookUrl);
  console.log("");

  let bookingId = null;
  let callId = null;

  if (mode === "booking" || mode === "both") {
    // Create a test booking and sync to CRM
    const ins = await db.query(
      `INSERT INTO bookings (tenant_id, call_id, contact_name, contact_phone, contact_email, address, city, scope, job_type, notes, status)
       VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled')
       RETURNING *`,
      [
        tenant.id,
        "Test User",
        "+15550001111",
        "test@example.com",
        "123 Test St",
        "Omaha",
        "Exterior paint, 3-bed home",
        "residential",
        "Test booking from scripts/test-crm-webhook.js",
      ]
    );
    const booking = ins.rows[0];
    bookingId = booking.id;
    console.log("Created test booking:", bookingId);

    const result = await crm.syncBookingToCrm(tenant.id, booking);
    if (result.synced) {
      console.log("  -> Booking event sent to webhook. crm_id:", result.crm_id || "(none returned)");
    } else {
      console.error("  -> Booking sync failed:", result.error || "unknown");
    }
    console.log("");
  }

  if (mode === "call_details" || mode === "both") {
    // Create a test call + recording with transcript, then send call_details to CRM
    const twilioCallSid = "CA-test-crm-" + Date.now();
    const callIns = await db.query(
      `INSERT INTO calls (tenant_id, twilio_call_sid, from_number, to_number, direction, status, disposition, started_at, ended_at)
       VALUES ($1, $2, $3, $4, 'inbound', 'completed', 'booked', now() - interval '2 minutes', now())
       RETURNING *`,
      [tenant.id, twilioCallSid, "+15550002222", "+14025551234"]
    );
    const call = callIns.rows[0];
    callId = call.id;
    console.log("Created test call:", callId, "(" + twilioCallSid + ")");

    const recIns = await db.query(
      `INSERT INTO recordings (call_id, tenant_id, twilio_sid, recording_url, duration_sec, status, transcript, transcript_src)
       VALUES ($1, $2, $3, $4, $5, 'completed', $6, 'whisper')
       RETURNING *`,
      [
        call.id,
        tenant.id,
        "RE-test-crm-" + Date.now(),
        "https://api.twilio.com/example/recording.mp3",
        90,
        "Caller asked for an exterior paint estimate. Address 123 Test St. Booked for next week.",
      ]
    );
    console.log("Created test recording with transcript");

    const result = await crm.sendCallDetailsToCrm(tenant.id, call.id);
    if (result.sent) {
      console.log("  -> Call details event sent to webhook. status:", result.status);
    } else {
      console.error("  -> Call details send failed:", result.error || "unknown");
    }
    console.log("");
  }

  console.log("Done. Check your Zapier Catch Hook for the payload(s).");
  if (bookingId) console.log("Test booking id (you can delete):", bookingId);
  if (callId) console.log("Test call id (you can delete):", callId);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

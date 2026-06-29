"use strict";

require("dotenv").config();
const db = require("../lib/db");
const crm = require("../services/crm");
const { getTenantById } = require("../lib/tenant");

/**
 * Full test of the CRM/Zapier sync flow.
 * Sends a real payload to the ZAPIER_WEBHOOK_URL or the first tenant's crm_webhook_url.
 */
async function main() {
  console.log("=== CRM/Zapier Full Sync Test ===");

  // 1. Get a tenant
  const tenantRes = await db.query(
    "SELECT id, name, company_name, crm_webhook_url, zapier_webhook_url FROM tenants ORDER BY (crm_webhook_url IS NOT NULL) DESC LIMIT 1"
  );
  const tenant = tenantRes.rows[0];
  if (!tenant) {
    console.error("No tenant found. Please seed the DB.");
    process.exit(1);
  }

  const webhookUrl = process.env.ZAPIER_WEBHOOK_URL || tenant.crm_webhook_url || tenant.zapier_webhook_url;
  if (!webhookUrl) {
    console.error("No webhook URL found. Set ZAPIER_WEBHOOK_URL in .env");
    process.exit(1);
  }

  console.log(`Target Tenant: ${tenant.company_name} (${tenant.id})`);
  console.log(`Target Hook:   ${webhookUrl}`);
  console.log("");

  // 2. Create a mock booking
  const mockBooking = {
    id: require("crypto").randomUUID(),
    tenant_id: tenant.id,
    contact_name: "Zapier Test User",
    contact_phone: "+15551234567",
    contact_email: "zapier-test@example.com",
    address: "123 Zapier Lane",
    city: "Automation City",
    state: "Florida",
    scope: "Full House Exterior Paint",
    job_type: "Residential",
    preferred_date: "2026-05-20",
    appointment_time: "10:00 AM",
    notes: "This is a test from the ai-front-desk-backend automated test script.",
    status: "scheduled"
  };

  console.log("--- Sending Booking Event ---");
  const bookingResult = await crm.syncBookingToCrm(tenant.id, mockBooking);
  console.log(`Result: ${bookingResult.synced ? "SUCCESS (200 OK)" : "FAILED (status " + bookingResult.status + ")"}`);
  if (bookingResult.error) console.error(`Error: ${bookingResult.error}`);
  console.log("");

  // 3. Create a mock call details event
  console.log("--- Sending Call Details Event (Flattened) ---");
  const mockCall = {
    id: require("crypto").randomUUID(),
    twilio_call_sid: "CA" + Math.random().toString(36).slice(2, 10),
    from_number: "+15551234567",
    to_number: "+14027738795",
    direction: "inbound",
    status: "completed",
    disposition: "booked",
    started_at: new Date(),
    ended_at: new Date(Date.now() + 120000),
  };

  // We mock the DB results for recordings
  const mockPrimaryRec = {
    duration_sec: 120,
    recording_url: "https://api.twilio.com/test/recording.mp3",
    transcript: "Hello, I want to book a paint job for my exterior. My address is 123 Zapier Lane."
  };

  // We bypass the DB query in sendCallDetailsToCrm by mocking the dependencies or just running the logic manually for the test
  // Since we want to test the REAL service, we'll use a hacky patch for the test script or just ensure the DB has the rows.
  
  // Let's actually insert them to be safe and test the real code
  await db.query(
    "INSERT INTO calls (id, tenant_id, twilio_call_sid, from_number, to_number, direction, status, disposition) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    [mockCall.id, tenant.id, mockCall.twilio_call_sid, mockCall.from_number, mockCall.to_number, mockCall.direction, mockCall.status, mockCall.disposition]
  );
  await db.query(
    "INSERT INTO recordings (call_id, tenant_id, twilio_sid, recording_url, duration_sec, transcript) VALUES ($1, $2, $3, $4, $5, $6)",
    [mockCall.id, tenant.id, "RE" + mockCall.twilio_call_sid.slice(2), mockPrimaryRec.recording_url, mockPrimaryRec.duration_sec, mockPrimaryRec.transcript]
  );
  await db.query(
    "INSERT INTO bookings (id, tenant_id, call_id, contact_name, contact_phone, state, status) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [mockBooking.id, tenant.id, mockCall.id, mockBooking.contact_name, mockBooking.contact_phone, mockBooking.state, mockBooking.status]
  );

  const callResult = await crm.sendCallDetailsToCrm(tenant.id, mockCall.id);
  console.log(`Result: ${callResult.sent ? "SUCCESS (200 OK)" : "FAILED"}`);
  if (callResult.error) console.error(`Error: ${callResult.error}`);

  console.log("");
  console.log("=== Test Complete ===");
  console.log("Check your Zapier 'Task History' or click 'Test Trigger' in the Zapier dashboard to see the new fields:");
  console.log("- booking_contact_name");
  console.log("- booking_contact_phone");
  console.log("- booking_contact_status");
  console.log("- first_name");
  console.log("- last_name");
  
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

"use strict";

require("dotenv").config();

const db = require("../lib/db");
const crm = require("../services/crm");

/**
 * Test the booking → webhook → DripJobs lead flow.
 * Creates one test booking and sends it to your CRM webhook (Zapier → DripJobs).
 * Uses the same CRM service as production, so the payload matches real bookings.
 *
 * Prerequisites:
 *   - DATABASE_URL (or your DB env) in .env
 *   - At least one tenant with CRM Webhook URL set (Settings), or ZAPIER_WEBHOOK_URL in .env
 *
 * Usage:
 *   node scripts/test-book-lead.js
 *     Uses default test data: "Test User", +15550001111, test@example.com, 123 Test St, Omaha
 *
 *   node scripts/test-book-lead.js "Jane Smith" "+15559876543" "jane@example.com" "456 Oak Ave" "Omaha"
 *     Optional args: contact_name, contact_phone, contact_email, address, city
 *
 * After running, check Zapier (Catch Hook) and DripJobs for the new lead.
 * The payload includes first_name, last_name, contact_email, address, contact_phone, preferred_date, notes.
 */
async function main() {
  const [
    contactName = "Test User",
    contactPhone = "+15550001111",
    contactEmail = "test@example.com",
    address = "123 Test St",
    city = "Omaha",
  ] = process.argv.slice(2);

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
      "No webhook URL. Set a tenant's CRM Webhook URL in Settings, or set ZAPIER_WEBHOOK_URL in .env."
    );
    process.exit(1);
  }

  const scope = "Exterior paint, 3-bed home";
  const jobType = "residential";
  const preferredDate = null;
  const notes = "Test lead from scripts/test-book-lead.js";

  console.log("--- Test Book Lead ---");
  console.log("Tenant:", tenant.company_name || tenant.name);
  console.log("Webhook:", webhookUrl);
  console.log("Lead data:", { contactName, contactPhone, contactEmail, address, city });
  console.log("");

  const ins = await db.query(
    `INSERT INTO bookings (tenant_id, call_id, contact_name, contact_phone, contact_email, address, city, scope, job_type, preferred_date, notes, status)
     VALUES ($1, NULL, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'scheduled')
     RETURNING *`,
    [tenant.id, contactName, contactPhone, contactEmail, address, city, scope, jobType, preferredDate, notes]
  );
  const booking = ins.rows[0];

  const result = await crm.syncBookingToCrm(tenant.id, booking);

  if (result.synced) {
    console.log("Booking sent to webhook successfully.");
    console.log("Payload includes: first_name, last_name, contact_email, address, contact_phone, preferred_date, notes.");
    console.log("");
    console.log("Next: Check your Zapier Catch Hook and DripJobs for the new lead.");
    if (result.crm_id) console.log("CRM id returned:", result.crm_id);
  } else {
    console.error("Failed to send booking:", result.error || "unknown");
    process.exit(1);
  }

  console.log("");
  console.log("Test booking id (you can delete from DB if needed):", booking.id);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

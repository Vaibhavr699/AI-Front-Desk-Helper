"use strict";

require("dotenv").config();
const db = require("../lib/db");

/**
 * Check that the latest booking is in the DB and was sent to CRM (Zapier).
 * Run after a call where the AI booked an appointment:
 *   node scripts/check-booking-crm.js
 */
async function main() {
  const bookings = await db.query(
    `SELECT b.*, t.name as tenant_name, t.crm_webhook_url,
      (SELECT COUNT(*) FROM bookings) as total_bookings
     FROM bookings b
     JOIN tenants t ON t.id = b.tenant_id
     ORDER BY b.created_at DESC
     LIMIT 5`
  );

  if (!bookings.rows.length) {
    console.log("No bookings in the database yet. Book an appointment during a call and run this again.");
    process.exit(0);
  }

  console.log("Latest bookings (newest first):\n");
  for (const b of bookings.rows) {
    console.log("---");
    console.log("Booking ID:", b.id);
    console.log("Tenant:", b.tenant_name);
    console.log("Contact:", b.contact_name, "|", b.contact_phone);
    console.log("Address:", b.address || "(none)");
    console.log("Scope:", b.scope || "(none)");
    console.log("Preferred date:", b.preferred_date || "(none)");
    console.log("Created at:", b.created_at);
    console.log("CRM synced at:", b.crm_synced_at || "(not synced)");
    console.log("CRM webhook set:", b.crm_webhook_url ? "Yes" : "No (set in Settings or use ZAPIER_WEBHOOK_URL)");
    console.log("");
  }

  const latest = bookings.rows[0];
  if (!latest.crm_synced_at) {
    console.log("→ Latest booking was NOT synced to CRM. Check:");
    console.log("  1. Tenant has CRM Webhook URL in Dashboard → Settings");
    console.log("  2. Or set ZAPIER_WEBHOOK_URL in .env");
    console.log("  3. Check server logs for 'CRM sync error'");
  } else {
    console.log("→ Latest booking was synced to CRM at", latest.crm_synced_at);
    console.log("  Check Zapier task history and DripJobs for the new lead/job.");
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

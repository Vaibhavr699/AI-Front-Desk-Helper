"use strict";

const db = require("../lib/db");

async function seed() {
  const client = await db.getClient();
  try {
    let tenantId;
    const existing = await client.query(
      "SELECT id FROM tenants WHERE slug = $1 LIMIT 1",
      ["gladiators-painting"]
    );
    if (existing.rows[0]) {
      tenantId = existing.rows[0].id;
      console.log("Gladiators tenant already exists.");
    } else {
      const tenantRes = await client.query(
        `INSERT INTO tenants (
          name, slug, company_name, timezone,
          welcome_message, instructions,
          transfer_sms_brief, transfer_numbers, follow_up_enabled
        ) VALUES (
          'Gladiators Painting', 'gladiators-painting', 'Gladiators Painting', 'America/Chicago',
          'Thanks for calling Gladiators Painting — we specialize in high-quality interior and exterior painting. What can we help you with today? Would you like to schedule a free on-site estimate?',
          'You are the professional receptionist for Gladiators Painting. Warm, confident, human. Capture: name, phone, address/city, interior or exterior, scope, timeline. Offer FREE on-site estimate. One question at a time. If commercial job, project over $10k, frustrated caller, or VIP/repeat customer, call request_human_transfer. When you have enough info to book, call book_appointment.',
          'Incoming transfer from AI: {{summary}}. Caller: {{caller_phone}}. {{notes}}',
          '[]',
          true
        )
        RETURNING id`
      );
      tenantId = tenantRes.rows[0].id;
    }
    const hasPhone = await client.query(
      "SELECT 1 FROM phone_numbers WHERE tenant_id = $1 AND REPLACE(phone, ' ', '') LIKE '%4027738795%' LIMIT 1",
      [tenantId]
    );
    if (!hasPhone.rows[0]) {
      await client.query(
        `INSERT INTO phone_numbers (tenant_id, phone, is_primary) VALUES ($1, $2, true)`,
        [tenantId, "+14027738795"]
      );
      console.log("Added phone +14027738795 for Gladiators.");
    }
    console.log("Seed done.");
  } finally {
    client.release();
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
}).then(() => process.exit(0));

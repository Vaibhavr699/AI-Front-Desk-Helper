#!/usr/bin/env node
"use strict";

/**
 * Assign the Twilio AI number 402-773-8795 to the Gladiator Paintings tenant.
 * Run from project root: node scripts/assign-gladiator-ai-number.js
 * Requires: DATABASE_URL or SUPABASE_DATABASE_URL, BASE_URL, and Twilio credentials for webhook.
 */
require("dotenv").config();

const db = require("../lib/db");
const { configurePhoneWebhook } = require("../lib/twilio");
const { getTenantById } = require("../lib/tenant");

const TENANT_ID = "a2942de5-5bfd-4cb1-8071-9207fe290a4b";
const AI_PHONE = "+14027738795";

async function main() {
  console.log("Assigning", AI_PHONE, "to tenant", TENANT_ID, "(Gladiator Paintings)...\n");

  const tenant = await getTenantById(TENANT_ID);
  if (!tenant) {
    console.error("Tenant not found:", TENANT_ID);
    process.exit(1);
  }
  console.log("Tenant:", tenant.name || tenant.company_name, "(" + tenant.slug + ")");

  const existing = await db.query(
    "SELECT id, tenant_id, phone, is_primary FROM phone_numbers WHERE phone = $1",
    [AI_PHONE]
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (row.tenant_id === TENANT_ID) {
      console.log("Number already assigned to this tenant. Reconfiguring Twilio webhook...");
    } else {
      console.log("Number currently assigned to another tenant. Reassigning to Gladiator Paintings...");
      await db.query(
        "UPDATE phone_numbers SET tenant_id = $1, updated_at = now() WHERE id = $2",
        [TENANT_ID, row.id]
      );
      console.log("Updated phone_numbers row.");
    }
  } else {
    const primaryCount = await db.query(
      "SELECT COUNT(*) as n FROM phone_numbers WHERE tenant_id = $1",
      [TENANT_ID]
    );
    const isPrimary = parseInt(primaryCount.rows[0].n, 10) === 0;
    if (!isPrimary) {
      await db.query(
        "UPDATE phone_numbers SET is_primary = false WHERE tenant_id = $1",
        [TENANT_ID]
      );
    }
    await db.query(
      "INSERT INTO phone_numbers (tenant_id, phone, is_primary) VALUES ($1, $2, $3)",
      [TENANT_ID, AI_PHONE, isPrimary]
    );
    console.log("Inserted", AI_PHONE, "as", isPrimary ? "primary" : "non-primary", "for tenant.");
  }

  const webhookResult = await configurePhoneWebhook(AI_PHONE, TENANT_ID, tenant);
  if (webhookResult.success) {
    console.log("Twilio webhook configured (voice + SMS).");
    await db.query(
      "UPDATE phone_numbers SET twilio_sid = $1, updated_at = now() WHERE phone = $2 AND tenant_id = $3",
      [webhookResult.twilioSid, AI_PHONE, TENANT_ID]
    );
  } else {
    console.warn("Twilio webhook not set (number may be external or BASE_URL missing):", webhookResult.error);
  }

  console.log("\nDone. Ring Central 402-817-1993 → forward to 402-773-8795 in Ring Central; 402-773-8795 is the AI number for Gladiator Paintings.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

#!/usr/bin/env node
"use strict";

/**
 * Test the POST /webhooks/crm/job-completed endpoint.
 *
 * Usage:
 *   node scripts/test-crm-job-completed.js [phone] [api_key]
 *
 * Examples:
 *   node scripts/test-crm-job-completed.js "+15551234567" "sk_test_abc123"
 *   node scripts/test-crm-job-completed.js   # uses defaults below
 *
 * This replicates what Zapier would send when DripJobs moves a job to "Complete".
 */

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const phone = process.argv[2] || "+15551234567";
const apiKey = process.argv[3] || process.env.TEST_API_KEY || "";

const payload = {
  phone,
  contact_name: "Test Customer",
  service_date: new Date().toISOString().slice(0, 10),
  job_type: "Interior Painting",
};

async function main() {
  console.log("POST %s/webhooks/crm/job-completed", BASE_URL);
  console.log("Payload:", JSON.stringify(payload, null, 2));
  console.log("Authorization: Bearer %s", apiKey ? apiKey.slice(0, 4) + "..." : "(none)");

  const headers = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  try {
    const resp = await fetch(`${BASE_URL}/webhooks/crm/job-completed`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const body = await resp.json();
    console.log("\nStatus: %d", resp.status);
    console.log("Response:", JSON.stringify(body, null, 2));

    if (body.ok) {
      console.log("\n✅ Success — lead_id=%s booking_id=%s last_service_date=%s",
        body.lead_id, body.booking_id, body.last_service_date);
    } else {
      console.log("\n❌ Failed:", body.error);
    }
  } catch (err) {
    console.error("Request failed:", err.message);
  }
}

main();

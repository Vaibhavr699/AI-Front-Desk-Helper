"use strict";

require("dotenv").config();
const db = require("../lib/db");

const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL || null;

/**
 * Check why bookings might not be syncing to Zapier/DripJobs.
 * Run: node scripts/check-crm-webhook.js
 */
async function main() {
  console.log("=== CRM Webhook Check ===\n");

  const tenants = await db.query(
    "SELECT id, name, slug, company_name, crm_webhook_url FROM tenants ORDER BY name"
  );

  if (!tenants.rows.length) {
    console.log("No tenants in database.");
    process.exit(1);
  }

  console.log("ZAPIER_WEBHOOK_URL in .env:", ZAPIER_WEBHOOK_URL ? "Set (fallback)" : "Not set");
  console.log("");

  for (const t of tenants.rows) {
    const url = (t.crm_webhook_url && t.crm_webhook_url.trim()) || ZAPIER_WEBHOOK_URL;
    const hasUrl = !!url;
    const display = url
      ? url.replace(/https?:\/\//, "").slice(0, 50) + (url.length > 50 ? "…" : "")
      : "(none)";
    console.log(`Tenant: ${t.name} (${t.slug})`);
    console.log(`  CRM Webhook: ${hasUrl ? display : "(none)"}`);
    if (!hasUrl) {
      console.log("  → FIX: Set CRM Webhook URL in Dashboard → Settings for this tenant, OR set ZAPIER_WEBHOOK_URL in .env");
    }
    console.log("");
  }

  console.log("--- What to do ---");
  console.log("1. Dashboard → Settings → CRM Webhook URL = your Zapier Catch Hook URL (e.g. https://hooks.zapier.com/...)");
  console.log("2. Or in .env: ZAPIER_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/.../");
  console.log("3. In Zapier: Zap must be ON; Trigger = Webhooks by Zapier → Catch Hook; Action = DripJobs (e.g. Create Lead)");
  console.log("4. After a booking, check Render logs for: [CRM] booking ... → webhook 200 OK (synced) or [CRM] No webhook URL (not configured)");
  console.log("5. Test without a call: node scripts/test-book-lead.js");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

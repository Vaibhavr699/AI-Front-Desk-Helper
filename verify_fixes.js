const db = require("./lib/db");
const { getTenantByFacebookPageId } = require("./lib/tenant");

async function verify() {
  try {
    console.log("--- VERIFYING FACEBOOK LOOKUP ---");
    // Test with the ID extracted from the URL I saw earlier: 61576059478850
    const pageId = "61576059478850";
    const tenant = await getTenantByFacebookPageId(pageId);
    if (tenant) {
      console.log(`✅ Found tenant: ${tenant.name} (ID: ${tenant.id})`);
      console.log(`Stored FB Page ID: ${tenant.facebook_page_id}`);
    } else {
      console.log("❌ Tenant NOT found for pageId:", pageId);
    }

    console.log("\n--- VERIFYING CRM WEBHOOK RESOLUTION ---");
    const testTenantId = "a2942de5-5bfd-4cb1-8071-9207fe290a4b"; // Gladiator Painting
    const t = await db.query("SELECT id, name, crm_webhook_url, zapier_webhook_url FROM tenants WHERE id = $1", [testTenantId]).then(r => r.rows[0]);
    
    let urls = [];
    if (t.crm_webhook_url?.trim()) urls.push(t.crm_webhook_url.trim());
    if (t.zapier_webhook_url?.trim()) urls.push(t.zapier_webhook_url.trim());
    
    console.log(`Tenant: ${t.name}`);
    console.log(`CRM URL: ${t.crm_webhook_url || "NONE"}`);
    console.log(`Zapier URL: ${t.zapier_webhook_url || "NONE"}`);
    console.log(`Final Webhook List:`, urls);

    if (urls.length >= 1) console.log("✅ Webhook resolution looks correct.");
    else console.log("⚠️ No webhooks found for this tenant.");

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

require("dotenv").config();
verify();

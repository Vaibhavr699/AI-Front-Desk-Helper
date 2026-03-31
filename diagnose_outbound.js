require('dotenv').config();
const db = require("./lib/db");

async function diagnose() {
  console.log("--- Outbound Diagnostic ---");
  
  try {
    // 1. Check active campaigns
    const campaigns = await db.query(
      "SELECT id, tenant_id, name, status, mode, calling_hours_start, calling_hours_end, max_attempts FROM outbound_campaigns WHERE status = 'active'"
    );
    
    console.log(`Found ${campaigns.rows.length} active campaigns.`);
    
    for (const c of campaigns.rows) {
      console.log(`\nChecking Campaign: ${c.name} (${c.id})`);
      
      // Check Calling Hours
      const now = new Date();
      const timeStr = now.toTimeString().split(' ')[0];
      const inHours = timeStr >= c.calling_hours_start && timeStr <= c.calling_hours_end;
      console.log(`- Current Time: ${timeStr}`);
      console.log(`- Calling Window: ${c.calling_hours_start} to ${c.calling_hours_end}`);
      console.log(`- Within Hours: ${inHours}`);

      // Check Balance
      const tenantRes = await db.query("SELECT plan, bundle_minutes_balance FROM tenants WHERE id = $1", [c.tenant_id]);
      const tenant = tenantRes.rows[0];
      console.log(`- Tenant Plan: ${tenant?.plan || 'N/A'}`);
      console.log(`- Bundle Balance: ${tenant?.bundle_minutes_balance || 0}`);

      // Check Twilio Number
      const phoneRes = await db.query(
        "SELECT phone FROM phone_numbers WHERE tenant_id = $1 AND is_active = true LIMIT 1",
        [c.tenant_id]
      );
      console.log(`- Active Twilio Number: ${phoneRes.rows[0]?.phone || 'NONE'}`);

      // Check Contacts
      const contactRes = await db.query(
         `SELECT count(*) FROM outbound_contacts WHERE campaign_id = $1 AND status IN ('pending', 'no_answer') AND attempts < $2`,
         [c.id, c.max_attempts]
      );
      console.log(`- Contacts Waiting: ${contactRes.rows[0].count}`);
    }
  } catch (err) {
    console.error("Diagnostic error:", err);
  }

  process.exit(0);
}

diagnose().catch(err => {
    console.error(err);
    process.exit(1);
});

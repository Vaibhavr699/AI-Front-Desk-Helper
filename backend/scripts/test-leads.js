require('dotenv').config();
const leadsService = require('../services/leads');
const messagesService = require('../services/messages');
const db = require('../lib/db');

async function runTest() {
  console.log("🚀 Starting Lead CRM Test...");
  
  try {
    // 1. Get a tenant
    const tenantRes = await db.query("SELECT id, name FROM tenants LIMIT 1");
    if (tenantRes.rows.length === 0) {
      console.error("❌ No tenants found in database. Run seeds first.");
      process.exit(1);
    }
    const tenant = tenantRes.rows[0];
    console.log(`🏢 Using Tenant: ${tenant.name} (${tenant.id})`);

    // 2. Create or Get Lead
    const testPhone = "+15550109999";
    const leadName = "John Testlead";
    console.log(`👤 Creating/Retrieving Lead for ${testPhone}...`);
    
    const lead = await leadsService.getOrCreateLead(tenant.id, testPhone, leadName);
    console.log(`✅ Lead Ready: ${lead.name} [ID: ${lead.id}]`);

    // 3. Update Status and Revenue
    console.log(`📈 Updating status to 'Qualified' and setting revenue...`);
    await leadsService.updateLeadInfo(lead.id, {
      status: 'Qualified',
      project_type: 'Exterior Painting',
      estimated_revenue_cents: 250000 // $2,500.00
    });

    // 4. Save some simulated messages
    console.log(`💬 Simulating conversation...`);
    
    const messages = [
      { channel: 'sms', direction: 'inbound', body: "Hi, I'm interested in a quote for my house." },
      { channel: 'sms', direction: 'outbound', body: "Hello! I'd be happy to help. What kind of project do you have in mind?" },
      { channel: 'sms', direction: 'inbound', body: "It's a two-story exterior job." }
    ];

    for (const msg of messages) {
      await messagesService.saveMessage(
        tenant.id, 
        lead.id, 
        msg.channel, 
        msg.direction, 
        msg.body
      );
      console.log(`   [${msg.direction.toUpperCase()}] ${msg.body.substring(0, 30)}...`);
    }

    // 5. Verify Aggregation
    const historyRes = await db.query(
      "SELECT count(*) FROM messages WHERE lead_id = $1",
      [lead.id]
    );
    console.log(`📊 Test Complete! Total messages for lead: ${historyRes.rows[0].count}`);
    console.log(`\n🔗 View this lead at: http://localhost:5173/leads/${lead.id}`);

  } catch (err) {
    console.error("❌ Test Failed:", err);
  } finally {
    process.exit(0);
  }
}

runTest();

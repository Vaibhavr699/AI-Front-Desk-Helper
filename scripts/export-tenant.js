const fs = require('fs');
const path = require('path');
require('dotenv').config();
const db = require('../lib/db');

async function exportMigrationData() {
  console.log("Starting export...");
  
  try {
    // 1. Get ALL Gladiators Painting Tenants
    const tenantRes = await db.query(
      "SELECT * FROM tenants WHERE company_name ILIKE '%Gladiators Painting%' OR slug = 'gladiator-painting'"
    );
    if (tenantRes.rows.length === 0) {
      console.error("Could not find any 'Gladiators Painting' tenants.");
      process.exit(1);
    }
    const tenants = tenantRes.rows;
    const tIds = tenants.map(t => t.id);
    console.log(`Found ${tenants.length} tenants: ${tenants.map(t => t.name).join(', ')}`);

    // 2. Fetch Dashboard Users (Admins and these Tenants' users)
    const usersRes = await db.query(
      `SELECT * FROM dashboard_users WHERE role = 'superadmin' OR tenant_id = ANY($1)`,
      [tIds]
    );
    const users = usersRes.rows;
    console.log(`Found ${users.length} users.`);

    // 3. Extender queries for tenant tables
    const tableQueries = [
      { name: 'leads', q: "SELECT * FROM leads WHERE tenant_id = ANY($1)" },
      { name: 'messages', q: "SELECT * FROM messages WHERE tenant_id = ANY($1)" },
      { name: 'bookings', q: "SELECT * FROM bookings WHERE tenant_id = ANY($1)" },
      { name: 'calls', q: "SELECT * FROM calls WHERE tenant_id = ANY($1)" },
      { name: 'technicians', q: "SELECT * FROM technicians WHERE tenant_id = ANY($1)" },
      { name: 'estimate_recoveries', q: "SELECT * FROM estimate_recoveries WHERE tenant_id = ANY($1)" },
      { name: 'faqs', q: "SELECT * FROM faqs WHERE tenant_id = ANY($1)" },
      { name: 'phone_numbers', q: "SELECT * FROM phone_numbers WHERE tenant_id = ANY($1)" },
      { name: 'campaign_log', q: "SELECT * FROM campaign_log WHERE tenant_id = ANY($1)" },
      { name: 'nurturing_campaigns', q: "SELECT * FROM nurturing_campaigns WHERE tenant_id = ANY($1)" },
      { name: 'outbound_campaigns', q: "SELECT * FROM outbound_campaigns WHERE tenant_id = ANY($1)" },
      { name: 'sms_consents', q: "SELECT * FROM sms_consents WHERE tenant_id = ANY($1)" },
      { name: 'notifications', q: "SELECT * FROM notifications WHERE tenant_id = ANY($1)" }
    ];

    const exportedData = {
      tenants: tenants,
      dashboard_users: users
    };

    // 4. Fetch the data dynamically
    for (const tq of tableQueries) {
      try {
        const res = await db.query(tq.q, [tIds]);
        exportedData[tq.name] = res.rows;
        console.log(`Exported ${res.rows.length} rows from ${tq.name}`);
      } catch (err) {
        // Table might not exist or some SQL error - log and continue best-effort
        console.warn(`WARNING: Skipping table ${tq.name} - ${err.message}`);
        exportedData[tq.name] = [];
      }
    }

    // 5. Write to JSON
    const dumpPath = path.join(__dirname, '..', 'migration_data.json');
    fs.writeFileSync(dumpPath, JSON.stringify(exportedData, null, 2));
    
    console.log(`✅ Export complete! Saved to ${dumpPath}`);
    process.exit(0);

  } catch (error) {
    console.error("Fatal export error:", error);
    process.exit(1);
  }
}

exportMigrationData();

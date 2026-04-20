const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const db = require("/home/nbuck/ai-front-desk-backend/lib/db");

async function diagnose() {
  try {
    console.log("Checking DB connection...");
    const test = await db.query("SELECT count(*) FROM tenants");
    console.log("Tenants count:", test.rows[0].count);

    console.log("--- RECENT MESSAGES ---");
    const messages = await db.query(`
      SELECT m.id, m.tenant_id, m.lead_id, m.channel, m.direction, SUBSTRING(m.body, 1, 20) as body, m.created_at
      FROM messages m
      ORDER BY m.created_at DESC
      LIMIT 10
    `);
    console.log("Rows returned:", messages.rows.length);
    console.table(messages.rows);

    console.log("\n--- RECENT LEADS (FB/WEB) ---");
    const leads = await db.query(`
      SELECT l.id, l.tenant_id, l.phone, l.name as lead_name, l.created_at
      FROM leads l
      WHERE l.phone LIKE 'fb-%' OR l.phone LIKE 'web-%'
      ORDER BY l.created_at DESC
      LIMIT 10
    `);
    console.log("Rows returned:", leads.rows.length);
    console.table(leads.rows);

    process.exit(0);
  } catch (err) {
    console.error("Diagnostic error:", err);
    process.exit(1);
  }
}

diagnose();

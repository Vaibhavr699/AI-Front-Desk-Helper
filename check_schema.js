const db = require("./lib/db");

async function checkSchema() {
  try {
    const contacts = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'outbound_contacts'");
    console.log("--- OUTBOUND_CONTACTS ---");
    console.log(contacts.rows.map(r => r.column_name).join(", "));

    const calls = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'calls'");
    console.log("--- CALLS ---");
    console.log(calls.rows.map(r => r.column_name).join(", "));
  } catch (e) {
    console.error(e.message);
  } finally {
    process.exit();
  }
}

checkSchema();

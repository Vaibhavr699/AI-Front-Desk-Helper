const db = require("./lib/db");

async function check() {
  try {
    const res = await db.query("SELECT id, slug, company_name FROM tenants WHERE slug = $1 OR company_name = $2", ["website-chat", "Website Chat"]);
    console.log("Tenants found:", JSON.stringify(res.rows, null, 2));
  } catch (e) {
    console.error("DB Error:", e.message);
  } finally {
    process.exit();
  }
}

check();

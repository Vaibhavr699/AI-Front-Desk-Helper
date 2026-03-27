
require("dotenv").config();
const db = require("./lib/db");

async function checkSchema() {
  try {
    const res = await db.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'estimate_recoveries'
    `);
    console.log("Estimate Recoveries Schema:");
    res.rows.forEach(r => console.log(`  ${r.column_name}: ${r.data_type}`));
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    process.exit();
  }
}

checkSchema();

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./lib/db');
const fs = require('fs');

async function runSingle() {
  try {
    const filePath = path.join(__dirname, 'migrations', '035_lead_actual_revenue.sql');
    if (!fs.existsSync(filePath)) {
        throw new Error("Migration file 035 not found at " + filePath);
    }
    const sql = fs.readFileSync(filePath, 'utf8');
    console.log("Applying 035_lead_actual_revenue.sql to database...");
    
    // Test connection first
    await pool.query('SELECT NOW()');
    console.log("DB Connection successful.");

    await pool.query(sql);
    console.log("Migration 035 applied successfully!");
    process.exit(0);
  } catch (err) {
    console.error("Migration failed:", err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

runSingle();

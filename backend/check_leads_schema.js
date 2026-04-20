const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./lib/db');

async function checkSchema() {
  try {
    const res = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'leads' 
      ORDER BY column_name;
    `);
    console.log("Leads table columns:");
    res.rows.forEach(row => {
      console.log(` - ${row.column_name} (${row.data_type})`);
    });
    process.exit(0);
  } catch (err) {
    console.error("Failed to check schema:", err.message);
    process.exit(1);
  }
}

checkSchema();

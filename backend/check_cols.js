"use strict";
require("dotenv").config();
const { pool } = require("./lib/db");
async function check() {
  const r = await pool.query("SELECT * FROM phone_numbers LIMIT 1");
  console.log("Columns:", r.fields.map(f => f.name));
  process.exit(0);
}
check().catch(console.error);

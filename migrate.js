"use strict";

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { pool } = require("./lib/db");

async function run() {
  const sqlFile = path.join(__dirname, "migrations", "033_add_external_ids_to_leads.sql");
  const sql = fs.readFileSync(sqlFile, "utf8");
  
  console.log("Applying migration 033...");
  await pool.query(sql);
  console.log("Migration 033 applied successfully.");
  process.exit(0);
}

run().catch(err => {
  console.error("Migration failed:", err);
  process.exit(1);
});

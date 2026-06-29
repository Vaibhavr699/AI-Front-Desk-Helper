"use strict";

// One-off applier for a single migration file. Use when the main
// run-migrations.js runner is blocked by a stale historical migration
// (it re-runs every .sql file from 001 on every invocation, which fails
// against a long-lived database where later migrations have already
// dropped/renamed columns that earlier migrations reference).
//
// Usage:
//   node scripts/apply-one-migration.js 072_rep_app_foundation.sql
//
// Prints NOTICEs from the migration's verification block so you can
// confirm the columns + tables actually got created.

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/apply-one-migration.js <filename.sql>");
    process.exit(2);
  }
  const full = path.join(__dirname, "..", "migrations", file);
  if (!fs.existsSync(full)) {
    console.error("Not found:", full);
    process.exit(2);
  }
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    console.error("Set DATABASE_URL or SUPABASE_DATABASE_URL");
    process.exit(2);
  }

  // Single client (not pool) so we can subscribe to notices on this one
  // session — the migration's DO $$ ... RAISE NOTICE block is the proof of
  // success and we want to see it.
  const client = new Client({ connectionString });
  client.on("notice", (msg) => console.log(msg.message));

  const sql = fs.readFileSync(full, "utf8");
  console.log("Applying", file, "...");
  await client.connect();
  try {
    await client.query(sql);
    console.log("OK —", file, "applied.");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

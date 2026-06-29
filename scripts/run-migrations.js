"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../lib/db");

async function run() {
  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DATABASE_URL;
  if (!connectionString) {
    console.error("Set DATABASE_URL or SUPABASE_DATABASE_URL");
    process.exit(1);
  }

  const baseline = process.argv.includes("--baseline");
  const dir = path.join(__dirname, "..", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  await pool.query(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       filename   TEXT PRIMARY KEY,
       applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
     )`,
  );

  const applied = new Set(
    (await pool.query("SELECT filename FROM schema_migrations")).rows.map((r) => r.filename),
  );
  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log("Migrations up to date.");
    process.exit(0);
  }

  if (baseline) {
    for (const file of pending) {
      await pool.query(
        "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
        [file],
      );
      console.log("Baselined (marked applied, not run):", file);
    }
    console.log(`Baseline complete — ${pending.length} migration(s) marked as applied.`);
    process.exit(0);
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(dir, file), "utf8");
    console.log("Running", file);
    try {
      await pool.query(sql);
    } catch (err) {
      console.error(`Migration ${file} failed:`, err.message);
      process.exit(1);
    }
    await pool.query(
      "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
      [file],
    );
  }
  console.log(`Applied ${pending.length} migration(s).`);
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});

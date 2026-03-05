"use strict";

const db = require("../lib/db");
const auth = require("../lib/auth");

async function main() {
  const email = process.env.DASHBOARD_USER_EMAIL || process.argv[2];
  const password = process.env.DASHBOARD_USER_PASSWORD || process.argv[3];
  if (!email || !password) {
    console.error("Usage: DASHBOARD_USER_EMAIL=x@y.com DASHBOARD_USER_PASSWORD=secret node scripts/create-dashboard-user.js");
    console.error("   Or: node scripts/create-dashboard-user.js x@y.com secret");
    process.exit(1);
  }
  const hash = await auth.hashPassword(password);
  const normalized = email.trim().toLowerCase();
  const existing = await db.query(
    "SELECT id FROM dashboard_users WHERE email = $1 AND tenant_id IS NULL LIMIT 1",
    [normalized]
  ).then((r) => r.rows[0]);
  if (existing) {
    await db.query(
      "UPDATE dashboard_users SET password_hash = $1, updated_at = now() WHERE id = $2",
      [hash, existing.id]
    );
    console.log("Dashboard user updated:", normalized);
  } else {
    await db.query(
      "INSERT INTO dashboard_users (email, password_hash, role) VALUES ($1, $2, 'admin')",
      [normalized, hash]
    );
    console.log("Dashboard user created:", normalized);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

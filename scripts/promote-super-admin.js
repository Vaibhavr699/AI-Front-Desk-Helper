"use strict";

const db = require("../lib/db");
const auth = require("../lib/auth");

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error("Usage: node scripts/promote-super-admin.js <email>");
    process.exit(1);
  }

  const normalized = email.trim().toLowerCase();
  const r = await db.query(
    "UPDATE dashboard_users SET is_super_admin = true, updated_at = now() WHERE email = $1 RETURNING id, email, is_super_admin",
    [normalized]
  );

  if (r.rows.length === 0) {
    console.error(`No user found with email: ${normalized}`);
    process.exit(1);
  }

  console.log(`✅ Promoted ${r.rows[0].email} (id: ${r.rows[0].id}) to super_admin.`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Error:", e.message);
  process.exit(1);
});

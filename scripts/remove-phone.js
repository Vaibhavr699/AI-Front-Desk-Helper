"use strict";

require("dotenv").config();
const db = require("../lib/db");

/**
 * Remove a phone number from phone_numbers so it can be connected by a new tenant.
 * Usage: node scripts/remove-phone.js 402-773-8795
 *    or: node scripts/remove-phone.js +14027738795
 */
async function main() {
  const raw = process.argv[2] || "402-773-8795";
  const digits = String(raw).replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (last10.length < 10) {
    console.error("Invalid phone: need at least 10 digits.");
    process.exit(1);
  }

  const rows = await db.query(
    `SELECT id, tenant_id, phone FROM phone_numbers
     WHERE REPLACE(REPLACE(REPLACE(phone, '+', ''), '-', ''), ' ', '') LIKE $1`,
    ["%" + last10 + "%"]
  );

  if (rows.rows.length === 0) {
    console.log("No phone_numbers row found for", raw, ". Nothing to remove.");
    process.exit(0);
    return;
  }

  for (const row of rows.rows) {
    await db.query("DELETE FROM phone_numbers WHERE id = $1", [row.id]);
    console.log("Removed:", row.phone, "(tenant:", row.tenant_id, ")");
  }

  console.log("Done. The number can now be added to a new tenant (Dashboard Settings or API).");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

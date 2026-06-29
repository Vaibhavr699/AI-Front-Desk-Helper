"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const db = require("../lib/db");

const VALID_TIERS = new Set(["standard", "pro", "elite"]);

async function main() {
  const email = process.argv[2];
  const tier = (process.argv[3] || "standard").toLowerCase();

  if (!email) {
    console.error("Usage: node scripts/activate-rep-seat.js <email> [standard|pro|elite]");
    process.exit(2);
  }
  if (!VALID_TIERS.has(tier)) {
    console.error(`Invalid tier "${tier}". Must be one of: standard, pro, elite`);
    process.exit(2);
  }

  const result = await db.query(
    `UPDATE dashboard_users
        SET rep_seat_active       = true,
            rep_seat_tier         = $2,
            rep_seat_activated_at = COALESCE(rep_seat_activated_at, now())
      WHERE lower(email) = lower($1)
      RETURNING id, email, rep_seat_tier, rep_seat_activated_at`,
    [email, tier],
  );

  if (result.rowCount === 0) {
    console.error(`No dashboard_users row found for email: ${email}`);
    process.exit(1);
  }

  console.log("Activated rep seat:");
  console.log(JSON.stringify(result.rows[0], null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

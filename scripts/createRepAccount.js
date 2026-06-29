"use strict";

require("dotenv").config();

const crypto = require("crypto");
const bcrypt = require("bcrypt");
const db = require("../lib/db");

const VALID_TIERS = ["standard", "pro", "elite"];

async function createRepAccount({ email, password, tier }) {
  const normalizedEmail = email.trim().toLowerCase();
  const seatTier = VALID_TIERS.includes(tier) ? tier : "standard";
  const passwordHash = await bcrypt.hash(password, 10);

  const existing = await db.query(
    "SELECT id, tenant_id FROM dashboard_users WHERE lower(email) = lower($1)",
    [normalizedEmail],
  );

  if (existing.rows[0]) {
    const { id, tenant_id } = existing.rows[0];
    await db.query(
      "UPDATE tenants SET rep_coach_enabled = true, subscription_status = 'active', updated_at = now() WHERE id = $1",
      [tenant_id],
    );
    await db.query(
      `UPDATE dashboard_users
          SET password_hash = $1,
              role = 'admin',
              rep_seat_active = true,
              rep_seat_tier = $2,
              rep_seat_activated_at = COALESCE(rep_seat_activated_at, now()),
              updated_at = now()
        WHERE id = $3`,
      [passwordHash, seatTier, id],
    );
    return { mode: "updated", userId: id, tenantId: tenant_id, email: normalizedEmail, tier: seatTier };
  }

  const companyName = normalizedEmail.split("@")[0] || "Test Account";
  const slugBase = companyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "account";
  const slug = `${slugBase}-${crypto.randomBytes(3).toString("hex")}`;

  const tenant = await db.query(
    `INSERT INTO tenants (name, company_name, slug, plan, subscription_status, rep_coach_enabled, aifdh_enabled)
     VALUES ($1, $1, $2, 'basic', 'active', true, false)
     RETURNING id`,
    [companyName, slug],
  );
  const tenantId = tenant.rows[0].id;

  const user = await db.query(
    `INSERT INTO dashboard_users (tenant_id, email, password_hash, role, rep_seat_active, rep_seat_tier, rep_seat_activated_at)
     VALUES ($1, $2, $3, 'admin', true, $4, now())
     RETURNING id`,
    [tenantId, normalizedEmail, passwordHash, seatTier],
  );

  return { mode: "created", userId: user.rows[0].id, tenantId, email: normalizedEmail, tier: seatTier };
}

async function main() {
  const [email, password, tier] = process.argv.slice(2);
  if (!email || !password) {
    console.error("usage: node scripts/createRepAccount.js <email> <password> [standard|pro|elite]");
    process.exit(1);
  }
  const result = await createRepAccount({ email, password, tier });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});

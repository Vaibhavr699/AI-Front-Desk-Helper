"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const auth = require("../lib/auth");
const db = require("../lib/db");

const DEFAULTS = {
  email: "test-rep@demo.aifdh",
  password: "TestPass123!",
  tenantName: "Demo Painting Co.",
  tier: "standard",
};

async function resolveTenantId(name) {
  const r = await db.query("SELECT id FROM tenants WHERE name = $1 LIMIT 1", [name]);
  if (r.rowCount === 0) {
    throw new Error(`No tenant found with name "${name}"`);
  }
  return r.rows[0].id;
}

async function main() {
  const email = (process.argv[2] || DEFAULTS.email).toLowerCase().trim();
  const password = process.argv[3] || DEFAULTS.password;
  const tenantName = process.argv[4] || DEFAULTS.tenantName;
  const tier = (process.argv[5] || DEFAULTS.tier).toLowerCase();

  const tenantId = await resolveTenantId(tenantName);
  const passwordHash = await auth.hashPassword(password);

  const result = await db.query(
    `INSERT INTO dashboard_users (email, password_hash, tenant_id, role,
                                   rep_seat_active, rep_seat_tier, rep_seat_activated_at)
     VALUES ($1, $2, $3, 'rep', true, $4, now())
     ON CONFLICT (tenant_id, email) DO UPDATE
        SET password_hash         = EXCLUDED.password_hash,
            tenant_id             = EXCLUDED.tenant_id,
            role                  = 'rep',
            rep_seat_active       = true,
            rep_seat_tier         = EXCLUDED.rep_seat_tier,
            rep_seat_activated_at = COALESCE(dashboard_users.rep_seat_activated_at, now()),
            totp_secret           = NULL,
            trusted_devices       = '[]'::jsonb,
            updated_at            = now()
     RETURNING id, email, tenant_id, role, rep_seat_tier`,
    [email, passwordHash, tenantId, tier],
  );

  const row = result.rows[0];
  console.log("");
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│ Test rep ready                                               │");
  console.log("├──────────────────────────────────────────────────────────────┤");
  console.log(`│ Email:    ${row.email.padEnd(50)} │`);
  console.log(`│ Password: ${password.padEnd(50)} │`);
  console.log(`│ Tenant:   ${tenantName.padEnd(50)} │`);
  console.log(`│ Tier:     ${row.rep_seat_tier.padEnd(50)} │`);
  console.log(`│ User ID:  ${row.id.padEnd(50)} │`);
  console.log("└──────────────────────────────────────────────────────────────┘");
  console.log("");
  console.log("Log in to the mobile app with the email + password above.");
  console.log("TOTP enrollment QR will show on first login.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

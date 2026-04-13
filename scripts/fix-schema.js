require('dotenv').config();
const db = require('../lib/db');

async function fixSchemaAndReimport() {
  console.log("Fixing missing columns in schema...");

  try {
     // 1. Add missing columns safely
     await db.query(`
        ALTER TABLE tenants 
        ADD COLUMN IF NOT EXISTS google_calendar_error TEXT,
        ADD COLUMN IF NOT EXISTS facebook_token_error TEXT,
        ADD COLUMN IF NOT EXISTS inbound_voice TEXT,
        ADD COLUMN IF NOT EXISTS outbound_voice TEXT,
        ADD COLUMN IF NOT EXISTS extra_numbers_count INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS city TEXT,
        ADD COLUMN IF NOT EXISTS state TEXT;
     `);

     await db.query(`
        ALTER TABLE bookings 
        ADD COLUMN IF NOT EXISTS actual_revenue_cents INTEGER DEFAULT 0;
     `);

     await db.query(`
        ALTER TABLE calls 
        ADD COLUMN IF NOT EXISTS transcript TEXT,
        ADD COLUMN IF NOT EXISTS duration_minutes REAL;
     `);

     await db.query(`
        ALTER TABLE phone_numbers 
        ADD COLUMN IF NOT EXISTS label TEXT;
     `);

     console.log("Missing columns added completely!");

     // 2. Wipe the incorrectly imported tenants so we can do a fresh import with all columns
     console.log("Wiping partial Gladiators records for clean reload...");
     const slugs = ['gladiators-nj', 'gladiators-ny', 'lincoln', 'kansas-city', 'gladiator-painting'];
     await db.query(`DELETE FROM tenants WHERE slug = ANY($1)`, [slugs]);
     
     // Wipe the system users associated with them just in case
     // Wait, the dashboard users were all dumped, let's wipe the users that match our json dump.
     // Delete all users that do NOT have a tenant_id but were in our JSON?
     // Users cascade when tenant is deleted. But global admins don't have tenant_id. Let's delete the specific admins we pushed.
     await db.query(`DELETE FROM dashboard_users WHERE email IN ('drew@gladiatorspainting.com')`);

     console.log("Clean complete! Now re-running import...");
     process.exit(0);

  } catch (err) {
     console.error("Failed to fix schema", err);
     process.exit(1);
  }
}

fixSchemaAndReimport();

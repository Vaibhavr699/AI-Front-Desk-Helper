const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const { pool } = require('./lib/db');

async function testQuery() {
  const tenantIds = ['a2942de5-5bfd-4cb1-8071-9207fe290a4b'];
  const currentWindow = new Date();
  currentWindow.setDate(currentWindow.getDate() - 30);
  
  const sql = `
        SELECT
          (SELECT COUNT(*) FROM leads WHERE tenant_id = ANY($1) AND status NOT IN ('Closed', 'Lost')) as open_leads,
          (SELECT COUNT(*) FROM leads WHERE tenant_id = ANY($1) AND status = 'New') as leads_needing_followup,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = ANY($1) AND LOWER(status) IN ('booked', 'confirmed', 'scheduled')) as jobs_scheduled,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = ANY($1) AND (LOWER(status) IN ('completed') OR actual_revenue_cents > 0)) as confirmed_jobs,
          COALESCE(
            (SELECT SUM(estimated_revenue_cents) FROM leads WHERE tenant_id = ANY($1) AND status NOT IN ('Closed', 'Lost') AND estimated_revenue_cents > 0),
            0
          ) + COALESCE(
            (SELECT SUM(estimated_revenue_cents) FROM bookings WHERE tenant_id = ANY($1) AND LOWER(status) IN ('booked', 'confirmed', 'scheduled') AND lead_id IS NULL AND estimated_revenue_cents > 0),
            0
          ) as estimated_revenue,
          (SELECT SUM(estimated_revenue_cents) FROM bookings WHERE tenant_id = ANY($1) AND LOWER(status) IN ('cancelled', 'lost', 'rejected', 'lost lead')) as lost_revenue,
          COALESCE(
            (SELECT SUM(actual_revenue_cents) FROM bookings WHERE tenant_id = ANY($1)),
            0
          ) + COALESCE(
            (SELECT SUM(actual_revenue_cents) FROM leads WHERE tenant_id = ANY($1)),
            0
          ) as actual_revenue
    `;

  try {
    console.log("Testing SQL query...");
    const res = await pool.query(sql, [tenantIds]);
    console.log("Query success! Result:", res.rows[0]);
    process.exit(0);
  } catch (err) {
    console.error("Query failed with error:");
    console.error(err.message);
    if (err.stack) console.error(err.stack);
    process.exit(1);
  }
}

testQuery();

const { Pool } = require('pg');
const pool = new Pool({ connectionString: 'postgresql://postgres.jztcepvuonagcchtbiin:C6bCBF1fpudgzrGU@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres' });
async function run() {
  const res = await pool.query("SELECT id, name, company_name, slug, timezone, google_calendar_id, google_refresh_token FROM tenants WHERE company_name ILIKE '%gladiator%' OR name ILIKE '%gladiator%';");
  console.log(JSON.stringify(res.rows, null, 2));
  process.exit(0);
}
run();

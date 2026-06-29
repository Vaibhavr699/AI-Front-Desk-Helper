const { query } = require('./lib/db');

async function check() {
  try {
    const res = await query("SELECT id, name, facebook_page_id, facebook_page_access_token FROM tenants WHERE facebook_page_id = '566954113178482'");
    console.log("Tenants found:", res.rows.length);
    if (res.rows.length > 0) {
      const t = res.rows[0];
      console.log(`Tenant: ${t.name} (${t.id})`);
      console.log(`Page ID: ${t.facebook_page_id}`);
      console.log(`Access Token present: ${t.facebook_page_access_token ? 'YES' : 'NO'}`);
      if (t.facebook_page_access_token) {
        console.log(`Access Token Start: ${t.facebook_page_access_token.substring(0, 10)}...`);
      }
    }
  } catch (err) {
    console.error("Query failed:", err.message);
  } finally {
    process.exit();
  }
}

check();

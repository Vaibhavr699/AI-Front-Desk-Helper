const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const db = require('./lib/db');


async function check() {
  try {
    const res = await db.query("SELECT name, facebook_page_id, facebook_page_access_token FROM tenants");
    for (const t of res.rows) {
      console.log(`- ${t.name} -`);
      console.log(`  Page ID: [${t.facebook_page_id}] (len: ${t.facebook_page_id?.length})`);
      console.log(`  Token:   [${t.facebook_page_access_token?.substring(0, 10)}...] (total len: ${t.facebook_page_access_token?.length})`);
    }
    process.exit();
    console.log("Tenants found:", res.rows.length);
    for (const t of res.rows) {
      console.log(`Tenant: ${t.name}`);
      console.log(`ID: ${t.id}`);
      console.log(`Slug: ${t.slug}`);
      console.log(`FB Page ID: ${t.facebook_page_id}`);
      console.log(`FB Token Start: ${t.facebook_page_access_token ? t.facebook_page_access_token.substring(0, 10) : 'NULL'}`);
      console.log("-------------------");
    }
  } catch (err) {
    console.error("Check failed:", err.message);
  } finally {
    process.exit();
  }
}

check();

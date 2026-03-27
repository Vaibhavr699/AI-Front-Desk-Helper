const { query } = require('./lib/db');

async function testToken() {
  const pageIds = ['566954113178482', '986679137865507'];
  try {
    const res = await query("SELECT facebook_page_access_token, name, facebook_page_id FROM tenants WHERE facebook_page_id = '566954113178482'");
    const token = res.rows[0].facebook_page_access_token;
    
    console.log(`Testing token for: ${res.rows[0].name}`);
    
    for (const id of pageIds) {
      console.log(`Checking Page ID: ${id}...`);
      const url = `https://graph.facebook.com/v18.0/${id}?fields=name&access_token=${token}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.error) {
        console.log(`  ❌ Error for ${id}: ${data.error.message}`);
      } else {
        console.log(`  ✅ Token is VALID for Page: ${data.name} (${id})`);
      }
    }
  } catch (err) {
    console.error("Test failed:", err.message);
  } finally {
    process.exit();
  }
}

testToken();

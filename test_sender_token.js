const { query } = require('./lib/db');

async function testSender() {
  const senderId = '26287614824227805';
  try {
    const res = await query("SELECT name, facebook_page_access_token, facebook_page_id FROM tenants WHERE name IN ('Gladiator Painting', 'Acme Painting')");
    
    for (const t of res.rows) {
      console.log(`Testing token for ${t.name} (Page ID: ${t.facebook_page_id})...`);
      const url = `https://graph.facebook.com/v18.0/${senderId}?fields=first_name,last_name&access_token=${t.facebook_page_access_token}`;
      const resp = await fetch(url);
      const data = await resp.json();
      if (data.error) {
        console.log(`  ❌ Error: ${data.error.message}`);
      } else {
        console.log(`  ✅ SUCCESS! User Profile: ${data.first_name} ${data.last_name}`);
      }
    }
  } catch (err) {
    console.error("Test failed:", err.message);
  } finally {
    process.exit();
  }
}

testSender();

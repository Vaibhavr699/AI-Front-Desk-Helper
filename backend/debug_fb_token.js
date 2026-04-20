const { query } = require('./lib/db');

async function debugToken() {
  try {
    const res = await query("SELECT facebook_page_access_token, name, facebook_page_id FROM tenants WHERE facebook_page_id = '566954113178482'");
    if (res.rows.length === 0) {
      console.log("No tenant found with Page ID 566954113178482");
      return;
    }

    const token = res.rows[0].facebook_page_access_token;
    if (!token) {
      console.log("No access token found in DB");
      return;
    }

    console.log(`Verifying token for tenant: ${res.rows[0].name}`);
    console.log(`Expected Page ID: ${res.rows[0].facebook_page_id}`);

    const url = `https://graph.facebook.com/v18.0/me?fields=id,name&access_token=${token}`;
    const resp = await fetch(url);
    const data = await resp.json();

    if (data.error) {
      console.error("Token Error:", data.error.message);
    } else {
      console.log("--- Meta API Response ---");
      console.log(`Page ID from Token: ${data.id}`);
      console.log(`Page Name from Token: ${data.name}`);
      
      if (data.id !== res.rows[0].facebook_page_id) {
        console.warn("❌ MISMATCH DETECTED!");
        console.warn(`The token in the database belongs to Page "${data.name}" (${data.id}), NOT ${res.rows[0].facebook_page_id}`);
      } else {
        console.log("✅ Token matches Page ID in database.");
      }
    }
  } catch (err) {
    console.error("Debug failed:", err.message);
  } finally {
    process.exit();
  }
}

debugToken();

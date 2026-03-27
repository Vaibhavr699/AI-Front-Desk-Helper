const { query } = require('./lib/db');

async function swap() {
  try {
    // 1. Get Acme's token
    console.log("Fetching Acme Painting token...");
    const acmeRes = await query("SELECT facebook_page_access_token FROM tenants WHERE name = 'Acme Painting'");
    if (acmeRes.rows.length === 0) {
      console.error("Acme Painting not found");
      return;
    }
    const token = acmeRes.rows[0].facebook_page_access_token;
    
    // 2. Update Gladiator Painting's token
    console.log("Updating Gladiator Painting with Acme's token...");
    const updateRes = await query("UPDATE tenants SET facebook_page_access_token = $1 WHERE name = 'Gladiator Painting'", [token]);
    console.log("Update successful. Rows affected:", updateRes.rowCount);
    
  } catch (err) {
    console.error("Swap failed:", err.message);
  } finally {
    process.exit();
  }
}

swap();

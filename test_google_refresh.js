const { google } = require('googleapis');
const { query } = require('./lib/db');
require('dotenv').config();

async function testRefreshToken() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  
  try {
    const res = await query("SELECT name, google_refresh_token FROM tenants WHERE google_calendar_id IS NOT NULL AND google_refresh_token IS NOT NULL");
    console.log(`Found ${res.rows.length} tenants with refresh tokens.`);
    
    for (const t of res.rows) {
      console.log(`\nTesting token for: ${t.name}`);
      const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
      oauth2Client.setCredentials({ refresh_token: t.google_refresh_token });
      
      try {
        const { credentials } = await oauth2Client.getAccessToken();
        console.log(`✅ SUCCESS! New access token obtained for ${t.name}`);
        // console.log("Access Token Start:", credentials.access_token.substring(0, 10));
      } catch (err) {
        console.error(`❌ FAILED for ${t.name}: ${err.message}`);
        if (err.response && err.response.data) {
          console.error("Error data:", JSON.stringify(err.response.data, null, 2));
        }
      }
    }
  } catch (err) {
    console.error("Database query failed:", err.message);
  } finally {
    process.exit();
  }
}

testRefreshToken();

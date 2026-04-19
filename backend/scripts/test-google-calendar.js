/**
 * Enhanced script to test Google Calendar API connectivity and credentials.
 */
const { google } = require("googleapis");
require("dotenv").config();

async function testCalendar() {
  console.log("[Test] Initializing Google Calendar test...");

  const clientEmail = process.env.GOOGLE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_PRIVATE_KEY;
  const calendarId = process.env.GOOGLE_CALENDAR_ID || "primary";

  if (!clientEmail || !privateKey) {
    console.error("[Error] Missing Google Calendar credentials in .env.");
    process.exit(1);
  }

  // Handle the case where the key is wrapped in quotes or has escaped newlines
  privateKey = privateKey.replace(/^"(.*)"$/, '$1').replace(/\\n/g, "\n");

  try {
    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/calendar"]
    });

    console.log("[Test] Attempting to authorize...");
    const token = await auth.getAccessToken();
    if (token && token.token) {
        console.log("[Success] Successfully generated an access token!");
    } else {
        console.error("[Error] Authorization succeeded but no token was returned.");
    }

    const calendar = google.calendar({ version: "v3", auth });

    console.log(`[Test] Attempting to list events for calendar: ${calendarId}...`);
    const response = await calendar.events.list({
      calendarId: calendarId,
      maxResults: 1,
      timeMin: new Date().toISOString(),
    });

    console.log("[Success] Google Calendar API is working!");
    console.log(`[Success] Retrieved ${response.data.items.length} upcoming events.`);
  } catch (err) {
    console.error("[Error] Google Calendar test failed:");
    console.error("Message:", err.message);
    if (err.response && err.response.data) {
        console.error("Response Data:", JSON.stringify(err.response.data, null, 2));
    }
    
    if (err.message.includes("unregistered callers")) {
      console.log("\nTIP: This error often means the Google Calendar API is NOT ENABLED for your project.");
      console.log("Please go to: https://console.cloud.google.com/apis/library/calendar.googleapis.com");
      console.log("And make sure it says 'API Enabled'.");
    }
    if (err.message.includes("not found")) {
        console.log("\nTIP: Ensure you have SHARED your calendar with the service account email.");
        console.log(`Service Account Email: ${clientEmail}`);
    }
  }
}

testCalendar();

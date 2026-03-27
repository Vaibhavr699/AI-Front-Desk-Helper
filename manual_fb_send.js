const { query } = require('./lib/db');
require('dotenv').config();

async function manualSend() {
  const recipientId = '26287614824227805'; // Rahul's ID from logs
  const token = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;
  
  console.log(`Sending manual test to ${recipientId}...`);
  console.log(`Token: ${token.substring(0, 15)}...`);

  const payload = {
    recipient: { id: recipientId },
    message: { text: "Manual test from server script" }
  };

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/me/messages?access_token=${token}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    const body = await response.text();
    console.log("Status:", response.status);
    console.log("Body:", body);
  } catch (err) {
    console.error("Fetch failed:", err.message);
  } finally {
    process.exit();
  }
}

manualSend();

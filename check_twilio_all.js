require("dotenv").config();
const { client } = require("./lib/twilio");

async function check() {
  if (!client) {
    console.error("Twilio client not initialized");
    process.exit(1);
  }
  try {
    const numbers = await client.incomingPhoneNumbers.list();
    console.log(`Total incoming phone numbers found (default page): ${numbers.length}`);
    
    // Check if there are more pages
    let allNumbers = [];
    await client.incomingPhoneNumbers.each(n => allNumbers.push(n.phoneNumber));
    console.log(`Total incoming phone numbers found (all pages): ${allNumbers.length}`);
    
    // Sample a few
    console.log("Sample:", allNumbers.slice(0, 10));
  } catch (e) {
    console.error("Error:", e.message);
  } finally {
    process.exit(0);
  }
}

check();

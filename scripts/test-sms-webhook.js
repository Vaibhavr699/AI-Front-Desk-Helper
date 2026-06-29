/**
 * Test script to simulate an incoming Twilio SMS message.
 * Usage: node scripts/test-sms-webhook.js "+918076055898" "Hello, I want to book an appointment"
 */
const fetch = require("node-fetch");
require("dotenv").config();

async function testSms() {
    const from = process.argv[2] || "+918076055898";
    const body = process.argv[3] || "Hi, I need an interior painting estimate for my 3-bedroom house in Noida.";
    const to = process.env.TWILIO_PHONE_NUMBER || "+14027738795";
    const port = process.env.PORT || 3001;

    console.log(`[Test] Sending SMS from ${from} to ${to}...`);
    console.log(`[Test] Message: "${body}"`);

    try {
        const response = await fetch(`http://localhost:${port}/twilio-sms`, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                From: from,
                To: to,
                Body: body
            }).toString()
        });

        const responseText = await response.text();
        console.log(`[Test] Status: ${response.status}`);
        console.log(`[Test] Response TwiML:\n${responseText}`);
    } catch (error) {
        console.error(`[Test] Error: ${error.message}`);
    }
}

testSms();

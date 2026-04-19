/**
 * Script to send a real outbound SMS via Twilio.
 * Usage: node scripts/send-real-sms.js "+918076055898" "Hello from AI Front Desk!"
 */
const fetch = require("node-fetch");
require("dotenv").config();

function buildTwilioAuthHeader() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function sendSms() {
    const to = process.argv[2] || "+918076055898";
    const body = process.argv[3] || "Hello! This is a real test message from your AI Front Desk platform.";
    const from = process.env.TWILIO_PHONE_NUMBER;

    if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN || !from) {
        console.error("Error: Missing Twilio credentials in .env");
        process.exit(1);
    }

    console.log(`[Twilio] Sending real SMS to ${to} from ${from}...`);

    const url = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/Messages.json`;
    const payload = new URLSearchParams({ To: to, From: from, Body: body }).toString();

    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: buildTwilioAuthHeader(),
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: payload
        });

        const result = await response.json();
        if (response.ok) {
            console.log(`[Success] Message sent! SID: ${result.sid}`);
        } else {
            console.error(`[Error] Twilio API error: ${result.message}`);
            console.error(JSON.stringify(result, null, 2));
        }
    } catch (err) {
        console.error(`[Error] Network error: ${err.message}`);
    }
}

sendSms();

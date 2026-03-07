/**
 * Script to check the current webhook configuration of a Twilio phone number.
 */
const fetch = require("node-fetch");
require("dotenv").config();

function buildTwilioAuthHeader() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function checkPhoneConfig() {
    const phone = process.env.TWILIO_PHONE_NUMBER || "+14027738795";
    console.log(`[Twilio] Checking config for ${phone}...`);

    try {
        // 1. Find the SID for the phone number
        const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phone)}`;
        const listRes = await fetch(listUrl, {
            headers: { Authorization: buildTwilioAuthHeader() }
        });
        const listData = await listRes.json();

        if (!listData.incoming_phone_numbers || listData.incoming_phone_numbers.length === 0) {
            console.error("[Error] Number not found in Twilio account.");
            return;
        }

        const numberObj = listData.incoming_phone_numbers[0];
        console.log(`[Config] SID: ${numberObj.sid}`);
        console.log(`[Config] Voice URL: ${numberObj.voice_url}`);
        console.log(`[Config] SMS URL: ${numberObj.sms_url}`);
        console.log(`[Config] SMS Method: ${numberObj.sms_method}`);

        // Check if it matches our local server or Render
        const currentBase = process.env.BASE_URL;
        console.log(`[Local .env] BASE_URL: ${currentBase}`);

    } catch (err) {
        console.error(`[Error] ${err.message}`);
    }
}

checkPhoneConfig();

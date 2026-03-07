/**
 * Script to update the Twilio phone number webhook URLs to point to the current server's IP.
 */
const fetch = require("node-fetch");
require("dotenv").config();

function buildTwilioAuthHeader() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function updatePhoneConfig() {
    const phone = process.env.TWILIO_PHONE_NUMBER || "+14027738795";
    // We use the IP address and port 3001
    const newBaseUrl = "http://116.202.210.102:3001";

    console.log(`[Twilio] Updating config for ${phone} to ${newBaseUrl}...`);

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

        const numberSid = listData.incoming_phone_numbers[0].sid;
        console.log(`[Twilio] SID: ${numberSid}. Updating...`);

        // 2. Update the number with new URLs
        const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${numberSid}.json`;
        const params = new URLSearchParams({
            VoiceUrl: `${newBaseUrl}/twilio/voice`,
            SmsUrl: `${newBaseUrl}/twilio-sms`,
            SmsMethod: "POST"
        });

        const updateRes = await fetch(updateUrl, {
            method: "POST",
            headers: {
                Authorization: buildTwilioAuthHeader(),
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: params.toString()
        });

        const updateResult = await updateRes.json();
        if (updateRes.ok) {
            console.log(`[Success] Webhooks updated!`);
            console.log(`[Config] SMS URL: ${updateResult.sms_url}`);
            console.log(`[Config] Voice URL: ${updateResult.voice_url}`);
        } else {
            console.error(`[Error] Update failed: ${updateResult.message}`);
        }

    } catch (err) {
        console.error(`[Error] ${err.message}`);
    }
}

updatePhoneConfig();

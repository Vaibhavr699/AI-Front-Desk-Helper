/**
 * Script to update the Twilio phone number webhook URLs to point to the Render environment.
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
    const newBaseUrl = "https://ai-front-desk-backend.onrender.com";

    console.log(`[Twilio] Updating config for ${phone} to ${newBaseUrl}...`);

    try {
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
            console.log(`[Success] Webhooks updated to Render!`);
        } else {
            console.error(`[Error] Update failed: ${updateResult.message}`);
        }
    } catch (err) {
        console.error(`[Error] ${err.message}`);
    }
}

updatePhoneConfig();

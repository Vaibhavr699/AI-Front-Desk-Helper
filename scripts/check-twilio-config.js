const fetch = require("node-fetch");
require("dotenv").config();

function buildTwilioAuthHeader() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function checkAllTwilioConfigs() {
    console.log(`[Twilio] Auditing all incoming phone numbers in account ${process.env.TWILIO_ACCOUNT_SID}...`);

    try {
        const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json`;
        const listRes = await fetch(listUrl, {
            headers: { Authorization: buildTwilioAuthHeader() }
        });
        const listData = await listRes.json();

        if (!listData.incoming_phone_numbers || listData.incoming_phone_numbers.length === 0) {
            console.error("[Error] No incoming phone numbers found.");
            return;
        }

        console.log(`[Twilio] Found ${listData.incoming_phone_numbers.length} numbers:`);
        console.log("--------------------------------------------------");

        for (const num of listData.incoming_phone_numbers) {
            console.log(`[Number] ${num.phone_number}`);
            console.log(`[SID]    ${num.sid}`);
            console.log(`[Voice]  ${num.voice_url}`);
            console.log(`[SMS]    ${num.sms_url}`);
            console.log(`[Method] ${num.sms_method}`);
            console.log("--------------------------------------------------");
        }
    } catch (err) {
        console.error(`[Error] ${err.message}`);
    }
}

checkAllTwilioConfigs();

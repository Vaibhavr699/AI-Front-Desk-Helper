require("dotenv").config();
const fetch = require("node-fetch");
const db = require("../lib/db");

function buildTwilioAuthHeader() {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    return "Basic " + Buffer.from(`${sid}:${token}`).toString("base64");
}

async function fixAllWebhooks() {
    const baseUrl = process.env.BASE_URL || "https://ai-front-desk-backend.onrender.com";
    console.log(`[Twilio] Starting global webhook fix using Base URL: ${baseUrl}`);

    try {
        const res = await db.query("SELECT phone, tenant_id FROM phone_numbers");
        const numbers = res.rows;

        if (numbers.length === 0) {
            console.log("[Twilio] No numbers found in database.");
            return;
        }

        console.log(`[Twilio] Found ${numbers.length} numbers in DB to sync...`);

        // Get all numbers in account once to find SIDs
        const listUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PageSize=100`;
        const listRes = await fetch(listUrl, {
            headers: { Authorization: buildTwilioAuthHeader() }
        });
        const listData = await listRes.json();
        const accountNumbers = listData.incoming_phone_numbers || [];

        for (const dbNum of numbers) {
            const cleanDbPhone = dbNum.phone.replace(/\D/g, "");
            const match = accountNumbers.find(a => a.phone_number.replace(/\D/g, "") === cleanDbPhone);

            if (!match) {
                console.warn(`[Twilio] Number ${dbNum.phone} from DB not found in Twilio account!`);
                continue;
            }

            console.log(`[Twilio] Updating ${dbNum.phone} (SID: ${match.sid})...`);

            const updateUrl = `https://api.twilio.com/2010-04-01/Accounts/${process.env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${match.sid}.json`;
            const params = new URLSearchParams({
                VoiceUrl: `${baseUrl}/twilio/voice`,
                SmsUrl: `${baseUrl}/twilio-sms`,
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

            if (updateRes.ok) {
                console.log(`[Success] Updated ${dbNum.phone}`);
            } else {
                const error = await updateRes.json();
                console.error(`[Error] Failed to update ${dbNum.phone}: ${error.message}`);
            }
        }

        console.log("[Twilio] Webhook sync complete!");
    } catch (err) {
        console.error(`[Error] ${err.message}`);
    } finally {
        process.exit(0);
    }
}

fixAllWebhooks();

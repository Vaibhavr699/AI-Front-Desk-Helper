"use strict";

const twilio = require("twilio");

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

const client =
  accountSid && authToken
    ? twilio(accountSid, authToken)
    : null;

/**
 * Use the tenant's Twilio client if they have their own credentials (bring your own Twilio);
 * otherwise use the platform client.
 */
function getClientForTenant(tenant) {
  if (tenant && tenant.twilio_account_sid && tenant.twilio_auth_token) {
    return twilio(tenant.twilio_account_sid, tenant.twilio_auth_token);
  }
  return client;
}

/**
 * Return { accountSid, authToken } for Basic auth (e.g. fetching recording URLs).
 * Uses tenant credentials if set, otherwise platform env.
 */
function getAuthForTenant(tenant) {
  if (tenant && tenant.twilio_account_sid && tenant.twilio_auth_token) {
    return {
      accountSid: tenant.twilio_account_sid,
      authToken: tenant.twilio_auth_token,
    };
  }
  return accountSid && authToken ? { accountSid, authToken } : null;
}

<<<<<<< HEAD
/**
 * Look up an incoming phone number in the Twilio account.
 * Returns the Twilio IncomingPhoneNumber resource or null if not found.
 */
async function findIncomingPhoneNumber(phoneNumber, tenant = null) {
  const c = getClientForTenant(tenant);
  if (!c) return null;
  try {
    const numbers = await c.incomingPhoneNumbers.list({ phoneNumber, limit: 1 });
    return numbers[0] || null;
  } catch (e) {
    console.error("[Twilio] findIncomingPhoneNumber error:", e.message);
    return null;
  }
}

/**
 * Auto-configure a Twilio phone number's voice webhook + status callback.
 * Sets "A call comes in" → POST BASE_URL/twilio/voice/:tenantId.
 * Returns { success, twilioSid, error }.
 */
async function configurePhoneWebhook(phoneNumber, tenantId = null, tenant = null) {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    return { success: false, error: "BASE_URL not set — cannot auto-configure webhook" };
  }
  const c = getClientForTenant(tenant);
  if (!c) {
    return { success: false, error: "Twilio credentials not configured" };
  }
  try {
    const incoming = await findIncomingPhoneNumber(phoneNumber, tenant);
    if (!incoming) {
      return { success: false, error: `Number ${phoneNumber} not found in your Twilio account. Make sure it is purchased and active.` };
    }
    const voiceUrl = tenantId
      ? `${baseUrl.replace(/\/$/, "")}/twilio/voice/${tenantId}`
      : `${baseUrl.replace(/\/$/, "")}/twilio/voice`;
    const statusUrl = `${baseUrl.replace(/\/$/, "")}/twilio/status`; // Twilio status callback does not need tenantId on the path currently
    await c.incomingPhoneNumbers(incoming.sid).update({
      voiceUrl,
      voiceMethod: "POST",
      statusCallback: statusUrl,
      statusCallbackMethod: "POST",
    });
    console.log("[Twilio] Webhook configured phone=%s sid=%s voiceUrl=%s", phoneNumber, incoming.sid, voiceUrl);
    return { success: true, twilioSid: incoming.sid };
  } catch (e) {
    console.error("[Twilio] configurePhoneWebhook error:", e.message);
    return { success: false, error: e.message };
  }
}

/**
 * Get the next available (unassigned) Twilio phone number from the platform pool.
 * Lists all numbers on the platform Twilio account, then excludes any already
 * assigned in the phone_numbers table. Returns { phone, twilioSid } or null.
 */
async function getNextAvailableNumber() {
  if (!client) return null;
  const db = require("./db");
  try {
    // Get all numbers from platform Twilio account
    const twilioNumbers = await client.incomingPhoneNumbers.list({ limit: 100 });
    if (!twilioNumbers.length) return null;

    // Get all numbers already assigned to tenants
    const assigned = await db.query("SELECT phone FROM phone_numbers");
    const assignedSet = new Set(
      assigned.rows.map((r) => r.phone.replace(/\D/g, "").slice(-10))
    );

    // Find the first unassigned number
    for (const tn of twilioNumbers) {
      const digits = tn.phoneNumber.replace(/\D/g, "").slice(-10);
      if (!assignedSet.has(digits)) {
        return { phone: tn.phoneNumber, twilioSid: tn.sid };
      }
    }
    return null; // all numbers are assigned
  } catch (e) {
    console.error("[Twilio] getNextAvailableNumber error:", e.message);
    return null;
  }
}

module.exports = { client, twilio, getClientForTenant, getAuthForTenant, findIncomingPhoneNumber, configurePhoneWebhook, getNextAvailableNumber };
=======
module.exports = { client, twilio, getClientForTenant, getAuthForTenant };
>>>>>>> 27d1bf5 (Twilio testing)

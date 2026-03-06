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
 * Fetch a list of available Twilio phone numbers.
 * Defaults to US numbers.
 */
async function fetchAvailableNumbers(areaCode = null, limit = 10) {
  if (!client) {
    throw new Error("Platform Twilio credentials not configured");
  }

  try {
    const searchOptions = { limit };
    if (areaCode) {
      searchOptions.areaCode = areaCode;
    }

    const available = await client.availablePhoneNumbers("US").local.list(searchOptions);
    return available.map(n => ({
      friendlyName: n.friendlyName,
      phoneNumber: n.phoneNumber,
      locality: n.locality,
      region: n.region,
    }));
  } catch (e) {
    console.error("[Twilio] fetchAvailableNumbers error:", e.message);
    throw e;
  }
}

/**
 * Purchase a specific Twilio phone number.
 */
async function purchaseNewNumber(phoneNumber) {
  if (!client) {
    throw new Error("Platform Twilio credentials not configured");
  }

  try {
    // Purchase the specific number
    const purchased = await client.incomingPhoneNumbers.create({
      phoneNumber,
    });

    console.log("[Twilio] Auto-purchased new number:", purchased.phoneNumber, purchased.sid);

    return {
      phone: purchased.phoneNumber,
      twilioSid: purchased.sid,
    };
  } catch (e) {
    console.error(`[Twilio] purchaseNewNumber error for ${phoneNumber}:`, e.message);
    throw e;
  }
}

module.exports = { client, twilio, getClientForTenant, getAuthForTenant, findIncomingPhoneNumber, configurePhoneWebhook, purchaseNewNumber, fetchAvailableNumbers };

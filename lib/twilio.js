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
 * Auto-configure a Twilio phone number's voice webhook, SMS webhook, and status callback.
 * Voice: "A call comes in" → POST BASE_URL/twilio/voice/:tenantId.
 * SMS: "A message comes in" → POST BASE_URL/twilio-sms (tenant resolved by To number).
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
    const base = baseUrl.replace(/\/$/, "");
    const voiceUrl = tenantId ? `${base}/twilio/voice/${tenantId}` : `${base}/twilio/voice`;
    const statusUrl = `${base}/twilio/status`;
    const smsUrl = `${base}/twilio-sms`;
    await c.incomingPhoneNumbers(incoming.sid).update({
      voiceUrl,
      voiceMethod: "POST",
      statusCallback: statusUrl,
      statusCallbackMethod: "POST",
      smsUrl,
      smsMethod: "POST",
    });
    console.log("[Twilio] Webhook configured phone=%s sid=%s voiceUrl=%s smsUrl=%s", phoneNumber, incoming.sid, voiceUrl, smsUrl);
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

/**
 * Fetch already-owned numbers in the Twilio account that are NOT yet assigned in our DB.
 */
async function getOwnedUnassignedNumbers(db, areaCode = null) {
  if (!client) {
    throw new Error("Platform Twilio credentials not configured");
  }

  try {
    // 1. Fetch all assigned numbers from DB
    const assignedRes = await db.query("SELECT phone FROM phone_numbers");
    const assignedSet = new Set(assignedRes.rows.map(r => r.phone.replace(/\+/g, "")));

    // 2. List all incoming numbers in Twilio (handle paging)
    const owned = [];
    await client.incomingPhoneNumbers.each(n => {
      owned.push(n);
    });
    
    // 3. Filter for unassigned and matching areaCode
    const cleanArea = areaCode ? areaCode.replace(/\D/g, "") : null;
    
    let unassigned = owned.filter(n => {
      const cleanPhone = n.phoneNumber.replace(/\+/g, "");
      const isAssigned = assignedSet.has(cleanPhone);
      if (isAssigned) return false;
      
      if (cleanArea) {
        return cleanPhone.includes(cleanArea);
      }
      return true;
    });

    return unassigned.map(n => ({
      friendlyName: n.friendlyName,
      phoneNumber: n.phoneNumber,
      locality: n.locality || "In Account",
      region: n.region || "",
      isOwned: true // Flag to indicate this is already purchased
    }));
  } catch (e) {
    console.error("[Twilio] getOwnedUnassignedNumbers error:", e.message);
    throw e;
  }
}

// Verify an inbound Twilio webhook's X-Twilio-Signature against the auth token
// of the account that owns the call (tenant BYO creds if set, else platform).
// A forged request can't produce a valid signature for the resolved token, so
// passing an attacker-chosen tenant in the query doesn't help them.
function validateTwilioRequest(req, tenant) {
  const authInfo = getAuthForTenant(tenant);
  const token = authInfo?.authToken;
  if (!token) return false;
  const signature = req.headers["x-twilio-signature"];
  if (!signature) return false;
  const base = (process.env.BASE_URL || "").replace(/\/$/, "");
  const url = base + req.originalUrl;
  try {
    return twilio.validateRequest(token, signature, url, req.body || {});
  } catch (e) {
    console.error("[Twilio] validateRequest error:", e.message);
    return false;
  }
}

module.exports = { client, twilio, getClientForTenant, getAuthForTenant, validateTwilioRequest, findIncomingPhoneNumber, configurePhoneWebhook, purchaseNewNumber, fetchAvailableNumbers, getOwnedUnassignedNumbers };

"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");
const crmWebhookPayload = require("../lib/crmWebhookPayload");

const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL || null;

/**
 * Returns an array of unique webhook URLs configured for the tenant.
 * Uses both crm_webhook_url and zapier_webhook_url.
 */
function getWebhookUrls(tenant) {
  const urls = new Set();
  
  if (tenant?.crm_webhook_url?.trim()) urls.add(tenant.crm_webhook_url.trim());
  if (tenant?.zapier_webhook_url?.trim()) urls.add(tenant.zapier_webhook_url.trim());
  
  // System-wide fallback ONLY if no tenant-specific URLs are set
  if (urls.size === 0 && ZAPIER_WEBHOOK_URL) {
    urls.add(ZAPIER_WEBHOOK_URL.trim());
  }
  
  return Array.from(urls);
}

async function syncBookingToCrm(tenantId, booking) {
  const tenant = await db.query(
    "SELECT id, name, company_name, crm_webhook_url, zapier_webhook_url, crm_api_key, crm_type FROM tenants WHERE id = $1",
    [tenantId]
  ).then((r) => r.rows[0]);
  
  const webhookUrls = getWebhookUrls(tenant);
  if (webhookUrls.length === 0) {
    console.warn("[AI-Desk] CRM no webhook URLs tenantId=%s tenantName=%s", tenantId, tenant?.name || "?");
    return { synced: false };
  }

  const nameParts = crmWebhookPayload.splitDisplayName(booking.contact_name);
  const firstName = nameParts.first_name || "";
  const lastName = nameParts.last_name || "";
  const displayName = nameParts.full_name || String(booking.contact_name || "").trim();
  const phone = crmWebhookPayload.normalizePhoneForCrm(booking.contact_phone) || String(booking.contact_phone || "").trim();
  const appointmentDetails = crmWebhookPayload.buildBookingAppointmentDetails(booking);

  const payload = {
    event_type: "booking",
    source: "ai-front-desk",
    tenant_id: tenantId,
    tenant_name: tenant?.name ?? null,
    company_name: tenant?.company_name ?? null,
    contact_name: displayName,
    first_name: firstName || "New Lead",
    last_name: lastName || ".",
    contact_phone: phone,
    contact_email: booking.contact_email || `lead-${phone.replace(/\D/g, "").slice(-10)}@placeholder.local`,
    address: booking.address || "Not provided",
    city: booking.city,
    state: booking.state || "Unknown",
    zip: "00000",
    scope: booking.scope,
    job_type: booking.job_type,
    preferred_date: booking.preferred_date || new Date().toISOString().split("T")[0],
    appointment_time: booking.appointment_time ?? null,
    notes: booking.notes,
    booking_id: booking.id,
    // Aliases for Zapier / DripJobs mappings (same values as contact_* fields)
    full_name: displayName,
    phone,
    email: booking.contact_email || `lead-${phone.replace(/\D/g, "").slice(-10)}@placeholder.local`,
    appointment_details: appointmentDetails,
  };

  const headers = { "Content-Type": "application/json" };
  if (tenant && tenant.crm_api_key) headers["Authorization"] = `Bearer ${tenant.crm_api_key}`;

  let lastOk = false;
  let lastStatus = 0;
  let lastError = null;
  let crmId = null;

  console.log("[AI-Desk] Sending booking payload to webhooks:", JSON.stringify(payload));

  // Send to all configured URLs
  for (const url of webhookUrls) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      lastOk = resp.ok;
      lastStatus = resp.status;
      const body = await resp.text();
      console.log("[AI-Desk] Webhook sent bookingId=%s url=%s status=%s ok=%s", booking.id, url, resp.status, resp.ok);
      
      // Try to extract a CRM ID from the responses
      try {
        const j = JSON.parse(body);
        if (j.id || j.job_id) {
          crmId = String(j.id || j.job_id);
        }
      } catch (_) { }
    } catch (e) {
      console.error("[AI-Desk] Webhook failed bookingId=%s url=%s error=%s", booking.id, url, e.message);
      lastError = e.message;
    }
  }

  if (crmId || lastOk) {
    await db.query(
      "UPDATE bookings SET crm_synced_at = now(), crm_id = COALESCE($1, crm_id), updated_at = now() WHERE id = $2",
      [crmId, booking.id]
    );
  }

  return { synced: lastOk, crm_id: crmId, error: lastError, status: lastStatus };
}

async function sendBookingConfirmationSms(tenant, booking, message) {
  const fullTenant = await db.query(
    `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
     FROM tenants t WHERE t.id = $1`,
    [tenant.id]
  ).then((r) => r.rows[0]);
  if (!fullTenant) return;
  const client = twilio.getClientForTenant(fullTenant);
  if (!client) return;
  let from = fullTenant.matched_phone || process.env.TWILIO_PHONE_NUMBER;
  if (!from) return;
  const body = message || `Your estimate with ${fullTenant.company_name} is scheduled. We'll reach out to confirm.`;
  try {
    await client.messages.create({
      to: booking.contact_phone,
      from,
      body,
    });
  } catch (e) {
    console.error("Confirmation SMS error:", e);
  }
}

async function sendCallDetailsToCrm(tenantId, callId) {
  const tenant = await db.query(
    "SELECT id, name, company_name, crm_webhook_url, zapier_webhook_url, crm_api_key FROM tenants WHERE id = $1",
    [tenantId]
  ).then((r) => r.rows[0]);
  
  const webhookUrls = getWebhookUrls(tenant);
  if (webhookUrls.length === 0) return { sent: false };

  const call = await db.query(
    "SELECT c.*, (SELECT json_agg(json_build_object('id', r.id, 'twilio_sid', r.twilio_sid, 'recording_url', r.recording_url, 'duration_sec', r.duration_sec, 'transcript', r.transcript, 's3_key', r.s3_key)) FROM recordings r WHERE r.call_id = c.id) as recordings FROM calls c WHERE c.id = $1",
    [callId]
  ).then((r) => r.rows[0]);
  if (!call) return { sent: false };

  const booking = await db.query(
    "SELECT id, contact_name, contact_phone, state, status FROM bookings WHERE call_id = $1 LIMIT 1",
    [callId]
  ).then((r) => r.rows[0]);

  const recordings = call.recordings || [];
  const primaryRec = recordings.find((r) => r.transcript) || recordings[0];
  const payload = {
    event_type: "call_details",
    source: "ai-front-desk",
    call_id: call.id,
    call_sid: call.twilio_call_sid,
    from_number: call.from_number,
    to_number: call.to_number,
    direction: call.direction,
    status: call.status,
    disposition: call.disposition,
    transferred: call.transferred,
    transfer_to: call.transfer_to,
    started_at: call.started_at,
    ended_at: call.ended_at,
    duration_sec: primaryRec?.duration_sec ?? null,
    recording_url: primaryRec?.recording_url ?? null,
    s3_key: primaryRec?.s3_key ?? null,
    transcript: primaryRec?.transcript ?? null,
    recording_sid: primaryRec?.twilio_sid ?? primaryRec?.id ?? null,
    tenant_id: tenantId,
    tenant_name: tenant?.name ?? null,
    company_name: tenant?.company_name ?? null,
    booking_id: booking?.id ?? null,
    booking_contact_name: booking?.contact_name ?? null,
    booking_contact_phone: booking?.contact_phone ?? null,
    booking_contact_state: booking?.state ?? null,
    booking_contact_status: booking?.status ?? null,
  };

  const headers = { "Content-Type": "application/json" };
  if (tenant && tenant.crm_api_key) headers["Authorization"] = `Bearer ${tenant.crm_api_key}`;

  let lastStatus = 0;
  let sentAny = false;

  console.log("[AI-Desk] Sending call_details payload to webhooks:", JSON.stringify(payload));

  for (const url of webhookUrls) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
      });
      lastStatus = resp.status;
      if (resp.ok) sentAny = true;
      console.log("[AI-Desk] Call details webhook sent callId=%s url=%s status=%s", call.id, url, resp.status);
    } catch (e) {
      console.error("[AI-Desk] Call details webhook failed callId=%s url=%s error=%s", call.id, url, e.message);
    }
  }

  return { sent: sentAny, status: lastStatus };
}

module.exports = {
  syncBookingToCrm,
  sendBookingConfirmationSms,
  sendCallDetailsToCrm,
};

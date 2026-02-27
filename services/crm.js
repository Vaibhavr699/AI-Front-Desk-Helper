"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");

const ZAPIER_WEBHOOK_URL = process.env.ZAPIER_WEBHOOK_URL || null;

function getCrmWebhookUrl(tenant) {
  const url = (tenant && tenant.crm_webhook_url) || ZAPIER_WEBHOOK_URL;
  return url && url.trim() ? url.trim() : null;
}

async function syncBookingToCrm(tenantId, booking) {
  const tenant = await db.query(
    "SELECT id, name, company_name, crm_webhook_url, crm_api_key, crm_type FROM tenants WHERE id = $1",
    [tenantId]
  ).then((r) => r.rows[0]);
  const webhookUrl = getCrmWebhookUrl(tenant);
  if (!webhookUrl) return { synced: false };

  const name = booking.contact_name && booking.contact_name.trim();
  const nameParts = name ? name.split(/\s+/).filter(Boolean) : [];
  const firstName = nameParts[0] ?? null;
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : null;

  const payload = {
    event_type: "booking",
    source: "ai-front-desk",
    tenant_id: tenantId,
    tenant_name: tenant?.name ?? null,
    company_name: tenant?.company_name ?? null,
    contact_name: booking.contact_name,
    first_name: firstName,
    last_name: lastName,
    contact_phone: booking.contact_phone,
    contact_email: booking.contact_email,
    address: booking.address,
    city: booking.city,
    scope: booking.scope,
    job_type: booking.job_type,
    preferred_date: booking.preferred_date,
    notes: booking.notes,
    booking_id: booking.id,
  };

  const headers = { "Content-Type": "application/json" };
  if (tenant && tenant.crm_api_key) headers["Authorization"] = `Bearer ${tenant.crm_api_key}`;

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    const ok = resp.ok;
    const body = await resp.text();
    let crmId = null;
    try {
      const j = JSON.parse(body);
      if (j.id) crmId = String(j.id);
      else if (j.job_id) crmId = String(j.job_id);
    } catch (_) { }
    await db.query(
      "UPDATE bookings SET crm_synced_at = now(), crm_id = COALESCE($1, crm_id), updated_at = now() WHERE id = $2",
      [crmId, booking.id]
    );
    return { synced: ok, crm_id: crmId };
  } catch (e) {
    console.error("CRM sync error:", e);
    return { synced: false, error: e.message };
  }
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
<<<<<<< HEAD
  let from = fullTenant.matched_phone || process.env.TWILIO_PHONE_NUMBER;
=======
  let from = process.env.TWILIO_PHONE_NUMBER || fullTenant.matched_phone;
>>>>>>> 27d1bf5 (Twilio testing)
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
    "SELECT id, name, company_name, crm_webhook_url, crm_api_key FROM tenants WHERE id = $1",
    [tenantId]
  ).then((r) => r.rows[0]);
  const webhookUrl = getCrmWebhookUrl(tenant);
  if (!webhookUrl) return { sent: false };

  const call = await db.query(
    "SELECT c.*, (SELECT json_agg(json_build_object('id', r.id, 'twilio_sid', r.twilio_sid, 'recording_url', r.recording_url, 'duration_sec', r.duration_sec, 'transcript', r.transcript, 's3_key', r.s3_key)) FROM recordings r WHERE r.call_id = c.id) as recordings FROM calls c WHERE c.id = $1",
    [callId]
  ).then((r) => r.rows[0]);
  if (!call) return { sent: false };

  const booking = await db.query(
    "SELECT id, contact_name, contact_phone, status FROM bookings WHERE call_id = $1 LIMIT 1",
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
    booking_contact: booking ? { name: booking.contact_name, phone: booking.contact_phone, status: booking.status } : null,
  };

  const headers = { "Content-Type": "application/json" };
  if (tenant && tenant.crm_api_key) headers["Authorization"] = `Bearer ${tenant.crm_api_key}`;

  try {
    const resp = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    return { sent: true, status: resp.status };
  } catch (e) {
    console.error("CRM call details error:", e);
    return { sent: false, error: e.message };
  }
}

module.exports = {
  syncBookingToCrm,
  sendBookingConfirmationSms,
  sendCallDetailsToCrm,
};

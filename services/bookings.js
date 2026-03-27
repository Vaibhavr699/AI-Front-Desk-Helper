"use strict";

const db = require("../lib/db");
const crm = require("./crm");
const emailService = require("./email");
const { getTenantById } = require("../lib/tenant");
const followUp = require("./followUp");

/** Normalize and validate booking payload from AI (handles camelCase, extra fields, bad dates). */
function normalizeBookingData(data) {
  if (!data || typeof data !== "object") return {};
  const get = (obj, ...keys) => {
    for (const k of keys) {
      const v = obj[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
    return null;
  };
  const contactPhone = get(data, "contact_phone", "contactPhone");
  if (!contactPhone) {
    throw new Error("contact_phone is required and cannot be empty");
  }
  // Only pass through preferred_date if it looks like a valid date (YYYY-MM-DD)
  let preferredDate = get(data, "preferred_date", "preferredDate");
  if (preferredDate) {
    const isoMatch = preferredDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!isoMatch) preferredDate = null;
  }
  return {
    contact_name: get(data, "contact_name", "contactName"),
    contact_phone: contactPhone,
    contact_email: get(data, "contact_email", "contactEmail"),
    address: get(data, "address"),
    city: get(data, "city"),
    state: get(data, "state"),
    scope: get(data, "scope"),
    job_type: get(data, "job_type", "jobType"),
    preferred_date: preferredDate,
    appointment_time: get(data, "appointment_time", "appointmentTime"),
    technician_id: get(data, "technician_id", "technicianId"),
    notes: get(data, "notes"),
    estimated_revenue_cents: data.estimated_value ? Math.round(parseFloat(data.estimated_value) * 100) : 15000, // Default to $150 if not specified
  };
}


async function createBooking(tenantId, callId, data, leadId = null, leadSource = null) {
  console.log("[AI-Desk] Booking create start tenantId=%s callId=%s raw_keys=%s", tenantId, callId || "(none)", Object.keys(data || {}).join(","));
  const norm = normalizeBookingData(data);
  console.log("[AI-Desk] Booking normalized name=%s phone=%s address=%s city=%s state=%s", norm.contact_name, norm.contact_phone, norm.address || "(none)", norm.city || "(none)", norm.state || "(none)");
  let res;
  try {
    res = await db.query(
      `INSERT INTO bookings (
        tenant_id, call_id, lead_id, contact_name, contact_phone, contact_email,
        address, city, state, scope, job_type, preferred_date, appointment_time, technician_id, notes, status, estimated_revenue_cents, lead_source
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'Booked', $16, $17)
      RETURNING *`,
      [
        tenantId,
        callId || null,
        leadId || null,
        norm.contact_name,
        norm.contact_phone,
        norm.contact_email,
        norm.address,
        norm.city,
        norm.state,
        norm.scope,
        norm.job_type,
        norm.preferred_date,
        norm.appointment_time,
        norm.technician_id,
        norm.notes,
        norm.estimated_revenue_cents,
        leadSource || null,
      ]

    );
  } catch (err) {
    console.error("[AI-Desk] Booking INSERT failed tenantId=%s error=%s code=%s data=%s", tenantId, err.message, err.code, JSON.stringify(norm));
    throw err;
  }
  const booking = res.rows[0];
  console.log("[AI-Desk] Booking saved id=%s tenantId=%s contact=%s", booking.id, tenantId, norm.contact_phone);
  const tenant = await getTenantById(tenantId);
  let crmSynced = false;
  try {
    const syncResult = await crm.syncBookingToCrm(tenantId, booking);
    crmSynced = !!syncResult.synced;
    console.log("[AI-Desk] CRM sync bookingId=%s synced=%s", booking.id, syncResult.synced);
  } catch (e) {
    console.error("[AI-Desk] CRM sync failed bookingId=%s error=%s", booking.id, e.message);
  }
  if (tenant) {
    crm.sendBookingConfirmationSms(tenant, booking).catch((e) => console.error("SMS:", e));
    emailService.sendBookingConfirmationEmail(tenant, booking).catch((e) => console.error("Email:", e));
  }
  if (tenant && tenant.follow_up_enabled) {
    followUp.scheduleFollowUps(tenantId, booking).catch((e) => console.error("Follow-up schedule:", e));
  }
  return { booking, crmSynced };
}

async function updateBooking(bookingId, data) {
  console.log("[AI-Desk] Booking update start bookingId=%s", bookingId);
  const norm = normalizeBookingData(data);
  const set = [];
  const values = [];
  let i = 1;

  for (const [key, value] of Object.entries(norm)) {
    if (value !== undefined) {
      set.push(`${key} = $${i++}`);
      values.push(value);
    }
  }

  if (set.length === 0) return null;

  values.push(bookingId);
  const res = await db.query(
    `UPDATE bookings SET ${set.join(", ")}, updated_at = now() WHERE id = $${i} RETURNING *`,
    values
  );

  const booking = res.rows[0];
  if (booking) {
    const tenant = await getTenantById(booking.tenant_id);
    if (tenant) {
      // Potentially sync to CRM and send notifications here too
      crm.syncBookingToCrm(booking.tenant_id, booking).catch(e => console.error("CRM Sync:", e));
    }
  }
  return booking;
}

async function cancelBooking(bookingId) {
  console.log("[AI-Desk] Booking cancel id=%s", bookingId);
  const res = await db.query(
    `UPDATE bookings SET status = 'Cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
    [bookingId]
  );
  const booking = res.rows[0];
  if (booking) {
    const tenant = await getTenantById(booking.tenant_id);
    if (tenant) {
      crm.syncBookingToCrm(booking.tenant_id, booking).catch(e => console.error("CRM Sync:", e));
    }
  }
  return booking;
}

async function findLatestBookingByPhone(tenantId, phone) {
  const res = await db.query(
    `SELECT * FROM bookings WHERE tenant_id = $1 AND contact_phone = $2 ORDER BY created_at DESC LIMIT 1`,
    [tenantId, phone]
  );
  return res.rows[0] || null;
}

module.exports = { createBooking, updateBooking, cancelBooking, findLatestBookingByPhone };

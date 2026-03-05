"use strict";

const db = require("../lib/db");
const crm = require("./crm");
const emailService = require("./email");
const { getTenantById } = require("../lib/tenant");
const followUp = require("./followUp");

async function createBooking(tenantId, callId, data) {
  const res = await db.query(
    `INSERT INTO bookings (
      tenant_id, call_id, contact_name, contact_phone, contact_email,
      address, city, scope, job_type, preferred_date, notes, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'scheduled')
    RETURNING *`,
    [
      tenantId,
      callId,
      data.contact_name || null,
      data.contact_phone || null,
      data.contact_email || null,
      data.address || null,
      data.city || null,
      data.scope || null,
      data.job_type || null,
      data.preferred_date || null,
      data.notes || null,
    ]
  );
  const booking = res.rows[0];
  const tenant = await getTenantById(tenantId);
  crm.syncBookingToCrm(tenantId, booking).catch((e) => console.error("CRM sync:", e));
  if (tenant) {
    crm.sendBookingConfirmationSms(tenant, booking).catch((e) => console.error("SMS:", e));
    emailService.sendBookingConfirmationEmail(tenant, booking).catch((e) => console.error("Email:", e));
  }
  if (tenant && tenant.follow_up_enabled) {
    followUp.scheduleFollowUps(tenantId, booking).catch((e) => console.error("Follow-up schedule:", e));
  }
  return booking;
}

async function getBookingsByTenant(tenantId, limit = 50) {
  const res = await db.query(
    `SELECT * FROM bookings WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [tenantId, limit]
  );
  return res.rows;
}

module.exports = { createBooking, getBookingsByTenant };

"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");
const { DateTime } = require("luxon");

const FOLLOW_UP_SCHEDULE = [
  { type: "24h", hours: 24 },
  { type: "3d", hours: 72 },
  { type: "5d", hours: 120 },
  { type: "10d", hours: 240 },
];

function addHours(d, h) {
  const out = new Date(d);
  out.setTime(out.getTime() + h * 60 * 60 * 1000);
  return out;
}

async function scheduleFollowUps(tenantId, booking) {
  const base = new Date(booking.created_at || Date.now());
  for (const { type, hours } of FOLLOW_UP_SCHEDULE) {
    const dueAt = addHours(base, hours);
    await db.query(
      `INSERT INTO follow_ups (tenant_id, booking_id, call_id, contact_phone, contact_name, follow_up_type, due_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')`,
      [
        tenantId,
        booking.id,
        booking.call_id || null,
        booking.contact_phone,
        booking.contact_name,
        type,
        dueAt.toISOString(),
      ]
    );
  }
}

async function processDueFollowUps() {
  const res = await db.query(
    `SELECT f.*, t.name as tenant_name, t.company_name, t.timezone
     FROM follow_ups f
     JOIN tenants t ON t.id = f.tenant_id
     WHERE f.status = 'pending' AND f.due_at <= now()
     ORDER BY f.due_at
     LIMIT 100`
  );
  for (const row of res.rows) {
    // Restrict outreach to 8 AM - 7 PM in the tenant's timezone
    const tz = row.timezone || "America/Chicago";
    const nowLocal = DateTime.now().setZone(tz);
    const hour = nowLocal.hour;

    if (hour < 8 || hour >= 19) {
      console.log(`[Follow-up] Outside outreach window for tenant ${row.tenant_name} (${row.tenant_id}). Local time: ${nowLocal.toFormat("HH:mm")}. Skipping.`);
      continue;
    }

    await sendFollowUp(row);
  }
}

async function sendFollowUp(followUp) {
  const tenant = await db.query(
    `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
     FROM tenants t WHERE t.id = $1`,
    [followUp.tenant_id]
  ).then((r) => r.rows[0]);
  if (!tenant) return;
  const client = twilio.getClientForTenant(tenant);
  if (!client) return;
  const from = tenant.matched_phone || process.env.TWILIO_PHONE_NUMBER;
  if (!from) return;

  const messages = {
    "24h": `Hi${followUp.contact_name ? " " + followUp.contact_name : ""}! This is ${followUp.company_name}. Just following up on your estimate request — any questions? Reply or give us a call.`,
    "3d": `${followUp.company_name} here — checking in about your estimate. We'd love to help. Give us a call if you're ready to schedule!`,
    "5d": `Quick reminder from ${followUp.company_name}: we're here when you're ready to get your project quoted. Reply or call us anytime.`,
    "10d": `Last follow-up from ${followUp.company_name}. If you still need a quote, we're happy to help. Otherwise we'll close your request. Thanks!`,
  };
  const body = messages[followUp.follow_up_type] || messages["24h"];

  try {
    await client.messages.create({
      to: followUp.contact_phone,
      from,
      body,
    });
    await db.query(
      "UPDATE follow_ups SET sent_at = now(), status = 'sent', updated_at = now() WHERE id = $1",
      [followUp.id]
    );
  } catch (e) {
    console.error("Follow-up send error:", e);
    await db.query(
      "UPDATE follow_ups SET status = 'failed', updated_at = now() WHERE id = $1",
      [followUp.id]
    );
  }
}

module.exports = {
  scheduleFollowUps,
  processDueFollowUps,
  sendFollowUp,
};

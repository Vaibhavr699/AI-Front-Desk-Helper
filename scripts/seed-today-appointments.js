"use strict";

require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const db = require("../lib/db");

const SEED_MARKER = "today-demo-v1";

const APPOINTMENTS = [
  {
    appointment_time: "09:00:00",
    lead: {
      name: "Dan Sullivan",
      phone: "+15551230001",
      email: "dan.sullivan@example.com",
      address: "412 Pinecrest Ave, Lincoln, NE",
      project_type: "Interior painting",
      status: "Scheduled",
      disc_primary: "D",
      disc_confidence: 0.86,
      widget_low: 120000,
      widget_high: 180000,
      widget_scope: "Living room + dining room, walls + trim, single coat",
    },
    booking: {
      city: "Lincoln",
      scope: "Walls + trim",
      job_type: "Interior painting",
      notes: "Wife mentioned the dining room ceiling has water stains.",
    },
  },
  {
    appointment_time: "13:30:00",
    lead: {
      name: "Maria Garcia",
      phone: "+15551230002",
      email: "maria.g@example.com",
      address: "88 Highland Park Blvd, Lincoln, NE",
      project_type: "Exterior painting",
      status: "Scheduled",
      disc_primary: "I",
      disc_confidence: 0.78,
      widget_low: 450000,
      widget_high: 620000,
      widget_scope: "Full exterior, 2-story, includes power wash",
    },
    booking: {
      city: "Lincoln",
      scope: "Full exterior repaint",
      job_type: "Exterior painting",
      notes: null,
    },
  },
  {
    appointment_time: "16:00:00",
    lead: {
      name: "Tom Reed",
      phone: "+15551230003",
      email: "tom.reed@example.com",
      address: "27 Sherwood Ct, Lincoln, NE",
      project_type: "Cabinet refinishing",
      status: "Scheduled",
      disc_primary: "C",
      disc_confidence: 0.71,
      widget_low: null,
      widget_high: null,
      widget_scope: null,
    },
    booking: {
      city: "Lincoln",
      scope: "Kitchen cabinets, 24 doors",
      job_type: "Cabinet refinishing",
      notes: "Wants to see samples of three finish options.",
    },
  },
];

async function findRep(email) {
  const r = await db.query(
    `SELECT id, tenant_id, email FROM dashboard_users WHERE lower(email) = lower($1) LIMIT 1`,
    [email],
  );
  if (r.rowCount === 0) {
    throw new Error(`No dashboard_users row for email: ${email}`);
  }
  return r.rows[0];
}

async function ensureTechnicianRow(rep) {
  await db.query(
    `INSERT INTO technicians (id, tenant_id, name, email)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (id) DO UPDATE
        SET tenant_id  = EXCLUDED.tenant_id,
            email      = EXCLUDED.email,
            updated_at = now()`,
    [rep.id, rep.tenant_id, rep.email.split("@")[0], rep.email],
  );
}

async function clearPreviousSeed(repId) {
  await db.query(
    `DELETE FROM bookings
      WHERE technician_id = $1
        AND notes LIKE '[SEED:' || $2 || ']%'`,
    [repId, SEED_MARKER],
  );
  await db.query(
    `DELETE FROM leads
      WHERE metadata->>'seed' = $1`,
    [SEED_MARKER],
  );
}

async function insertLead(tenantId, lead) {
  const result = await db.query(
    `INSERT INTO leads (tenant_id, name, phone, email, address, project_type, status,
                         disc_primary, disc_confidence, disc_detected_at,
                         widget_estimate_low_cents, widget_estimate_high_cents,
                         widget_estimate_scope_summary, widget_estimated_at,
                         contact_method, lead_source, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::numeric, now(),
             $10::integer, $11::integer, $12,
             CASE WHEN $10::integer IS NOT NULL THEN now() ELSE NULL END,
             'voice', 'seed', $13::jsonb)
     RETURNING id`,
    [
      tenantId,
      lead.name,
      lead.phone,
      lead.email,
      lead.address,
      lead.project_type,
      lead.status,
      lead.disc_primary,
      lead.disc_confidence,
      lead.widget_low,
      lead.widget_high,
      lead.widget_scope,
      JSON.stringify({ seed: SEED_MARKER }),
    ],
  );
  return result.rows[0].id;
}

async function insertBooking(tenantId, repId, leadId, lead, appointment) {
  const noteTag = `[SEED:${SEED_MARKER}]`;
  const noteBody = appointment.booking.notes
    ? `${noteTag} ${appointment.booking.notes}`
    : noteTag;
  await db.query(
    `INSERT INTO bookings (tenant_id, technician_id, lead_id,
                            contact_name, contact_phone, contact_email,
                            address, city, scope, job_type,
                            preferred_date, appointment_time, status,
                            notes, lead_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
             CURRENT_DATE, $11, 'scheduled', $12, 'seed')`,
    [
      tenantId,
      repId,
      leadId,
      lead.name,
      lead.phone,
      lead.email,
      lead.address,
      appointment.booking.city,
      appointment.booking.scope,
      appointment.booking.job_type,
      appointment.appointment_time,
      noteBody,
    ],
  );
}

async function main() {
  const email = process.argv[2] || "test-rep@demo.aifdh";
  const rep = await findRep(email);

  await ensureTechnicianRow(rep);
  await clearPreviousSeed(rep.id);

  for (const appointment of APPOINTMENTS) {
    const leadId = await insertLead(rep.tenant_id, appointment.lead);
    await insertBooking(rep.tenant_id, rep.id, leadId, appointment.lead, appointment);
  }

  console.log("");
  console.log("Seeded today's appointments for:", rep.email);
  console.log("");
  console.log("Times:");
  for (const a of APPOINTMENTS) {
    const time = a.appointment_time.slice(0, 5);
    const widget = a.lead.widget_low ? " (has widget estimate)" : "";
    console.log(`  ${time}  ${a.lead.name.padEnd(16)} DISC: ${a.lead.disc_primary}${widget}`);
  }
  console.log("");
  console.log("Pull-to-refresh on the Today tab to see them.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

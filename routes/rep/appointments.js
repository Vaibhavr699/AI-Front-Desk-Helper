"use strict";

// ── /api/rep/appointments ──────────────────────────────────────────────────
//   GET /today      — bookings assigned to this rep for today
//   GET /upcoming   — bookings assigned to this rep for the next 7 days
//
// "Assigned to me" = bookings.technician_id = req.rep.id. Tenant-scoped.
// Returns the joined lead summary inline so the home screen can render cards
// without a second round-trip per appointment.
// ────────────────────────────────────────────────────────────────────────────

const express = require("express");
const db = require("../../lib/db");
const { repAuthChain } = require("../../lib/requireRep");

const router = express.Router();

const SELECT_APPOINTMENT = `
  SELECT b.id, b.lead_id, b.preferred_date, b.appointment_time, b.status, b.state,
         b.scope, b.job_type, b.address, b.city, b.notes,
         l.id   AS lead_id_check,
         l.name AS lead_name,
         l.phone AS lead_phone,
         l.email AS lead_email,
         l.address AS lead_address,
         l.project_type,
         l.status AS lead_status,
         l.buyer_persona,
         l.persona_confidence,
         l.disc_primary,
         l.disc_secondary,
         l.disc_confidence,
         l.widget_estimate_low_cents,
         l.widget_estimate_high_cents
    FROM bookings b
    LEFT JOIN leads l ON l.id = b.lead_id
`;

function shape(row) {
  return {
    id: row.id,
    preferred_date: row.preferred_date,
    appointment_time: row.appointment_time,
    status: row.status,
    state: row.state,
    scope: row.scope,
    job_type: row.job_type,
    address: row.address || row.lead_address,
    city: row.city,
    notes: row.notes,
    lead: row.lead_id
      ? {
          id: row.lead_id,
          name: row.lead_name,
          phone: row.lead_phone,
          email: row.lead_email,
          address: row.lead_address,
          project_type: row.project_type,
          status: row.lead_status,
          buyer_persona: row.buyer_persona,
          persona_confidence: row.persona_confidence,
          disc_primary: row.disc_primary,
          disc_secondary: row.disc_secondary,
          disc_confidence: row.disc_confidence != null ? Number(row.disc_confidence) : null,
          has_widget_estimate: row.widget_estimate_low_cents != null,
          widget_estimate_low_cents: row.widget_estimate_low_cents,
          widget_estimate_high_cents: row.widget_estimate_high_cents,
        }
      : null,
  };
}

router.get("/today", ...repAuthChain, async (req, res) => {
  try {
    const r = await db.query(
      `${SELECT_APPOINTMENT}
       WHERE b.tenant_id = $1
         AND b.technician_id = $2
         AND b.preferred_date = CURRENT_DATE
         AND (b.cancelled_at IS NULL)
       ORDER BY b.appointment_time ASC NULLS LAST`,
      [req.rep.tenant_id, req.rep.id]
    );
    res.json({ appointments: r.rows.map(shape) });
  } catch (e) {
    console.error("[rep/appointments/today]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/upcoming", ...repAuthChain, async (req, res) => {
  try {
    const days = Math.min(parseInt(req.query.days, 10) || 7, 30);
    const r = await db.query(
      `${SELECT_APPOINTMENT}
       WHERE b.tenant_id = $1
         AND b.technician_id = $2
         AND b.preferred_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + ($3 || ' days')::interval)::date
         AND (b.cancelled_at IS NULL)
       ORDER BY b.preferred_date ASC, b.appointment_time ASC NULLS LAST`,
      [req.rep.tenant_id, req.rep.id, days]
    );
    res.json({ appointments: r.rows.map(shape), days });
  } catch (e) {
    console.error("[rep/appointments/upcoming]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

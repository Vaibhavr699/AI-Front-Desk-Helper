"use strict";

/**
 * routes/v1.js
 *
 * Phase 13A (Jun 12, 2026) — Agent-Bookable REST API.
 *
 * The machine-to-machine booking surface. External AI agents / partner systems
 * check availability and create bookings here. Both endpoints wrap the SAME
 * lib/bookingEngine that website/SMS/voice already use — an agent booking is a
 * REAL booking, identical underneath: slot check, DB row, lead link, CRM sync,
 * confirmation SMS/email, Google Calendar event, pre-visit briefing.
 *
 *   GET  /api/v1/availability/:tenantId    PUBLIC (no key)  — read open slots
 *   POST /api/v1/booking/:tenantId         KEYED            — create a booking
 *
 * AUTH MODEL (Drew's decision, Jun 12):
 *   - Availability READ is public. It exposes only open time slots — nothing
 *     sensitive — so any agent that found the tenant can immediately see when
 *     they're free. No key required.
 *   - Booking WRITE is keyed. It writes data and fires real SMS/email to a
 *     customer, so it's gated on the tenant's api_key (tenants.api_key, which
 *     already exists and is populated for every tenant). Pass it as either
 *     `Authorization: Bearer <key>` or `x-api-key: <key>`.
 *
 * AGENT BOOKING = REAL BOOKING (Drew's decision, Jun 12):
 *   It routes through bookingEngine.book() exactly like every other channel, so
 *   the booking is logged, the pre-visit briefing runs, the recovery/nurture
 *   sequence is skipped (the lead is already converted), and the full
 *   outcome-chain (call→book→revenue→retention) is preserved. The only new
 *   thing is source: "api" so these are distinguishable in the data later.
 *
 * Phase 13B (the MCP server) will wrap THESE endpoints — it does not re-
 * implement booking. One engine, one REST layer, one MCP layer on top.
 */

const express = require("express");
const router = express.Router();

const bookingEngine = require("../lib/bookingEngine");
const db = require("../lib/db");
const { writeBookingVisibilityRow } = require("../lib/bookingVisibility");

// Same horizon logic as the SMS picker, for the "no date given" availability scan.
const DAY_SCAN_HORIZON = 14;   // look up to 14 days out
const MAX_DAYS_SHOWN   = 7;    // return at most 7 days of openings
const DEFAULT_DURATION_MIN = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function isValidEmail(text) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(text || "").trim());
}

function todayIsoInTz(timezone) {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric", month: "2-digit", day: "2-digit",
    timeZone: timezone || "America/Chicago",
  }).format(new Date());
}

function addDaysIso(isoDate, days) {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

// Resolve a tenant by id. Returns the row or null. Kept minimal — we only need
// id, name, timezone, api_key for this layer.
async function loadTenant(tenantId) {
  if (!tenantId) return null;
  try {
    const { rows } = await db.query(
      `SELECT id, name, timezone, api_key FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId]
    );
    return rows[0] || null;
  } catch (e) {
    console.error("[v1] loadTenant failed id=%s: %s", tenantId, e.message);
    return null;
  }
}

// Pull the api key from either the Authorization: Bearer header or x-api-key.
function extractApiKey(req) {
  const auth = req.get("authorization") || "";
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim();
  const x = req.get("x-api-key");
  if (x) return String(x).trim();
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/availability/:tenantId   — PUBLIC
//
//   ?date=YYYY-MM-DD   (optional) a specific day
//   ?duration=60       (optional) appointment length in minutes
//
// With a date: returns that day's open slots.
// Without a date: scans the next DAY_SCAN_HORIZON days and returns the first
// MAX_DAYS_SHOWN that have openings — lets an agent ask "what's open this week"
// without knowing a specific date.
// ─────────────────────────────────────────────────────────────────────────────

router.get("/availability/:tenantId", async (req, res) => {
  const tenant = await loadTenant(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ ok: false, error: "tenant_not_found" });
  }

  const duration = parseInt(req.query.duration, 10) || DEFAULT_DURATION_MIN;
  const dateParam = (req.query.date || "").trim();

  // Single-day lookup.
  if (dateParam) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return res.status(422).json({ ok: false, error: "invalid_date", detail: "date must be YYYY-MM-DD" });
    }
    let avail;
    try {
      avail = await bookingEngine.getAvailability({
        tenantId: tenant.id,
        date: dateParam,
        durationMinutes: duration,
      });
    } catch (e) {
      console.error("[v1] availability failed tenant=%s date=%s: %s", tenant.id, dateParam, e.message);
      return res.status(502).json({ ok: false, error: "availability_lookup_failed" });
    }
    const slots = (avail && avail.ok && Array.isArray(avail.slots)) ? avail.slots : [];
    console.log("[v1] availability tenant=%s date=%s slots=%d", tenant.id, dateParam, slots.length);
    return res.json({
      ok: true,
      tenant: { id: tenant.id, name: tenant.name },
      date: dateParam,
      duration_minutes: duration,
      slots,
    });
  }

  // Multi-day scan (no specific date requested).
  const tz = tenant.timezone || "America/Chicago";
  const days = [];
  try {
    const start = todayIsoInTz(tz);
    for (let i = 0; i < DAY_SCAN_HORIZON && days.length < MAX_DAYS_SHOWN; i++) {
      const dateIso = addDaysIso(start, i);
      let avail;
      try {
        avail = await bookingEngine.getAvailability({
          tenantId: tenant.id,
          date: dateIso,
          durationMinutes: duration,
        });
      } catch (e) {
        console.error("[v1] scan day failed tenant=%s date=%s: %s", tenant.id, dateIso, e.message);
        continue;
      }
      if (avail && avail.ok && Array.isArray(avail.slots) && avail.slots.length > 0) {
        days.push({ date: dateIso, slots: avail.slots });
      }
    }
  } catch (e) {
    console.error("[v1] availability scan failed tenant=%s: %s", tenant.id, e.message);
    return res.status(502).json({ ok: false, error: "availability_lookup_failed" });
  }

  console.log("[v1] availability scan tenant=%s days=%d", tenant.id, days.length);
  return res.json({
    ok: true,
    tenant: { id: tenant.id, name: tenant.name },
    duration_minutes: duration,
    days,
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/booking/:tenantId   — KEYED
//
// Headers: Authorization: Bearer <api_key>   (or  x-api-key: <api_key>)
// Body:
//   {
//     "date": "YYYY-MM-DD",
//     "time": "<slot value from availability>",
//     "duration_minutes": 60,            (optional)
//     "contact": {
//       "name":    "...",                (required)
//       "phone":   "...",                (required)
//       "email":   "...",                (required)
//       "address": "..."                 (required — same gate as every channel)
//     },
//     "project_type":    "...",          (optional)
//     "project_details": "..."           (optional)
//   }
//
// On success: 200 { ok, booking_id, lead_id, date, time }
// On a slot problem: 409 { ok:false, error:"slot_taken" } etc.
// ─────────────────────────────────────────────────────────────────────────────

router.post("/booking/:tenantId", async (req, res) => {
  const tenant = await loadTenant(req.params.tenantId);
  if (!tenant) {
    return res.status(404).json({ ok: false, error: "tenant_not_found" });
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const key = extractApiKey(req);
  if (!key) {
    return res.status(401).json({ ok: false, error: "missing_api_key", detail: "Provide Authorization: Bearer <key> or x-api-key header" });
  }
  if (!tenant.api_key || key !== tenant.api_key) {
    console.warn("[v1] booking auth failed tenant=%s", tenant.id);
    return res.status(403).json({ ok: false, error: "invalid_api_key" });
  }

  // ── Validate payload ─────────────────────────────────────────────────────────
  const body = req.body || {};
  const date = (body.date || "").trim();
  const time = (body.time || "").toString().trim();
  const contact = body.contact || {};
  const duration = parseInt(body.duration_minutes, 10) || DEFAULT_DURATION_MIN;

  const errors = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("date (YYYY-MM-DD) is required");
  if (!time) errors.push("time is required (use a slot value from /availability)");
  if (!contact.name || !String(contact.name).trim())    errors.push("contact.name is required");
  if (!contact.phone || !String(contact.phone).trim())  errors.push("contact.phone is required");
  if (!isValidEmail(contact.email))                     errors.push("contact.email must be a valid email");
  if (!contact.address || String(contact.address).trim().length < 5) errors.push("contact.address is required");

  if (errors.length) {
    return res.status(422).json({ ok: false, error: "validation_failed", details: errors });
  }

  // ── Book through the shared engine (agent booking = real booking) ────────────
  // estimated_value (optional, dollars): if the agent supplies a quote value,
  // pass it through so the booking persists with real revenue instead of the
  // engine's $250 default. Omitted → engine default. Same param PR7 added for
  // voice; surfacing it here keeps agent bookings from under-counting revenue.
  const numericEstimate = Number(body.estimated_value);
  const estimatedValue = (Number.isFinite(numericEstimate) && numericEstimate > 0) ? numericEstimate : null;

  let result;
  try {
    result = await bookingEngine.book({
      tenantId: tenant.id,
      date,
      time,
      durationMinutes: duration,
      contact: {
        name: String(contact.name).slice(0, 120),
        phone: String(contact.phone).trim(),
        email: String(contact.email).trim(),
        address: String(contact.address).slice(0, 240),
      },
      projectType: body.project_type || "",
      projectDetails: body.project_details || "",
      leadId: null,            // engine find-or-creates the lead from contact.phone
      source: "api",           // tag agent-layer bookings distinctly
      estimatedValue,          // optional; null → engine $250 default
    });
  } catch (e) {
    console.error("[v1] engine.book threw tenant=%s: %s", tenant.id, e.message);
    return res.status(502).json({ ok: false, error: "booking_failed" });
  }

  if (!result || !result.ok) {
    const reason = result?.reason || "booking_failed";
    // Map engine reasons to sensible HTTP codes so the calling agent can react.
    //   409 — the slot was taken between availability lookup and booking
    //   422 — the request was understood but can't be fulfilled as-is
    //         (closed day, out of hours, bad date/time, missing contact)
    //   502 — something went wrong on our side (create_failed, unknown)
    const code = (reason === "slot_taken") ? 409
               : (reason === "day_closed"
                  || reason === "outside_business_hours"
                  || reason === "invalid_datetime"
                  || reason === "missing_contact") ? 422
               : 502;
    console.warn("[v1] booking rejected tenant=%s reason=%s", tenant.id, reason);
    return res.status(code).json({ ok: false, error: reason, message: result?.message });
  }

  console.log("[v1] BOOKED via API tenant=%s bookingId=%s date=%s time=%s", tenant.id, result.bookingId, date, time);

  writeBookingVisibilityRow({
    tenantId: tenant.id,
    leadId: result.leadId,
    bookingId: result.bookingId,
    date, time,
    contactName: String(contact.name).slice(0, 120),
    projectType: body.project_type || "",
    source: "api",
  });

  return res.json({
    ok: true,
    booking_id: result.bookingId,
    lead_id: result.leadId,
    date,
    time,
    tenant: { id: tenant.id, name: tenant.name },
  });
});

module.exports = router;

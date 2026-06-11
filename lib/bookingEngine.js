"use strict";

// ============================================================================
// lib/bookingEngine.js  —  Phase 12 KEYSTONE (May 28, 2026)
// ============================================================================
// One channel-agnostic booking service. Every surface that needs to quote,
// check availability, or book an appointment calls these four functions:
//
//     getQuote({ tenantId, serviceSlug, inputs })
//     getAvailability({ tenantId, date, durationMinutes })
//     checkSlot({ tenantId, date, time, durationMinutes })
//     book({ tenantId, date, time, durationMinutes, contact, projectType,
//            projectDetails, leadId?, source, callId?, estimatedValue? })
//
// They are PURE in the sense that matters: plain data in, structured result
// out. No `req`, no in-memory SMS `thread`, no WebSocket. That is what makes
// them callable by:
//   - the SMS orchestrator (handleLeadBooking shrinks to a thin adapter)
//   - the voice WebSocket tools (check_availability / book_appointment)
//   - the estimator widget (gains real slot-booking)
//   - Phase 13's agent-bookable API (a thin wrapper over these four)
//   - future RCS / WhatsApp / IG DM surfaces
//
// ── Why this exists ─────────────────────────────────────────────────────────
// Before this module, the booking capability was duplicated and divergent:
//   * server.js had getAvailableSlots/checkAvailability/bookAppointment
//     (offset-aware, correct tz handling, but hardcoded 8–5 hours)
//   * calendar.js had a SECOND getAvailableSlots/checkAvailability
//     (per-day business_hours aware, but naive datetime strings; its
//     checkAvailability also shipped a live ReferenceError that silently
//     failed open and double-booked against Google-only events — hotfixed
//     May 28)
//   * booking only ever fired as a side effect of runSmsAiOrchestrator or
//     the voice tool handler — there was no callable entry point
//
// This module is the consolidation. For each capability it takes the
// strongest existing implementation and unifies:
//   getAvailability → server.js offset-aware windows + calendar.js per-day
//                     business_hours (best of both)
//   checkSlot       → server.js offset-aware buildAppointmentWindow
//                     (retires the weaker calendar.checkAvailability)
//   book            → bookingsService.createBooking + calendar.syncToGoogleCalendar,
//                     mirroring the proven voice book_appointment sequence
//
// ── Cents / dollars ─────────────────────────────────────────────────────────
// getQuote passes lib/estimator.calculateRange output straight through
// (range_min_cents / range_max_cents / specialized). No conversion here.
//
// book() accepts estimatedValue in DOLLARS as a top-level param (AI's
// extracted lead value). It hands that to createBooking as estimated_value,
// which normalizeBookingData converts to cents. If estimatedValue is null
// or zero, normalizeBookingData falls back to its $250 default.
//
// ── Error philosophy ────────────────────────────────────────────────────────
// Every function returns a structured object; none throw on the normal
// "couldn't do it" paths (slot taken, calendar not configured, bad input).
// They reserve throwing for genuinely exceptional cases, and book() wraps
// the DB write so a calendar failure never loses the booking. Callers branch
// on the returned { ok, reason } — same contract for every channel.
// ============================================================================

const db = require("./db");
const estimator = require("./estimator");
const calendar = require("../calendar");
const bookingsService = require("../services/bookings");
const leadsService = require("../services/leads");
const { getTenantById } = require("./tenant");

const DEFAULT_TZ = process.env.BUSINESS_TIMEZONE || "America/Chicago";
const DEFAULT_CALENDAR_ID = process.env.GOOGLE_CALENDAR_ID || "primary";
const DEFAULT_DURATION_MIN = 60;

// ─────────────────────────────────────────────────────────────────────────────
// Time helpers — lifted verbatim from server.js so the engine builds the SAME
// offset-aware windows the (correct) SMS path used. Kept private to this module.
// ─────────────────────────────────────────────────────────────────────────────

function normalizeTimeString(timeValue) {
  const raw = String(timeValue || "").trim();
  if (!raw) return "";

  const ampmMatch = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*([ap]m)$/i);
  if (ampmMatch) {
    let hour = Number(ampmMatch[1]);
    const minutes = Number(ampmMatch[2] || "0");
    const suffix = ampmMatch[3].toLowerCase();
    if (suffix === "pm" && hour < 12) hour += 12;
    if (suffix === "am" && hour === 12) hour = 0;
    if (hour >= 0 && hour < 24 && minutes >= 0 && minutes < 60) {
      return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
    }
  }

  const twentyFourHourMatch = raw.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (twentyFourHourMatch) {
    const hour = Number(twentyFourHourMatch[1]);
    const minutes = Number(twentyFourHourMatch[2]);
    const seconds = Number(twentyFourHourMatch[3] || "0");
    if (hour >= 0 && hour < 24 && minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60) {
      return `${String(hour).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    }
  }

  return "";
}

function getTzOffsetString(timeZone, dateStr) {
  try {
    const dateToCheck = new Date(dateStr + "T12:00:00Z"); // Midday UTC to avoid edge cases
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" }).formatToParts(dateToCheck);
    const o = parts.find((p) => p.type === "timeZoneName").value;

    if (o === "GMT") return "Z";
    let offset = o.replace("GMT", "");
    if (!offset.includes(":")) {
      const sign = offset[0];
      const hours = offset.slice(1).padStart(2, "0");
      return `${sign}${hours}:00`;
    } else {
      const sign = offset[0];
      let [hours, mins] = offset.slice(1).split(":");
      hours = hours.padStart(2, "0");
      return `${sign}${hours}:${mins}`;
    }
  } catch (e) {
    return "Z";
  }
}

function buildAppointmentWindow(dateValue, timeValue, durationMinutes, timeZone) {
  const normalizedDate = String(dateValue || "").trim();
  const normalizedTime = normalizeTimeString(timeValue);
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MIN;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate) || !normalizedTime) {
    return null;
  }

  const offset = getTzOffsetString(timeZone, normalizedDate);
  const start = new Date(`${normalizedDate}T${normalizedTime}${offset}`);
  if (Number.isNaN(start.getTime())) return null;

  const end = new Date(start.getTime() + duration * 60 * 1000);
  return { start, end, offset, normalizedTime };
}

/** Resolve a tenant row from an id, tolerating either an id string or a hydrated object. */
async function resolveTenant(tenantOrId) {
  if (tenantOrId && typeof tenantOrId === "object" && tenantOrId.id) return tenantOrId;
  if (typeof tenantOrId === "string") return getTenantById(tenantOrId);
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Business-hours fit check. Shared by checkSlot (booking guard) and available
// to getAvailability's slot generation. Reads the same per-day business_hours
// shape getAvailability uses: tenant.business_hours[dayName] = { open:"08:00",
// close:"17:00", closed:false }, defaulting to 8–5 open when unset.
//
// Returns one of:
//   { ok:true }                                  — fits inside open hours
//   { ok:false, reason:"day_closed" }            — that weekday is closed
//   { ok:false, reason:"outside_business_hours", open, close }
//                                                — start before open OR end after close
//   { ok:false, reason:"invalid_datetime" }      — couldn't parse date/time
//
// The check is on the LOCAL wall-clock window (open/close are wall-clock in the
// tenant's tz), so we compare the normalized HH:MM:SS against open/close minutes
// directly rather than against UTC instants — no tz math needed, and it can't
// drift across DST the way instant math can.
function checkBusinessHoursFit(tenant, date, time, durationMinutes) {
  const normalizedTime = normalizeTimeString(time);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) || !normalizedTime) {
    return { ok: false, reason: "invalid_datetime" };
  }

  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const [year, month, day] = date.split("-").map(Number);
  const dayName = days[new Date(year, month - 1, day).getDay()];
  const bh = (tenant.business_hours && tenant.business_hours[dayName]) || { open: "08:00", close: "17:00", closed: false };

  if (bh.closed) return { ok: false, reason: "day_closed" };

  const toMinutes = (hhmm) => {
    const [h, m] = String(hhmm).split(":").map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };

  const openMin = toMinutes(bh.open || "08:00");
  const closeMin = toMinutes(bh.close || "17:00");

  const [sh, sm] = normalizedTime.split(":").map(Number);
  const startMin = sh * 60 + sm;
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MIN;
  const endMin = startMin + duration;

  // Appointment must START at/after open AND END at/before close.
  if (startMin < openMin || endMin > closeMin) {
    return { ok: false, reason: "outside_business_hours", open: bh.open || "08:00", close: bh.close || "17:00" };
  }
  return { ok: true };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1) getQuote — price range for a scoped project
// ═════════════════════════════════════════════════════════════════════════════
//
// Thin wrapper over lib/estimator. Validates inputs, then returns calculateRange
// output verbatim. Shape is either:
//   { range_min_cents, range_max_cents, ...breakdown }   (real quote)
//   { specialized: true, reason, trigger }                (needs walkthrough)
//
// Returns { ok:false, reason:'invalid_inputs', validationErrors } on bad input
// so callers (widget, agent API) get a structured failure instead of a throw.
async function getQuote({ tenantId, serviceSlug, inputs }) {
  if (!tenantId || !serviceSlug) {
    return { ok: false, reason: "missing_params", message: "tenantId and serviceSlug are required" };
  }

  const validation = estimator.validateInputs(serviceSlug, inputs || {});
  if (!validation.valid) {
    return { ok: false, reason: "invalid_inputs", validationErrors: validation.errors };
  }

  try {
    const result = await estimator.calculateRange(tenantId, serviceSlug, inputs || {});
    return { ok: true, quote: result };
  } catch (e) {
    console.error("[bookingEngine.getQuote] error tenant=%s service=%s: %s", tenantId, serviceSlug, e.message);
    return { ok: false, reason: "quote_error", message: e.message };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 2) getAvailability — open 60-min slots for a given day
// ═════════════════════════════════════════════════════════════════════════════
//
// Consolidated implementation:
//   - per-day business_hours (from calendar.js) — honors closed days + custom
//     open/close, falling back to 8–5 when unset
//   - offset-aware freebusy windows (from server.js getTzOffsetString) — so
//     Google times are compared in the tenant's real timezone, not naive
//   - merges Google busy + local non-cancelled bookings, same as both legacy
//     impls did
//
// Returns:
//   { ok:true, date, slots:[{ time, value }], calendarConfigured }
//     - time  = display string ("9:00 AM")
//     - value = 24h normalized ("09:00:00") for machine callers (agent API)
//   { ok:true, date, slots:[], closed:true }   when the day is a closed day
//
// Never throws — on calendar error returns slots computed from local DB only,
// flagged calendarConfigured:false so callers know Google wasn't consulted.
async function getAvailability({ tenantId, date, durationMinutes }) {
  const tenant = await resolveTenant(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))) {
    return { ok: false, reason: "invalid_date", message: "date must be YYYY-MM-DD" };
  }

  const tz = tenant.timezone || DEFAULT_TZ;
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MIN;
  const durationMs = duration * 60 * 1000;

  // ── per-day business hours (calendar.js behavior) ───────────────────────
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  const [year, month, day] = date.split("-").map(Number);
  const dayName = days[new Date(year, month - 1, day).getDay()];
  const bh = (tenant.business_hours && tenant.business_hours[dayName]) || { open: "08:00", close: "17:00", closed: false };
  if (bh.closed) {
    return { ok: true, date, slots: [], closed: true, calendarConfigured: Boolean(calendar.getCalendarForTenant(tenant)) };
  }
  const [openH, openM] = String(bh.open || "08:00").split(":").map(Number);
  const [closeH, closeM] = String(bh.close || "17:00").split(":").map(Number);

  const offset = getTzOffsetString(tz, date);
  const startOfDay = new Date(`${date}T${String(openH).padStart(2, "0")}:${String(openM).padStart(2, "0")}:00${offset}`);
  const endOfDay = new Date(`${date}T${String(closeH).padStart(2, "0")}:${String(closeM).padStart(2, "0")}:00${offset}`);
  if (Number.isNaN(startOfDay.getTime()) || Number.isNaN(endOfDay.getTime())) {
    return { ok: false, reason: "invalid_window" };
  }

  const busy = [];
  let calendarConfigured = false;

  // ── Google busy (offset-aware freebusy) ─────────────────────────────────
  const cal = calendar.getCalendarForTenant(tenant);
  if (cal) {
    calendarConfigured = true;
    try {
      const calendarId = tenant.google_calendar_id || DEFAULT_CALENDAR_ID;
      const fb = await cal.freebusy.query({
        requestBody: {
          timeMin: startOfDay.toISOString(),
          timeMax: endOfDay.toISOString(),
          timeZone: tz,
          items: [{ id: calendarId }],
        },
      });
      (fb.data.calendars[calendarId].busy || []).forEach((b) => {
        busy.push({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() });
      });
    } catch (e) {
      console.error("[bookingEngine.getAvailability] freebusy failed date=%s tenant=%s: %s", date, tenant.id, e.message);
      calendarConfigured = false; // computed from local DB only
    }
  }

  // ── Local DB busy ───────────────────────────────────────────────────────
  try {
    const dbRes = await db.query(
      "SELECT appointment_time FROM bookings WHERE tenant_id = $1 AND preferred_date = $2 AND status != 'Cancelled'",
      [tenant.id, date]
    );
    dbRes.rows.forEach((row) => {
      const t = normalizeTimeString(row.appointment_time);
      if (!t) return;
      const s = new Date(`${date}T${t}${offset}`).getTime();
      if (!Number.isNaN(s)) busy.push({ start: s, end: s + durationMs });
    });
  } catch (e) {
    console.error("[bookingEngine.getAvailability] local busy fetch failed date=%s tenant=%s: %s", date, tenant.id, e.message);
  }

  // ── Minimum booking notice (Jun 11, 2026) ───────────────────────────────
  // Hide any slot sooner than now + the tenant's required lead time (default
  // 24h). slotStart below is an absolute instant (offset-aware), so this
  // comparison is correct across timezones and DST — no wall-clock math.
  // This is the single chokepoint every channel reads, so SMS/FB menu,
  // website widget, and voice availability all inherit the rule.
  const noticeHours = Number.isFinite(Number(tenant.min_booking_notice_hours))
    ? Number(tenant.min_booking_notice_hours)
    : 24;
  const earliestBookable = Date.now() + noticeHours * 60 * 60 * 1000;

  // ── Generate hourly slots within business hours, drop any overlapping busy ─
  const slots = [];
  for (let h = openH; h < closeH; h++) {
    const slotStart = new Date(`${date}T${String(h).padStart(2, "0")}:00:00${offset}`).getTime();
    const slotEnd = slotStart + durationMs;
    if (slotStart < earliestBookable) continue;   // too soon — needs more notice
    const overlaps = busy.some((b) => slotStart < b.end && slotEnd > b.start);
    if (!overlaps) {
      const displayH = h % 12 || 12;
      const ampm = h >= 12 ? "PM" : "AM";
      slots.push({ time: `${displayH}:00 ${ampm}`, value: `${String(h).padStart(2, "0")}:00:00` });
    }
  }

  return { ok: true, date, slots, calendarConfigured };
}

// ═════════════════════════════════════════════════════════════════════════════
// 3) checkSlot — is this exact date+time free?
// ═════════════════════════════════════════════════════════════════════════════
//
// server.js checkAvailability logic, offset-aware. Local DB first (fast, always
// available), then Google freebusy for the exact window.
//
// Returns:
//   { ok:true, available:true|false, reason? }
//   { ok:true, available:true, reason:'calendar_not_configured' }  (book anyway)
//   { ok:false, reason:'invalid_datetime' }
//
// On a Google error it fails SAFE-OPEN (available:true, reason:'calendar_error')
// — same as the legacy server.js behavior — so a Google hiccup doesn't block a
// booking. The local-DB check above still catches same-system double-books.
async function checkSlot({ tenantId, date, time, durationMinutes }) {
  const tenant = await resolveTenant(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const tz = tenant.timezone || DEFAULT_TZ;
  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MIN;

  // 0. Business-hours guard. Runs FIRST — before any DB or Google call — so an
  //    out-of-hours request (e.g. a voice/SMS caller who said "7 PM" when the
  //    shop closes at 5) is rejected immediately, regardless of whether the
  //    calendar happens to be free then. The widget can't hit this (its slot
  //    list is already hours-bounded), but voice/SMS take a model-proposed
  //    time, so this is the enforcement chokepoint for every channel.
  const hours = checkBusinessHoursFit(tenant, date, time, duration);
  if (!hours.ok) {
    if (hours.reason === "invalid_datetime") {
      return { ok: false, reason: "invalid_datetime", message: "Use date (YYYY-MM-DD) and time (HH:MM or 1:30 PM)." };
    }
    if (hours.reason === "day_closed") {
      return { ok: true, available: false, reason: "day_closed", message: "We're closed that day." };
    }
    // outside_business_hours
    return {
      ok: true,
      available: false,
      reason: "outside_business_hours",
      open: hours.open,
      close: hours.close,
      message: `That time is outside business hours (${hours.open}–${hours.close}).`,
    };
  }

  // 1. Local DB conflict check — ±59 min window around the requested time.
  try {
    const localRes = await db.query(
      `SELECT id FROM bookings
        WHERE tenant_id = $1
          AND preferred_date = $2
          AND status != 'Cancelled'
          AND appointment_time >= ($3::time - interval '59 minutes')
          AND appointment_time <= ($3::time + interval '59 minutes')`,
      [tenant.id, date, normalizeTimeString(time)]
    );
    if (localRes.rows.length > 0) {
      return { ok: true, available: false, reason: "busy_local" };
    }
  } catch (e) {
    console.error("[bookingEngine.checkSlot] local check failed: %s", e.message);
    // continue to Google check
  }

  const cal = calendar.getCalendarForTenant(tenant);
  if (!cal) return { ok: true, available: true, reason: "calendar_not_configured" };

  const window = buildAppointmentWindow(date, time, duration, tz);
  if (!window) {
    return { ok: false, reason: "invalid_datetime", message: "Use date (YYYY-MM-DD) and time (HH:MM or 1:30 PM)." };
  }

  const calendarId = tenant.google_calendar_id || DEFAULT_CALENDAR_ID;
  try {
    const response = await cal.freebusy.query({
      requestBody: {
        timeMin: window.start.toISOString(),
        timeMax: window.end.toISOString(),
        timeZone: tz,
        items: [{ id: calendarId }],
      },
    });
    const busy = response?.data?.calendars?.[calendarId]?.busy || [];

    // Clear any stored calendar error on success (parity with server.js).
    if (tenant.google_calendar_error) {
      db.query("UPDATE tenants SET google_calendar_error = NULL WHERE id = $1", [tenant.id]).catch(() => {});
    }

    return { ok: true, available: busy.length === 0, busySlots: busy };
  } catch (err) {
    const errMsg = err.message || String(err);
    console.error("[bookingEngine.checkSlot] freebusy failed tenant=%s: %s", tenant.id, errMsg);
    if (errMsg.includes("invalid_grant")) {
      db.query("UPDATE tenants SET google_calendar_error = 'invalid_grant' WHERE id = $1", [tenant.id]).catch(() => {});
    }
    if (errMsg.includes("unregistered callers")) {
      return { ok: true, available: true, reason: "calendar_not_configured" };
    }
    // Fail safe-open — don't block bookings on a Google hiccup.
    return { ok: true, available: true, reason: "calendar_error", message: errMsg };
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// 4) book — the keystone of the keystone
// ═════════════════════════════════════════════════════════════════════════════
//
// Composes the proven voice book_appointment sequence, callable without a
// WebSocket:
//   1. checkSlot — refuse if taken (unless calendar isn't configured)
//   2. bookingsService.createBooking — DB row + lead link + CRM sync +
//      confirmation SMS/email + notifications + recovery conversion
//      (this is the heavy, battle-tested chain; we do NOT reimplement it)
//   3. calendar.syncToGoogleCalendar — Google event (fire-and-forget; a
//      calendar failure must never lose a booking that's already in the DB)
//
// contact = { name, phone, email?, address?, city?, state? }
//
// estimatedValue: PR 7 (May 29, 2026). AI's extracted lead value in dollars
// (e.g. 1000 for $1000 interior painting). Passed through to createBooking
// as estimated_value, which normalizeBookingData converts to cents on insert.
// If omitted, normalizeBookingData falls back to its $250 default. Before
// PR 7, this param did not exist — every voice-booked job persisted as $250
// regardless of what the AI extracted from the call. Fixed by surfacing AI's
// value as the ground truth for revenue forecasting + dashboard tiles.
//
// Returns:
//   { ok:true, bookingId, leadId, eventId, confirmationText }
//   { ok:false, reason:'slot_taken' | 'invalid_datetime' | 'missing_contact'
//               | 'create_failed', message }
//
// leadId: if the caller already resolved a lead (SMS thread, voice handshake),
// pass it and createBooking links it. If omitted, createBooking's own
// belt-and-suspenders path find-or-creates a lead from contact.phone (now
// reliable post lead-linking fix), so book() works even when the caller has
// no lead yet (e.g. the widget, or the agent API).
async function book({
  tenantId,
  date,
  time,
  durationMinutes,
  contact = {},
  projectType,
  projectDetails,
  leadId = null,
  source = "booking_engine",
  callId = null,
  estimatedValue = null,
}) {
  const tenant = await resolveTenant(tenantId);
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const name = contact.name || contact.full_name || "New Lead";
  const phone = contact.phone || null;
  if (!phone) {
    return { ok: false, reason: "missing_contact", message: "contact.phone is required to book" };
  }

  const duration = Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MIN;

  // Normalize the time to canonical HH:MM:SS ("2 PM" -> "14:00:00") BEFORE it
  // ever reaches createBooking, whose appointment_time column is Postgres
  // `time` and rejects free-form strings ("invalid input syntax for type
  // time: \"2 PM\""). Both voice and SMS hand the engine model-generated
  // free-form times, so this is the right chokepoint. If the value can't be
  // parsed, bail as invalid_datetime instead of throwing a create_failed at
  // insert time.
  const normalizedTime = normalizeTimeString(time);
  if (!normalizedTime) {
    return { ok: false, reason: "invalid_datetime", message: "Use time as HH:MM or 1:30 PM." };
  }

  // 1. Slot check. calendar_not_configured / calendar_error both proceed
  //    (book anyway) — matches the SMS path's isAvailable logic. Only a
  //    definitive busy result blocks.
  const slot = await checkSlot({ tenantId: tenant.id, date, time: normalizedTime, durationMinutes: duration });
  if (!slot.ok && slot.reason === "invalid_datetime") {
    return { ok: false, reason: "invalid_datetime", message: slot.message };
  }
  // Business-hours rejections from checkSlot — surface with their own reason so
  // the caller (voice/SMS) can say "we're open 8–5, want a time in that window?"
  // rather than the misleading "that time is no longer available."
  if (slot.reason === "day_closed") {
    return { ok: false, reason: "day_closed", message: slot.message || "We're closed that day." };
  }
  if (slot.reason === "outside_business_hours") {
    return {
      ok: false,
      reason: "outside_business_hours",
      open: slot.open,
      close: slot.close,
      message: slot.message || "That time is outside business hours.",
    };
  }
  const proceedDespite = slot.reason === "calendar_not_configured" || slot.reason === "calendar_error";
  if (slot.ok && slot.available === false && !proceedDespite) {
    return { ok: false, reason: "slot_taken", message: "That time is no longer available." };
  }

  // PR 7 (May 29, 2026): build createBooking payload. estimated_value is
  // passed through only when the caller (voice/SMS/widget) provided a
  // value > 0 — leaving the key unset lets normalizeBookingData fall back
  // to its $250 default rather than overriding it with null/0/nonsense.
  const createPayload = {
    contact_name: name,
    contact_phone: phone,
    contact_email: contact.email || "",
    address: contact.address || "",
    city: contact.city || "",
    state: contact.state || "",
    scope: projectType || "",
    job_type: (projectType && String(projectType).trim()) || "Residential",
    preferred_date: date,
    appointment_time: normalizedTime,
    notes: projectDetails || "",
  };
  const numericEstimate = Number(estimatedValue);
  if (Number.isFinite(numericEstimate) && numericEstimate > 0) {
    createPayload.estimated_value = numericEstimate;
  }

  // 2. DB row + the whole createBooking chain. This is the source of truth;
  //    if it throws, nothing was booked and we surface create_failed.
  let booking;
  let crmSynced = false;
  try {
    const created = await bookingsService.createBooking(
      tenant.id,
      callId,
      createPayload,
      leadId,
      source
    );
    booking = created.booking;
    crmSynced = created.crmSynced;
  } catch (e) {
    console.error("[bookingEngine.book] createBooking failed tenant=%s: %s", tenant.id, e.message);
    // createBooking throws "This time slot is no longer available" from its
    // own final availability check — surface that as slot_taken, not a
    // generic failure, so the caller can offer alternatives.
    if (/no longer available/i.test(e.message)) {
      return { ok: false, reason: "slot_taken", message: "That time is no longer available." };
    }
    return { ok: false, reason: "create_failed", message: e.message };
  }

  // 3. Google event — fire-and-forget. The booking already exists in the DB
  //    and createBooking already sent the customer confirmation; a calendar
  //    write failure must not fail the booking or change what we return.
  let eventId = null;
  try {
    const ev = await calendar.syncToGoogleCalendar(booking, tenant);
    eventId = ev?.id || null;
  } catch (e) {
    console.error("[bookingEngine.book] syncToGoogleCalendar failed bookingId=%s: %s", booking.id, e.message);
  }

  // 4. Flip the lead to Booked if we have one (createBooking links it, but
  //    its status flip only runs on the belt-and-suspenders path; do it here
  //    too so the happy path — caller passed leadId — also flips status).
  const finalLeadId = booking.lead_id || leadId || null;
  if (finalLeadId) {
    leadsService.updateLeadStatus(finalLeadId, "Booked").catch((e) =>
      console.error("[bookingEngine.book] lead status flip failed leadId=%s: %s", finalLeadId, e.message)
    );
  }

  const confirmationText = `You are booked for ${date} at ${time}.`;
  return {
    ok: true,
    bookingId: booking.id,
    leadId: finalLeadId,
    eventId,
    crmSynced,
    confirmationText,
  };
}

module.exports = {
  getQuote,
  getAvailability,
  checkSlot,
  book,
  // exported for unit tests / adapters that need the same time normalization
  _internal: { normalizeTimeString, getTzOffsetString, buildAppointmentWindow },
};

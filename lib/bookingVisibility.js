"use strict";

/**
 * lib/bookingVisibility.js
 *
 * Phase 13 follow-up (Jun 15, 2026).
 *
 * The ONE thing routes/booking.js (the widget path) does that bookingEngine.book()
 * does NOT: write a `channel='website'` summary row to `messages` so the booking
 * surfaces as a thread in the Conversations tab. Everything else a booking needs
 * — CRM sync, owner notify, confirmation SMS/email, push, lead link — already
 * happens inside the engine's createBooking, so the REST API (13A), MCP server
 * (13B), and public page (13.5) all get those by calling book() directly.
 *
 * Without this row, an agent/API/public booking exists in `bookings`, syncs to
 * CRM, and fires notifications, but never appears as a CONVERSATION thread (that
 * view is built from `messages`). This helper closes that single gap by writing
 * the same AI-authored outbound summary row routes/booking.js writes, so all
 * booking surfaces surface identically.
 *
 * Fire-and-forget by contract: a visibility-row failure must NEVER fail a
 * booking that already succeeded. Callers don't await the result for control
 * flow — they pass the booking result and move on.
 */

const db = require("./db");

/**
 * Write the website-visibility summary message for a completed booking.
 *
 * @param {object} args
 * @param {string} args.tenantId
 * @param {string} args.leadId        - the booked lead (result.leadId)
 * @param {string} args.bookingId     - result.bookingId
 * @param {string} args.date          - "YYYY-MM-DD"
 * @param {string} args.time          - slot value/time as booked
 * @param {string} [args.contactName] - for "Booked under X"
 * @param {string} [args.projectType]
 * @param {string} args.source        - "api" | "mcp" | "public_page"
 * @returns {Promise<void>} resolves always; logs and swallows errors.
 */
async function writeBookingVisibilityRow({
  tenantId,
  leadId,
  bookingId,
  date,
  time,
  contactName,
  projectType,
  source,
}) {
  if (!tenantId || !leadId) {
    // No lead → nothing to attach a thread to. Not an error; just skip.
    return;
  }

  const parts = [`Appointment booked for ${date} at ${time}`, projectType ? `(${projectType})` : null].filter(Boolean);
  const body = `${parts.join(" ")}.${contactName && contactName !== "New Lead" ? ` Booked under ${contactName}.` : ""}`;

  try {
    await db.query(
      `INSERT INTO messages (tenant_id, lead_id, channel, direction, body, metadata)
       VALUES ($1, $2, 'website', 'outbound', $3, $4::jsonb)`,
      [
        tenantId,
        leadId,
        body,
        JSON.stringify({
          system_generated: true,
          booking_id: bookingId || null,
          source: source || "agent",
        }),
      ]
    );
  } catch (e) {
    console.error("[bookingVisibility] insert failed (non-fatal) tenant=%s lead=%s: %s", tenantId, leadId, e.message);
  }
}

module.exports = { writeBookingVisibilityRow };

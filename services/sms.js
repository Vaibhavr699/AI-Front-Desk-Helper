"use strict";

/**
 * services/sms.js
 *
 * Customer-facing transactional SMS messages.
 *
 * Phase 2 Cancellation Flow (May 4, 2026): sendBookingCancellationSms.
 *
 * Pattern: each function takes a booking and a tenant, looks up the tenant's
 * primary phone number from phone_numbers, sends via Twilio, and updates an
 * audit column on the booking row. All functions are fire-and-forget — they
 * never throw, so callers don't need a try/catch.
 *
 * Why a dedicated service file (instead of folding into crm.js or
 * notifications.js): customer SMS is a separate concern from CRM webhooks
 * and from in-app bell notifications. Keeping it here means future
 * transactional SMS (reschedule confirmation, day-of reminder, etc.) can
 * land alongside cancellation without bloating other files.
 */

const db = require("../lib/db");
const twilio = require("../lib/twilio");

/**
 * Format a YYYY-MM-DD or full ISO date string as a friendly natural-language
 * phrase like "Friday, May 15th". Used in the SMS body so the customer
 * immediately recognizes which appointment was cancelled.
 *
 * Falls back to "your scheduled" if the date is missing or unparseable —
 * matching the "your scheduled appointment has been cancelled" phrasing
 * works when there's no concrete date.
 */
function formatFriendlyDate(dateValue) {
  if (!dateValue) return "your scheduled";
  try {
    // Handle both YYYY-MM-DD (date-only) and full ISO timestamps.
    // The Bookings.jsx page uses the same trick — appending T00:00:00 to
    // date-only strings prevents JS from interpreting them as UTC midnight
    // and shifting the displayed date by a day in negative timezones.
    const dateStr = typeof dateValue === "string" && !dateValue.includes("T")
      ? `${dateValue}T00:00:00`
      : dateValue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "your scheduled";

    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    const month   = d.toLocaleDateString("en-US", { month: "long" });
    const day     = d.getDate();

    // Ordinal suffix (1st, 2nd, 3rd, 4th...). Special-case 11/12/13.
    const suffix = (n) => {
      if (n >= 11 && n <= 13) return "th";
      switch (n % 10) {
        case 1:  return "st";
        case 2:  return "nd";
        case 3:  return "rd";
        default: return "th";
      }
    };

    return `${weekday}, ${month} ${day}${suffix(day)}`;
  } catch (e) {
    return "your scheduled";
  }
}

/**
 * Extract first name from a full name string. Falls back to "there" so the
 * SMS doesn't read awkwardly when contact_name is missing.
 * Mirrors estimateRecovery.getFirstName.
 */
function getFirstName(fullName) {
  if (!fullName || typeof fullName !== "string") return "there";
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || "there";
}

/**
 * Look up the tenant's primary phone number for outbound SMS. This is both
 * the From: and the callback number we embed in the message body so the
 * customer can call/reply to the same line they already have saved.
 *
 * Ordering rule mirrors estimateRecovery.executeStep:
 *   primary first, then oldest. Guarantees a stable choice even if no
 *   number is flagged is_primary.
 */
async function getTenantPrimaryPhone(tenantId) {
  const res = await db.query(
    `SELECT phone FROM phone_numbers
      WHERE tenant_id = $1
      ORDER BY is_primary DESC NULLS LAST, created_at ASC
      LIMIT 1`,
    [tenantId]
  );
  return res.rows[0]?.phone || null;
}

/**
 * Send the customer a transactional SMS confirming their booking has been
 * cancelled. Fire-and-forget — never throws. Updates
 * bookings.cancellation_sms_sent_at on success.
 *
 * Phase 2 Cancellation Flow (May 4, 2026).
 *
 * Why this function never throws: it's called from cancelBooking() after
 * the booking row has already been updated to status='Cancelled'. If SMS
 * fails, the cancellation itself must still succeed — the customer's
 * appointment is already off the books, so a failed SMS is just a missed
 * notification, not a data integrity problem.
 *
 * Skip cases (return { ok: false, skipped: <reason> }):
 *   - missing tenant or booking
 *   - booking has no contact_phone
 *   - tenant has no Twilio credentials
 *   - tenant has no primary phone configured
 *
 * The cancellation_reason from the dashboard textarea is intentionally NOT
 * surfaced to the customer — reasons are often candid internal notes
 * ("customer was rude", "double-booked"). If Drew wants to share context,
 * he can send a follow-up message manually.
 *
 * @param {object} tenant  - Tenant row (must have id, company_name OR name)
 * @param {object} booking - Booking row (must have id, contact_phone,
 *                           contact_name, preferred_date)
 * @returns {Promise<{ok: boolean, sid?: string, error?: string, skipped?: string}>}
 */
async function sendBookingCancellationSms(tenant, booking) {
  if (!tenant || !booking) {
    console.warn("[SMS Cancel] Missing tenant or booking, skipping");
    return { ok: false, skipped: "missing_args" };
  }

  // Skip silently if no customer phone — common for legacy/manual bookings
  // entered without a phone number. Logs as warning so it's visible if
  // we're seeing a lot of skips.
  if (!booking.contact_phone) {
    console.warn("[SMS Cancel] No contact_phone for booking=%s, skipping", booking.id);
    return { ok: false, skipped: "no_phone" };
  }

  // Twilio client — uses tenant's BYOT creds if set, else platform creds.
  // Same pattern as estimateRecovery.sendRecoverySms.
  const client = twilio.getClientForTenant(tenant);
  if (!client) {
    console.warn("[SMS Cancel] No Twilio client for tenant=%s", tenant.id);
    return { ok: false, skipped: "no_twilio_client" };
  }

  // Tenant's primary phone is both From: and the callback number in body.
  // Customer sees the SMS from the same number they already have saved as
  // "Gladiators Painting" (or whatever).
  const fromPhone = await getTenantPrimaryPhone(tenant.id);
  if (!fromPhone) {
    console.warn("[SMS Cancel] No primary phone for tenant=%s", tenant.id);
    return { ok: false, skipped: "no_from_phone" };
  }

  const firstName    = getFirstName(booking.contact_name);
  const companyName  = tenant.company_name || tenant.name || "your contractor";
  const friendlyDate = formatFriendlyDate(booking.preferred_date);

  // Message format locked by Drew (May 4, 2026):
  //   Hi {first}, this is {company}. Your {date} appointment has been
  //   cancelled. If this was a mistake or you'd like to reschedule, reply
  //   to this message or call {phone}. — {company}
  //
  // Branded bookends (company name top + bottom) so the customer
  // immediately recognizes who it's from even before reading. Reschedule
  // path is explicit so they don't think they need to start over.
  const body =
    `Hi ${firstName}, this is ${companyName}. ` +
    `Your ${friendlyDate} appointment has been cancelled. ` +
    `If this was a mistake or you'd like to reschedule, reply to this ` +
    `message or call ${fromPhone}. — ${companyName}`;

  try {
    const message = await client.messages.create({
      to:   booking.contact_phone,
      from: fromPhone,
      body,
    });

    // Audit column added by Mig 054 (May 4, 2026). Stamps the moment we
    // successfully handed the SMS off to Twilio. Doesn't track delivery —
    // that would require a status callback, which is a Phase 3 concern.
    await db.query(
      "UPDATE bookings SET cancellation_sms_sent_at = now() WHERE id = $1",
      [booking.id]
    ).catch((e) =>
      console.error("[SMS Cancel] cancellation_sms_sent_at update failed bookingId=%s err=%s",
        booking.id, e.message)
    );

    console.log(
      "[SMS Cancel] Sent bookingId=%s to=%s from=%s sid=%s",
      booking.id, booking.contact_phone, fromPhone, message.sid
    );
    return { ok: true, sid: message.sid };
  } catch (e) {
    // Common Twilio failures: invalid number (21211), unsubscribed (21610),
    // unverified trial number (21608). All non-fatal — log and move on.
    console.error("[SMS Cancel] Twilio send failed bookingId=%s code=%s error=%s",
      booking.id, e.code || "unknown", e.message);
    return { ok: false, error: e.message };
  }
}

module.exports = {
  sendBookingCancellationSms,
  // Helpers exported for testing / future transactional SMS functions
  formatFriendlyDate,
  getFirstName,
  getTenantPrimaryPhone,
};

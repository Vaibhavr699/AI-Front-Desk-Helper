"use strict";

const db = require("../lib/db");
const crm = require("./crm");
const emailService = require("./email");
const smsService = require("./sms"); // Phase 2 Cancellation Flow (May 4, 2026)
const { getTenantById } = require("../lib/tenant");
const followUp = require("./followUp");
const calendar = require("../calendar");
const notificationService = require("./notifications");

/** Normalize and validate booking payload from AI (handles camelCase, extra fields, bad dates). */
function normalizeBookingData(data, isUpdate = false) {
  if (!data || typeof data !== "object") return {};
  const get = (obj, ...keys) => {
    for (const k of keys) {
      if (k in obj) {
        const v = obj[k];
        if (v == null || String(v).trim() === "") return null;
        return String(v).trim();
      }
    }
    return isUpdate ? undefined : null;
  };

  const contactPhone = get(data, "contact_phone", "contactPhone");
  if (!isUpdate && !contactPhone) {
    throw new Error("contact_phone is required and cannot be empty");
  }

  // Only pass through preferred_date if it looks like a valid date (YYYY-MM-DD)
  let preferredDate = get(data, "preferred_date", "preferredDate");
  if (preferredDate) {
    const isoMatch = preferredDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!isoMatch) preferredDate = isUpdate ? undefined : null;
  }

  const result = {
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
  };

  // Handle estimated_revenue_cents carefully for updates
  if ("estimated_value" in data || "estimatedValue" in data) {
    const val = data.estimated_value !== undefined ? data.estimated_value : data.estimatedValue;
    const numeric = parseFloat(val);
    // Use default if not a valid number or <= 0
    result.estimated_revenue_cents = (isNaN(numeric) || numeric <= 0) ? 25000 : Math.round(numeric * 100);
  } else if (!isUpdate) {
    result.estimated_revenue_cents = 25000; // Default $250.00
  }

  return result;
}


async function createBooking(tenantId, callId, data, leadId = null, leadSource = null) {
  console.log("[AI-Desk] Booking create start tenantId=%s callId=%s raw_keys=%s", tenantId, callId || "(none)", Object.keys(data || {}).join(","));
  const norm = normalizeBookingData(data);

  // Final Availability Check BEFORE inserting to prevent race conditions or sync overlaps
  if (norm.preferred_date && norm.appointment_time) {
    const tenant = await getTenantById(tenantId);
    const av = await calendar.checkAvailability(norm.preferred_date, norm.appointment_time, tenant);
    if (!av.available) {
      console.warn("[AI-Desk] FINAL CHECK FAILED: Slot %s %s already taken for tenant %s", norm.preferred_date, norm.appointment_time, tenantId);
      throw new Error("This time slot is no longer available. Please choose another time.");
    }
  }

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

  // 📅 New booking notification (non-blocking — must never fail the booking)
  notificationService.notifyNewBooking(tenantId, {
    customer_name: booking.contact_name,
    service_date:  booking.preferred_date,
    booking_id:    booking.id,
    lead_id:       booking.lead_id,
    source:        leadSource || "ai",
  }).catch((e) => console.error("[AI-Desk] notifyNewBooking failed:", e.message));

  // ATTRIBUTION: Link success back to Outbound Campaign & Script
  if (callId) {
    try {
      const contactRes = await db.query(
        "UPDATE outbound_contacts SET status = 'booked' WHERE last_call_id = $1 RETURNING campaign_id, last_script_id",
        [callId]
      );
      if (contactRes.rows.length > 0) {
         const { campaign_id, last_script_id } = contactRes.rows[0];
         console.log("[AI-Desk] Outbound Success attributed: campaign=%s script=%s", campaign_id, last_script_id);
         
         // Increment campaign-wide booking count
         await db.query("UPDATE outbound_campaigns SET booked_count = booked_count + 1 WHERE id = $1", [campaign_id]);
         
         // Increment specific script booking count and update performance_pct
         if (last_script_id) {
           await db.query(`
              WITH stats AS (
                SELECT 
                  COUNT(*) FILTER (WHERE status = 'booked') as bookings,
                  COUNT(*) as total_calls
                FROM outbound_contacts
                WHERE last_script_id = $1
              )
              UPDATE outbound_scripts 
              SET performance_pct = ROUND((stats.bookings::numeric / NULLIF(stats.total_calls, 0)) * 100, 2)
              FROM stats
              WHERE id = $1`, 
              [last_script_id]
           );
         }
      }
    } catch (e) {
       console.error("[AI-Desk] Outbound attribution error:", e.message);
    }
  }

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
  const norm = normalizeBookingData(data, true);
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

/**
 * Cancel a booking. Updates status + cancellation metadata, fires owner email,
 * fires bell notification, fires customer SMS, syncs to CRM, flips the linked
 * lead back to 'New', and cancels any active estimate recoveries for that lead.
 *
 * Phase 1 (May 4, 2026) — SHIPPED: owner email + bell notification + status
 *   metadata (cancelled_at, cancelled_via, cancellation_reason).
 * Phase 2 (May 4, 2026) — SHIPPED: customer SMS via services/sms.js +
 *   cancellation_sms_sent_at audit column (Mig 054).
 * Phase 3 (May 4, 2026) — SHIPPED: lead status flip to 'New' (so the lead
 *   re-enters the follow-up queue and can be re-engaged for a reschedule)
 *   + cancel ALL active estimate_recoveries linked to this lead OR booking
 *   (so the AI stops texting/calling about an estimate that's no longer
 *   on the books).
 * Phase 4 — DEFERRED: Google Calendar event deletion (using
 *   bookings.google_event_id from Mig 053), CRM event_type override,
 *   voice + SMS callsite wiring (so AI agents can cancel on the customer's
 *   behalf during a call/text conversation).
 *
 * Side effects are all fire-and-forget — none of them can fail the
 * cancellation itself. Order is intentional:
 *   1. CRM sync first (external source of truth)
 *   2. Owner email (Drew gets immediate notice)
 *   3. Bell notification (in-app)
 *   4. Customer SMS (most-likely-to-fail step)
 *   5. Lead status flip (downstream pipeline state)
 *   6. Recovery cancel chain (stops future AI outreach)
 *
 * @param {string} bookingId - The booking UUID
 * @param {object} options - Optional metadata about the cancellation
 * @param {string} options.cancelled_via - 'voice' | 'sms' | 'dashboard' | 'crm'
 * @param {string} options.cancellation_reason - Free-text reason (internal only,
 *                                               NOT surfaced to customer SMS)
 * @returns {object|null} The updated booking row, or null if not found
 */
async function cancelBooking(bookingId, options = {}) {
  const cancelled_via = options.cancelled_via || null;
  const cancellation_reason = options.cancellation_reason || null;

  console.log("[AI-Desk] Booking cancel id=%s via=%s", bookingId, cancelled_via || "unknown");

  // Update the booking row with status + cancellation metadata
  const res = await db.query(
    `UPDATE bookings
     SET status = 'Cancelled',
         cancelled_at = now(),
         cancelled_via = $2,
         cancellation_reason = $3,
         updated_at = now()
     WHERE id = $1
     RETURNING *`,
    [bookingId, cancelled_via, cancellation_reason]
  );
  const booking = res.rows[0];

  if (!booking) {
    console.warn("[AI-Desk] Cancel: booking not found id=%s", bookingId);
    return null;
  }

  const tenant = await getTenantById(booking.tenant_id);

  if (tenant) {
    // CRM sync (existing behavior — fire and forget)
    crm.syncBookingToCrm(booking.tenant_id, booking)
      .catch(e => console.error("[Cancel] CRM Sync:", e.message));

    // Owner email — fire and forget (must never block the cancellation)
    emailService.sendBookingCancellationEmail(tenant, booking, cancelled_via, cancellation_reason)
      .catch(e => console.error("[Cancel] Email failed:", e.message));

    // Bell notification — fire and forget
    notificationService.notifyBookingCancellation(booking.tenant_id, {
      customer_name: booking.contact_name,
      service_date:  booking.preferred_date,
      booking_id:    booking.id,
      lead_id:       booking.lead_id,
      cancelled_via,
    }).catch(e => console.error("[Cancel] Notification failed:", e.message));

    // Customer SMS — Phase 2 (May 4, 2026). Fire and forget. Never throws
    // (services/sms.js wraps Twilio errors and returns { ok: false }).
    // Cancellation reason is intentionally NOT passed — internal-only.
    smsService.sendBookingCancellationSms(tenant, booking)
      .catch(e => console.error("[Cancel] Customer SMS failed:", e.message));
  }

  // ── Phase 3 (May 4, 2026) ─────────────────────────────────────────────
  // Lead status flip + recovery cancel chain. Both fire-and-forget — wrapped
  // in IIFE so any await inside doesn't block the function return.
  //
  // We do these AFTER the tenant-dependent side effects above because they
  // operate purely on our own DB and don't need the tenant row. Skipping
  // the full async/await chain inside cancelBooking keeps this function
  // returning quickly to the dashboard.
  (async () => {
    // Flip the lead back to 'New' so it re-enters the follow-up queue.
    // Drew's reasoning (May 4, 2026): a cancelled booking often becomes a
    // reschedule, so 'Lost' would be too aggressive — we want this lead
    // visible in the pipeline for re-engagement.
    if (booking.lead_id) {
      try {
        await db.query(
          `UPDATE leads
              SET status = 'New',
                  updated_at = now()
            WHERE id = $1`,
          [booking.lead_id]
        );
        console.log("[Cancel] Lead %s flipped to 'New'", booking.lead_id);
      } catch (e) {
        console.error("[Cancel] Lead status flip failed leadId=%s err=%s",
          booking.lead_id, e.message);
      }
    }

    // Cancel ALL active estimate recoveries linked to this booking OR lead.
    // We match on either side because:
    //   - estimateRecovery.startRecovery() sets booking_id + lead_id
    //   - estimateRecovery.startEstimateRecovery() / startInquiryRecovery()
    //     set lead_id but NOT booking_id (they fire before any booking
    //     exists)
    // If the cancelled booking's lead has a recovery that pre-dates the
    // booking itself, we still want to stop it. The OR covers both paths.
    //
    // status='cancelled' is what the recovery cron checks via
    // `WHERE status='active'` — flipping it here guarantees no further
    // SMS or AI calls fire for this customer about this estimate.
    try {
      const cancelClause = booking.lead_id
        ? `WHERE status = 'active' AND (booking_id = $1 OR lead_id = $2)`
        : `WHERE status = 'active' AND booking_id = $1`;
      const cancelParams = booking.lead_id
        ? [booking.id, booking.lead_id]
        : [booking.id];
      const recRes = await db.query(
        `UPDATE estimate_recoveries
            SET status = 'cancelled',
                updated_at = now()
          ${cancelClause}
          RETURNING id`,
        cancelParams
      );
      if (recRes.rowCount > 0) {
        console.log("[Cancel] Cancelled %d active recoveries for booking=%s lead=%s",
          recRes.rowCount, booking.id, booking.lead_id || "(none)");
      }
    } catch (e) {
      console.error("[Cancel] Recovery cancel chain failed bookingId=%s err=%s",
        booking.id, e.message);
    }
  })().catch(e => console.error("[Cancel] Phase 3 IIFE crashed:", e.message));

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

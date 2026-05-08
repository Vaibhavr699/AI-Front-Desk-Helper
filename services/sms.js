"use strict";

/**
 * services/sms.js
 *
 * Customer-facing transactional SMS messages + the multi-turn SMS
 * cancellation conversation flow + outbound estimate link sender.
 *
 * Phase 2 (May 4, 2026): sendBookingCancellationSms — formal confirmation
 *   SMS fired from cancelBooking() when cancellation comes from the
 *   dashboard, voice, or any non-SMS callsite.
 *
 * Phase 4C (May 4, 2026): initiateSmsCancellation +
 *   handleSmsCancellationIncoming — multi-turn state machine that lets a
 *   customer cancel their appointment by texting "I want to cancel". The
 *   AI orchestrator detects intent (sets should_cancel=true) and we drive
 *   the rest deterministically: lookup → confirm date/time → capture
 *   reason → fire cancelBooking with cancelled_via='sms'. State lives on
 *   the in-memory SMS thread (server.js getOrCreateSmsThread).
 *
 * Phase E1 (May 4, 2026): sendEstimateLinkSms — fires when the voice AI
 *   calls the send_estimate_link tool during a phone call. Sends the
 *   caller a vertical-agnostic SMS with a link to the hosted estimator
 *   page (routes/estimateLink.js). Link includes ?call_id=<callId> for
 *   attribution back to the originating call.
 *
 * Migration 059 (May 8, 2026): DNC suppression added to both outbound
 *   functions (sendBookingCancellationSms + sendEstimateLinkSms). The
 *   customer-initiated cancellation flow is intentionally NOT gated by
 *   DNC — those are responses to inbound customer messages, not outbound
 *   automation. A customer who texts "cancel my appointment" deserves a
 *   reply even if they're on the do-not-contact list.
 */

const db = require("../lib/db");
const twilio = require("../lib/twilio");

// ─────────────────────────────────────────────────────────────────────
// Helpers — formatting + phone lookup
// ─────────────────────────────────────────────────────────────────────

function formatFriendlyDate(dateValue) {
  if (!dateValue) return "your scheduled";
  try {
    const dateStr = typeof dateValue === "string" && !dateValue.includes("T")
      ? `${dateValue}T00:00:00`
      : dateValue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "your scheduled";

    const weekday = d.toLocaleDateString("en-US", { weekday: "long" });
    const month   = d.toLocaleDateString("en-US", { month: "long" });
    const day     = d.getDate();

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

function getFirstName(fullName) {
  if (!fullName || typeof fullName !== "string") return "there";
  const parts = fullName.trim().split(/\s+/);
  return parts[0] || "there";
}

/**
 * Look up the tenant's primary phone number for outbound SMS. Used as
 * both the From: number and (sometimes) embedded in body as a callback
 * number. Mirrors the ordering rule from estimateRecovery.executeStep:
 * primary first, then oldest.
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

// ─────────────────────────────────────────────────────────────────────
// DNC SUPPRESSION (Migration 059, May 8 2026)
// ─────────────────────────────────────────────────────────────────────

/**
 * Check whether a phone is on the do-not-contact list for a tenant.
 *
 * Matches on both E.164 exact and last-10-digit normalized form to catch
 * +14025551234 vs (402) 555-1234 vs 4025551234.
 *
 * Cheap query thanks to the partial index idx_leads_do_not_contact —
 * the WHERE do_not_contact = true predicate scans only flagged rows.
 *
 * Returns true if blocked, false if safe to proceed.
 */
async function isPhoneDoNotContact(tenantId, phone) {
  if (!tenantId || !phone) return false;
  const last10 = String(phone).replace(/\D/g, "").slice(-10);
  const r = await db.query(
    `SELECT 1 FROM leads
      WHERE tenant_id = $1
        AND do_not_contact = true
        AND (
          phone = $2
          OR right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $3
        )
      LIMIT 1`,
    [tenantId, phone, last10]
  );
  return r.rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────
// Phase 2: transactional cancellation SMS
// ─────────────────────────────────────────────────────────────────────

async function sendBookingCancellationSms(tenant, booking) {
  if (!tenant || !booking) {
    console.warn("[SMS Cancel] Missing tenant or booking, skipping");
    return { ok: false, skipped: "missing_args" };
  }

  // Phase 4C dedup: if cancellation came via SMS flow itself, skip the
  // formal SMS (customer is already mid-conversation with us).
  if (booking.cancelled_via === "sms") {
    console.log("[SMS Cancel] Skipping — cancelled_via=sms (avoid duplicate SMS in same thread) bookingId=%s", booking.id);
    return { ok: false, skipped: "cancelled_via_sms" };
  }

  if (!booking.contact_phone) {
    console.warn("[SMS Cancel] No contact_phone for booking=%s, skipping", booking.id);
    return { ok: false, skipped: "no_phone" };
  }

  // DNC suppression (Migration 059): never send a cancellation confirmation
  // to a do-not-contact customer. Even though it's transactional, they
  // explicitly opted out of all communication. The dashboard user who
  // triggered the cancellation already sees it cancelled in their UI.
  if (await isPhoneDoNotContact(tenant.id, booking.contact_phone)) {
    console.log("[SMS Cancel] DNC blocked bookingId=%s tenant=%s phone=%s — suppressing",
      booking.id, tenant.id, booking.contact_phone);
    return { ok: false, skipped: "do_not_contact" };
  }

  const client = twilio.getClientForTenant(tenant);
  if (!client) {
    console.warn("[SMS Cancel] No Twilio client for tenant=%s", tenant.id);
    return { ok: false, skipped: "no_twilio_client" };
  }

  const fromPhone = await getTenantPrimaryPhone(tenant.id);
  if (!fromPhone) {
    console.warn("[SMS Cancel] No primary phone for tenant=%s", tenant.id);
    return { ok: false, skipped: "no_from_phone" };
  }

  const firstName    = getFirstName(booking.contact_name);
  const companyName  = tenant.company_name || tenant.name || "your contractor";
  const friendlyDate = formatFriendlyDate(booking.preferred_date);

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
    console.error("[SMS Cancel] Twilio send failed bookingId=%s code=%s error=%s",
      booking.id, e.code || "unknown", e.message);
    return { ok: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase E1 (May 4, 2026): outbound estimate link SMS
// ─────────────────────────────────────────────────────────────────────

/**
 * Send the caller an SMS with a link to the hosted estimator page. Fired
 * from server.js when the voice AI calls the send_estimate_link tool
 * during a phone call.
 *
 * Vertical-agnostic by design — body says "free instant estimate" rather
 * than "painting estimate" so the same code works for painting, roofing,
 * fencing, HVAC, etc. The estimator page itself adapts to the tenant's
 * configured vertical (Phase 7 V1).
 *
 * Why this lives in services/sms.js (not lib/twilio.js or a new file):
 * the Twilio client lookup, primary-phone lookup, and structured logging
 * are already battle-tested here. Reusing them keeps behavior consistent
 * across all our customer-facing SMS — same tenant credentials, same
 * From: number, same error handling.
 *
 * Never throws. Returns { ok, sid?, error? }. The dispatcher in server.js
 * checks ok and either confirms to the AI or instructs it to apologize +
 * transfer.
 *
 * @param {object} tenant       - Tenant row (must have id, company_name OR name)
 * @param {string} toPhone      - Recipient phone (E.164 or any format Twilio accepts)
 * @param {string} link         - Full estimator URL with call_id query param
 * @param {string} sourceCallId - Originating call ID (for log only — already in link)
 * @returns {Promise<{ok: boolean, sid?: string, error?: string, skipped?: string}>}
 */
async function sendEstimateLinkSms(tenant, toPhone, link, sourceCallId = null) {
  if (!tenant || !toPhone || !link) {
    console.warn("[Estimate Link] Missing args tenant=%s phone=%s link=%s",
      tenant ? "ok" : "MISSING", toPhone || "MISSING", link || "MISSING");
    return { ok: false, error: "missing_args" };
  }

  // DNC suppression (Migration 059): never text an estimator link to a
  // do-not-contact customer, even if they're on a live call asking for it.
  // Edge case (DNC'd customer calls in and asks for an estimator link)
  // should be handled by the AI offering an in-person estimate instead.
  if (await isPhoneDoNotContact(tenant.id, toPhone)) {
    console.log("[Estimate Link] DNC blocked tenant=%s to=%s call_id=%s — suppressing",
      tenant.id, toPhone, sourceCallId || "(none)");
    return { ok: false, error: "do_not_contact", skipped: "do_not_contact" };
  }

  const client = twilio.getClientForTenant(tenant);
  if (!client) {
    console.warn("[Estimate Link] No Twilio client for tenant=%s", tenant.id);
    return { ok: false, error: "no_twilio_client" };
  }

  const fromPhone = await getTenantPrimaryPhone(tenant.id);
  if (!fromPhone) {
    console.warn("[Estimate Link] No primary phone for tenant=%s", tenant.id);
    return { ok: false, error: "no_from_phone" };
  }

  const companyName = tenant.company_name || tenant.name || "us";

  // Body locked May 4, 2026 (Drew, Phase E1):
  //   Vertical-agnostic — works for painting, roofing, fencing, etc.
  //   Includes the "what happens next" close ("fill it out and book
  //   right from there") which matches what the voice AI says verbally.
  //   Single line for SMS readability.
  const body =
    `Hi from ${companyName}! Tap to get your free instant estimate: ` +
    `${link} — fill it out and you can book right from there.`;

  try {
    const message = await client.messages.create({
      to:   toPhone,
      from: fromPhone,
      body,
    });

    console.log(
      "[Estimate Link] Sent tenant=%s to=%s from=%s call_id=%s sid=%s",
      tenant.id, toPhone, fromPhone, sourceCallId || "(none)", message.sid
    );
    return { ok: true, sid: message.sid };
  } catch (e) {
    // Common Twilio failures: 21211 invalid number, 21610 unsubscribed,
    // 21408 not enabled for region. All non-fatal — log and let caller
    // decide what to tell the AI.
    console.error("[Estimate Link] Twilio send failed tenant=%s to=%s code=%s err=%s",
      tenant.id, toPhone, e.code || "unknown", e.message);
    return { ok: false, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Phase 4C: SMS cancellation conversation state machine
//
// NOTE: These functions intentionally do NOT have DNC suppression. They
// respond to inbound customer messages — a DNC'd customer who texts in
// asking to cancel their appointment deserves a reply. DNC suppresses
// outbound automation, not responses to direct customer requests.
// ─────────────────────────────────────────────────────────────────────

function isAffirmation(text) {
  return /\b(yes|yeah|yep|yup|yea|sure|confirm|please|go ahead|correct|right|ok|okay|absolutely|definitely)\b/i.test(text);
}

function isNegation(text) {
  return /\b(no|nope|nah|don'?t|keep|stop|nevermind|never mind|forget|cancel that)\b/i.test(text);
}

function isSkipReason(text) {
  return /^(none|no|nothing|skip|n\/?a|no thanks|no thank you|nope|nah)$/i.test(text.trim());
}

async function initiateSmsCancellation(thread, tenant) {
  const bookingsService = require("./bookings");
  const phone = thread.leadCapture?.phone || thread.phone;

  if (!phone) {
    return {
      reply: "I'd love to help cancel — could you confirm the phone number on the appointment so I can look it up?",
    };
  }

  let upcoming = [];
  try {
    upcoming = await bookingsService.findUpcomingBookingsByPhone(tenant.id, phone);
  } catch (e) {
    console.error("[SMS Cancel Flow] Lookup failed phone=%s tenant=%s err=%s",
      phone, tenant.id, e.message);
    return {
      reply: "I'm having trouble looking up your appointment right now. Please call us directly so we can help.",
    };
  }

  if (upcoming.length === 0) {
    console.log("[SMS Cancel Flow] No upcoming bookings phone=%s tenant=%s", phone, tenant.id);
    return {
      reply: "I don't see any upcoming appointments under this number. If you booked under a different phone number, please call us directly so we can look it up.",
    };
  }

  if (upcoming.length === 1) {
    const b = upcoming[0];
    const friendly = bookingsService.formatBookingForVoiceConfirm(b);
    thread.cancelState = "awaiting_confirm";
    thread.pendingCancelBookingId = b.id;
    thread.pendingCancelBookingsList = null;
    console.log("[SMS Cancel Flow] 1 booking found, awaiting confirm bookingId=%s", b.id);
    return {
      reply: `I see your appointment ${friendly}. Reply YES to confirm cancellation, or NO to keep it.`,
    };
  }

  const items = upcoming.map((b) => ({
    id: b.id,
    friendly: bookingsService.formatBookingForVoiceConfirm(b),
  }));
  thread.cancelState = "awaiting_choice";
  thread.pendingCancelBookingsList = items;
  thread.pendingCancelBookingId = null;
  console.log("[SMS Cancel Flow] %d bookings found, awaiting choice phone=%s",
    items.length, phone);

  const list = items.map((it, i) => `${i + 1}) ${it.friendly}`).join("\n");
  return {
    reply: `I see multiple upcoming appointments under this number:\n${list}\n\nWhich would you like to cancel? Reply with the number, or NONE to keep them all.`,
  };
}

async function handleSmsCancellationIncoming(thread, incomingText, tenant) {
  if (!thread.cancelState) return null;

  const text = (incomingText || "").trim();
  const lc = text.toLowerCase();

  if (/^(nevermind|never mind|forget it|cancel that|stop)$/i.test(lc)) {
    console.log("[SMS Cancel Flow] Universal abort from state=%s", thread.cancelState);
    thread.cancelState = null;
    thread.pendingCancelBookingId = null;
    thread.pendingCancelBookingsList = null;
    return { reply: "No problem, keeping your appointment as-is." };
  }

  switch (thread.cancelState) {

    case "awaiting_choice": {
      const list = thread.pendingCancelBookingsList || [];

      if (/^(none|no)$/i.test(lc)) {
        console.log("[SMS Cancel Flow] awaiting_choice → cancelled by customer");
        thread.cancelState = null;
        thread.pendingCancelBookingsList = null;
        return { reply: "Got it, keeping all your appointments." };
      }

      const digitMatch = lc.match(/\d+/);
      const num = digitMatch ? parseInt(digitMatch[0], 10) : NaN;

      if (!num || num < 1 || num > list.length) {
        const reList = list.map((it, i) => `${i + 1}) ${it.friendly}`).join("\n");
        return {
          reply: `Sorry, I didn't catch that. Please reply with the number of the appointment you'd like to cancel:\n${reList}\n\nOr NONE to keep them all.`,
        };
      }

      const chosen = list[num - 1];
      thread.cancelState = "awaiting_confirm";
      thread.pendingCancelBookingId = chosen.id;
      thread.pendingCancelBookingsList = null;
      console.log("[SMS Cancel Flow] awaiting_choice → awaiting_confirm bookingId=%s", chosen.id);
      return {
        reply: `Just to confirm, you want to cancel: ${chosen.friendly}? Reply YES to confirm or NO to keep it.`,
      };
    }

    case "awaiting_confirm": {
      const yes = isAffirmation(lc);
      const no  = isNegation(lc);

      if (yes && no) {
        return {
          reply: "Sorry, I want to make sure I get this right. Please reply with just YES to cancel, or NO to keep your appointment.",
        };
      }

      if (no) {
        console.log("[SMS Cancel Flow] awaiting_confirm → declined");
        thread.cancelState = null;
        thread.pendingCancelBookingId = null;
        return { reply: "Got it, keeping your appointment." };
      }

      if (!yes) {
        return {
          reply: "Sorry, I didn't catch that. Please reply YES to confirm cancellation, or NO to keep your appointment.",
        };
      }

      thread.cancelState = "awaiting_reason";
      console.log("[SMS Cancel Flow] awaiting_confirm → awaiting_reason bookingId=%s",
        thread.pendingCancelBookingId);
      return {
        reply: "No problem — was there anything specific that came up, just so we can let the team know? Reply with a quick note, or NONE to skip.",
      };
    }

    case "awaiting_reason": {
      const bookingId = thread.pendingCancelBookingId;
      if (!bookingId) {
        console.error("[SMS Cancel Flow] awaiting_reason with no pendingCancelBookingId — resetting");
        thread.cancelState = null;
        return {
          reply: "Sorry, something went wrong on our end. Please call us if you still need to cancel.",
        };
      }

      const reason = isSkipReason(lc) ? null : text.slice(0, 500);

      try {
        const bookingsService = require("./bookings");
        const booking = await bookingsService.cancelBooking(bookingId, {
          cancelled_via: "sms",
          cancellation_reason: reason,
        });

        thread.cancelState = null;
        thread.pendingCancelBookingId = null;

        if (!booking) {
          console.warn("[SMS Cancel Flow] cancelBooking returned null bookingId=%s", bookingId);
          return {
            reply: "Hmm, I couldn't find that appointment to cancel. Please call us if you still need help.",
          };
        }

        if (booking.tenant_id !== tenant.id) {
          console.error("[SMS Cancel Flow] tenant mismatch! booking=%s tenant=%s expected=%s",
            booking.id, booking.tenant_id, tenant.id);
          return {
            reply: "Something went wrong. Please call us directly to cancel your appointment.",
          };
        }

        console.log("[SMS Cancel Flow] Cancelled bookingId=%s tenant=%s reason=%s",
          booking.id, tenant.id, reason ? "captured" : "none");

        const friendly = bookingsService.formatBookingForVoiceConfirm(booking);
        return {
          reply: `Cancelled — your appointment ${friendly} has been cancelled. Would you like to set up a new time, or just leave things for now?`,
        };
      } catch (e) {
        console.error("[SMS Cancel Flow] Cancel failed bookingId=%s err=%s",
          bookingId, e.message);
        thread.cancelState = null;
        thread.pendingCancelBookingId = null;
        return {
          reply: "Sorry, something went wrong cancelling your appointment. Please call us directly so we can help.",
        };
      }
    }

    default:
      console.warn("[SMS Cancel Flow] Unknown cancelState=%s — resetting", thread.cancelState);
      thread.cancelState = null;
      thread.pendingCancelBookingId = null;
      thread.pendingCancelBookingsList = null;
      return null;
  }
}

module.exports = {
  // Phase 2 (transactional cancellation SMS)
  sendBookingCancellationSms,
  // Phase 4C (multi-turn cancellation conversation)
  initiateSmsCancellation,
  handleSmsCancellationIncoming,
  // Phase E1 (outbound estimate link)
  sendEstimateLinkSms,
  // Helpers
  formatFriendlyDate,
  getFirstName,
  getTenantPrimaryPhone,
  // DNC suppression (Migration 059)
  isPhoneDoNotContact,
};

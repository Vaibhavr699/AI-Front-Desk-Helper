"use strict";

// ════════════════════════════════════════════════════════════════════════════
// routes/booking.js — Phase 12 A1 foundation (May 28, 2026)
//
// Two PUBLIC, tenant-scoped endpoints that wrap the channel-agnostic
// bookingEngine. The widget calls these to show real open slots and to book
// against the same engine voice and SMS already use — so a widget booking
// produces an identical bookings row, lead link, CRM sync, confirmation
// SMS/email, and Google Calendar event.
//
//   POST /api/booking/availability  → bookingEngine.getAvailability
//   POST /api/booking/book          → bookingEngine.book   (+ Option B consent)
//
// These are deliberately thin and machine-callable: clean JSON in, clean JSON
// out, no voice/SMS-specific shaping. That makes them the drop-in surface for
// the Phase 13 agent-bookable API — an external AI hits the same two routes.
//
// CONSENT (Option B): /book requires `consent: true` in the body and writes a
// row to sms_consents at book time, mirroring /api/widget/start-sms exactly
// (IP, user-agent, page URL, session id) for 10DLC dispute defense. No prior
// opt-in required — the checkbox on the booking form IS the consent moment.
// CONSENT (Option B, with reuse): /book records a fresh sms_consents row when
// the request carries `consent: true`. If consent isn't passed but this phone
// already has a prior consent row (e.g. the SMS opt-in popup earlier in the
// session), that consent is REUSED and the booking proceeds. With neither, the
// booking is refused with 400 consent_required so the widget shows the box.
//
// Public (no authMiddleware) because the widget is unauthenticated; every
// request is scoped by tenantId in the body, same pattern as start-sms and
// /website-chat. resolveTenant accepts a UUID or a slug.
// ════════════════════════════════════════════════════════════════════════════

const express = require("express");
const router = express.Router();

const db = require("../lib/db");
const bookingEngine = require("../lib/bookingEngine");
const leadsService = require("../services/leads");
const { getTenantById, getTenantBySlug } = require("../lib/tenant");

const DEFAULT_DURATION_MIN = 60;

async function resolveTenant(idOrSlug) {
  if (!idOrSlug) return null;
  let tenant = await getTenantById(idOrSlug).catch(() => null);
  if (!tenant) tenant = await getTenantBySlug(idOrSlug).catch(() => null);
  return tenant;
}

// ── POST /api/booking/availability ──────────────────────────────────────────
// Body: { tenantId, date: "YYYY-MM-DD", durationMinutes? }
// Returns: { ok:true, date, slots:[{time,value}], calendarConfigured, closed? }
//   time  = display ("9:00 AM"); value = 24h ("09:00:00") for machine callers.
router.post("/availability", async (req, res) => {
  const { tenantId, date, durationMinutes } = req.body || {};

  if (!tenantId || !date) {
    return res.status(400).json({ ok: false, error: "tenantId and date are required" });
  }

  try {
    const tenant = await resolveTenant(tenantId);
    if (!tenant) return res.status(404).json({ ok: false, error: "tenant_not_found" });

    const result = await bookingEngine.getAvailability({
      tenantId: tenant.id,
      date,
      durationMinutes: Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MIN,
    });

    if (!result.ok) {
      // invalid_date / invalid_window / tenant_not_found — surface as 400 so
      // the widget can correct the input, not a 500.
      return res.status(400).json(result);
    }

    return res.json(result);
  } catch (err) {
    console.error("[Booking API] /availability error tenant=%s date=%s: %s", tenantId, date, err.message);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ── POST /api/booking/book ──────────────────────────────────────────────────
// Body: {
//   tenantId, date, time, durationMinutes?,
//   contact: { name, phone, email?, address?, city?, state? },
//   projectType?, projectDetails?,
//   consent: true,                       // REQUIRED (Option B)
//   consentText?, sessionId?, pageUrl?,  // consent provenance
//   source?                              // attribution, default "widget_booking"
// }
// Returns: { ok:true, bookingId, leadId, eventId, confirmationText }
//          { ok:false, reason, message }   (slot_taken | invalid_datetime |
//                                            missing_contact | create_failed)
router.post("/book", async (req, res) => {
  const {
    tenantId,
    date,
    time,
    durationMinutes,
    contact = {},
    projectType,
    projectDetails,
    consent,
    consentText,
    sessionId,
    pageUrl,
    source,
  } = req.body || {};

  if (!tenantId || !date || !time) {
    return res.status(400).json({ ok: false, error: "tenantId, date, and time are required" });
  }

  const phone = contact.phone || null;
  if (!phone) {
    return res.status(400).json({ ok: false, error: "contact.phone is required" });
  }

  // ── Option B consent gate (with reuse) ─────────────────────────────────
  // The booking-form checkbox is the consent moment, BUT if this phone already
  // consented (SMS opt-in popup earlier, or any prior consent), we reuse that
  // rather than forcing the box again. No verifiable consent anywhere → refuse,
  // so the engine never sends an unconsented confirmation SMS/email. The gate
  // is evaluated INSIDE the try below (after tenant resolves).

  try {
    const tenant = await resolveTenant(tenantId);
    if (!tenant) return res.status(404).json({ ok: false, error: "tenant_not_found" });

    // 1. Consent gate with reuse. Three cases:
    //    (a) consent === true  → record a fresh sms_consents row now.
    //    (b) consent not given, but a prior consent row exists for this
    //        phone+tenant (e.g. the SMS opt-in popup earlier this session, or
    //        any past consent) → proceed, reusing that consent. No new row.
    //    (c) consent not given AND no prior row → refuse with consent_required
    //        so the widget knows to show the checkbox.
    //
    //    Phone matching uses last-10-digit canonicalization so "+14025551234",
    //    "4025551234", and "(402) 555-1234" all match the same prior consent,
    //    consistent with how leads/recoveries match phones elsewhere.
    let consentId = null;

    if (consent === true) {
      // (a) Record fresh consent — mirrors /api/widget/start-sms's row exactly
      //     so the dashboard/compliance export treats widget-booking consent
      //     and SMS-popup consent identically. trust proxy (set in server.js)
      //     makes req.ip the real visitor IP for 10DLC dispute defense.
      try {
        const consentRes = await db.query(
          `INSERT INTO sms_consents
             (tenant_id, phone, consent_text, source, ip_address, user_agent, page_url, session_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            tenant.id,
            phone,
            consentText || "Consent given via booking form",
            source || "widget_booking",
            req.ip,
            req.headers["user-agent"],
            pageUrl,
            sessionId,
          ]
        );
        consentId = consentRes.rows[0]?.id || null;
      } catch (consentErr) {
        // A consent-write failure must block the booking — the whole point of
        // the gate is that we never send unconsented messages.
        console.error("[Booking API] consent insert failed tenant=%s phone=%s: %s", tenant.id, phone, consentErr.message);
        return res.status(500).json({ ok: false, error: "consent_record_failed" });
      }
    } else {
      // (b)/(c) No consent in this request — look for a prior one to reuse.
      let priorConsent = null;
      try {
        const last10 = String(phone).replace(/\D/g, "").slice(-10);
        const priorRes = await db.query(
          `SELECT id FROM sms_consents
            WHERE tenant_id = $1
              AND (
                phone = $2
                OR right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $3
              )
            ORDER BY consent_given_at DESC NULLS LAST
            LIMIT 1`,
          [tenant.id, phone, last10]
        );
        priorConsent = priorRes.rows[0] || null;
      } catch (lookupErr) {
        // If the lookup itself fails, fail closed — refuse rather than risk
        // booking without verifiable consent.
        console.error("[Booking API] prior-consent lookup failed tenant=%s phone=%s: %s", tenant.id, phone, lookupErr.message);
        return res.status(500).json({ ok: false, error: "consent_lookup_failed" });
      }

      if (!priorConsent) {
        // (c) No checkbox, no prior consent → the widget must show the box.
        return res.status(400).json({
          ok: false,
          error: "consent_required",
          message: "SMS consent is required to book. Check the consent box and resubmit.",
        });
      }

      // (b) Reuse the existing consent. consentId points at the prior row so
      //     the lead's last_consent_id still references a real consent record.
      consentId = priorConsent.id;
      console.log("[Booking API] reusing prior consent id=%s tenant=%s phone=%s", consentId, tenant.id, phone);
    }

    // 2. Resolve/create the lead via the normalized-phone path (the bug #30
    //    fix) so the widget booking links to any existing lead and never
    //    creates a duplicate. Pass it into the engine as leadId.
    let leadId = null;
    try {
      const lead = await leadsService.getOrCreateLead(
        tenant.id,
        phone,
        contact.name || null,
        source || "widget_booking",
        "web_form"
      );
      if (lead) {
        leadId = lead.id;
        // Stamp consent onto the lead the same way start-sms does.
        leadsService.updateLeadInfo(leadId, {
          has_sms_consent: true,
          last_consent_id: consentId,
        }).catch((e) => console.error("[Booking API] lead consent stamp failed:", e.message));
      }
    } catch (leadErr) {
      // Non-fatal — the engine's own getOrCreateLead inside createBooking will
      // still link by phone. Log and proceed.
      console.error("[Booking API] getOrCreateLead failed tenant=%s phone=%s: %s", tenant.id, phone, leadErr.message);
    }

    // 3. THE KEYSTONE CALL — identical engine voice and SMS use. Time
    //    normalization, slot check, DB row, lead link, CRM sync, confirmation
    //    SMS/email, and Google Calendar event all happen inside.
    const result = await bookingEngine.book({
      tenantId: tenant.id,
      date,
      time,
      durationMinutes: Number(durationMinutes) > 0 ? Number(durationMinutes) : DEFAULT_DURATION_MIN,
      contact: {
        name: contact.name || "New Lead",
        phone,
        email: contact.email || "",
        address: contact.address || "",
        city: contact.city || "",
        state: contact.state || "",
      },
      projectType: projectType || "",
      projectDetails: projectDetails || "",
      leadId: leadId || null,
      source: source || "widget_booking",
    });

    if (!result.ok) {
      // slot_taken / day_closed / outside_business_hours are caller-correctable
      // conflicts → 409 with the engine's reason+message so the widget can
      // re-prompt for a different time. invalid_datetime / missing_contact →
      // 400. create_failed and anything unexpected → 500.
      if (result.reason === "slot_taken" || result.reason === "day_closed" || result.reason === "outside_business_hours") {
        return res.status(409).json(result);
      }
      if (result.reason === "invalid_datetime" || result.reason === "missing_contact") {
        return res.status(400).json(result);
      }
      console.warn("[Booking API] engine.book failed tenant=%s reason=%s msg=%s", tenant.id, result.reason, result.message || "");
      return res.status(500).json(result);
    }

    // ── Surface the booking as a website conversation ──────────────────────
    // The Conversations tab is built from the `messages` table — a lead only
    // appears there once it has a messages row. A widget BOOKING (slot picker →
    // confirm) never goes through the chat path, so without this insert the
    // lead + booking exist (notifications fire) but no thread shows up. We write
    // one AI-authored outbound website message summarizing the booking so the
    // thread surfaces, consistent with how voice/SMS threads come to exist.
    // Non-fatal: a failure here must never fail a booking that's already saved.
    const bookedLeadId = result.leadId || leadId || null;
    if (bookedLeadId) {
      const summaryParts = [
        `Appointment booked for ${date} at ${time}`,
        projectType ? `(${projectType})` : null,
      ].filter(Boolean);
      const summaryBody = `${summaryParts.join(" ")}.${
        contact.name && contact.name !== "New Lead" ? ` Booked under ${contact.name}.` : ""
      }`;

      db.query(
        `INSERT INTO messages (tenant_id, lead_id, channel, direction, body, metadata)
         VALUES ($1, $2, 'website', 'outbound', $3, $4::jsonb)`,
        [
          tenant.id,
          bookedLeadId,
          summaryBody,
          JSON.stringify({
            system_generated: true,
            booking_id: result.bookingId,
            source: source || "widget_booking",
            session_id: sessionId || null,
          }),
        ]
      ).catch((msgErr) =>
        console.error(
          "[Booking API] booking-summary message insert failed (non-fatal) tenant=%s lead=%s: %s",
          tenant.id, bookedLeadId, msgErr.message
        )
      );
    }
    console.log("[Booking API] booked tenant=%s bookingId=%s leadId=%s eventId=%s consentId=%s",
      tenant.id, result.bookingId, result.leadId, result.eventId || "none", consentId);

    return res.json({
      ok: true,
      bookingId: result.bookingId,
      leadId: result.leadId,
      eventId: result.eventId,
      confirmationText: result.confirmationText,
    });
  } catch (err) {
    console.error("[Booking API] /book error tenant=%s: %s", tenantId, err.message);
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

module.exports = router;

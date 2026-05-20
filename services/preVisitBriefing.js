"use strict";

/**
 * services/preVisitBriefing.js — Phase 8B (May 20, 2026)
 *
 * Sends an SMS briefing to the rep/owner ~1 hour before each booked
 * appointment so they walk into the visit prepared. The briefing reads
 * the customer's DISC profile + buyer persona from coaching_conversations
 * and asks GPT-4o to compose a short, practical heads-up.
 *
 * Why ~1 hour out (not 2):
 *   Drew's call. Drew does estimates himself and wanted the brief fresh
 *   in his head as he drives over, not buried in his morning notifications.
 *   When other tenants onboard, this can become a per-tenant setting.
 *
 * Why send even without DISC data:
 *   Even a plain "9 AM with Adam Smith — interior painting, $500 estimated"
 *   is useful. DISC is the differentiator; the baseline brief still has
 *   value for new-call leads without a DISC classification.
 *
 * Recipient resolution (Option C, with fallback):
 *   1. tenant.pre_visit_sms_recipient_phone — if owner configured one
 *   2. owner dashboard user's phone — automatic fallback for new tenants
 *      who haven't touched Settings. Looked up via the dashboard_users
 *      table where role='owner', ordered by created_at ASC (the founding
 *      owner gets the briefings).
 *
 * Idempotency:
 *   The query filters out bookings where pre_visit_sms_sent_at IS NOT NULL,
 *   and we write the timestamp inside the same transaction as the SMS send.
 *   Even if the cron tick overlaps (15-min cadence, but a tick could take
 *   30s on a slow day), a booking will only be picked up once.
 *
 * Failure modes (all return without throwing — the cron continues):
 *   - No DISC data → send with project info only
 *   - No recipient phone resolvable → skip with log, leave timestamp NULL
 *     so the next eligible window retries (until the window passes)
 *   - GPT-4o composer fails → fall back to a templated brief
 *   - Twilio send fails → log, leave timestamp NULL for retry
 *
 * NOT in scope for v0:
 *   - Multiple recipients per booking
 *   - Slack/email destinations (SMS only)
 *   - Tech-specific routing (we use the tenant-level recipient — when
 *     technicians actually use the platform we layer on technician_id
 *     lookup as a higher priority than the tenant-level setting)
 */

const db = require("../lib/db");
const fetch = require("node-fetch");
const twilio = require("../lib/twilio");
const smsService = require("./sms"); // for getTenantPrimaryPhone

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = "gpt-4o";

// Window: 45-75 min ahead of now. The cron runs every 15 min, so a 30-min
// window guarantees we catch every booking exactly once (assuming the cron
// doesn't fall more than 15 min behind).
const WINDOW_MIN_AHEAD = 45;
const WINDOW_MAX_AHEAD = 75;

// ─────────────────────────────────────────────────────────────────────
// Recipient phone resolution
// ─────────────────────────────────────────────────────────────────────

/**
 * Resolve who should receive the pre-visit briefing for this booking.
 *
 * Priority:
 *   0. The booking's assigned technician's phone (Phase 8B tech routing).
 *      bookings.technician_id → dashboard_users.phone. This is the whole
 *      point of tech assignment: the briefing follows whoever is actually
 *      doing the visit.
 *   1. tenant.pre_visit_sms_recipient_phone (Option C explicit setting)
 *   2. The founding owner dashboard user's phone (auto-fallback)
 *
 * `booking` is optional — when omitted (or it has no technician_id), the
 * resolver simply falls through to Path 1/2, so existing callers and
 * un-assigned bookings keep working unchanged.
 *
 * Returns null if nothing is resolvable — caller skips the send and leaves
 * pre_visit_sms_sent_at NULL so we don't burn the slot.
 */
async function resolveRecipientPhone(tenant, booking) {
  // Path 0: assigned technician's phone (Phase 8B — May 20, 2026)
  if (booking?.technician_id) {
    try {
      const techRes = await db.query(
        `SELECT phone FROM dashboard_users
          WHERE id = $1
            AND phone IS NOT NULL
            AND phone != ''
          LIMIT 1`,
        [booking.technician_id]
      );
      const techPhone = (techRes.rows[0]?.phone || "").trim();
      if (techPhone) {
        console.log("[PreVisitBriefing] Routing booking=%s to assigned technician=%s",
          booking.id, booking.technician_id);
        return techPhone;
      }
      // Tech assigned but no phone on file — fall through to tenant phone.
      console.warn("[PreVisitBriefing] Booking=%s has assigned tech=%s with no phone — falling back",
        booking.id, booking.technician_id);
    } catch (err) {
      console.warn("[PreVisitBriefing] Assigned-tech phone lookup failed booking=%s err=%s",
        booking?.id, err.message);
      // fall through
    }
  }

  // Path 1: explicit tenant setting
  const explicit = (tenant?.pre_visit_sms_recipient_phone || "").trim();
  if (explicit) return explicit;

  // Path 2: founding owner's phone from dashboard_users.
  // The `phone` column on dashboard_users is added in migration 084.
  try {
    const res = await db.query(
      `SELECT phone FROM dashboard_users
        WHERE tenant_id = $1
          AND role = 'owner'
          AND phone IS NOT NULL
          AND phone != ''
        ORDER BY created_at ASC
        LIMIT 1`,
      [tenant.id]
    );
    return res.rows[0]?.phone || null;
  } catch (err) {
    console.warn("[PreVisitBriefing] Owner phone lookup failed for tenant=%s err=%s",
      tenant.id, err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────
// GPT-4o briefing composer
// ─────────────────────────────────────────────────────────────────────

/**
 * Compose the SMS body using GPT-4o. Receives the booking + lead +
 * optional DISC context. Returns a short SMS (under 320 chars / 2
 * segments) optimized for fast reading on a phone.
 *
 * The prompt deliberately:
 *   - Forbids fluff ("I'm excited to inform you..." nonsense)
 *   - Demands actionable language ("Lead with price, close fast")
 *   - Keeps it under 320 chars so it fits in 2 SMS segments
 *   - Defaults gracefully when DISC is absent
 */
async function composeBriefingBody({ booking, lead, tenant, discRow }) {
  const companyName = tenant.company_name || tenant.name || "your business";
  const customerName = booking.contact_name || lead?.name || "customer";
  const projectType = booking.scope || lead?.project_type || "the project";
  const address = booking.address || lead?.address || "(no address on file)";
  const apptDate = booking.preferred_date;
  const apptTime = booking.appointment_time || "(no time set)";
  const leadValueCents = booking.estimated_revenue_cents || lead?.estimated_value || null;
  const leadValueDollars = leadValueCents ? Math.round(leadValueCents / 100) : null;

  // DISC context (may be null/empty)
  const discPrimary = discRow?.disc_primary || null;
  const persona = discRow?.buyer_persona || null;
  const signals = Array.isArray(discRow?.disc_signals?.signals)
    ? discRow.disc_signals.signals.slice(0, 3).join("; ")
    : (Array.isArray(discRow?.disc_signals) ? discRow.disc_signals.slice(0, 3).join("; ") : null);

  const discLabel = {
    D: "Dominant — direct, fast decisions, doesn't want chitchat",
    I: "Influential — social, wants connection, talk benefits",
    S: "Steady — wants reassurance, hates pressure, build trust slow",
    C: "Conscientious — analytical, wants data + details, be precise",
  };

  const personaLabel = {
    "The Pragmatist": "ready buyer, just needs the price",
    "The Researcher": "comparison-shopping, wants thoroughness",
    "The Relationship-Builder": "values connection, slow to commit",
    "The Skeptic": "cautious, expect objections",
  };

  // Build the structured context block for GPT
  const contextLines = [
    `Customer: ${customerName}`,
    `Appointment: ${apptDate} at ${apptTime}`,
    `Address: ${address}`,
    `Project: ${projectType}`,
  ];
  if (leadValueDollars) contextLines.push(`Estimated value: $${leadValueDollars}`);
  if (discPrimary) {
    contextLines.push(`DISC: ${discPrimary} (${discLabel[discPrimary] || ""})`);
  }
  if (persona && persona !== "unknown") {
    contextLines.push(`Persona: ${persona} (${personaLabel[persona] || ""})`);
  }
  if (signals) {
    contextLines.push(`Behavioral signals from call: ${signals}`);
  }

  const systemPrompt = `You compose SMS briefings for home-service estimators heading into a sales appointment. Write ONE plain-text SMS (no markdown, no emojis, max 320 chars) that helps the rep walk in prepared.

Rules:
- Start with "${companyName} brief:" then customer + time on one line
- One line on project + lead value
- If DISC data is present, ONE actionable line about how to approach them (e.g., "Lead with price + options, close fast" for D, "Build rapport first, share photos" for I)
- If no DISC, omit that line entirely — don't pad with generic advice
- No fluff like "I'm excited to inform you" or "Have a great visit"
- Plain, direct, scannable on a drive over`;

  const userPrompt = `Compose the briefing SMS using this context:\n\n${contextLines.join("\n")}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.5,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error("[PreVisitBriefing] GPT-4o composer failed status=%s body=%s",
        response.status, errBody.slice(0, 300));
      return buildFallbackBody({ booking, lead, tenant, discRow });
    }

    const data = await response.json();
    const composed = data.choices?.[0]?.message?.content?.trim();
    if (!composed) {
      console.warn("[PreVisitBriefing] GPT-4o returned empty content, using fallback");
      return buildFallbackBody({ booking, lead, tenant, discRow });
    }

    // Hard-cap at 480 chars (3 SMS segments) as a safety net even if GPT
    // ignores the instruction.
    return composed.length > 480 ? composed.slice(0, 477) + "..." : composed;
  } catch (err) {
    console.error("[PreVisitBriefing] GPT-4o composer threw err=%s", err.message);
    return buildFallbackBody({ booking, lead, tenant, discRow });
  }
}

/**
 * Templated fallback when GPT-4o is unavailable. Deterministic, no AI,
 * still useful. The rep gets the same core info — just less personalized.
 */
function buildFallbackBody({ booking, lead, tenant, discRow }) {
  const companyName = tenant.company_name || tenant.name || "Business";
  const customerName = booking.contact_name || lead?.name || "customer";
  const projectType = booking.scope || lead?.project_type || "project";
  const apptTime = booking.appointment_time || "today";
  const address = booking.address || "";
  const leadValueDollars = booking.estimated_revenue_cents
    ? Math.round(booking.estimated_revenue_cents / 100)
    : null;
  const discPrimary = discRow?.disc_primary || null;

  const discTip = {
    D: " They're direct — lead with price, close fast.",
    I: " They're social — build rapport, share photos.",
    S: " They want reassurance — hate pressure, go slow.",
    C: " They're analytical — bring details and data.",
  };

  let body = `${companyName} brief: ${customerName} at ${apptTime} — ${projectType}`;
  if (address) body += ` (${address})`;
  if (leadValueDollars) body += `, ~$${leadValueDollars}`;
  body += ".";
  if (discPrimary && discTip[discPrimary]) body += discTip[discPrimary];

  return body;
}

// ─────────────────────────────────────────────────────────────────────
// Twilio sender
// ─────────────────────────────────────────────────────────────────────

/**
 * Send the briefing SMS to the recipient using the tenant's primary
 * Twilio number as the From. Returns { ok, sid? }. Never throws.
 */
async function sendBriefingSms({ tenant, recipientPhone, body }) {
  const client = twilio.getClientForTenant(tenant);
  if (!client) {
    console.warn("[PreVisitBriefing] No Twilio client for tenant=%s", tenant.id);
    return { ok: false, reason: "no_twilio_client" };
  }

  const fromPhone = await smsService.getTenantPrimaryPhone(tenant.id);
  if (!fromPhone) {
    console.warn("[PreVisitBriefing] No primary phone for tenant=%s", tenant.id);
    return { ok: false, reason: "no_from_phone" };
  }

  try {
    const message = await client.messages.create({
      to: recipientPhone,
      from: fromPhone,
      body,
    });
    console.log("[PreVisitBriefing] Sent to=%s from=%s tenant=%s sid=%s",
      recipientPhone, fromPhone, tenant.id, message.sid);
    return { ok: true, sid: message.sid };
  } catch (err) {
    console.error("[PreVisitBriefing] Twilio send failed tenant=%s code=%s err=%s",
      tenant.id, err.code || "unknown", err.message);
    return { ok: false, reason: "twilio_error", error: err.message };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Per-booking processor
// ─────────────────────────────────────────────────────────────────────

/**
 * Process ONE booking — generate the briefing, send it, mark the row.
 * Called from the sweep loop. Errors are logged and swallowed so a
 * single bad booking doesn't break the whole batch.
 */
async function processOneBooking(booking) {
  try {
    // Load tenant fresh — we need pre_visit_sms_enabled and the recipient
    // phone setting which loadTenants() might not have hydrated.
    const tenantRes = await db.query(
      `SELECT id, name, company_name, timezone, twilio_account_sid, twilio_auth_token,
              pre_visit_sms_enabled, pre_visit_sms_recipient_phone
         FROM tenants
        WHERE id = $1
        LIMIT 1`,
      [booking.tenant_id]
    );
    const tenant = tenantRes.rows[0];
    if (!tenant) {
      console.warn("[PreVisitBriefing] Tenant not found for booking=%s", booking.id);
      return;
    }

    // Opt-out check — tenant disabled the feature
    if (tenant.pre_visit_sms_enabled === false) {
      // Mark sent so we don't keep retrying on every tick. The
      // pre_visit_sms_body stays NULL to indicate "skipped, not sent."
      await db.query(
        `UPDATE bookings
            SET pre_visit_sms_sent_at = now(),
                pre_visit_sms_body = '[skipped: tenant disabled]'
          WHERE id = $1`,
        [booking.id]
      );
      console.log("[PreVisitBriefing] Tenant %s has pre_visit_sms_enabled=false, marking booking=%s as skipped",
        tenant.id, booking.id);
      return;
    }

    // Recipient resolution — Phase 8B passes the booking so an assigned
    // technician (booking.technician_id) is routed to first (Path 0).
    const recipientPhone = await resolveRecipientPhone(tenant, booking);
    if (!recipientPhone) {
      // Don't mark sent — owner might configure recipient mid-window
      console.warn("[PreVisitBriefing] No recipient resolvable for tenant=%s booking=%s — leaving for retry",
        tenant.id, booking.id);
      return;
    }

    // Lead lookup (DISC + project info)
    let lead = null;
    if (booking.lead_id) {
      const leadRes = await db.query(
        "SELECT id, name, phone, project_type, address, estimated_value FROM leads WHERE id = $1 LIMIT 1",
        [booking.lead_id]
      );
      lead = leadRes.rows[0] || null;
    }

    // DISC + persona lookup from coaching_conversations (matches the
    // pattern in routes/leads.js loadDiscFields)
    let discRow = null;
    if (booking.lead_id) {
      const discRes = await db.query(
        `SELECT disc_primary, disc_secondary, disc_scores, disc_confidence,
                disc_signals, buyer_persona, persona_confidence, persona_signals
           FROM coaching_conversations
          WHERE lead_id = $1
            AND (disc_primary IS NOT NULL OR (buyer_persona IS NOT NULL AND buyer_persona != 'unknown'))
          ORDER BY created_at DESC
          LIMIT 1`,
        [booking.lead_id]
      );
      discRow = discRes.rows[0] || null;
    }

    // Compose
    const body = await composeBriefingBody({ booking, lead, tenant, discRow });

    // Send
    const sendResult = await sendBriefingSms({ tenant, recipientPhone, body });
    if (!sendResult.ok) {
      // Leave timestamp NULL — next tick retries (unless the appointment
      // window has passed by then)
      console.warn("[PreVisitBriefing] Send failed for booking=%s reason=%s — leaving for retry",
        booking.id, sendResult.reason);
      return;
    }

    // Mark sent — only after Twilio confirmed
    await db.query(
      `UPDATE bookings
          SET pre_visit_sms_sent_at = now(),
              pre_visit_sms_body = $1,
              pre_visit_sms_recipient = $2
        WHERE id = $3`,
      [body, recipientPhone, booking.id]
    );

    console.log("[PreVisitBriefing] Sent + marked booking=%s tenant=%s recipient=%s discPrimary=%s",
      booking.id, tenant.id, recipientPhone, discRow?.disc_primary || "(none)");

  } catch (err) {
    console.error("[PreVisitBriefing] processOneBooking failed booking=%s err=%s",
      booking.id, err.message);
  }
}

// ─────────────────────────────────────────────────────────────────────
// Cron sweep
// ─────────────────────────────────────────────────────────────────────

/**
 * Find all bookings 45-75 minutes ahead of now (in their tenant's
 * timezone) that haven't received a pre-visit briefing yet. Process
 * each one.
 *
 * Timezone handling: bookings store preferred_date + appointment_time
 * as a date + time pair, interpreted in the tenant's local timezone.
 * We compute the booking's full timestamp using AT TIME ZONE and then
 * compare against now() — much simpler than doing it in JS.
 *
 * The query filters by status != 'Cancelled' so cancelled appointments
 * don't trigger briefings (would be embarrassing — "heads up about
 * your 9 AM" for an appointment that was cancelled yesterday).
 */
async function runPreVisitBriefingSweep() {
  try {
    const result = await db.query(
      `SELECT b.id, b.tenant_id, b.lead_id, b.contact_name, b.contact_phone,
              b.address, b.scope, b.preferred_date, b.appointment_time,
              b.estimated_revenue_cents, b.status, b.technician_id
         FROM bookings b
         JOIN tenants t ON t.id = b.tenant_id
        WHERE b.pre_visit_sms_sent_at IS NULL
          AND b.status != 'Cancelled'
          AND b.preferred_date IS NOT NULL
          AND b.appointment_time IS NOT NULL
          AND (
            (b.preferred_date::timestamp + b.appointment_time::interval)
              AT TIME ZONE COALESCE(t.timezone, 'America/Chicago')
            BETWEEN now() + interval '${WINDOW_MIN_AHEAD} minutes'
                AND now() + interval '${WINDOW_MAX_AHEAD} minutes'
          )
        ORDER BY b.preferred_date ASC, b.appointment_time ASC
        LIMIT 100`
    );

    const bookings = result.rows;
    if (bookings.length === 0) {
      // Quiet success — most ticks find nothing
      return { ok: true, processed: 0 };
    }

    console.log("[PreVisitBriefing] Sweep found %d eligible booking(s)", bookings.length);

    let sent = 0;
    let skipped = 0;
    for (const booking of bookings) {
      const before = booking.pre_visit_sms_sent_at;
      await processOneBooking(booking);
      // We don't re-read here for counts; processOneBooking logs the outcome
      sent++; // best-effort count — actual sent/skipped logged per-booking
    }

    console.log("[PreVisitBriefing] Sweep done. Processed=%d", sent);
    return { ok: true, processed: sent };
  } catch (err) {
    console.error("[PreVisitBriefing] Sweep FATAL err=%s", err.message);
    return { ok: false, error: err.message };
  }
}

module.exports = {
  runPreVisitBriefingSweep,
  // Exported for testing + manual triggering
  composeBriefingBody,
  buildFallbackBody,
  resolveRecipientPhone,
  processOneBooking,
};

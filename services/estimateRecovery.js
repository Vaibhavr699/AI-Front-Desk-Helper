"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");
const { getLast10Digits, normalizeE164Phone } = require("../lib/phone");
const { canSendRecovery, getCadenceDays, getCustomCadenceSteps } = require("../lib/recoverySettings");
// Phase 10E (May 27, 2026) — DISC-adaptive cadence helper. Scales the
// static delayHours in each sequence step based on the lead's DISC
// classification + tenant settings. Falls back to the base delay for
// any no-op condition (toggle off, no lead, no DISC, low confidence,
// DB error) so it's a transparent layer on top of the existing engine.
const { applyDiscMultiplier } = require("../lib/discCadence");

function normalizeRecoveryPhone(raw) {
  const value = String(raw || "").trim();
  return normalizeE164Phone(value) || value;
}

// ─────────────────────────────────────────────────────────
// SEQUENCE DEFINITIONS
// ─────────────────────────────────────────────────────────

/**
 * REVISED 21-day Ghost Sequence
 *
 * Day 0  → SMS: estimate confirmation
 * Day 1  → SMS: check-in / questions
 * Day 3  → SMS: value reminder (what makes us different)
 * Day 5  → CALL + voicemail: first AI call attempt
 * Day 7  → SMS: urgency — schedule filling up
 * Day 10 → CALL + voicemail: second AI call attempt
 * Day 14 → SMS: soft close
 * Day 17 → CALL + voicemail: final AI call attempt
 * Day 21 → SMS: hard close → DORMANT → seasonal campaigns
 *
 * NOTE (Phase 10E, May 27 2026): the delayHours values below are BASE
 * delays. When DISC-adaptive cadence is enabled on a tenant, the actual
 * wall-clock delay is scaled by the lead's DISC bucket multiplier via
 * lib/discCadence.applyDiscMultiplier. The Phase 10B preset filter
 * (GHOST_STEP_DAYS in executeStep) still uses these as canonical day
 * offsets for preset bucketing — DISC scales the timing, not the bucket
 * identity. So a "day10_call" step always counts as a day-10 preset
 * candidate even when DISC pulls it forward to day 6 in wall-clock time.
 */
const GHOST_SEQUENCE = [
  {
    step: "estimate_sent",
    channel: "sms",
    delayHours: 0,
    message: (v) =>
      `Hi ${v.first_name}! Your estimate from ${v.company_name} is ready. Take a look and let us know if you have any questions — we'd love to get you on the schedule!`,
    next: "day1_checkin",
  },
  {
    step: "day1_checkin",
    channel: "sms",
    delayHours: 24,
    message: (v) =>
      `Hey ${v.first_name}, just checking in — did you get a chance to review your estimate? Happy to answer any questions or adjust anything before we lock in your spot.`,
    next: "day3_value",
  },
  {
    step: "day3_value",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Quick note from ${v.company_name} — every project includes a detailed walkthrough, color consultation, and our satisfaction guarantee. We want to make sure you feel great about every detail. Still interested?`,
    next: "day5_call",
  },
  {
    step: "day5_call",
    channel: "call",
    delayHours: 48,
    script:
      "Hi {{first_name}}, this is the AI assistant from {{company_name}}. I'm just calling to follow up on the estimate we sent over. Did you have a chance to look at it, or do you have any questions I can help with? We'd love to get your project on the schedule.",
    voicemail:
      "Hi {{first_name}}, it's {{company_name}} following up on the estimate we sent over. I wanted to make sure it came through okay and see if you had any questions. The easiest thing is to just reply to our text thread — I'll pick it right up. Talk soon!",
    next: "day7_urgency",
  },
  {
    step: "day7_urgency",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Hi ${v.first_name}! ${v.company_name} here — our schedule is starting to fill up for the coming weeks. If you'd like to lock in your spot, now is a great time. Just reply YES and we'll get you scheduled!`,
    next: "day10_call",
  },
  {
    step: "day10_call",
    channel: "call",
    delayHours: 72,
    script:
      "Hi {{first_name}}, this is {{company_name}} reaching out again about your project estimate. I wanted to personally make sure you had everything you need to feel comfortable moving forward. Is there anything holding you back or any questions I can answer?",
    voicemail:
     "Hi {{first_name}}, {{company_name}} again about your estimate. We're starting to book out a few weeks, so I wanted to check in before those slots fill. If you want to grab a spot or have any questions, just reply to our text — happy to help.",
    next: "day14_softclose",
  },
  {
    step: "day14_softclose",
    channel: "sms",
    delayHours: 96,
    message: (v) =>
      `Hi ${v.first_name}, still thinking things over? Totally understood — it's a big decision. We're here when you're ready. Just reply anytime and we'll pick right up where we left off. — ${v.company_name}`,
    next: "day17_call",
  },
  {
    step: "day17_call",
    channel: "call",
    delayHours: 72,
    script:
      "Hi {{first_name}}, this is {{company_name}} with one final follow-up on your project estimate. We want to make sure we haven't missed you. If now isn't the right time, no worries at all — we just want to make sure you're taken care of whenever you're ready.",
    voicemail:
      "Hi {{first_name}}, it's {{company_name}} with one last check-in on your estimate. If the timing's not right, no problem at all — but if you're still thinking about it, just reply to our text and let me know, even a quick yes or no helps. Thanks!",
    next: "day21_hardclose",
  },
  {
    step: "day21_hardclose",
    channel: "sms",
    delayHours: 96,
    message: (v) =>
      `Hi ${v.first_name}, we'll go ahead and close out this estimate request for now. If you ever want to revisit your project, we'd love to hear from you — just reach out anytime. Thanks for considering ${v.company_name}!`,
    next: null, // → DORMANT → seasonal campaigns
  },
];

/**
 * "Need to think about it" objection sequence.
 */
const THINKING_SEQUENCE = [
  {
    step: "thinking_ack",
    channel: "sms",
    delayHours: 0,
    message: (v) =>
      `Totally understand — it's a big decision. Is there anything specific you're weighing that I can help with?`,
    next: "thinking_48h_sms",
  },
  {
    step: "thinking_48h_sms",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Just checking back — are you still considering getting this done soon, or waiting a bit?`,
    next: "thinking_48h_call",
  },
  {
    step: "thinking_48h_call",
    channel: "call",
    delayHours: 4,
    script:
      "Just wanted to see where this sits for you so I can plan our schedule properly.",
    voicemail:
       "Hi {{first_name}}, just checking in on your project — no rush at all. Whenever you've got a minute, reply to our text and let me know where your head's at. Talk soon!",
    next: null,
  },
];

/**
 * "Price is high / getting other quotes" objection sequence.
 */
const PRICE_SEQUENCE = [
  {
    step: "price_ack",
    channel: "sms",
    delayHours: 0,
    message: (v) =>
      `I completely understand — most homeowners compare 2–3 options. Besides price, is there anything else important in your decision?`,
    next: "price_48h_sms",
  },
  {
    step: "price_48h_sms",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Quick question — if everything else felt right, would you feel comfortable moving forward?`,
    next: "price_48h_call",
  },
  {
    step: "price_48h_call",
    channel: "call",
    delayHours: 4,
    script:
      "If there's a budget target you're trying to hit, I can see if there's any flexibility.",
    voicemail:
       "Hi {{first_name}}, {{company_name}} about your estimate — if the number's a concern, we may have some flexibility. Reply to our text and let's see what we can do.",
    next: null,
  },
];

/**
 * "Need to talk to spouse" objection sequence.
 */
const SPOUSE_SEQUENCE = [
  {
    step: "spouse_ack",
    channel: "sms",
    delayHours: 0,
    message: (v) =>
      `Of course — would it help if I sent over a quick summary you can share?`,
    next: "spouse_2d_sms",
  },
  {
    step: "spouse_2d_sms",
    channel: "sms",
    delayHours: 48,
    message: (v) =>
      `Were you able to connect with them about it?`,
    next: "spouse_4d_call",
  },
  {
    step: "spouse_4d_call",
    channel: "call",
    delayHours: 48,
    script:
      "I just wanted to follow up — are we moving forward or should I release this spot?",
    voicemail:
       "Hi {{first_name}}, just following up to see if you and your partner had a chance to talk it over. No pressure — just reply to our text whenever you're ready and I'll help from there.",
    next: null,
  },
];

/**
 * Inquiry sequence (called but didn't book).
 */
const INQUIRY_SEQUENCE = [
  {
    step: "inquiry_thanks",
    channel: "sms",
    delayHours: 1,
    message: (v) =>
      `Hi ${v.first_name}! This is ${v.company_name}. I noticed we couldn't finish your booking inquiry earlier. Did you have any other questions I can help with?`,
    next: "inquiry_call",
  },
  {
    step: "inquiry_call",
    channel: "call",
    delayHours: 24,
    script:
      "Hi {{first_name}}, this is the AI assistant from {{company_name}}. I'm calling back to see if you were still interested in that painting project you called about? We have a few openings this week.",
    voicemail:
       "Hi {{first_name}}, it's {{company_name}} returning your call about your painting project. We've got a couple of openings this week for free estimates — if you'd like one, just reply to this text with a day that works and I'll get you on the calendar.",
    next: null,
  },
];

/**
 * 🆕 Missed-call sequence — when AI didn't answer (busy/failed/no-answer).
 *
 * Immediate SMS is sent by the caller of startMissedCallRecovery (not by this
 * sequence), so step 1 here is the 30-minute AI callback. If they replied to
 * the immediate SMS in the meantime, the cron job skips this step because
 * last_response_at will be set — OR the follow-up can be cancelled manually.
 *
 * 30 min → AI callback w/ voicemail detection
 * Day 1  → second AI callback attempt (catches the morning-after hot leads)
 * Done   → DORMANT → seasonal campaigns
 */
const MISSED_CALL_SEQUENCE = [
  {
    step: "missed_call_30min",
    channel: "call",
    delayHours: 0.5, // 30 minutes
    script:
      "Hi {{first_name}}, this is the AI assistant calling back from {{company_name}}. I noticed we missed your call a little while ago and wanted to reach out right away. What can I help you with today?",
    voicemail:
       "Hi, it's {{company_name}} — sorry we missed you a few minutes ago! I'd love to help with whatever you called about. Just reply to this text and tell me what you need — I'll get right back to you.",
    next: "missed_call_24h",
  },
  {
    step: "missed_call_24h",
    channel: "call",
    delayHours: 23.5, // ~24h after the initial missed call (30min + 23.5h)
    script:
      "Hi {{first_name}}, this is {{company_name}} following up on the call we missed yesterday. I just wanted to personally make sure we didn't leave you hanging. Were you looking for a painting estimate, or is there something specific I can help you with?",
    voicemail:
     "Hi, it's {{company_name}} following up on the call we missed yesterday. Still happy to help with your project — just reply to this text with what you're looking for and I'll take care of you from there.",
    next: null, // → DORMANT → seasonal campaigns
  },
];

// Facebook messages between SMS touches
const FACEBOOK_MESSAGES = [
  `Just wanted to make sure you saw the estimate we sent over 🙂`,
  `Let me know if you'd like to secure your spot.`,
];

// Objection type → sequence
const OBJECTION_SEQUENCES = {
  thinking: THINKING_SEQUENCE,
  price:    PRICE_SEQUENCE,
  spouse:   SPOUSE_SEQUENCE,
};

// All sequences flattened for step lookup
const ALL_STEPS = new Map();
for (const seq of [
  GHOST_SEQUENCE,
  THINKING_SEQUENCE,
  PRICE_SEQUENCE,
  SPOUSE_SEQUENCE,
  INQUIRY_SEQUENCE,
  MISSED_CALL_SEQUENCE,
]) {
  for (const s of seq) ALL_STEPS.set(s.step, s);
}

// ─────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────

function addHours(d, h) {
  const out = new Date(d);
  out.setTime(out.getTime() + h * 60 * 60 * 1000);
  return out;
}

function addDays(d, days) {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function getFirstName(fullName) {
  if (!fullName) return "there";
  return fullName.split(/\s+/)[0] || "there";
}

// ─────────────────────────────────────────────────────────
// CUSTOM CADENCE SUPPORT (Phase A — June 8, 2026)
//
// Custom cadences don't use the fixed GHOST_SEQUENCE linked list. Instead
// they're driven by the tenant's custom_cadence_days array (normalized to
// {day, channel}[] by recoverySettings.getCustomCadenceSteps). Progress is
// tracked by encoding the current day in recovery.current_step as
// "custom_day_<N>" — no schema migration, and it survives mid-recovery edits
// to the array because we advance by "next day greater than current", not by
// array index.
//
// Model decision (June 8): the custom array is FULLY AUTHORITATIVE. There is
// no implicit day-0 confirmation — if the tenant doesn't list day 0, the
// customer's first contact is whatever the lowest listed day is.
// ─────────────────────────────────────────────────────────

function encodeCustomStep(day) {
  return `custom_day_${day}`;
}
function decodeCustomStep(step) {
  const m = /^custom_day_(\d+)$/.exec(step || "");
  return m ? parseInt(m[1], 10) : null;
}
function isCustomStep(step) {
  return /^custom_day_\d+$/.test(step || "");
}

// Canonical day → GHOST step, used to source DEFAULT copy for a custom day.
// Phase A: a custom day reuses the copy of the nearest canonical step at or
// below it (day 30 borrows day-21 copy; day 2 borrows day-1 copy). Phase B
// will replace this with user-authored text when the cadence entry carries it.
const CANONICAL_DAY_TO_STEP = [
  [21, "day21_hardclose"],
  [17, "day17_call"],
  [14, "day14_softclose"],
  [10, "day10_call"],
  [7,  "day7_urgency"],
  [5,  "day5_call"],
  [3,  "day3_value"],
  [1,  "day1_checkin"],
  [0,  "estimate_sent"],
];

function nearestCanonicalStepForDay(day, channel) {
  // Prefer a canonical step whose channel matches AND whose day is <= the
  // custom day. Fall back to nearest-by-day, then a hard default.
  let dayMatch = null;
  for (const [d, stepName] of CANONICAL_DAY_TO_STEP) {
    if (d <= day) {
      const stepDef = ALL_STEPS.get(stepName);
      if (!stepDef) continue;
      if (!dayMatch) dayMatch = stepDef;                 // nearest-by-day fallback
      if (stepDef.channel === channel) return stepDef;   // best: channel + day match
    }
  }
  return dayMatch || ALL_STEPS.get("estimate_sent");
}

// Substitute {{first_name}} / {{company_name}} tokens in user-written custom
// copy. (Phase B — June 8, 2026.) Canonical SMS copy uses ${v.x} JS templates
// substituted at call time; user-written copy uses {{x}} mustache tokens
// substituted here, matching the style already used by call scripts. Unknown
// tokens are left as literal text by design — a contractor's typo shouldn't
// error the send; they'll see the literal text and can fix it.
function substituteTokens(text, vars) {
  if (typeof text !== "string" || !text) return "";
  return text
    .replace(/\{\{\s*first_name\s*\}\}/gi, vars.first_name || "there")
    .replace(/\{\{\s*company_name\s*\}\}/gi, vars.company_name || "");
}

// Build the touch payload for a custom cadence entry {day, channel}.
//
// Phase B: PREFER user-authored text (entry.message / entry.script /
// entry.voicemail) when present and non-blank; otherwise fall back to the
// nearest canonical step's copy (Phase A behavior). Each field falls back
// INDEPENDENTLY — e.g. a call day with a custom script but no voicemail uses
// the canonical voicemail, not a reuse of the live script (different speech
// acts). User text gets {{token}} substitution; canonical SMS copy is a
// function evaluated with vars as before.
function buildCustomTouch(entry, vars) {
  const channel = entry.channel === "call" ? "call" : "sms";
  const src = nearestCanonicalStepForDay(entry.day, channel);

  const hasText = (v) => typeof v === "string" && v.trim().length > 0;

  if (channel === "sms") {
    let body;
    if (hasText(entry.message)) {
      body = substituteTokens(entry.message, vars);
    } else {
      body = typeof src.message === "function" ? src.message(vars) : (src.message || "");
    }
    return { channel: "sms", message: body };
  }

  // call — script + voicemail fall back independently to canonical defaults.
  const script = hasText(entry.script)
    ? substituteTokens(entry.script, vars)
    : (src.script || "");

  const voicemail = hasText(entry.voicemail)
    ? substituteTokens(entry.voicemail, vars)
    : (src.voicemail || src.script || "");

  return { channel: "call", script, voicemail };
}
// ─────────────────────────────────────────────────────────
// CORE: Start a recovery sequence
// ─────────────────────────────────────────────────────────

async function startRecovery(tenantId, bookingId, options = {}) {
  const existing = await db.query(
    "SELECT id FROM estimate_recoveries WHERE booking_id = $1 AND status = 'active'",
    [bookingId]
  );
  if (existing.rows.length > 0) {
    console.log("[Recovery] Already active for bookingId=%s", bookingId);
    return existing.rows[0];
  }

  const booking = await db.query("SELECT * FROM bookings WHERE id = $1", [bookingId]);
  if (!booking.rows[0]) return null;
  const b = booking.rows[0];

  const now = new Date();
  const firstStep = GHOST_SEQUENCE[0];
  // Phase 10E: scale first-step delay by DISC bucket if enabled. lead_id
  // comes from the booking row — may be null for legacy bookings, in
  // which case applyDiscMultiplier returns the base delay unchanged.
  const delayHours = await applyDiscMultiplier(firstStep.delayHours, b.lead_id || null, tenantId);
  const nextActionAt = addHours(now, delayHours);

  const res = await db.query(
    `INSERT INTO estimate_recoveries (
      tenant_id, booking_id, call_id, contact_name, contact_phone, contact_email,
      status, current_step, estimate_sent_at, next_action_at, lead_source, lead_id
    ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9, $10, $11)
    RETURNING *`,
    [
      tenantId,
      bookingId,
      b.call_id || options.call_id || null,
      b.contact_name || options.contact_name,
      b.contact_phone || options.contact_phone,
      b.contact_email || options.contact_email || null,
      firstStep.step,
      options.estimate_sent_at || now.toISOString(),
      nextActionAt.toISOString(),
      options.lead_source || "phone",
      b.lead_id || null,
    ]
  );
  console.log("[Recovery] Started id=%s tenant=%s booking=%s", res.rows[0].id, tenantId, bookingId);
  return res.rows[0];
}

async function startEstimateRecovery(tenantId, lead, options = {}) {
  const phone = normalizeRecoveryPhone(lead.phone || lead.contact_phone);
  if (!phone) return null;
  const last10 = getLast10Digits(phone);

  const existing = await db.query(
    `SELECT id FROM estimate_recoveries
      WHERE tenant_id = $1
        AND status = 'active'
        AND (
          contact_phone = $2
          OR right(regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10) = $3
        )`,
    [tenantId, phone, last10]
  );
 if (existing.rows.length > 0) return existing.rows[0];

  // ───────────────────────────────────────────────────────────────────
  // Creation-time master gate (June 8, 2026 — Option A).
  //
  // Only check the DURABLE config fact: is estimate recovery fundamentally
  // ON for this tenant? (recovery_enabled master + trigger_estimate_recovery).
  // We deliberately do NOT check quiet hours / cadence / per-channel here —
  // those are TIMING decisions evaluated at send time in executeStep, so a
  // recovery created during quiet hours still gets created and simply waits.
  //
  // This stops accumulating phantom 'active' recoveries (and the premature
  // notifications they triggered) for tenants who have recovery turned off,
  // e.g. Paragon Exteriors with recovery_enabled=false. Gating here is
  // defense-in-depth: executeStep's canSendRecovery still catches a tenant
  // who flips the toggle off AFTER a recovery is created.
  // ───────────────────────────────────────────────────────────────────
 let creationSettings = null;
  try {
    const masterGate = await canSendRecovery({
      tenantId,
      channel: "sms",
      trigger: "estimate_recovery",
      leadId:  lead.id || null,
    });
    // gate.settings is populated whenever the gate didn't short-circuit on a
    // pre-settings condition; capture it so we can detect custom cadence
    // without a second query. May be null if blocked early — handled below.
    creationSettings = masterGate.settings || null;
    // Block creation only on reasons that mean recovery is FUNDAMENTALLY off
    // for this tenant. canSendRecovery returns these exact strings:
    //   master_off                 → recovery_enabled = false
    //   estimate_recovery_disabled → trigger_estimate_recovery = false
    // Everything else (sms_disabled, voice_disabled, quiet_hours, lead_*) is
    // a per-channel or timing decision handled at send time — let those
    // through so the recovery is created and simply defers/skips later.
    const CREATION_BLOCK_REASONS = ["master_off", "estimate_recovery_disabled"];
    if (!masterGate.allowed && CREATION_BLOCK_REASONS.includes(masterGate.reason)) {
      console.log(
        "[Recovery] Creation gated tenant=%s reason=%s — not creating recovery",
        tenantId, masterGate.reason
      );
      return null;
    }
  } catch (gateErr) {
    // Fail-open on gate error: better to create the recovery (which is then
    // gated again at send time) than to silently drop a real lead on a DB hiccup.
    console.error("[Recovery] Creation gate check failed tenant=%s err=%s — proceeding (send-time gate still applies)", tenantId, gateErr.message);
  }

  const now = new Date();

  // ───────────────────────────────────────────────────────────────────
  // First-step selection (Phase A — June 8, 2026).
  //
  // If the tenant is on the CUSTOM preset, enter the custom path: the first
  // step is "custom_day_<lowestDay>" and the first action fires after that
  // many days. The custom array is fully authoritative — there is no implicit
  // day-0 confirmation unless the tenant listed day 0.
  //
  // Otherwise use the standard GHOST_SEQUENCE day-0 entry as before.
  //
  // If settings couldn't be read (creationSettings null) we fall back to the
  // standard ghost path — safe default, send-time gating still applies.
  // ───────────────────────────────────────────────────────────────────
  let firstStepName;
  let baseDelayHours;

  // ───────────────────────────────────────────────────────────────────
  // First-step selection — custom cadence detection (FIXED Jun 17, 2026).
  //
  // ROOT CAUSE (Shawn Kruger / Paragon, Jun 10): creationSettings was
  // sourced from masterGate.settings, which canSendRecovery may leave null
  // when it short-circuits. When null, the OLD code fell through to the
  // GHOST_SEQUENCE day-0 "estimate_sent" step with delayHours=0 — firing an
  // immediate "your estimate is ready" SMS even though Paragon is on a
  // CUSTOM day-30 cadence. The day-30 schedule was silently bypassed.
  //
  // The fallback-to-ghost-day-0 is NOT safe for a custom-cadence tenant:
  // it sends a message they explicitly configured not to send, at day 0.
  //
  // FIX: do not trust the gate's side-channel settings. Read the recovery
  // settings DIRECTLY (same call executeCustomStep already uses), so custom
  // detection is reliable regardless of how the gate resolved. Only fall
  // back to ghost if we genuinely have no settings AND no custom preset.
  // ───────────────────────────────────────────────────────────────────
  let settingsForCadence = creationSettings;
  if (!settingsForCadence) {
    try {
      settingsForCadence = await require("../lib/recoverySettings").getRecoverySettings(tenantId);
    } catch (e) {
      console.error("[Recovery] direct getRecoverySettings failed at creation tenant=%s err=%s", tenantId, e.message);
    }
  }

  let customSteps = [];
  try {
    if (settingsForCadence && settingsForCadence.cadence_preset === "custom") {
      customSteps = getCustomCadenceSteps(settingsForCadence, null);
    }
  } catch (e) {
    console.error("[Recovery] getCustomCadenceSteps failed at creation tenant=%s err=%s", tenantId, e.message);
  }

  if (customSteps.length > 0) {
    const firstDay = customSteps[0].day;
    firstStepName  = encodeCustomStep(firstDay);
    baseDelayHours = firstDay * 24;
    console.log(
      "[Recovery] Custom cadence creation tenant=%s firstDay=%d channel=%s steps=%j",
      tenantId, firstDay, customSteps[0].channel, customSteps.map((s) => `${s.day}:${s.channel}`)
    );
  } else if (settingsForCadence && settingsForCadence.cadence_preset === "custom") {
    // Custom preset but the array resolved empty (misconfigured/blank). Do
    // NOT fall back to an immediate ghost day-0 send — that's the exact bug.
    // Decline to create the recovery; a custom cadence with no usable steps
    // has nothing to send. Consistent with the other "nothing to do" returns.
    console.log(
      "[Recovery] Custom preset but no usable cadence steps tenant=%s — not creating (would have wrongly defaulted to ghost day-0)",
      tenantId
    );
    return null;
  } else {
    firstStepName  = GHOST_SEQUENCE[0].step;
    baseDelayHours = GHOST_SEQUENCE[0].delayHours;
  }

  // Phase 10E: scale first-step delay by DISC bucket if enabled.
  const delayHours = await applyDiscMultiplier(baseDelayHours, lead.id || null, tenantId);
  const nextActionAt = addHours(now, delayHours);

  const res = await db.query(
    `INSERT INTO estimate_recoveries (
      tenant_id, lead_id, call_id, contact_name, contact_phone, contact_email,
      status, current_step, next_action_at, lead_source
    ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, $9)
    RETURNING *`,
    [
      tenantId,
      lead.id || null,
      options.call_id || null,
     lead.name || lead.contact_name || null,
      phone,
      lead.email || lead.contact_email || null,
      firstStepName,
      nextActionAt.toISOString(),
      options.lead_source || "crm_webhook",
    ]
  );
console.log("[Recovery] Estimate recovery started id=%s tenant=%s phone=%s", res.rows[0].id, tenantId, phone);

  // NOTE (June 8, 2026): the "AI Follow-Up Started" notification used to fire
  // HERE, at creation, before any gate ran — which produced phantom alerts
  // for recoveries that were then suppressed at send time (Paragon bug). It
  // now fires from executeStep AFTER the first touch actually goes out, so a
  // notification reliably means a real message was sent. See executeStep.

  return res.rows[0];
}

async function startInquiryRecovery(tenantId, lead, options = {}) {
  const phone = normalizeRecoveryPhone(lead.phone || lead.contact_phone);
  if (!phone) return null;
  const last10 = getLast10Digits(phone);

  const existing = await db.query(
    `SELECT id FROM estimate_recoveries
      WHERE tenant_id = $1
        AND status = 'active'
        AND (
          contact_phone = $2
          OR right(regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10) = $3
        )`,
    [tenantId, phone, last10]
  );
  if (existing.rows.length > 0) return existing.rows[0];

  const now = new Date();
  const firstStep = INQUIRY_SEQUENCE[0];
  // Phase 10E: scale first-step delay by DISC bucket if enabled.
  const delayHours = await applyDiscMultiplier(firstStep.delayHours, lead.id || null, tenantId);
  const nextActionAt = addHours(now, delayHours);

  const res = await db.query(
    `INSERT INTO estimate_recoveries (
      tenant_id, lead_id, call_id, contact_name, contact_phone, contact_email,
      status, current_step, next_action_at, lead_source
    ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, 'inquiry')
    RETURNING *`,
    [
      tenantId,
      lead.id || null,
      options.call_id || null,
      lead.name || lead.contact_name || null,
      phone,
      lead.email || lead.contact_email || null,
      firstStep.step,
      nextActionAt.toISOString(),
    ]
  );
  console.log("[Recovery] Inquiry started id=%s tenant=%s phone=%s", res.rows[0].id, tenantId, phone);
  return res.rows[0];
}

/**
 * 🆕 Start missed-call recovery (Option B).
 *
 * Called from routes/twilio.js /status handler when Twilio reports the call
 * as busy/failed/no-answer. The IMMEDIATE "sorry we missed your call" SMS is
 * sent by the caller before invoking this function — this sets up the
 * follow-up call cadence:
 *   - 30 minutes:  first AI callback
 *   - ~24 hours:   second AI callback
 *   - dormant →    seasonal campaigns
 *
 * Dedupe: if an active recovery already exists for this phone (any type),
 * skip — don't stack recoveries for the same caller.
 */
async function startMissedCallRecovery(tenantId, lead, options = {}) {
  const phone = normalizeRecoveryPhone(lead.phone || lead.contact_phone);
  if (!phone) return null;
  const last10 = getLast10Digits(phone);

  const existing = await db.query(
    `SELECT id FROM estimate_recoveries
      WHERE tenant_id = $1
        AND status = 'active'
        AND (
          contact_phone = $2
          OR right(regexp_replace(COALESCE(contact_phone, ''), '[^0-9]', '', 'g'), 10) = $3
        )`,
    [tenantId, phone, last10]
  );
  if (existing.rows.length > 0) {
    console.log("[Recovery] Missed-call dedupe: recovery already active for %s", phone);
    return existing.rows[0];
  }

  const now          = new Date();
  const firstStep    = MISSED_CALL_SEQUENCE[0];
  // Phase 10E: scale first-step delay by DISC bucket if enabled. Note that
  // most missed-call recoveries fire so soon after the call (30 min base)
  // that DISC may not be classified yet — applyDiscMultiplier will return
  // the base delay unchanged in that case.
  const delayHours = await applyDiscMultiplier(firstStep.delayHours, lead.id || null, tenantId);
  const nextActionAt = addHours(now, delayHours);

  const res = await db.query(
    `INSERT INTO estimate_recoveries (
      tenant_id, lead_id, call_id, contact_name, contact_phone, contact_email,
      status, current_step, next_action_at, lead_source
    ) VALUES ($1, $2, $3, $4, $5, $6, 'active', $7, $8, 'missed_call')
    RETURNING *`,
    [
      tenantId,
      lead.id || null,
      options.call_id || null,
     lead.name || lead.contact_name || null,
      phone,
      lead.email || lead.contact_email || null,
      firstStep.step,
      nextActionAt.toISOString(),
    ]
  );
  console.log(
    "[Recovery] Missed-call recovery started id=%s tenant=%s phone=%s next=%s",
    res.rows[0].id,
    tenantId,
    phone,
    nextActionAt.toISOString()
  );
  return res.rows[0];
}

// ─────────────────────────────────────────────────────────
// DNC SUPPRESSION (Migration 059, May 8 2026)
// ─────────────────────────────────────────────────────────

/**
 * Check whether a recovery should be blocked from sending due to a
 * do_not_contact flag on a matching lead.
 *
 * Two ways to match:
 *   1. recovery.lead_id directly references a DNC'd lead.
 *   2. recovery.contact_phone matches any DNC'd lead in the same tenant
 *      (covers cases where the recovery was created without lead_id).
 *
 * Cheap query thanks to the partial index idx_leads_do_not_contact —
 * the WHERE do_not_contact = true predicate scans only flagged rows.
 *
 * Returns true if blocked, false if safe to proceed.
 */
async function isRecoveryBlocked(recovery) {
  if (!recovery) return false;

  // Path 1: linked lead is DNC
  if (recovery.lead_id) {
    const r = await db.query(
      "SELECT 1 FROM leads WHERE id = $1 AND do_not_contact = true LIMIT 1",
      [recovery.lead_id]
    );
    if (r.rows.length > 0) return true;
  }

  // Path 2: any same-phone lead in this tenant is DNC. Matches both
  // E.164 exact and last-10-digit normalized form to catch +14025551234
  // vs (402) 555-1234 vs 4025551234.
  if (recovery.contact_phone && recovery.tenant_id) {
    const last10 = getLast10Digits(recovery.contact_phone);
    const r = await db.query(
      `SELECT 1 FROM leads
        WHERE tenant_id = $1
          AND do_not_contact = true
          AND (
            phone = $2
            OR right(regexp_replace(COALESCE(phone, ''), '[^0-9]', '', 'g'), 10) = $3
          )
        LIMIT 1`,
      [recovery.tenant_id, recovery.contact_phone, last10]
    );
    if (r.rows.length > 0) return true;
  }

  return false;
}

// ─────────────────────────────────────────────────────────
// SENTIMENT SUPPRESSION (Bug #6, May 13, 2026)
// ─────────────────────────────────────────────────────────

/**
 * Check whether the customer recently expressed anger or complaint
 * that should pause this recovery sequence.
 *
 * Bug #6 fix: the Bob Prange transcript (May 13) showed recovery touches
 * continuing to fire even after the customer texted angrily about service
 * failures. Sentiment-aware suppression: if any inbound message in the
 * last 48 hours matches anger or complaint patterns, pause the recovery
 * (reschedule, don't cancel — they might calm down) and check again on
 * the next tick.
 *
 * Keyword-based detection by design: fast (regex), deterministic (no
 * OpenAI hallucination), and matches the patterns we've seen in actual
 * angry-customer transcripts. Upgrade to OpenAI sentiment call later if
 * we want nuance.
 *
 * Used by:
 *  - executeStep() in this file (recovery touches)
 *  - runSmsFollowUps() in server.js (SMS thread nurture loop)
 *
 * Returns true if recovery should pause, false to proceed normally.
 * Fails open on DB errors — better to send than to skip silently.
 */
async function hasRecentNegativeSentiment(tenantId, contactPhone, lookbackHours = 48) {
  if (!contactPhone || !tenantId) return false;

  const last10 = getLast10Digits(contactPhone);

  try {
    const res = await db.query(
      `SELECT m.body, m.created_at
         FROM messages m
         JOIN leads l ON l.id = m.lead_id
        WHERE m.tenant_id = $1
          AND m.direction = 'inbound'
          AND m.created_at > now() - ($4::text || ' hours')::interval
          AND (
            l.phone = $2
            OR right(regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g'), 10) = $3
          )
        ORDER BY m.created_at DESC
        LIMIT 20`,
      [tenantId, contactPhone, last10, lookbackHours]
    );

    if (res.rows.length === 0) return false;

    const negativePatterns = [
      /\b(angry|furious|frustrated|pissed|mad|upset|annoyed)\b/i,
      /\b(terrible|awful|horrible|disgusting|garbage)\b/i,
      /\bnever (show|came|showed)/i,
      /\b(ripped off|rip[- ]?off|scam|fraud|cheated)\b/i,
      /\b(lawyer|sue|sued|suing|court|bbb|better business|attorney)\b/i,
      /\b(refund|money back|charge[- ]?back)\b/i,
      /\b(stop calling|leave me alone|harass)\b/i,
      /\b(ridiculous|unacceptable|outrageous)\b/i,
      /\b(complaint|complain|complaining)\b/i,
      /\byou guys (suck|are (the )?(worst|terrible|awful|useless))\b/i,
      /\bthis is (bs|bullshit|absurd)\b/i,
    ];

    for (const msg of res.rows) {
      for (const pattern of negativePatterns) {
        if (pattern.test(msg.body)) {
          console.log(
            "[Recovery] Negative sentiment detected from=%s msg=%s",
            contactPhone,
            (msg.body || "").slice(0, 100)
          );
          return true;
        }
      }
    }
    return false;
  } catch (err) {
    console.error("[Recovery] Sentiment check failed:", err.message);
    return false;
  }
}

// ─────────────────────────────────────────────────────────
// CORE: Process due recovery actions (called by cron)
// ─────────────────────────────────────────────────────────

async function processDueRecoveries() {
  const res = await db.query(
    `SELECT er.*, t.company_name, t.name as tenant_name
     FROM estimate_recoveries er
     JOIN tenants t ON t.id = er.tenant_id
     WHERE er.status = 'active'
       AND er.next_action_at <= now()
       -- DNC suppression (Migration 059): skip if the linked lead is flagged.
       AND NOT EXISTS (
         SELECT 1 FROM leads l
         WHERE l.id = er.lead_id
           AND l.do_not_contact = true
       )
       -- DNC suppression: skip if any same-phone lead in this tenant is
       -- flagged. Catches recoveries where lead_id was never linked but
       -- the customer exists in leads under the same number.
       AND NOT EXISTS (
         SELECT 1 FROM leads l
         WHERE l.tenant_id = er.tenant_id
           AND l.do_not_contact = true
           AND (
             l.phone = er.contact_phone
             OR right(regexp_replace(COALESCE(l.phone, ''), '[^0-9]', '', 'g'), 10)
                = right(regexp_replace(COALESCE(er.contact_phone, ''), '[^0-9]', '', 'g'), 10)
           )
       )
     ORDER BY er.next_action_at
     LIMIT 50`
  );

  let processed = 0;
  for (const recovery of res.rows) {
    try {
      await executeStep(recovery);
      processed++;
    } catch (e) {
      console.error("[Recovery] Step failed id=%s step=%s error=%s", recovery.id, recovery.current_step, e.message);
    }
  }
  if (processed > 0) {
    console.log("[Recovery] Processed %d due recoveries", processed);
  }
}

// ─────────────────────────────────────────────────────────
// CORE: Execute a single step
// ─────────────────────────────────────────────────────────

async function executeStep(recovery) {
   console.log(
    "[Recovery] CHECKPOINT-A enter id=%s tenant=%s step=%s lead_source=%s contact=%s",
    recovery.id, recovery.tenant_id, recovery.current_step, recovery.lead_source, recovery.contact_phone
  );
  // Defense in depth (Migration 059): the SQL filter in processDueRecoveries
  // should prevent DNC'd recoveries from getting here, but a flag could be
  // flipped between the SELECT and now (window of ~ms-to-seconds). If we
  // find a blocked recovery here, cancel it so it stops cluttering the
  // active list, and never send.
  if (await isRecoveryBlocked(recovery)) {
    console.log("[Recovery] DNC blocked at executeStep id=%s phone=%s — auto-cancelling", recovery.id, recovery.contact_phone);
    await markCancelled(recovery.id);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Bug #6 fix (May 13, 2026) — sentiment-aware pause.
  //
  // The Bob Prange transcript revealed that the recovery system continues
  // firing follow-up touches even after the customer texted angrily about
  // service failures. Check for negative-sentiment phrases in inbound
  // messages over the last 48h. If found, reschedule for 24h out instead
  // of firing. The customer may cool off; if not, we'll pause again next
  // tick. Recovery resumes naturally once the angry window passes.
  //
  // We do NOT cancel — that would dump the recovery permanently. A legit
  // angry customer might still convert once their concern is resolved.
  // ─────────────────────────────────────────────────────────────────────
 if (await hasRecentNegativeSentiment(recovery.tenant_id, recovery.contact_phone)) {
    console.log(
      "[Recovery] Sentiment pause id=%s phone=%s — rescheduling 24h out",
      recovery.id,
      recovery.contact_phone
    );
    const next = addHours(new Date(), 24);
    await db.query(
      "UPDATE estimate_recoveries SET next_action_at = $1, updated_at = now() WHERE id = $2",
      [next.toISOString(), recovery.id]
    );
    return;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Custom cadence intercept (Phase A — June 8, 2026).
  //
  // Custom steps are encoded as "custom_day_<N>" and are NOT in ALL_STEPS,
  // so they must be routed to the dedicated handler BEFORE the stepDef
  // lookup below (which would otherwise return undefined and mark the
  // recovery dormant). executeCustomStep does its own DNC/sentiment-safe
  // gating, send, and advancement — the DNC + sentiment checks above have
  // already run, so it inherits those protections.
  // ─────────────────────────────────────────────────────────────────────
  if (isCustomStep(recovery.current_step)) {
    await executeCustomStep(recovery);
    return;
  }

const stepDef = ALL_STEPS.get(recovery.current_step);
  if (!stepDef) {
    await markDormant(recovery.id);
    return;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 10A/C/D recovery gate (May 16, 2026)
  //
  // Tenant-level toggles + per-lead override layered on top of the
  // existing sequence engine.
  //   master_off / *_disabled / lead_paused → reschedule 24h
  //     (don't lose the recovery — tenant may toggle back on later)
  //   quiet_hours                            → reschedule 1h
  //     (retry inside the same calendar day once window passes)
  //   lead_cadence_off                       → cancel
  //     (explicit per-lead opt-out from recovery)
  //
  // Fail-open on errors so a DB hiccup never silently drops a recovery.
  // ─────────────────────────────────────────────────────────────────────
  let phase10Settings = null;
  try {
    const channel = stepDef.channel === "call" ? "voice" : "sms";
    const isMissedCall =
      recovery.lead_source === "missed_call" ||
      (recovery.current_step || "").startsWith("missed_call_");
    const trigger = isMissedCall ? "missed_call" : "estimate_recovery";

    const gate = await canSendRecovery({
      tenantId: recovery.tenant_id,
      channel,
      trigger,
      leadId:   recovery.lead_id,
    });

    console.log(
      "[Recovery] CHECKPOINT-B gate id=%s allowed=%s reason=%s channel=%s trigger=%s",
      recovery.id, gate.allowed, gate.reason || "ok", channel, trigger
    );

    if (!gate.allowed) {
      console.log(
        "[Recovery] Phase 10 gate blocked id=%s step=%s channel=%s trigger=%s reason=%s",
        recovery.id, recovery.current_step, channel, trigger, gate.reason
      );

      if (gate.reason === "lead_cadence_off") {
        await markCancelled(recovery.id);
        return;
      }

      const rescheduleHours = gate.reason === "quiet_hours" ? 1 : 24;
      const next = addHours(new Date(), rescheduleHours);
      await db.query(
        "UPDATE estimate_recoveries SET next_action_at = $1, updated_at = now() WHERE id = $2",
        [next.toISOString(), recovery.id]
      );
      return;
    }

    phase10Settings = gate.settings;
  } catch (err) {
    console.error(
      "[Recovery] Phase 10 gate check failed id=%s err=%s — FAILING CLOSED, rescheduling 1h",
      recovery.id, err.message
    );
    try {
      const next = addHours(new Date(), 1);
      await db.query(
        "UPDATE estimate_recoveries SET next_action_at = $1, updated_at = now() WHERE id = $2",
        [next.toISOString(), recovery.id]
      );
    } catch (rescheduleErr) {
      console.error("[Recovery] reschedule on gate error failed: %s", rescheduleErr.message);
    }
    return;
  }

  // ─────────────────────────────────────────────────────────────────────
  // Phase 10B cadence preset filter (May 16, 2026)
  //
  // Applies only to the 21-day GHOST_SEQUENCE. Objection / inquiry /
  // missed-call sequences have their own pacing and aren't filtered by
  // the cadence preset. If the current ghost step's day offset isn't in
  // the tenant's cadence preset days (e.g. preset='gentle' → [3,10,21]
  // skips day1/day5/day7/day14/day17 sends), advance the sequence as if
  // the step fired — the sequence progresses, just without that message.
  //
  // Phase 10E note: this preset filter uses the CANONICAL day offsets,
  // independent of any DISC multiplier applied to the wall-clock delay.
  // A "day10_call" step always counts as day-10 for preset bucketing
  // even when DISC pulls it forward to day 6 in real time.
  // ─────────────────────────────────────────────────────────────────────
  const GHOST_STEP_DAYS = {
    day1_checkin:    1,
    day3_value:      3,
    day5_call:       5,
    day7_urgency:    7,
    day10_call:      10,
    day14_softclose: 14,
    day17_call:      17,
    day21_hardclose: 21,
  };
  const stepDay = GHOST_STEP_DAYS[recovery.current_step];
  if (stepDay !== undefined && phase10Settings) {
    let leadOverride = null;
    if (recovery.lead_id) {
      try {
        const leadResult = await db.query(
          "SELECT recovery_cadence_override FROM leads WHERE id = $1 LIMIT 1",
          [recovery.lead_id]
        );
        leadOverride = leadResult.rows[0]?.recovery_cadence_override || null;
      } catch (err) {
        console.error("[Recovery] lead override lookup failed: %s", err.message);
      }
    }
    const cadenceDays = getCadenceDays(phase10Settings, leadOverride);
    if (cadenceDays.length > 0 && !cadenceDays.includes(stepDay)) {
      console.log(
        "[Recovery] Cadence skip id=%s step=%s day=%d cadence=%j — advancing",
        recovery.id, recovery.current_step, stepDay, cadenceDays
      );
      await advanceStep(recovery, stepDef);
      return;
    }
  }

  const tenant = await db.query(
    `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
     FROM tenants t WHERE t.id = $1`,
    [recovery.tenant_id]
  ).then((r) => r.rows[0]);
  if (!tenant) return;

  const vars = {
    first_name:   getFirstName(recovery.contact_name),
    company_name: tenant.company_name || tenant.name,
  };

  console.log(
    "[Recovery] CHECKPOINT-C about-to-send id=%s step=%s channel=%s to=%s",
    recovery.id, recovery.current_step, stepDef.channel, recovery.contact_phone
  );

  if (stepDef.channel === "sms") {
    await sendRecoverySms(recovery, tenant, stepDef, vars);
  } else if (stepDef.channel === "call") {
    await makeRecoveryCall(recovery, tenant, stepDef, vars);
  }

  // 📨 "AI Follow-Up Started" notification — fires once, on the FIRST touch
  // of an estimate-recovery sequence, AFTER it actually sent (June 8, 2026).
  // Guard: only the GHOST sequence's opening step, and only when no prior
  // touch has gone out (sms_attempts + call_attempts were 0 at entry). This
  // is the post-gate location, so the notification reliably means a real
  // message went out. Copy is built from the tenant's actual channels +
  // cadence, not hardcoded boilerplate. Non-blocking.
  if (
    recovery.current_step === GHOST_SEQUENCE[0].step &&
    (recovery.sms_attempts || 0) === 0 &&
    (recovery.call_attempts || 0) === 0
  ) {
    try {
      const channels = [];
      if (phase10Settings?.sms_enabled)   channels.push("SMS");
      if (phase10Settings?.voice_enabled) channels.push("voice");
      if (phase10Settings?.email_enabled) channels.push("email");

      let cadenceDayCount = null;
      try {
        const cadenceDays = getCadenceDays(phase10Settings, null);
        // +1 for the day-0 confirmation, which always sends and isn't in the
        // preset day list. Falls back to null if cadence resolves empty.
        cadenceDayCount = Array.isArray(cadenceDays) && cadenceDays.length > 0
          ? cadenceDays.length + 1
          : null;
      } catch (_) { /* leave null — copy degrades gracefully */ }

      const notificationService = require("./notifications");
      notificationService.notifyEstimateRecoveryStarted(recovery.tenant_id, {
        customer_name:   recovery.contact_name || null,
        lead_id:         recovery.lead_id || null,
        recovery_id:     recovery.id,
        channels,
        cadenceDayCount,
      }).catch((e) => console.error("[Recovery] notifyEstimateRecoveryStarted failed:", e.message));
    } catch (e) {
      console.error("[Recovery] Notification dispatch failed:", e.message);
    }
  }

  // Facebook touch for Facebook leads
  if (recovery.lead_source === "facebook" && stepDef.channel === "sms") {
    const fbIdx = Math.min(recovery.sms_attempts, FACEBOOK_MESSAGES.length - 1);
    if (fbIdx < FACEBOOK_MESSAGES.length) {
      await logTouch(recovery.id, recovery.tenant_id, "facebook", stepDef.step, FACEBOOK_MESSAGES[fbIdx]);
    }
  }

  await advanceStep(recovery, stepDef);
}

// ─────────────────────────────────────────────────────────
// CORE: Execute a single CUSTOM cadence step (Phase A — June 8, 2026)
//
// Self-contained handler for custom_day_<N> steps. Mirrors executeStep's
// gating but reads the per-day channel from the tenant's custom array
// instead of a fixed sequence step. Flow:
//   1. Load settings + the normalized custom step array.
//   2. Find the entry for the current day. (Gone from array → advance/dormant.)
//   3. Gate via canSendRecovery for THAT day's channel.
//        master_off/*_disabled/lead_paused → reschedule 24h
//        quiet_hours                        → reschedule 1h
//        lead_cadence_off                   → cancel
//        sms_disabled / voice_disabled      → SKIP this day, advance to next
//          (channel toggle wins; the other channel's days still fire)
//   4. Build + send the touch (default copy in Phase A).
//   5. Advance to the next day in the array; dormant when none remain.
// ─────────────────────────────────────────────────────────
async function executeCustomStep(recovery) {
  const currentDay = decodeCustomStep(recovery.current_step);
  if (currentDay === null) {
    console.error("[Recovery] Custom step decode failed id=%s step=%s — dormant", recovery.id, recovery.current_step);
    await markDormant(recovery.id);
    return;
  }

  // Load settings + custom array.
  let settings;
  try {
    settings = await require("../lib/recoverySettings").getRecoverySettings(recovery.tenant_id);
  } catch (err) {
    console.error("[Recovery] Custom getRecoverySettings failed id=%s err=%s — reschedule 1h", recovery.id, err.message);
    const next = addHours(new Date(), 1);
    await db.query(
      "UPDATE estimate_recoveries SET next_action_at = $1, updated_at = now() WHERE id = $2",
      [next.toISOString(), recovery.id]
    ).catch(() => {});
    return;
  }

  // Tenant may have switched OFF custom preset mid-recovery. If so, this
  // recovery's custom_day_<N> step no longer maps to anything coherent —
  // mark dormant rather than guess. (Rare; a preset change is a deliberate
  // act and existing custom recoveries gracefully wind down.)
  const customSteps = getCustomCadenceSteps(settings, null);
  if (customSteps.length === 0) {
    console.log("[Recovery] Custom step but tenant no longer on custom preset id=%s — dormant", recovery.id);
    await markDormant(recovery.id);
    return;
  }

  const entry = customSteps.find((s) => s.day === currentDay);
  if (!entry) {
    // The current day was removed from the array (mid-recovery edit). Advance
    // to the next day greater than current, or dormant if none.
    console.log("[Recovery] Custom day %d no longer in array id=%s — advancing", currentDay, recovery.id);
    await advanceCustomStep(recovery, currentDay, customSteps);
    return;
  }

  const channel = entry.channel === "call" ? "call" : "sms";
  const gateChannel = channel === "call" ? "voice" : "sms";

  // Phase 10 gate for THIS day's channel.
  let gate;
  try {
    gate = await canSendRecovery({
      tenantId: recovery.tenant_id,
      channel:  gateChannel,
      trigger:  "estimate_recovery",
      leadId:   recovery.lead_id,
    });
  } catch (err) {
    console.error("[Recovery] Custom gate check failed id=%s err=%s — FAILING CLOSED, reschedule 1h", recovery.id, err.message);
    const next = addHours(new Date(), 1);
    await db.query(
      "UPDATE estimate_recoveries SET next_action_at = $1, updated_at = now() WHERE id = $2",
      [next.toISOString(), recovery.id]
    ).catch(() => {});
    return;
  }

  console.log(
    "[Recovery] CHECKPOINT-CUSTOM id=%s day=%d channel=%s allowed=%s reason=%s",
    recovery.id, currentDay, channel, gate.allowed, gate.reason || "ok"
  );

  if (!gate.allowed) {
    // Channel-toggle block → SKIP this day, advance to next. The channel
    // toggle is a master safety switch; a custom day cannot override it.
    // The OTHER channel's days in this same cadence still fire.
    if (gate.reason === "sms_disabled" || gate.reason === "voice_disabled") {
      console.log(
        "[Recovery] Custom day %d skipped id=%s — %s (channel toggle off, advancing)",
        currentDay, recovery.id, gate.reason
      );
      await advanceCustomStep(recovery, currentDay, customSteps);
      return;
    }

    // Explicit per-lead opt-out → cancel.
    if (gate.reason === "lead_cadence_off") {
      await markCancelled(recovery.id);
      return;
    }

    // quiet_hours → retry in 1h (same day once window passes).
    // Everything else (master_off, estimate_recovery_disabled, lead_paused)
    // → reschedule 24h; tenant may re-enable.
    const rescheduleHours = gate.reason === "quiet_hours" ? 1 : 24;
    const next = addHours(new Date(), rescheduleHours);
    await db.query(
      "UPDATE estimate_recoveries SET next_action_at = $1, updated_at = now() WHERE id = $2",
      [next.toISOString(), recovery.id]
    );
    return;
  }

  // Load tenant for vars + send.
  const tenant = await db.query(
    `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
     FROM tenants t WHERE t.id = $1`,
    [recovery.tenant_id]
  ).then((r) => r.rows[0]);
  if (!tenant) {
    console.error("[Recovery] Custom step no tenant id=%s — dormant", recovery.id);
    await markDormant(recovery.id);
    return;
  }

  const vars = {
    first_name:   getFirstName(recovery.contact_name),
    company_name: tenant.company_name || tenant.name,
  };

  const touch = buildCustomTouch(entry, vars);
  const stepLabel = encodeCustomStep(currentDay);

  console.log(
    "[Recovery] CHECKPOINT-CUSTOM-C about-to-send id=%s day=%d channel=%s to=%s",
    recovery.id, currentDay, touch.channel, recovery.contact_phone
  );

  if (touch.channel === "sms") {
    // Reuse sendRecoverySms by shimming a stepDef-shaped object carrying the
    // resolved message + a step label for logging.
    await sendRecoverySms(recovery, tenant, { step: stepLabel, channel: "sms", message: touch.message }, vars);
  } else {
    await makeRecoveryCall(recovery, tenant, { step: stepLabel, channel: "call", script: touch.script, voicemail: touch.voicemail }, vars);
  }

  // Notification on the FIRST touch of this custom recovery (zero prior
  // attempts at entry). Same post-send placement + honest copy as the
  // ghost path.
  if ((recovery.sms_attempts || 0) === 0 && (recovery.call_attempts || 0) === 0) {
    try {
      const channels = [];
      if (settings.sms_enabled)   channels.push("SMS");
      if (settings.voice_enabled) channels.push("voice");
      if (settings.email_enabled) channels.push("email");
      const notificationService = require("./notifications");
      notificationService.notifyEstimateRecoveryStarted(recovery.tenant_id, {
        customer_name:   recovery.contact_name || null,
        lead_id:         recovery.lead_id || null,
        recovery_id:     recovery.id,
        channels,
        cadenceDayCount: customSteps.length,
      }).catch((e) => console.error("[Recovery] notifyEstimateRecoveryStarted failed:", e.message));
    } catch (e) {
      console.error("[Recovery] Custom notification dispatch failed:", e.message);
    }
  }

  await advanceCustomStep(recovery, currentDay, customSteps);
}

// Advance a custom recovery to the next day in the array greater than the
// current day. Dormant when none remain. Delay is (nextDay - currentDay)
// days, DISC-scaled like the ghost path.
async function advanceCustomStep(recovery, currentDay, customSteps) {
  const nextEntry = customSteps.find((s) => s.day > currentDay);
  if (!nextEntry) {
    await markDormant(recovery.id);
    return;
  }
  const gapDays = nextEntry.day - currentDay;
  const baseDelayHours = gapDays * 24;
  const delayHours = await applyDiscMultiplier(baseDelayHours, recovery.lead_id, recovery.tenant_id);
  const nextAt = addHours(new Date(), delayHours);
  await db.query(
    "UPDATE estimate_recoveries SET current_step = $1, next_action_at = $2, updated_at = now() WHERE id = $3",
    [encodeCustomStep(nextEntry.day), nextAt.toISOString(), recovery.id]
  );
  console.log(
    "[Recovery] Custom advance id=%s %d → %d (%s) in %dd",
    recovery.id, currentDay, nextEntry.day, nextEntry.channel, gapDays
  );
}

// ─────────────────────────────────────────────────────────
// SMS
// ─────────────────────────────────────────────────────────

async function sendRecoverySms(recovery, tenant, stepDef, vars) {
  const body = typeof stepDef.message === "function"
    ? stepDef.message(vars)
    : stepDef.message || "";

  // Phase 8B visibility refactor (May 28, 2026): route through lib/outboundSms
  // so the recovery SMS writes to the messages table — appears on the lead
  // timeline + messages thread + activity feed. Before this change, AI-
  // initiated recovery SMS were invisible to tenant admins. The Paragon
  // incident (21 invisible touches 5/22-5/28) was this exact path.
  const outboundSms = require("../lib/outboundSms");
  const result = await outboundSms.send({
    tenant,
    to:       recovery.contact_phone,
    body,
    source:   "recovery",
    leadId:   recovery.lead_id || null,
    sourceId: recovery.id,
    meta: {
      recovery_id: recovery.id,
      step:        stepDef.step,
      lead_source: recovery.lead_source || null,
    },
  });

  if (result.ok) {
    await db.query(
      "UPDATE estimate_recoveries SET sms_attempts = sms_attempts + 1, updated_at = now() WHERE id = $1",
      [recovery.id]
    );
    await logTouch(recovery.id, recovery.tenant_id, "sms", stepDef.step, body, "sent");
    console.log("[Recovery] SMS sent id=%s step=%s to=%s sid=%s",
      recovery.id, stepDef.step, recovery.contact_phone, result.sid);
  } else {
    console.error("[Recovery] SMS failed id=%s reason=%s error=%s",
      recovery.id, result.reason || "unknown", result.error || "(none)");
    await logTouch(recovery.id, recovery.tenant_id, "sms", stepDef.step, body, "failed");
  }
}

// ─────────────────────────────────────────────────────────
// OUTBOUND CALL with voicemail detection
// ─────────────────────────────────────────────────────────

async function makeRecoveryCall(recovery, tenant, stepDef, vars) {
  const baseUrl = process.env.BASE_URL;
  if (!baseUrl) {
    console.warn("[Recovery] BASE_URL not set, cannot make outbound call");
    return;
  }

  const script = (stepDef.script || "")
    .replace(/\{\{first_name\}\}/g, vars.first_name)
    .replace(/\{\{company_name\}\}/g, vars.company_name);

  // Voicemail script — played when answering machine is detected
  const voicemail = (stepDef.voicemail || stepDef.script || "")
    .replace(/\{\{first_name\}\}/g, vars.first_name)
    .replace(/\{\{company_name\}\}/g, vars.company_name);

  const twimlUrl = `${baseUrl.replace(/\/$/, "")}/twilio/recovery-call`
    + `?recoveryId=${encodeURIComponent(recovery.id)}`
    + `&script=${encodeURIComponent(script)}`
    + `&voicemail=${encodeURIComponent(voicemail)}`;

  const statusCallback = `${baseUrl.replace(/\/$/, "")}/twilio/recovery-call-status`
    + `?recoveryId=${encodeURIComponent(recovery.id)}`;

  // Phase 8B visibility refactor (May 28, 2026): route through lib/outboundCall
  // so the recovery call writes to the calls table on dial — appears in the
  // call list immediately with correct from_number, lead_id, and metadata.
  // Before this change, makeRecoveryCall called Twilio directly and the
  // calls row only got created later by routes/twilio.js#/recovery-call when
  // (and only if) the call connected and ran the WS stream. Voicemail-only
  // calls never wrote a row at all.
  const outboundCall = require("../lib/outboundCall");
  const result = await outboundCall.create({
    tenant,
    to:                       recovery.contact_phone,
    twimlUrl,
    source:                   "recovery",
    leadId:                   recovery.lead_id || null,
    sourceId:                 recovery.id,
    leadSource:               recovery.lead_source || null,
    statusCallback,
    machineDetection:         "Enable",
    machineDetectionTimeout:  8,
    timeout:                  30,
    meta: {
      recovery_id: recovery.id,
      step:        stepDef.step,
      script_preview: script.slice(0, 200),
    },
  });

  if (result.ok) {
    await db.query(
      "UPDATE estimate_recoveries SET call_attempts = call_attempts + 1, updated_at = now() WHERE id = $1",
      [recovery.id]
    );
    await logTouch(recovery.id, recovery.tenant_id, "call", stepDef.step, script, "initiated", result.callSid);
    console.log("[Recovery] Call initiated id=%s step=%s callSid=%s callId=%s",
      recovery.id, stepDef.step, result.callSid, result.callId || "(none)");
  } else {
    console.error("[Recovery] Call failed id=%s reason=%s error=%s",
      recovery.id, result.reason || "unknown", result.error || "(none)");
    await logTouch(recovery.id, recovery.tenant_id, "call", stepDef.step, script, "failed");
  }
}

// ─────────────────────────────────────────────────────────
// STEP ADVANCEMENT
// ─────────────────────────────────────────────────────────

async function advanceStep(recovery, currentStepDef) {
  const nextStepName = currentStepDef.next;

  if (!nextStepName) {
    // End of sequence → dormant (and schedule seasonal campaigns)
    await markDormant(recovery.id);
    return;
  }

  const nextStep = ALL_STEPS.get(nextStepName);
  if (!nextStep) {
    await markDormant(recovery.id);
    return;
  }

  // Phase 10E: scale the next step's delay by the lead's DISC bucket if
  // the tenant has 10E enabled. This is the highest-traffic call site for
  // applyDiscMultiplier — every advancement through the sequence routes
  // through here. Returns base unchanged for unclassified leads or when
  // toggle is off.
  const delayHours = await applyDiscMultiplier(nextStep.delayHours, recovery.lead_id, recovery.tenant_id);
  const nextAt = addHours(new Date(), delayHours);
  await db.query(
    "UPDATE estimate_recoveries SET current_step = $1, next_action_at = $2, updated_at = now() WHERE id = $3",
    [nextStepName, nextAt.toISOString(), recovery.id]
  );
}

// ─────────────────────────────────────────────────────────
// OBJECTION ROUTING
// ─────────────────────────────────────────────────────────

async function setObjection(recoveryId, objectionType) {
  const sequence = OBJECTION_SEQUENCES[objectionType];
  if (!sequence || !sequence.length) {
    console.warn("[Recovery] Unknown objection type=%s", objectionType);
    return;
  }

  const firstStep = sequence[0];
  // Phase 10E: scale the objection sequence's first-step delay too. Look
  // up the recovery's tenant + lead so the multiplier helper has what it
  // needs. Cheap query — recoveries table is small and PK-indexed.
  let tenantId = null;
  let leadId = null;
  try {
    const r = await db.query(
      "SELECT tenant_id, lead_id FROM estimate_recoveries WHERE id = $1 LIMIT 1",
      [recoveryId]
    );
    tenantId = r.rows[0]?.tenant_id || null;
    leadId = r.rows[0]?.lead_id || null;
  } catch (err) {
    console.error("[Recovery] setObjection lookup failed: %s", err.message);
  }
  const delayHours = await applyDiscMultiplier(firstStep.delayHours, leadId, tenantId);
  const nextAt = addHours(new Date(), delayHours);

  await db.query(
    `UPDATE estimate_recoveries SET
      objection_type = $1, current_step = $2, next_action_at = $3,
      last_response_at = now(), updated_at = now()
     WHERE id = $4`,
    [objectionType, firstStep.step, nextAt.toISOString(), recoveryId]
  );
  console.log("[Recovery] Objection set id=%s type=%s → step=%s", recoveryId, objectionType, firstStep.step);
}

// ─────────────────────────────────────────────────────────
// STATUS UPDATES
// ─────────────────────────────────────────────────────────

async function markConverted(recoveryId) {
  await db.query(
    "UPDATE estimate_recoveries SET status = 'converted', updated_at = now() WHERE id = $1",
    [recoveryId]
  );
  console.log("[Recovery] Converted id=%s", recoveryId);

  // 🚀 Owner SMS notification (migrated from salesEngine.notifyOwnerOfConversion)
  // Best-effort — never blocks conversion.
  try {
    const res = await db.query(
      `SELECT er.contact_name, t.company_name, t.transfer_numbers
       FROM estimate_recoveries er
       JOIN tenants t ON t.id = er.tenant_id
       WHERE er.id = $1 LIMIT 1`,
      [recoveryId]
    );
    const row = res.rows[0];
    if (!row) return;

    const ownerPhone = (row.transfer_numbers && row.transfer_numbers[0]) || null;
    if (!ownerPhone) {
      console.log("[Recovery] No owner phone for recovery=%s, skipping SMS notification", recoveryId);
      return;
    }

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken  = process.env.TWILIO_AUTH_TOKEN;
    const from       = process.env.TWILIO_PHONE_NUMBER;
    if (!accountSid || !authToken || !from) {
      console.log("[Recovery] Twilio creds missing, skipping owner SMS for recovery=%s", recoveryId);
      return;
    }

    const fetch = require("node-fetch");
    const auth  = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
    const url   = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const msg   = `🚀 SALES WIN! ${row.contact_name || "A customer"} just accepted their estimate for ${row.company_name}. Great job!`;

    await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: ownerPhone, From: from, Body: msg }),
    });
    console.log("[Recovery] Owner SMS sent for recovery=%s to=%s", recoveryId, ownerPhone);
  } catch (err) {
    console.error("[Recovery] Owner SMS notification failed:", err.message);
  }
}

/**
 * Mark dormant AND schedule lead for seasonal campaigns.
 * Estimate leads (no completed job) go to seasonal only — NOT maintenance/re-engagement.
 */
async function markDormant(recoveryId) {
  const recoveryRes = await db.query(
    "SELECT tenant_id, lead_id, contact_phone FROM estimate_recoveries WHERE id = $1",
    [recoveryId]
  );
  const recovery = recoveryRes.rows[0];

  await db.query(
    "UPDATE estimate_recoveries SET status = 'dormant', updated_at = now() WHERE id = $1",
    [recoveryId]
  );
  console.log("[Recovery] Dormant id=%s", recoveryId);

  // ── Auto-transition to seasonal campaigns ──────────────────────────────
  // Only if lead exists and has NO last_service_date (didn't complete a job)
  // Completed job leads are already handled by schedulePostServiceCampaigns()
  if (recovery?.lead_id && recovery?.tenant_id) {
    try {
      const leadRes = await db.query(
        "SELECT id, last_service_date FROM leads WHERE id = $1",
        [recovery.lead_id]
      );
      const lead = leadRes.rows[0];

      if (lead && !lead.last_service_date) {
        // Mark lead as seasonal-eligible by setting a flag we can query
        // Uses estimate_attempted_at so seasonal campaigns can pick them up
        await db.query(
          `UPDATE leads SET
            estimate_attempted_at = COALESCE(estimate_attempted_at, now()),
            updated_at = now()
           WHERE id = $1`,
          [recovery.lead_id]
        ).catch(() => {
          // Column may not exist yet — safe to ignore, seasonal fallback still works
          console.log("[Recovery] estimate_attempted_at column not found — seasonal eligibility via created_at");
        });
        console.log("[Recovery] Lead %s marked for seasonal campaigns (no completed job)", recovery.lead_id);
      }
    } catch (err) {
      console.warn("[Recovery] Could not schedule seasonal transition:", err.message);
    }
  }
}

async function markPaused(recoveryId) {
  await db.query(
    "UPDATE estimate_recoveries SET status = 'paused', updated_at = now() WHERE id = $1",
    [recoveryId]
  );
}

async function markCancelled(recoveryId) {
  await db.query(
    "UPDATE estimate_recoveries SET status = 'cancelled', updated_at = now() WHERE id = $1",
    [recoveryId]
  );
}

async function resumeRecovery(recoveryId) {
  const firstStep = GHOST_SEQUENCE[0];
  // Phase 10E: scale the resumed first-step delay by DISC. Same pattern
  // as setObjection — look up tenant + lead for the helper.
  let tenantId = null;
  let leadId = null;
  try {
    const r = await db.query(
      "SELECT tenant_id, lead_id FROM estimate_recoveries WHERE id = $1 LIMIT 1",
      [recoveryId]
    );
    tenantId = r.rows[0]?.tenant_id || null;
    leadId = r.rows[0]?.lead_id || null;
  } catch (err) {
    console.error("[Recovery] resumeRecovery lookup failed: %s", err.message);
  }
  const delayHours = await applyDiscMultiplier(firstStep.delayHours, leadId, tenantId);
  const nextAt = addHours(new Date(), delayHours);
  await db.query(
    `UPDATE estimate_recoveries SET
      status = 'active', current_step = $1, next_action_at = $2,
      objection_type = NULL, updated_at = now()
     WHERE id = $3`,
    [firstStep.step, nextAt.toISOString(), recoveryId]
  );
}

async function recordResponse(recoveryId) {
  await db.query(
    "UPDATE estimate_recoveries SET last_response_at = now(), updated_at = now() WHERE id = $1",
    [recoveryId]
  );
}

// ─────────────────────────────────────────────────────────
// TOUCH LOGGING
// ─────────────────────────────────────────────────────────

async function logTouch(recoveryId, tenantId, channel, step, messageBody, status = "sent", callSid = null) {
  await db.query(
    `INSERT INTO recovery_touches (recovery_id, tenant_id, channel, step, message_body, call_sid, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [recoveryId, tenantId, channel, step, messageBody || null, callSid || null, status]
  );
}

// ─────────────────────────────────────────────────────────
// QUERIES
// ─────────────────────────────────────────────────────────

async function getRecoveriesByTenant(tenantId, { status, limit = 50 } = {}) {
  let q = "SELECT * FROM estimate_recoveries WHERE tenant_id = $1";
  const params = [tenantId];
  if (status) {
    params.push(status);
    q += " AND status = $" + params.length;
  }
  q += " ORDER BY created_at DESC LIMIT $" + (params.length + 1);
  params.push(limit);
  const res = await db.query(q, params);
  return res.rows;
}

async function getRecoveryById(id) {
  const res = await db.query("SELECT * FROM estimate_recoveries WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function getTouchesByRecovery(recoveryId) {
  const res = await db.query(
    "SELECT * FROM recovery_touches WHERE recovery_id = $1 ORDER BY created_at",
    [recoveryId]
  );
  return res.rows;
}

async function getRecoveryStats(tenantIds) {
  const ids = Array.isArray(tenantIds) ? tenantIds : [tenantIds];
  const [total, active, converted, dormant] = await Promise.all([
    db.query("SELECT COUNT(*) as count FROM estimate_recoveries WHERE tenant_id = ANY($1)", [ids]),
    db.query("SELECT COUNT(*) as count FROM estimate_recoveries WHERE tenant_id = ANY($1) AND status = 'active'", [ids]),
    db.query("SELECT COUNT(*) as count FROM estimate_recoveries WHERE tenant_id = ANY($1) AND status = 'converted'", [ids]),
    db.query("SELECT COUNT(*) as count FROM estimate_recoveries WHERE tenant_id = ANY($1) AND status = 'dormant'", [ids]),
  ]);
  const t = parseInt(total.rows[0].count, 10) || 0;
  const c = parseInt(converted.rows[0].count, 10) || 0;
  return {
    total:               t,
    active:              parseInt(active.rows[0].count, 10) || 0,
    converted:           c,
    dormant:             parseInt(dormant.rows[0].count, 10) || 0,
    recovery_rate_pct:   t > 0 ? Math.round((c / t) * 100) : 0,
  };
}

module.exports = {
  startRecovery,
  startInquiryRecovery,
  startEstimateRecovery,
  startMissedCallRecovery,
  processDueRecoveries,
  setObjection,
  markConverted,
  markDormant,
  markPaused,
  markCancelled,
  resumeRecovery,
  recordResponse,
  getRecoveriesByTenant,
  getRecoveryById,
  getTouchesByRecovery,
  getRecoveryStats,
  sendRecoverySms,
  makeRecoveryCall,
  advanceStep,
  isRecoveryBlocked,
  hasRecentNegativeSentiment,
  GHOST_SEQUENCE,
  INQUIRY_SEQUENCE,
  MISSED_CALL_SEQUENCE,
  OBJECTION_SEQUENCES,
  ALL_STEPS,
};

"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");
const { getLast10Digits, normalizeE164Phone } = require("../lib/phone");
const { canSendRecovery, getCadenceDays } = require("../lib/recoverySettings");

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
      "Hi {{first_name}}, this is {{company_name}} calling about your recent estimate. We wanted to make sure you had a chance to review it and answer any questions. Give us a call back or just reply to our last text whenever you're ready. We look forward to hearing from you!",
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
      "Hi {{first_name}}, calling again from {{company_name}} about your estimate. Our schedule is filling up and we want to make sure you don't lose your spot. Please give us a call back or just reply to our text. We're here to help — hope to hear from you soon!",
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
      "Hi {{first_name}}, this is {{company_name}} with one last message about your estimate. We completely understand if the timing isn't right. Whenever you're ready to move forward — even months from now — just reach out and we'll be happy to help. Have a great day!",
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
      "Hi {{first_name}}, just calling to check in — still here whenever you're ready to talk through the project. Give us a call back or just reply to our text. Talk soon!",
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
      "Hi {{first_name}}, calling about your estimate — if budget is a concern we may have some flexibility. Give us a call back and let's talk through it. Thanks!",
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
      "Hi {{first_name}}, just following up to see if you and your partner had a chance to discuss the project. Give us a call back when you're ready — we're happy to answer any questions for both of you!",
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
      "Hi {{first_name}}, this is {{company_name}} calling back about your recent inquiry. We'd love to help with your project — give us a call back or just text us anytime. We have openings this week!",
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
      "Hi, this is {{company_name}} calling you back — sorry we missed your call earlier! We'd love to help with your project. Just give us a call back or reply to our text anytime. Thanks!",
    next: "missed_call_24h",
  },
  {
    step: "missed_call_24h",
    channel: "call",
    delayHours: 23.5, // ~24h after the initial missed call (30min + 23.5h)
    script:
      "Hi {{first_name}}, this is {{company_name}} following up on the call we missed yesterday. I just wanted to personally make sure we didn't leave you hanging. Were you looking for a painting estimate, or is there something specific I can help you with?",
    voicemail:
      "Hi, this is {{company_name}} calling you back about the call we missed yesterday. If you're still interested in a painting estimate, we'd love to help. Give us a call back or reply to our text — thanks!",
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
  const nextActionAt = addHours(now, firstStep.delayHours);

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

  const now = new Date();
  const firstStep = GHOST_SEQUENCE[0];
  const nextActionAt = addHours(now, firstStep.delayHours);

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
      lead.name || lead.contact_name || "Guest",
      phone,
      lead.email || lead.contact_email || null,
      firstStep.step,
      nextActionAt.toISOString(),
      options.lead_source || "crm_webhook",
    ]
  );
  console.log("[Recovery] Estimate recovery started id=%s tenant=%s phone=%s", res.rows[0].id, tenantId, phone);

  // 📨 Estimate recovery engaged notification (non-blocking)
  try {
    const notificationService = require("./notifications");
    notificationService.notifyEstimateRecoveryStarted(tenantId, {
      customer_name: lead.name || lead.contact_name,
      lead_id:       lead.id || null,
      recovery_id:   res.rows[0].id,
    }).catch((e) => console.error("[Recovery] notifyEstimateRecoveryStarted failed:", e.message));
  } catch (e) {
    console.error("[Recovery] Notification import failed:", e.message);
  }

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
  const nextActionAt = addHours(now, firstStep.delayHours);

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
      lead.name || lead.contact_name || "Guest",
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
  const nextActionAt = addHours(now, firstStep.delayHours);

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
      lead.name || lead.contact_name || "Guest",
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
      "[Recovery] Phase 10 gate check failed id=%s err=%s — proceeding to send",
      recovery.id, err.message
    );
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

  if (stepDef.channel === "sms") {
    await sendRecoverySms(recovery, tenant, stepDef, vars);
  } else if (stepDef.channel === "call") {
    await makeRecoveryCall(recovery, tenant, stepDef, vars);
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
// SMS
// ─────────────────────────────────────────────────────────

async function sendRecoverySms(recovery, tenant, stepDef, vars) {
  const client = twilio.getClientForTenant(tenant);
  if (!client) {
    console.warn("[Recovery] No Twilio client for tenant=%s", recovery.tenant_id);
    return;
  }
  const from = tenant.matched_phone || process.env.TWILIO_PHONE_NUMBER;
  if (!from) return;

  const body = typeof stepDef.message === "function"
    ? stepDef.message(vars)
    : stepDef.message || "";

  try {
    await client.messages.create({ to: recovery.contact_phone, from, body });
    await db.query(
      "UPDATE estimate_recoveries SET sms_attempts = sms_attempts + 1, updated_at = now() WHERE id = $1",
      [recovery.id]
    );
    await logTouch(recovery.id, recovery.tenant_id, "sms", stepDef.step, body, "sent");
    console.log("[Recovery] SMS sent id=%s step=%s to=%s", recovery.id, stepDef.step, recovery.contact_phone);
  } catch (e) {
    console.error("[Recovery] SMS failed id=%s error=%s", recovery.id, e.message);
    await logTouch(recovery.id, recovery.tenant_id, "sms", stepDef.step, body, "failed");
  }
}

// ─────────────────────────────────────────────────────────
// OUTBOUND CALL with voicemail detection
// ─────────────────────────────────────────────────────────

async function makeRecoveryCall(recovery, tenant, stepDef, vars) {
  const client = twilio.getClientForTenant(tenant);
  if (!client) return;
  const from = tenant.matched_phone || process.env.TWILIO_PHONE_NUMBER;
  if (!from) return;

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

  try {
    const call = await client.calls.create({
      to:    recovery.contact_phone,
      from,
      url:   twimlUrl,
      method: "GET",
      timeout: 30,
      // ✅ Voicemail detection — waits for beep then fires TwiML with AnsweredBy param
      machineDetection:      "Enable",
      machineDetectionTimeout: 8,
      statusCallback: `${baseUrl.replace(/\/$/, "")}/twilio/recovery-call-status?recoveryId=${encodeURIComponent(recovery.id)}`,
      statusCallbackMethod: "POST",
      statusCallbackEvent:  ["completed"],
    });
    await db.query(
      "UPDATE estimate_recoveries SET call_attempts = call_attempts + 1, updated_at = now() WHERE id = $1",
      [recovery.id]
    );
    await logTouch(recovery.id, recovery.tenant_id, "call", stepDef.step, script, "initiated", call.sid);
    console.log("[Recovery] Call initiated id=%s step=%s callSid=%s", recovery.id, stepDef.step, call.sid);
  } catch (e) {
    console.error("[Recovery] Call failed id=%s error=%s", recovery.id, e.message);
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

  const nextAt = addHours(new Date(), nextStep.delayHours);
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
  const nextAt = addHours(new Date(), firstStep.delayHours);

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
  const nextAt = addHours(new Date(), firstStep.delayHours);
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

"use strict";

const db = require("../lib/db");
const twilio = require("../lib/twilio");

// ─────────────────────────────────────────────────────────
// SEQUENCE DEFINITIONS
// ─────────────────────────────────────────────────────────

/**
 * Generic ghosting sequence (no objection stated).
 * Day 1 SMS → Day 1 + 3h Call → Day 3 SMS → Day 5 Call → Day 7 Final SMS → Dormant.
 */
const GHOST_SEQUENCE = [
    {
        step: "estimate_sent",
        channel: "sms",
        delayHours: 0,
        message: (v) =>
            `Hi ${v.first_name}, I've sent over your estimate from ${v.company_name}! Let me know if you have any questions.`,
        next: "sms_followup",
    },
    {
        step: "sms_followup",
        channel: "sms",
        delayHours: 24,
        message: (v) =>
            `Hey ${v.first_name}, just checking in to see if you had a chance to look at that estimate. We'd love to get you on the schedule!`,
        next: "ai_call_followup",
    },
    {
        step: "ai_call_followup",
        channel: "call",
        delayHours: 48, // 2 days later
        script:
            "Hi {{first_name}}, this is the AI assistant from {{company_name}}. I'm just calling to follow up on the estimate we sent. Did you have any questions, or would you like to get that scheduled?",
        next: "second_reminder",
    },
    {
        step: "second_reminder",
        channel: "sms",
        delayHours: 72, // 3 days later
        message: (v) =>
            `Quick reminder from ${v.company_name} about your project. Our schedule is filling up fast — would you like to lock in your spot?`,
        next: "final_attempt",
    },
    {
        step: "final_attempt",
        channel: "sms",
        delayHours: 72, // 3 more days
        message: (v) =>
            `Hi ${v.first_name}, I haven't heard back, so I'll go ahead and close this request for now. If you're still interested, just reply YES and I'll jump back in!`,
        next: null,
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
        next: null, // → rejoin ghost sequence at day3_sms or dormant
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
        next: null,
    },
];

/**
 * Facebook layer messages — inserted between SMS touches if lead came from Facebook.
 */
const FACEBOOK_MESSAGES = [
    `Just wanted to make sure you saw the estimate we sent over 🙂`,
    `Let me know if you'd like to secure your spot.`,
];

// Map objection types to their sequences
const OBJECTION_SEQUENCES = {
    thinking: THINKING_SEQUENCE,
    price: PRICE_SEQUENCE,
    spouse: SPOUSE_SEQUENCE,
};

// All sequences flattened for step lookup
const ALL_STEPS = new Map();
for (const seq of [GHOST_SEQUENCE, THINKING_SEQUENCE, PRICE_SEQUENCE, SPOUSE_SEQUENCE]) {
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

function getFirstName(fullName) {
    if (!fullName) return "there";
    return fullName.split(/\s+/)[0] || "there";
}

// ─────────────────────────────────────────────────────────
// CORE: Start a recovery sequence
// ─────────────────────────────────────────────────────────

/**
 * Start an estimate recovery sequence for a booking.
 * Called when a booking's appointment is completed but not booked (after 24h).
 */
async function startRecovery(tenantId, bookingId, options = {}) {
    // Check if recovery already exists for this booking
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
    console.log("[Recovery] Started id=%s tenant=%s booking=%s phone=%s", res.rows[0].id, tenantId, bookingId, b.contact_phone);
    return res.rows[0];
}

// ─────────────────────────────────────────────────────────
// CORE: Process due recovery actions (called by cron)
// ─────────────────────────────────────────────────────────

async function processDueRecoveries() {
    const res = await db.query(
        `SELECT er.*, t.company_name, t.name as tenant_name
     FROM estimate_recoveries er
     JOIN tenants t ON t.id = er.tenant_id
     WHERE er.status = 'active' AND er.next_action_at <= now()
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
    const stepDef = ALL_STEPS.get(recovery.current_step);
    if (!stepDef) {
        // Unknown step → mark dormant
        await markDormant(recovery.id);
        return;
    }

    const tenant = await db.query(
        `SELECT t.*, (SELECT pn.phone FROM phone_numbers pn WHERE pn.tenant_id = t.id ORDER BY pn.is_primary DESC NULLS LAST LIMIT 1) as matched_phone
     FROM tenants t WHERE t.id = $1`,
        [recovery.tenant_id]
    ).then((r) => r.rows[0]);
    if (!tenant) return;

    const vars = {
        first_name: getFirstName(recovery.contact_name),
        company_name: tenant.company_name || tenant.name,
    };

    if (stepDef.channel === "sms") {
        await sendRecoverySms(recovery, tenant, stepDef, vars);
    } else if (stepDef.channel === "call") {
        await makeRecoveryCall(recovery, tenant, stepDef, vars);
    }

    // Also send a Facebook message if lead came from Facebook and this is an SMS step
    if (recovery.lead_source === "facebook" && stepDef.channel === "sms") {
        const fbIdx = Math.min(recovery.sms_attempts, FACEBOOK_MESSAGES.length - 1);
        if (fbIdx < FACEBOOK_MESSAGES.length) {
            // Log the Facebook touch (actual FB API integration would go here)
            await logTouch(recovery.id, recovery.tenant_id, "facebook", stepDef.step, FACEBOOK_MESSAGES[fbIdx]);
        }
    }

    // Advance to next step
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
        await client.messages.create({
            to: recovery.contact_phone,
            from,
            body,
        });
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
// OUTBOUND CALL (via Twilio)
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

    // Build TwiML URL for the outbound call — AI will read the script
    const script = (stepDef.script || stepDef.voicemail || "")
        .replace(/\{\{first_name\}\}/g, vars.first_name)
        .replace(/\{\{company_name\}\}/g, vars.company_name);

    const twimlUrl = `${baseUrl.replace(/\/$/, "")}/twilio/recovery-call?recoveryId=${encodeURIComponent(recovery.id)}&script=${encodeURIComponent(script)}`;

    try {
        const call = await client.calls.create({
            to: recovery.contact_phone,
            from,
            url: twimlUrl,
            method: "GET",
            timeout: 30,
            statusCallback: `${baseUrl.replace(/\/$/, "")}/twilio/recovery-call-status?recoveryId=${encodeURIComponent(recovery.id)}`,
            statusCallbackMethod: "POST",
            statusCallbackEvent: ["completed"],
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
        // If we were in an objection sequence, rejoin ghost sequence at day3_sms
        if (recovery.objection_type && recovery.current_step !== "day7_final") {
            const ghostResume = ALL_STEPS.get("day3_sms");
            if (ghostResume) {
                const nextAt = addHours(new Date(), ghostResume.delayHours || 24);
                await db.query(
                    "UPDATE estimate_recoveries SET current_step = $1, next_action_at = $2, updated_at = now() WHERE id = $3",
                    ["day3_sms", nextAt.toISOString(), recovery.id]
                );
                return;
            }
        }
        // End of sequence → dormant
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

/**
 * Route a recovery into an objection sequence.
 * Called when the lead responds with a specific objection.
 */
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
}

async function markDormant(recoveryId) {
    await db.query(
        "UPDATE estimate_recoveries SET status = 'dormant', updated_at = now() WHERE id = $1",
        [recoveryId]
    );
    console.log("[Recovery] Dormant id=%s", recoveryId);
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

/**
 * Resume a paused or dormant recovery — resets to Day 1 SMS.
 */
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

/**
 * Record that the lead responded (resets last_response_at).
 */
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

/**
 * Get recovery stats for a tenant (conversion rate, etc.).
 */
async function getRecoveryStats(tenantId) {
    const [total, active, converted, dormant] = await Promise.all([
        db.query("SELECT COUNT(*) as count FROM estimate_recoveries WHERE tenant_id = $1", [tenantId]),
        db.query("SELECT COUNT(*) as count FROM estimate_recoveries WHERE tenant_id = $1 AND status = 'active'", [tenantId]),
        db.query("SELECT COUNT(*) as count FROM estimate_recoveries WHERE tenant_id = $1 AND status = 'converted'", [tenantId]),
        db.query("SELECT COUNT(*) as count FROM estimate_recoveries WHERE tenant_id = $1 AND status = 'dormant'", [tenantId]),
    ]);
    const t = parseInt(total.rows[0].count, 10) || 0;
    const c = parseInt(converted.rows[0].count, 10) || 0;
    return {
        total: t,
        active: parseInt(active.rows[0].count, 10) || 0,
        converted: c,
        dormant: parseInt(dormant.rows[0].count, 10) || 0,
        recovery_rate_pct: t > 0 ? Math.round((c / t) * 100) : 0,
    };
}

module.exports = {
    // Core
    startRecovery,
    processDueRecoveries,
    // Objection routing
    setObjection,
    // Status
    markConverted,
    markDormant,
    markPaused,
    markCancelled,
    resumeRecovery,
    recordResponse,
    // Queries
    getRecoveriesByTenant,
    getRecoveryById,
    getTouchesByRecovery,
    getRecoveryStats,
    // Manual Actions
    sendRecoverySms,
    makeRecoveryCall,
    advanceStep,
    // Constants (for API/UI)
    GHOST_SEQUENCE,
    OBJECTION_SEQUENCES,
    ALL_STEPS
};

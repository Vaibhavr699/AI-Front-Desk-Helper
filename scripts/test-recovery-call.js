"use strict";

require("dotenv").config();

const readline = require("readline");
const { client: twilioClient } = require("../lib/twilio");
const db = require("../lib/db");
const estimateRecovery = require("../services/estimateRecovery");

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer);
        });
    });
}

// Your phone number — the AI will call you
const RING_NUMBER = (process.env.TEST_RING_NUMBER || "+918076055898").replace(/\s/g, "");

/**
 * Test the Estimate Recovery system end-to-end:
 *
 * 1. Find the latest booking (or create a dummy one)
 * 2. Start a recovery sequence for it
 * 3. Place an outbound AI call to your phone using the recovery TwiML
 * 4. You talk to the AI — it will follow up on the estimate
 * 5. After the call, check recovery status, touches, objections
 *
 * Usage:
 *   node scripts/test-recovery-call.js
 *
 * Env vars: BASE_URL, TEST_RING_NUMBER, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN
 */
async function main() {
    if (!twilioClient) {
        console.error("❌ Twilio not configured. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in .env");
        process.exit(1);
    }

    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║   Estimate Recovery — Live AI Test               ║");
    console.log("╚══════════════════════════════════════════════════╝\n");

    // ── Step 1: Find or create a test booking ──
    console.log("Step 1: Finding a booking to recover...\n");

    let booking;
    const bookings = await db.query(
        "SELECT b.*, t.company_name FROM bookings b JOIN tenants t ON t.id = b.tenant_id ORDER BY b.created_at DESC LIMIT 1"
    );

    if (bookings.rows.length > 0) {
        booking = bookings.rows[0];
        console.log("  ✅ Using latest booking:");
        console.log("     ID:      ", booking.id);
        console.log("     Contact: ", booking.contact_name, "|", booking.contact_phone);
        console.log("     Tenant:  ", booking.company_name);
        console.log("     Created: ", booking.created_at);
    } else {
        // Create a dummy booking for testing
        console.log("  ⚠ No bookings found. Creating a test booking...\n");
        const tenant = await db.query("SELECT id, company_name FROM tenants LIMIT 1");
        if (!tenant.rows.length) {
            console.error("❌ No tenants found. Create a tenant first via the dashboard.");
            process.exit(1);
        }
        const t = tenant.rows[0];
        const res = await db.query(
            `INSERT INTO bookings (tenant_id, contact_name, contact_phone, address, scope, status)
       VALUES ($1, 'John Test', $2, '123 Main St', 'exterior', 'scheduled') RETURNING *`,
            [t.id, RING_NUMBER]
        );
        booking = { ...res.rows[0], company_name: t.company_name };
        console.log("  ✅ Test booking created:");
        console.log("     ID:      ", booking.id);
        console.log("     Contact:  John Test |", RING_NUMBER);
        console.log("     Tenant:  ", booking.company_name);
    }

    // ── Step 2: Start the recovery sequence ──
    console.log("\nStep 2: Starting recovery sequence...\n");

    // Cancel any existing recovery for this booking so re-runs work
    const existingRecoveries = await db.query(
        "SELECT id, status FROM estimate_recoveries WHERE booking_id = $1 AND status IN ('active', 'paused') ORDER BY created_at DESC",
        [booking.id]
    );
    for (const ex of existingRecoveries.rows) {
        console.log("  ⚠ Cancelling old recovery:", ex.id, "status:", ex.status);
        await estimateRecovery.markCancelled(ex.id);
    }

    const recovery = await estimateRecovery.startRecovery(booking.tenant_id, booking.id, {
        contact_name: booking.contact_name,
        contact_phone: booking.contact_phone,
        lead_source: "phone",
    });

    if (!recovery) {
        console.error("❌ Could not start recovery. There may already be an active one for this booking.");
        // Check existing
        const existing = await db.query(
            "SELECT * FROM estimate_recoveries WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1",
            [booking.id]
        );
        if (existing.rows[0]) {
            console.log("  Found existing recovery ID:", existing.rows[0].id, "status:", existing.rows[0].status);
            if (existing.rows[0].status !== "active") {
                console.log("  Resuming it...");
                await estimateRecovery.resumeRecovery(existing.rows[0].id);
            }
        }
        process.exit(1);
    }

    console.log("  ✅ Recovery started:");
    console.log("     Recovery ID: ", recovery.id);
    console.log("     Status:      ", recovery.status);
    console.log("     Current step:", recovery.current_step);
    console.log("     Contact:     ", recovery.contact_name, "|", recovery.contact_phone);

    // ── Step 3: Place the outbound AI call ──
    console.log("\nStep 3: Placing outbound AI call to your phone...\n");

    // Get the tenant's Twilio number to use as caller ID
    const phoneRes = await db.query(
        "SELECT phone FROM phone_numbers WHERE tenant_id = $1 ORDER BY is_primary DESC NULLS LAST LIMIT 1",
        [booking.tenant_id]
    );
    const fromNumber = phoneRes.rows[0]?.phone || process.env.TWILIO_PHONE_NUMBER;
    if (!fromNumber) {
        console.error("❌ No from number found. Assign a phone number to the tenant first.");
        process.exit(1);
    }

    const script = `Hey ${(booking.contact_name || "there").split(/\s+/)[0]}, just following up on the estimate we sent over. I wanted to see if you had any questions before we move forward.`;

    const recoveryCallUrl = `${BASE_URL.replace(/\/$/, "")}/twilio/recovery-call?recoveryId=${encodeURIComponent(recovery.id)}&script=${encodeURIComponent(script)}`;
    const statusCallbackUrl = `${BASE_URL.replace(/\/$/, "")}/twilio/recovery-call-status?recoveryId=${encodeURIComponent(recovery.id)}`;

    console.log("  From (tenant AI): ", fromNumber);
    console.log("  To (your phone):  ", RING_NUMBER);
    console.log("  Recovery ID:      ", recovery.id);
    console.log("  Webhook:          ", BASE_URL);

    const call = await twilioClient.calls.create({
        from: fromNumber,
        to: RING_NUMBER,
        url: recoveryCallUrl,
        method: "GET",
        timeout: 30,
        statusCallback: statusCallbackUrl,
        statusCallbackMethod: "POST",
        statusCallbackEvent: ["completed"],
    });

    console.log("\n  📞 Call created! SID:", call.sid);
    console.log("  Your phone should ring. Answer it!\n");
    console.log("  ┌──────────────────────────────────────────┐");
    console.log("  │  TEST SCENARIOS TO TRY:                   │");
    console.log("  │                                           │");
    console.log("  │  1. Say 'I need to think about it'        │");
    console.log("  │     → AI should handle thinking objection │");
    console.log("  │                                           │");
    console.log("  │  2. Say 'The price seems high'            │");
    console.log("  │     → AI should handle price objection    │");
    console.log("  │                                           │");
    console.log("  │  3. Say 'I need to talk to my wife'       │");
    console.log("  │     → AI should handle spouse objection   │");
    console.log("  │                                           │");
    console.log("  │  4. Say 'Yes, let's book it'              │");
    console.log("  │     → AI should book appointment on spot  │");
    console.log("  └──────────────────────────────────────────┘\n");

    // ── Step 4: Wait for call to finish ──
    await ask("When the call is done, press Enter to check results... ");

    // ── Step 5: Check recovery status ──
    console.log("\n╔══════════════════════════════════════════════════╗");
    console.log("║   RESULTS                                        ║");
    console.log("╚══════════════════════════════════════════════════╝\n");

    const updatedRecovery = await estimateRecovery.getRecoveryById(recovery.id);
    if (updatedRecovery) {
        console.log("Recovery Status:");
        console.log("  ID:             ", updatedRecovery.id);
        console.log("  Status:         ", updatedRecovery.status, updatedRecovery.status === "converted" ? "🎉" : "");
        console.log("  Objection type: ", updatedRecovery.objection_type || "(none — ghosting path)");
        console.log("  Current step:   ", updatedRecovery.current_step);
        console.log("  SMS attempts:   ", updatedRecovery.sms_attempts);
        console.log("  Call attempts:  ", updatedRecovery.call_attempts);
        console.log("  Last response:  ", updatedRecovery.last_response_at || "(no response recorded)");
        console.log("");
    }

    // Check touches
    const touches = await estimateRecovery.getTouchesByRecovery(recovery.id);
    if (touches.length > 0) {
        console.log("Touch History:");
        for (const t of touches) {
            console.log(`  [${t.channel.toUpperCase()}] step=${t.step} status=${t.status} ${t.call_sid ? "callSid=" + t.call_sid : ""}`);
            if (t.message_body) console.log(`    "${t.message_body.slice(0, 80)}${t.message_body.length > 80 ? "..." : ""}"`);
        }
        console.log("");
    } else {
        console.log("  No touches logged yet.\n");
    }

    // Check if a new booking was created (conversion)
    const newBookings = await db.query(
        "SELECT * FROM bookings WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 3",
        [booking.tenant_id]
    );
    console.log("Latest Bookings:");
    for (const b of newBookings.rows) {
        const marker = b.created_at > booking.created_at ? " ← NEW (from recovery call)" : "";
        console.log(`  ${b.id} | ${b.contact_name} | ${b.contact_phone} | ${b.created_at}${marker}`);
    }

    // Summary
    console.log("\n───────────────────────────────────────────────────");
    if (updatedRecovery?.status === "converted") {
        console.log("✅ RECOVERY CONVERTED — The AI booked the appointment on the call!");
    } else if (updatedRecovery?.objection_type) {
        console.log(`📋 OBJECTION DETECTED: "${updatedRecovery.objection_type}" — Follow-up sequence adjusted.`);
        console.log(`   Next step: ${updatedRecovery.current_step} at ${updatedRecovery.next_action_at}`);
    } else {
        console.log("📞 Call completed. Check status above.");
        console.log("   The cron will continue the sequence automatically.");
    }
    console.log("───────────────────────────────────────────────────\n");

    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});

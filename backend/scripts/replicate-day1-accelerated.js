"use strict";

require("dotenv").config();
const db = require("../lib/db");
const estimateRecovery = require("../services/estimateRecovery");

const TARGET_NUMBER = "+918076055898";

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log("🚀 Starting Accelerated Day 1 Follow-Up Test for", TARGET_NUMBER);

    // 1. Find a tenant
    const tenantRes = await db.query("SELECT id, company_name FROM tenants LIMIT 1");
    if (!tenantRes.rows[0]) {
        console.error("❌ No tenants found.");
        process.exit(1);
    }
    const tenant = tenantRes.rows[0];
    console.log(`✅ Using Tenant: ${tenant.company_name} (${tenant.id})`);

    // 2. Find or create a booking
    let bookingRes = await db.query(
        "SELECT id FROM bookings WHERE contact_phone = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1",
        [TARGET_NUMBER, tenant.id]
    );
    let bookingId;
    if (bookingRes.rows[0]) {
        bookingId = bookingRes.rows[0].id;
        console.log("✅ Using existing booking:", bookingId);
    } else {
        const insertRes = await db.query(
            "INSERT INTO bookings (tenant_id, contact_name, contact_phone, status) VALUES ($1, 'Rahul Test', $2, 'scheduled') RETURNING id",
            [tenant.id, TARGET_NUMBER]
        );
        bookingId = insertRes.rows[0].id;
        console.log("✅ Created new test booking:", bookingId);
    }

    // 3. Clear any old recoveries to avoid conflicts
    await db.query("UPDATE estimate_recoveries SET status = 'cancelled' WHERE contact_phone = $1", [TARGET_NUMBER]);

    // 4. Start Recovery (This sets first step to day1_sms)
    console.log("\n--- Triggering Day 1 SMS ---");
    const recovery = await estimateRecovery.startRecovery(tenant.id, bookingId, {
        contact_name: "Rahul",
        contact_phone: TARGET_NUMBER,
        lead_source: "phone"
    });

    // 5. Force process the SMS step
    // We update next_action_at to ensure it is due
    await db.query("UPDATE estimate_recoveries SET next_action_at = now() - interval '1 minute' WHERE id = $1", [recovery.id]);
    await estimateRecovery.processDueRecoveries();
    console.log("✅ SMS Step processed.");

    console.log("\nWaiting 10 seconds before triggering the call...");
    await sleep(10000);

    // 6. Force the step to 'day1_call' and make it due
    console.log("\n--- Triggering Day 1 Call ---");
    await db.query(
        "UPDATE estimate_recoveries SET current_step = 'day1_call', next_action_at = now() - interval '1 minute' WHERE id = $1",
        [recovery.id]
    );

    // 7. Force process the Call step
    await estimateRecovery.processDueRecoveries();
    console.log("✅ Call Step processed. Your phone should ring shortly.");

    console.log("\n--- Test Complete ---");
    process.exit(0);
}

main().catch(err => {
    console.error(err);
    process.exit(1);
});

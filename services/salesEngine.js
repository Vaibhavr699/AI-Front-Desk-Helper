"use strict";

const db = require("../lib/db");
const fetch = require("node-fetch");
const crypto = require("crypto");

/**
 * Trigger an estimate follow-up for a lead.
 * This will create a record in the database to track the follow-up stages.
 */
async function createEstimateFollowUp(lead, tenantId = null) {
    try {
        const phone = lead.phone;
        if (!phone) return;

        // Default to Gladiators Painting tenant if not provided
        if (!tenantId) {
            const res = await db.pool.query("SELECT id FROM tenants WHERE slug = 'gladiators-painting' LIMIT 1");
            tenantId = res.rows[0]?.id;
        }

        if (!tenantId) {
            console.warn("[Sales-Engine] No tenant ID found for follow-up. Using null.");
        }

        // Check if there's already an active recovery for this phone
        const existing = await db.pool.query(
            "SELECT id FROM estimate_recoveries WHERE contact_phone = $1 AND status = 'active'",
            [phone]
        );

        if (existing.rows.length > 0) {
            console.log("[Sales-Engine] Follow-up already active for %s", phone);
            return;
        }

        await db.pool.query(
            `INSERT INTO estimate_recoveries (
        id, tenant_id, contact_name, contact_phone, status, current_step, next_action_at
      ) VALUES ($1, $2, $3, $4, 'active', '0', $5)`,
            [
                crypto.randomUUID(),
                tenantId,
                lead.full_name || "",
                phone,
                new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString() // 2 hours from now
            ]
        );

        console.log("[Sales-Engine] Created follow-up for %s (Stage 0 in 2h)", phone);
    } catch (err) {
        console.error("[Sales-Engine] createEstimateFollowUp error:", err.message);
    }
}

/**
 * Run the automation loop to process due follow-ups.
 */
async function runEstimateFollowUps() {
    try {
        const res = await db.pool.query(
            `SELECT er.*, t.company_name 
       FROM estimate_recoveries er
       LEFT JOIN tenants t ON t.id = er.tenant_id
       WHERE er.status = 'active' AND er.next_action_at <= now()
       LIMIT 50`
        );

        for (const item of res.rows) {
            await processFollowUpStage(item);
        }
    } catch (err) {
        console.error("[Sales-Engine] runEstimateFollowUps error:", err.message);
    }
}

async function processFollowUpStage(item) {
    const stage = parseInt(item.current_step, 10);
    const phone = item.contact_phone;
    const name = item.contact_name;
    const companyName = item.company_name || "our team";
    const now = Date.now();

    try {
        if (stage === 0) {
            // Stage 0: 2 hours after estimate
            await sendTwilioSms(
                phone,
                `Hi ${name || ""}! Just checking in about your ${companyName} estimate. Do you have any questions I can help with?`
            );
            await updateStage(item.id, 1, now + (24 * 60 * 60 * 1000));
        }
        else if (stage === 1) {
            // Stage 1: 24 hours later
            await sendTwilioSms(
                phone,
                `Hi ${name || ""}, this is ${companyName}. We still have a few openings this week if you'd like to get your project scheduled. Want me to lock in a time for you?`
            );
            await updateStage(item.id, 2, now + (48 * 60 * 60 * 1000));
        }
        else if (stage === 2) {
            // Stage 2: 48 hours later (Outbound Call 1)
            await triggerOutboundEstimateCall({ phone, full_name: name, companyName });
            await updateStage(item.id, 3, now + (72 * 60 * 60 * 1000));
        }
        else if (stage === 3) {
            // Stage 3: 72 hours later (Outbound Call 2)
            await triggerOutboundEstimateCall({ phone, full_name: name, companyName });
            await updateStage(item.id, 4, now + (5 * 24 * 60 * 60 * 1000));
        }
        else if (stage === 4) {
            // Stage 4: 5 days later (Outbound Call 3)
            await triggerOutboundEstimateCall({ phone, full_name: name, companyName });
            await db.pool.query("UPDATE estimate_recoveries SET status = 'dormant', updated_at = now() WHERE id = $1", [item.id]);
        }
    } catch (err) {
        console.error("[Sales-Engine] processFollowUpStage error for %s:", item.id, err.message);
    }
}

async function updateStage(id, stage, nextAction) {
    await db.pool.query(
        "UPDATE estimate_recoveries SET current_step = $1, next_action_at = $2, updated_at = now() WHERE id = $3",
        [stage.toString(), new Date(nextAction).toISOString(), id]
    );
}

/**
 * Trigger an outbound AI call via Twilio.
 */
async function triggerOutboundEstimateCall(lead) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;
    const companyName = lead.companyName || "our team";

    if (!accountSid || !authToken || !from) {
        console.warn("[Sales-Engine] Twilio credentials missing. Skipping outbound call.");
        return;
    }

    const baseUrl = process.env.BASE_URL || "";
    if (!baseUrl) {
        console.warn("[Sales-Engine] BASE_URL missing. Skipping outbound call.");
        return;
    }

    const wsHost = baseUrl.replace(/^https?:\/\//, "");
    const script = `Hey ${lead.full_name || ""}, this is the AI assistant from ${companyName}. I'm calling to see if you had any questions about the estimate we sent over...`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${wsHost}/twilio-media?type=recovery&amp;script=${encodeURIComponent(script)}" />
  </Connect>
</Response>`;

    try {
        const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
        const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`;

        const response = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({
                To: lead.phone,
                From: from,
                Twiml: twiml
            })
        });

        if (!response.ok) {
            const body = await response.text();
            console.error("[Sales-Engine] Twilio outbound call failed:", response.status, body);
        } else {
            console.log("[Sales-Engine] Outbound AI call triggered for %s (Tenant: %s)", lead.phone, companyName);
        }
    } catch (err) {
        console.error("[Sales-Engine] triggerOutboundEstimateCall error:", err.message);
    }
}

/**
 * Helper to send SMS via Twilio.
 */
async function sendTwilioSms(to, body) {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !from) return;

    const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

    try {
        await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Basic ${auth}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: new URLSearchParams({ To: to, From: from, Body: body })
        });
        console.log("[Sales-Engine] SMS sent to %s", to);
    } catch (err) {
        console.error("[Sales-Engine] sendTwilioSms error:", err.message);
    }
}

/**
 * Stop an active follow-up (e.g., if estimate accepted in DripJobs).
 */
async function stopEstimateFollowUp(phone, status = "converted") {
    try {
        const result = await db.pool.query(
            "UPDATE estimate_recoveries SET status = $1, updated_at = now() WHERE contact_phone = $2 AND status = 'active' RETURNING id, tenant_id, contact_name",
            [status, phone]
        );

        if (result.rows.length > 0) {
            const row = result.rows[0];
            console.log("[Sales-Engine] Follow-up STOPPED for %s (Status: %s)", phone, status);

            if (status === "converted") {
                await notifyOwnerOfConversion(row.tenant_id, row.contact_name);
            }

            return { ok: true, count: result.rows.length };
        } else {
            console.log("[Sales-Engine] No active follow-up found to stop for %s", phone);
            return { ok: false, reason: "no_active_followup" };
        }
    } catch (err) {
        console.error("[Sales-Engine] stopEstimateFollowUp error:", err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * Notify the business owner (tenant) that an estimate was accepted.
 */
async function notifyOwnerOfConversion(tenantId, leadName) {
    try {
        const res = await db.pool.query("SELECT company_name, transfer_numbers FROM tenants WHERE id = $1", [tenantId]);
        const tenant = res.rows[0];
        if (!tenant) return;

        const ownerPhone = (tenant.transfer_numbers && tenant.transfer_numbers[0]) || null;
        if (!ownerPhone) {
            console.warn("[Sales-Engine] No owner phone for tenant %s. Skipping notification.", tenantId);
            return;
        }

        const msg = `🚀 SALES WIN! ${leadName || "A customer"} just accepted their estimate for ${tenant.company_name}. Great job!`;
        await sendTwilioSms(ownerPhone, msg);
        console.log("[Sales-Engine] Owner notification sent to %s", ownerPhone);
    } catch (err) {
        console.error("[Sales-Engine] notifyOwnerOfConversion error:", err.message);
    }
}

module.exports = {
    createEstimateFollowUp,
    runEstimateFollowUps,
    stopEstimateFollowUp
};

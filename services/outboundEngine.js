"use strict";

const db = require("../lib/db");
const twilio = require("twilio");
const cron = require("node-cron");
const { evolveScripts } = require("./outbound");

/**
 * Background worker that processes active outbound campaigns.
 * Respects calling hours, max attempts, and tenant minute balance.
 */
async function startOutboundEngine() {
  console.log("[Outbound] Engine started.");

  // Run every minute
  cron.schedule("*/1 * * * *", async () => {
    try {
      await processActiveCampaigns();
    } catch (err) {
      console.error("[Outbound] Engine error:", err.message);
    }
  });
}

async function processActiveCampaigns() {
  // 1. Find active campaigns
  const campaigns = await db.query(
    "SELECT id, tenant_id, name, mode, calling_hours_start, calling_hours_end, max_attempts FROM outbound_campaigns WHERE status = 'active'"
  );

  for (const campaign of campaigns.rows) {
    try {
      // 2. CHECK: Calling Hours
      if (!isWithinCallingHours(campaign)) continue;

      // 3. CHECK: Tenant Minute Balance
      const balance = await getTenantMinuteBalance(campaign.tenant_id);
      if (balance <= 0) {
        console.warn("[Outbound] Pausing campaign %s: Tenant %s out of minutes.", campaign.name, campaign.tenant_id);
        await db.query("UPDATE outbound_campaigns SET status = 'paused' WHERE id = $1", [campaign.id]);
        // TODO: Send alert to user
        continue;
      }

      // 4. Find next contact to call
      const contact = await findNextContact(campaign);
      if (!contact) {
        console.log("[Outbound] Campaign %s finished all contacts.", campaign.name);
        await db.query("UPDATE outbound_campaigns SET status = 'completed' WHERE id = $1", [campaign.id]);
        continue;
      }

      // 5. Pick a script (for Auto mode)
      let scriptId = null;
      if (campaign.mode === 'auto') {
        // SCRIPTS SURVIVAL LOOP: Evolve every 50 calls made in campaign
        if (campaign.calls_made > 0 && campaign.calls_made % 50 === 0) {
           console.log("[Outbound] Triggering AI Evolution Loop for campaign %s", campaign.name);
           evolveScripts(campaign.id).catch(e => console.error("[Outbound] Evolution failed:", e.message));
        }

        const scriptRes = await db.query(
          "SELECT id FROM outbound_scripts WHERE campaign_id = $1 AND status = 'active'", 
          [campaign.id]
        );
        if (scriptRes.rows.length > 0) {
          const randomScript = scriptRes.rows[Math.floor(Math.random() * scriptRes.rows.length)];
          scriptId = randomScript.id;
        }
      }

      // 6. Initiate Call
      await initiateOutboundCall(campaign, contact, scriptId);
    } catch (e) {
      console.error("[Outbound] Error processing campaign %s:", campaign.id, e.message);
    }
  }
}

function isWithinCallingHours(campaign) {
  const now = new Date();
  const timeStr = now.toTimeString().split(' ')[0]; // HH:MM:SS
  return timeStr >= campaign.calling_hours_start && timeStr <= campaign.calling_hours_end;
}

async function getTenantMinuteBalance(tenantId) {
  // Plan limits (duplicated here for speed, better in a shared lib)
  const PLAN_LIMITS = { basic: 500, pro: 1200, elite: 3000 };
  
  const tenantRes = await db.query("SELECT plan, bundle_minutes_balance FROM tenants WHERE id = $1", [tenantId]);
  const tenant = tenantRes.rows[0];
  if (!tenant) return 0;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0,0,0,0);

  const usageRes = await db.query(
    "SELECT COALESCE(SUM(duration_sec), 0) as total_sec FROM recordings WHERE tenant_id = $1 AND created_at >= $2",
    [tenantId, startOfMonth]
  );
  
  const usedMinutes = Math.ceil(usageRes.rows[0].total_sec / 60);
  const planLimit = PLAN_LIMITS[tenant.plan] || 500;
  
  const planMinutesLeft = Math.max(0, planLimit - usedMinutes);
  return planMinutesLeft + (tenant.bundle_minutes_balance || 0);
}

async function findNextContact(campaign) {
  // Rules: status = 'pending' OR (status = 'no_answer' AND attempts < max_attempts)
  // Ordered by last_attempt_at (oldest first)
  const res = await db.query(
    `SELECT * FROM outbound_contacts 
     WHERE campaign_id = $1 
     AND status IN ('pending', 'no_answer') 
     AND attempts < $2
     ORDER BY last_attempt_at ASC NULLS FIRST
     LIMIT 1`,
    [campaign.id, campaign.max_attempts]
  );
  return res.rows[0] || null;
}

async function initiateOutboundCall(campaign, contact, scriptId = null) {
  const tenantRes = await db.query(
    "SELECT id, twilio_account_sid, twilio_auth_token FROM tenants WHERE id = $1", 
    [campaign.tenant_id]
  );
  const tenant = tenantRes.rows[0];
  if (!tenant || !tenant.twilio_account_sid) return;

  const client = twilio(tenant.twilio_account_sid, tenant.twilio_auth_token);
  
  // Find outbound number
  const phoneRes = await db.query(
    "SELECT phone FROM phone_numbers WHERE tenant_id = $1 AND is_active = true LIMIT 1",
    [campaign.tenant_id]
  );
  const fromNumber = phoneRes.rows[0]?.phone;
  if (!fromNumber) return;

  console.log("[Outbound] Calling %s (%s) for campaign %s", contact.name, contact.phone, campaign.name);

  // We'll use a TwiML Bin or a hosted endpoint that points back to our /twilio-media handler
  // For simplicity, we just trigger the call and point to our server's outbound entry
  const baseUrl = process.env.BASE_URL || "";
  let callbackUrl = `${baseUrl}/twilio/outbound?campaignId=${campaign.id}&contactId=${contact.id}`;
  if (scriptId) callbackUrl += `&scriptId=${scriptId}`;

  try {
    const call = await client.calls.create({
      url: callbackUrl,
      to: contact.phone,
      from: fromNumber,
    });

    await db.query(
      "UPDATE outbound_contacts SET attempts = attempts + 1, last_attempt_at = now(), status = 'contacted', last_script_id = $1 WHERE id = $2",
      [scriptId, contact.id]
    );

    await db.query(
      "UPDATE outbound_campaigns SET calls_made = calls_made + 1 WHERE id = $1",
      [campaign.id]
    );

  } catch (err) {
    console.error("[Outbound] Twilio call failed:", err.message);
    await db.query("UPDATE outbound_contacts SET status = 'failed' WHERE id = $1", [contact.id]);
  }
}

module.exports = { startOutboundEngine };

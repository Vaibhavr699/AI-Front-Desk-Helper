"use strict";

const db = require("../lib/db");
const twilio = require("twilio");
const cron = require("node-cron");
const { evolveScripts } = require("./outbound");
const {
  canRunOutboundFollowup,
  canRunOutboundLists,
  getOutboundDailyMax,
} = require("../lib/plans");

/**
 * Background worker that processes active outbound campaigns.
 * Respects calling hours, max attempts, tenant minute balance,
 * and per-tenant outbound gates (followup / lists / daily-max).
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
    "SELECT id, tenant_id, name, mode, calling_hours_start, calling_hours_end, max_attempts, calls_made FROM outbound_campaigns WHERE status = 'active'"
  );

  for (const campaign of campaigns.rows) {
    try {
      // 2. CHECK: Calling Hours
      if (!isWithinCallingHours(campaign)) continue;

      // 3. Load tenant once with all the columns the rest of this iteration
      // needs. plan_overrides is critical — without it, gate helpers fall
      // back to defaults always and per-zee overrides do nothing.
      // (Apr 29, 2026 — fixes Bug 2 from Phase 6 build.)
      const tenantRes = await db.query(
        `SELECT id, plan, plan_overrides, bundle_minutes_balance,
                twilio_account_sid, twilio_auth_token
           FROM tenants WHERE id = $1`,
        [campaign.tenant_id]
      );
      const tenant = tenantRes.rows[0];
      if (!tenant) {
        console.warn("[Outbound] Tenant %s missing, skipping campaign %s", campaign.tenant_id, campaign.name);
        continue;
      }

      // 4. CHECK: Outbound feature gates (Apr 29, 2026 — Phase 6 Franchise).
      // auto mode = AI-driven estimate/lead followup → gated by followup flag.
      // any other mode = bulk list dialing → gated by lists flag.
      // Both gated checks happen before script generation or Twilio cost.
      if (campaign.mode === "auto") {
        if (!canRunOutboundFollowup(tenant)) {
          console.warn(
            "[Outbound] Skipping campaign %s: tenant %s has outbound_followup disabled",
            campaign.name,
            tenant.id
          );
          continue;
        }
      } else {
        if (!canRunOutboundLists(tenant)) {
          console.warn(
            "[Outbound] Skipping campaign %s: tenant %s has outbound_lists disabled",
            campaign.name,
            tenant.id
          );
          continue;
        }
      }

      // 5. CHECK: Daily call cap.
      // Franchise zees default to 50/day. HQ can override per-zee.
      // Non-franchise tenants default to Infinity (no cap).
      const dailyMax = getOutboundDailyMax(tenant);
      if (Number.isFinite(dailyMax)) {
        const todayCount = await getTodayCallCount(tenant.id);
        if (todayCount >= dailyMax) {
          console.warn(
            "[Outbound] Skipping campaign %s: tenant %s hit daily cap (%d/%d)",
            campaign.name,
            tenant.id,
            todayCount,
            dailyMax
          );
          continue;
        }
      }

      // 6. CHECK: Tenant Minute Balance
      const balance = await getTenantMinuteBalance(tenant);
      if (balance <= 0) {
        console.warn("[Outbound] Pausing campaign %s: Tenant %s out of minutes.", campaign.name, tenant.id);
        await db.query("UPDATE outbound_campaigns SET status = 'paused' WHERE id = $1", [campaign.id]);
        // TODO: Send alert to user
        continue;
      }

      // 7. Find next contact to call
      const contact = await findNextContact(campaign);
      if (!contact) {
        console.log("[Outbound] Campaign %s finished all contacts.", campaign.name);
        await db.query("UPDATE outbound_campaigns SET status = 'completed' WHERE id = $1", [campaign.id]);
        continue;
      }

      // 8. Pick a script (for Auto mode)
      let scriptId = null;
      if (campaign.mode === 'auto') {
        const scriptRes = await db.query(
          "SELECT id FROM outbound_scripts WHERE campaign_id = $1 AND status = 'active'", 
          [campaign.id]
        );
        
        // CRITICAL: If scripts aren't generated yet (OpenAI delay), skip this tick 
        // to prevent 'Manual Mode' leakage.
        if (scriptRes.rows.length === 0) {
           console.log("[Outbound] Skipping campaign %s: Waiting for script generation...", campaign.name);
           continue; 
        }

        // SCRIPTS SURVIVAL LOOP: Evolve every 50 calls made in campaign
        if (campaign.calls_made > 0 && campaign.calls_made % 50 === 0) {
           console.log("[Outbound] Triggering AI Evolution Loop for campaign %s", campaign.name);
           evolveScripts(campaign.id).catch(e => console.error("[Outbound] Evolution failed:", e.message));
        }

        const randomScript = scriptRes.rows[Math.floor(Math.random() * scriptRes.rows.length)];
        scriptId = randomScript.id;
      }

      // 9. Initiate Call (pass tenant — already loaded above)
      await initiateOutboundCall(campaign, contact, scriptId, tenant);
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

/**
 * Count outbound calls already attempted today for this tenant.
 * Uses outbound_contacts.last_attempt_at joined to campaigns by tenant.
 * Apr 29, 2026 — added for franchise daily-cap enforcement.
 *
 * NOTE: If you have a dedicated outbound_call_log or calls table that
 * tracks outbound separately, swap this query — outbound_contacts only
 * captures the LAST attempt per contact, so a contact called 3x today
 * still counts as 1 here. Acceptable for soft cap enforcement on the
 * franchise tier; tighten later if needed.
 */
async function getTodayCallCount(tenantId) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const res = await db.query(
    `SELECT COUNT(*) as cnt
       FROM outbound_contacts oc
       JOIN outbound_campaigns ocp ON ocp.id = oc.campaign_id
      WHERE ocp.tenant_id = $1
        AND oc.last_attempt_at >= $2`,
    [tenantId, startOfDay]
  );
  return parseInt(res.rows[0]?.cnt || "0", 10);
}

/**
 * Get tenant's remaining minute balance for the month.
 * Now accepts a tenant object so caller can avoid double-querying.
 */
async function getTenantMinuteBalance(tenant) {
  // Plan limits (duplicated here for speed, better in a shared lib)
  const PLAN_LIMITS = { basic: 500, pro: 1200, elite: 3000, franchise: 500 };

  if (!tenant) return 0;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0,0,0,0);

  const usageRes = await db.query(
    "SELECT COALESCE(SUM(duration_sec), 0) as total_sec FROM recordings WHERE tenant_id = $1 AND created_at >= $2",
    [tenant.id, startOfMonth]
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

/**
 * Initiate the actual Twilio call.
 * @param {object} campaign - campaign row
 * @param {object} contact - contact row
 * @param {string|null} scriptId - script to use (auto mode)
 * @param {object} tenant - already-loaded tenant (avoids redundant SELECT)
 */
async function initiateOutboundCall(campaign, contact, scriptId, tenant) {
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
    // ─────────────────────────────────────────────────────────────────
    // AMD (Answering Machine Detection) — Apr 27, 2026 fix
    //
    // machineDetection: "Enable" → Twilio listens to the called party's
    // first audio and determines human vs machine.  Result is sent back
    // as `AnsweredBy` parameter on the TwiML callback URL.
    //
    // asyncAmd: false → Twilio WAITS for AMD result before firing the
    // callback URL.  This is critical because routes/twilio.js /outbound
    // reads AnsweredBy on the initial request.  If async, AnsweredBy
    // would arrive on a separate webhook later, after we'd already
    // connected Alex to the voicemail.
    //
    // Without these flags, AnsweredBy is always empty, and the AMD
    // handling code in routes/twilio.js was dead.
    // ─────────────────────────────────────────────────────────────────
    const call = await client.calls.create({
      url: callbackUrl,
      to: contact.phone,
      from: fromNumber,
      machineDetection: "Enable",
      machineDetectionTimeout: 30,
      asyncAmd: false,
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

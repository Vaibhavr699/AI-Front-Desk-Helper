"use strict";

// ============================================================================
// cron/reportResellerUsage.js
// ============================================================================
// Apr 27, 2026 — Reseller pricing rebuild Day 4
//
// Daily reporter that pushes voice + SMS overage usage to Stripe meters so
// resellers get billed for usage above their tier cap.
//
// SCHEDULE: once per day at 03:00 Central (08:00 UTC). Wired into the same
// node-cron schedule that starts the outbound engine — see services/
// outboundEngine.js startOutboundEngine() pattern.
//
// ARCHITECTURE: "report only overage" model.
//   - Cron computes total voice + SMS used in the current billing month
//     across all child tenants of each reseller.
//   - Subtracts the reseller's tier cap.
//   - Reports the OVERAGE delta (vs. last cron run) to Stripe meters.
//   - Stripe charges $0.15/min, $0.05/msg, etc., per the per-unit metered
//     prices — no tiered/graduated math required on Stripe's side.
//
// IDEMPOTENCY: two layers.
//   1. tenants.last_usage_reported_through pointer — cron only reports
//      delta from this timestamp forward, never re-reports historical
//      usage.
//   2. reseller_usage_reports unique index ON (tenant_id, billing_year,
//      billing_month, DATE(reported_at)) WHERE success=true — at most one
//      successful report per tenant per month per cron-day.
//
// EVENT NAMES (case-sensitive, see lib/resellerPlans.js METER_EVENT_NAMES):
//   voice → "reseller_voice_minutes"  (underscores)
//   sms   → "reseller.sms.messages"   (dots)
//
// REQUIRED MIGRATIONS: 044
// REQUIRED ENV VARS: STRIPE_SECRET_KEY + the 12 reseller price IDs
//                    (see lib/resellerPlans.js header)
// ============================================================================

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const cron = require("node-cron");

const db = require("../lib/db");
const {
  getResellerTier,
  METER_EVENT_NAMES,
} = require("../lib/resellerPlans");

// ── Constants ────────────────────────────────────────────────────────────
const CRON_SCHEDULE = "0 3 * * *";   // 03:00 every day, server local time
const CRON_TIMEZONE = "America/Chicago";

/**
 * Public entry point. Wire into server.js startup the same way
 * startOutboundEngine() is wired.
 */
function startResellerUsageReporter() {
  console.log("[ResellerUsage] Cron started. Schedule:", CRON_SCHEDULE, CRON_TIMEZONE);

  cron.schedule(CRON_SCHEDULE, async () => {
    console.log("[ResellerUsage] === Daily run begin ===");
    try {
      const summary = await runDailyReport();
      console.log("[ResellerUsage] === Daily run complete ===", summary);
    } catch (err) {
      console.error("[ResellerUsage] FATAL cron error:", err.message, err.stack);
    }
  }, { timezone: CRON_TIMEZONE });
}

// ============================================================================
// Main loop — runs once per day
// ============================================================================
async function runDailyReport() {
  const startedAt = new Date();
  const now = new Date();
  const billing_year  = now.getFullYear();
  const billing_month = now.getMonth() + 1;
  const period_start  = new Date(billing_year, billing_month - 1, 1, 0, 0, 0); // 1st of month
  const period_end    = now;

  // Find every active reseller. We only report on tenants that:
  //   - Have account_type = 'reseller' (filtered by reseller_tier IS NOT NULL)
  //   - Have an active Stripe subscription (status = 'active' or 'trialing')
  //   - Have a stripe_customer_id (otherwise meter events have nowhere to land)
  const { rows: resellers } = await db.query(
    `SELECT id, name, reseller_tier, stripe_customer_id,
            usage_cap_voice_minutes, usage_cap_sms,
            last_usage_reported_through
       FROM tenants
      WHERE reseller_tier IS NOT NULL
        AND stripe_customer_id IS NOT NULL
        AND subscription_status IN ('active', 'trialing')
        AND deleted_at IS NULL`
  );

  console.log(`[ResellerUsage] Found ${resellers.length} active reseller(s) to evaluate`);

  const summary = {
    started_at: startedAt.toISOString(),
    resellers_evaluated: resellers.length,
    voice_events_sent: 0,
    sms_events_sent: 0,
    errors: 0,
    skipped_no_overage: 0,
    skipped_already_reported_today: 0,
  };

  for (const reseller of resellers) {
    try {
      const result = await reportOneReseller(reseller, {
        billing_year,
        billing_month,
        period_start,
        period_end,
      });

      if (result.skipped_already_reported_today) summary.skipped_already_reported_today++;
      if (result.skipped_no_overage)              summary.skipped_no_overage++;
      if (result.voice_event_sent)                summary.voice_events_sent++;
      if (result.sms_event_sent)                  summary.sms_events_sent++;
    } catch (err) {
      summary.errors++;
      console.error(
        `[ResellerUsage] Reseller %s failed: %s`,
        reseller.id, err.message
      );
    }
  }

  return summary;
}

// ============================================================================
// Per-reseller report
// ============================================================================
async function reportOneReseller(reseller, period) {
  const { billing_year, billing_month, period_start, period_end } = period;

  // 1. Idempotency check — has a SUCCESSFUL report already been logged today?
  const todaysRunCheck = await db.query(
    `SELECT id FROM reseller_usage_reports
      WHERE tenant_id = $1
        AND billing_year = $2
        AND billing_month = $3
        AND DATE(reported_at) = CURRENT_DATE
        AND success = true
      LIMIT 1`,
    [reseller.id, billing_year, billing_month]
  );
  if (todaysRunCheck.rows.length > 0) {
    console.log(`[ResellerUsage] Reseller %s — already reported successfully today, skipping.`, reseller.id);
    return { skipped_already_reported_today: true };
  }

  // 2. Get tier config (caps + overage rates from JS, capable of being
  //    overridden by per-tenant DB columns)
  const tier = getResellerTier(reseller.reseller_tier);
  const cap_voice_minutes = reseller.usage_cap_voice_minutes || tier.cap_voice_minutes || 0;
  const cap_sms           = reseller.usage_cap_sms           || tier.cap_sms           || 0;

  // 3. Compute total month-to-date usage across reseller + all child tenants
  const { total_voice_minutes, total_sms } = await computeMonthToDateUsage({
    reseller_id: reseller.id,
    billing_year,
    billing_month,
  });

  // 4. Compute overage (only above-cap usage gets reported)
  const overage_voice_minutes = Math.max(0, total_voice_minutes - cap_voice_minutes);
  const overage_sms           = Math.max(0, total_sms - cap_sms);

  // 5. Compute the DELTA since last cron run. This is what we actually send
  //    to Stripe — sending the cumulative overage every day would multiply
  //    the bill by N days at month-end. Stripe meters with Sum aggregation
  //    expect incremental events, not running totals.
  const lastReport = await getMostRecentReport(reseller.id, billing_year, billing_month);
  const prev_overage_voice = lastReport ? Number(lastReport.overage_voice_minutes) : 0;
  const prev_overage_sms   = lastReport ? Number(lastReport.overage_sms) : 0;

  const delta_voice = Math.max(0, overage_voice_minutes - prev_overage_voice);
  const delta_sms   = Math.max(0, overage_sms - prev_overage_sms);

  // 6. If both deltas are zero, log a "no overage" audit row and bail.
  if (delta_voice === 0 && delta_sms === 0) {
    console.log(
      `[ResellerUsage] Reseller %s: no overage delta (voice=%s/%s, sms=%s/%s) — logging skip.`,
      reseller.id,
      total_voice_minutes, cap_voice_minutes,
      total_sms, cap_sms
    );
    await insertReportRow({
      tenant_id: reseller.id,
      billing_year, billing_month,
      period_start, period_end,
      total_voice_minutes, total_sms,
      cap_voice_minutes, cap_sms,
      overage_voice_minutes, overage_sms,
      voice_reported: false, sms_reported: false,
      success: true, // success=true because nothing-to-do is a valid outcome
      stripe_voice_event_id: null,
      stripe_sms_event_id: null,
      error_message: null,
    });
    await db.query(
      `UPDATE tenants SET last_usage_reported_through = $1 WHERE id = $2`,
      [period_end, reseller.id]
    );
    return { skipped_no_overage: true };
  }

  // 7. POST meter events to Stripe (one per non-zero delta)
  let stripe_voice_event_id = null;
  let stripe_sms_event_id   = null;
  let voice_reported        = false;
  let sms_reported          = false;
  let error_message         = null;

  try {
    if (delta_voice > 0) {
      const ev = await stripe.billing.meterEvents.create({
        event_name: METER_EVENT_NAMES.voice, // "reseller_voice_minutes"
        payload: {
          stripe_customer_id: reseller.stripe_customer_id,
          // Stripe expects integer or numeric string. Round to integer
          // minutes to avoid fractional-minute fees from arithmetic noise.
          value: String(Math.round(delta_voice)),
        },
      });
      stripe_voice_event_id = ev.identifier || null;
      voice_reported = true;
      console.log(
        `[ResellerUsage] Reseller %s: voice +%s min reported (event %s)`,
        reseller.id, Math.round(delta_voice), stripe_voice_event_id
      );
    }

    if (delta_sms > 0) {
      const ev = await stripe.billing.meterEvents.create({
        event_name: METER_EVENT_NAMES.sms, // "reseller.sms.messages"
        payload: {
          stripe_customer_id: reseller.stripe_customer_id,
          value: String(delta_sms),
        },
      });
      stripe_sms_event_id = ev.identifier || null;
      sms_reported = true;
      console.log(
        `[ResellerUsage] Reseller %s: sms +%s reported (event %s)`,
        reseller.id, delta_sms, stripe_sms_event_id
      );
    }
  } catch (err) {
    error_message = err.message || String(err);
    console.error(
      `[ResellerUsage] Reseller %s Stripe meter event failed: %s`,
      reseller.id, error_message
    );
    // Don't rethrow — we still want to log the audit row before returning.
  }

  // 8. Audit log
  const success = !error_message
    && (delta_voice === 0 || voice_reported)
    && (delta_sms === 0   || sms_reported);

  await insertReportRow({
    tenant_id: reseller.id,
    billing_year, billing_month,
    period_start, period_end,
    total_voice_minutes, total_sms,
    cap_voice_minutes, cap_sms,
    overage_voice_minutes, overage_sms,
    voice_reported, sms_reported,
    stripe_voice_event_id, stripe_sms_event_id,
    success, error_message,
  });

  // 9. Advance pointer ONLY on full success — partial failures will retry
  //    tomorrow with the same starting point.
  if (success) {
    await db.query(
      `UPDATE tenants SET last_usage_reported_through = $1 WHERE id = $2`,
      [period_end, reseller.id]
    );
  }

  return {
    voice_event_sent: voice_reported,
    sms_event_sent: sms_reported,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Sum voice minutes + SMS count for the current billing month across the
 * reseller's own tenant + all child customer tenants.
 */
async function computeMonthToDateUsage({ reseller_id, billing_year, billing_month }) {
  const { rows } = await db.query(
    `WITH child_tenants AS (
       SELECT id FROM tenants
        WHERE reseller_id = $1
           OR id = $1
     ),
     voice AS (
       SELECT COALESCE(SUM(c.duration_minutes), 0)::numeric AS total
         FROM calls c
        WHERE c.tenant_id IN (SELECT id FROM child_tenants)
          AND EXTRACT(YEAR  FROM c.started_at) = $2
          AND EXTRACT(MONTH FROM c.started_at) = $3
     ),
     sms AS (
       SELECT COUNT(*)::int AS total
         FROM messages m
        WHERE m.tenant_id IN (SELECT id FROM child_tenants)
          AND m.channel = 'sms'
          AND EXTRACT(YEAR  FROM m.created_at) = $2
          AND EXTRACT(MONTH FROM m.created_at) = $3
     )
     SELECT (SELECT total FROM voice) AS voice_minutes,
            (SELECT total FROM sms)   AS sms_count`,
    [reseller_id, billing_year, billing_month]
  );

  return {
    total_voice_minutes: Number(rows[0]?.voice_minutes || 0),
    total_sms:           Number(rows[0]?.sms_count || 0),
  };
}

/**
 * Get the most recent report row for this tenant in this billing month.
 * Used to compute the delta of overage since last cron run.
 */
async function getMostRecentReport(tenant_id, billing_year, billing_month) {
  const { rows } = await db.query(
    `SELECT overage_voice_minutes, overage_sms, success, reported_at
       FROM reseller_usage_reports
      WHERE tenant_id = $1
        AND billing_year = $2
        AND billing_month = $3
        AND success = true
      ORDER BY reported_at DESC
      LIMIT 1`,
    [tenant_id, billing_year, billing_month]
  );
  return rows[0] || null;
}

/**
 * Insert one audit row in reseller_usage_reports.
 */
async function insertReportRow(r) {
  await db.query(
    `INSERT INTO reseller_usage_reports (
       tenant_id,
       billing_year, billing_month,
       period_start, period_end,
       total_voice_minutes, total_sms,
       cap_voice_minutes, cap_sms,
       overage_voice_minutes, overage_sms,
       stripe_voice_event_id, stripe_sms_event_id,
       voice_reported, sms_reported,
       success, error_message
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
     )`,
    [
      r.tenant_id,
      r.billing_year, r.billing_month,
      r.period_start, r.period_end,
      r.total_voice_minutes, r.total_sms,
      r.cap_voice_minutes, r.cap_sms,
      r.overage_voice_minutes, r.overage_sms,
      r.stripe_voice_event_id, r.stripe_sms_event_id,
      r.voice_reported, r.sms_reported,
      r.success, r.error_message,
    ]
  );
}

// ============================================================================
// Manual trigger — call this from a one-off route or REPL when debugging
// ============================================================================
async function runOnce() {
  console.log("[ResellerUsage] Manual run triggered");
  return await runDailyReport();
}

module.exports = {
  startResellerUsageReporter,
  runOnce,
};

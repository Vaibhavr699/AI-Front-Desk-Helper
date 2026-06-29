"use strict";

// ============================================================================
// services/reportResellerUsage.js
// ============================================================================
// Apr 27, 2026 — Reseller pricing rebuild Day 4
// Apr 27, 2026 — Added cap threshold warnings (80% / 100%) per metric per
//                billing period. Fires email + dashboard bell notification.
//                Idempotent via reseller_usage_reports.threshold_*_notified
//                columns added in migration 045.
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
// CAP WARNINGS: after computing usage, the cron checks each metric against
// 80% and 100% thresholds. If a threshold is crossed for the first time in
// this billing period, an email + bell notification fires. The audit table
// remembers which thresholds have been notified so we don't double-fire.
//
// IDEMPOTENCY: two layers.
//   1. tenants.last_usage_reported_through pointer — cron only reports
//      delta from this timestamp forward.
//   2. reseller_usage_reports.threshold_voice_*_notified +
//      threshold_sms_*_notified columns — once a threshold has been
//      notified for a given billing month, never notify it again.
//
// EVENT NAMES (case-sensitive, see lib/resellerPlans.js METER_EVENT_NAMES):
//   voice → "reseller_voice_minutes"  (underscores)
//   sms   → "reseller.sms.messages"   (dots)
//
// REQUIRED MIGRATIONS: 044, 045
// REQUIRED ENV VARS: STRIPE_SECRET_KEY + the 12 reseller price IDs
//                    (see lib/resellerPlans.js header)
// ============================================================================

const Stripe = require("stripe");
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const cron = require("node-cron");

const db = require("../lib/db");
const {
  getResellerTier,
  getNextResellerTier,
  METER_EVENT_NAMES,
} = require("../lib/resellerPlans");
const notifications = require("./notifications");
const { sendResellerCapWarningEmail } = require("./resellerEmail");

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
    `SELECT id, name, primary_email, reseller_tier, stripe_customer_id,
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
    cap_warnings_fired: 0,
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
      summary.cap_warnings_fired += (result.cap_warnings_fired || 0);
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

  // 2. Get tier config
  const tier = getResellerTier(reseller.reseller_tier);
  const cap_voice_minutes = reseller.usage_cap_voice_minutes || tier.cap_voice_minutes || 0;
  const cap_sms           = reseller.usage_cap_sms           || tier.cap_sms           || 0;

  // 3. Compute total month-to-date usage across reseller + all child tenants
  const { total_voice_minutes, total_sms } = await computeMonthToDateUsage({
    reseller_id: reseller.id,
    billing_year,
    billing_month,
  });

  // 4. Compute overage (only above-cap usage gets reported to Stripe)
  const overage_voice_minutes = Math.max(0, total_voice_minutes - cap_voice_minutes);
  const overage_sms           = Math.max(0, total_sms - cap_sms);

  // 5. Compute the DELTA since last cron run.
  const lastReport = await getMostRecentReport(reseller.id, billing_year, billing_month);
  const prev_overage_voice = lastReport ? Number(lastReport.overage_voice_minutes) : 0;
  const prev_overage_sms   = lastReport ? Number(lastReport.overage_sms) : 0;

  const delta_voice = Math.max(0, overage_voice_minutes - prev_overage_voice);
  const delta_sms   = Math.max(0, overage_sms - prev_overage_sms);

  // 6. POST meter events to Stripe (one per non-zero delta)
  let stripe_voice_event_id = null;
  let stripe_sms_event_id   = null;
  let voice_reported        = false;
  let sms_reported          = false;
  let error_message         = null;
  let voice_event_sent      = false;
  let sms_event_sent        = false;

  try {
    if (delta_voice > 0) {
      const ev = await stripe.billing.meterEvents.create({
        event_name: METER_EVENT_NAMES.voice, // "reseller_voice_minutes"
        payload: {
          stripe_customer_id: reseller.stripe_customer_id,
          value: String(Math.round(delta_voice)),
        },
      });
      stripe_voice_event_id = ev.identifier || null;
      voice_reported = true;
      voice_event_sent = true;
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
      sms_event_sent = true;
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
  }

  const success = !error_message
    && (delta_voice === 0 || voice_reported)
    && (delta_sms === 0   || sms_reported);

  // 7. Cap warning detection
  const voicePct = cap_voice_minutes > 0 ? (total_voice_minutes / cap_voice_minutes) * 100 : 0;
  const smsPct   = cap_sms > 0           ? (total_sms / cap_sms) * 100                    : 0;

  const priorNotified = await getPriorNotifiedFlags(reseller.id, billing_year, billing_month);

  const thresholdsToFire = computeThresholdsToFire({
    voicePct, smsPct,
    priorNotified,
  });

  let cap_warnings_fired = 0;
  for (const t of thresholdsToFire) {
    try {
      await fireCapWarning({
        reseller, tier, threshold: t.threshold, metric: t.metric,
        used: t.metric === 'voice' ? total_voice_minutes : total_sms,
        cap:  t.metric === 'voice' ? cap_voice_minutes   : cap_sms,
        overage_voice_cents: tier.overage_voice_cents,
        overage_sms_cents:   tier.overage_sms_cents,
        overage_voice_minutes,
        overage_sms,
      });
      cap_warnings_fired++;
    } catch (err) {
      console.error(
        `[ResellerUsage] Cap warning fire failed reseller=%s metric=%s threshold=%s err=%s`,
        reseller.id, t.metric, t.threshold, err.message
      );
    }
  }

  // 8. Compute the final notified flags (prior OR newly-fired) for the audit row.
  //    Crossing a higher threshold implies the lower threshold was also
  //    crossed, so 100% firing also sets 80% to true. This prevents the
  //    80% warning from re-firing if usage later dips back below 100%
  //    (e.g. via an end-of-month cap reset edge case or manual cap bump).
  const newlyNotified = thresholdsToFire.reduce((acc, t) => {
    acc[`${t.metric}_${t.threshold}`] = true;
    if (t.threshold === 100) acc[`${t.metric}_80`] = true; // imply lower
    return acc;
  }, {});

  // Also: if usage is currently at/above 80%, set the 80 flag even when no
  // new email fires this run (covers the "skipped 80% by jumping straight
  // to 100%" case where computeThresholdsToFire only emits the 100 entry).
  if (voicePct >= 80) newlyNotified.voice_80 = newlyNotified.voice_80 || true;
  if (voicePct >= 100) newlyNotified.voice_100 = newlyNotified.voice_100 || true;
  if (smsPct >= 80) newlyNotified.sms_80 = newlyNotified.sms_80 || true;
  if (smsPct >= 100) newlyNotified.sms_100 = newlyNotified.sms_100 || true;

  const finalFlags = {
    voice_80_notified:  priorNotified.voice_80_notified  || !!newlyNotified.voice_80,
    voice_100_notified: priorNotified.voice_100_notified || !!newlyNotified.voice_100,
    sms_80_notified:    priorNotified.sms_80_notified    || !!newlyNotified.sms_80,
    sms_100_notified:   priorNotified.sms_100_notified   || !!newlyNotified.sms_100,
  };

  // 9. Audit log (always written)
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
    threshold_voice_80_notified:  finalFlags.voice_80_notified,
    threshold_voice_100_notified: finalFlags.voice_100_notified,
    threshold_sms_80_notified:    finalFlags.sms_80_notified,
    threshold_sms_100_notified:   finalFlags.sms_100_notified,
  });

  // 10. Advance pointer ONLY on full success.
  if (success) {
    await db.query(
      `UPDATE tenants SET last_usage_reported_through = $1 WHERE id = $2`,
      [period_end, reseller.id]
    );
  }

  return {
    voice_event_sent,
    sms_event_sent,
    skipped_no_overage: !voice_event_sent && !sms_event_sent && delta_voice === 0 && delta_sms === 0,
    cap_warnings_fired,
  };
}

// ============================================================================
// Cap-warning helpers
// ============================================================================

/**
 * Pulls the prior-most-recent threshold-notified flags for this reseller +
 * billing month. Returns false for all four if no prior report exists.
 */
async function getPriorNotifiedFlags(tenant_id, billing_year, billing_month) {
  const { rows } = await db.query(
    `SELECT threshold_voice_80_notified,
            threshold_voice_100_notified,
            threshold_sms_80_notified,
            threshold_sms_100_notified
       FROM reseller_usage_reports
      WHERE tenant_id = $1
        AND billing_year = $2
        AND billing_month = $3
      ORDER BY reported_at DESC
      LIMIT 1`,
    [tenant_id, billing_year, billing_month]
  );
  const r = rows[0] || {};
  return {
    voice_80_notified:  Boolean(r.threshold_voice_80_notified),
    voice_100_notified: Boolean(r.threshold_voice_100_notified),
    sms_80_notified:    Boolean(r.threshold_sms_80_notified),
    sms_100_notified:   Boolean(r.threshold_sms_100_notified),
  };
}

/**
 * Decides which (metric × threshold) combos need to fire warnings.
 *
 * A threshold fires when current usage % >= threshold AND that threshold
 * hasn't already been notified this billing month.
 *
 * Per-metric, fires the HIGHEST applicable threshold not yet notified
 * (e.g. if both 80 and 100 unnotified and at 105%, fires 100 only).
 */
function computeThresholdsToFire({ voicePct, smsPct, priorNotified }) {
  const out = [];

  if (voicePct >= 100 && !priorNotified.voice_100_notified) {
    out.push({ metric: 'voice', threshold: 100 });
  } else if (voicePct >= 80 && !priorNotified.voice_80_notified) {
    out.push({ metric: 'voice', threshold: 80 });
  }

  if (smsPct >= 100 && !priorNotified.sms_100_notified) {
    out.push({ metric: 'sms', threshold: 100 });
  } else if (smsPct >= 80 && !priorNotified.sms_80_notified) {
    out.push({ metric: 'sms', threshold: 80 });
  }

  return out;
}

/**
 * Fires a single cap warning: bell notification + email.
 * Both are fire-and-forget (logged on failure but never thrown).
 */
async function fireCapWarning({
  reseller, tier, threshold, metric,
  used, cap,
  overage_voice_cents, overage_sms_cents,
  overage_voice_minutes, overage_sms,
}) {
  console.log(
    `[ResellerUsage] Cap warning FIRE reseller=%s tier=%s metric=%s threshold=%s used=%s cap=%s`,
    reseller.id, tier.id, metric, threshold, used, cap
  );

  // Project overage cost from current month-to-date overage
  const projectedOverageCents = metric === 'voice'
    ? Math.round(overage_voice_minutes * overage_voice_cents)
    : Math.round(overage_sms * overage_sms_cents);

  // Look up next-tier flat price for the upgrade pitch (only at 100%).
  let next_tier_name = null;
  let next_tier_monthly_cents = null;
  if (threshold >= 100) {
    try {
      const nextTier = getNextResellerTier(tier.id);
      if (nextTier) {
        next_tier_name = nextTier.name;
        next_tier_monthly_cents = nextTier.monthly_price_cents;
      }
    } catch (_) {
      // Already at top tier — silent no-op
    }
  }

  // Bell notification
  const metricLabel = metric === 'voice' ? 'Voice' : 'SMS';
  const isAt100 = threshold >= 100;
  const usedFmt = Number(used).toLocaleString('en-US');
  const capFmt  = Number(cap).toLocaleString('en-US');

  notifications.createNotification(reseller.id, {
    type: 'reseller_cap_warning',
    title: isAt100
      ? `⚠️ ${metricLabel} cap reached — overage active`
      : `${metricLabel} usage at 80%`,
    body: isAt100
      ? `You've used ${usedFmt} of ${capFmt} ${metric === 'voice' ? 'voice minutes' : 'SMS messages'} this month. Additional usage is now billing as overage.`
      : `You've used ${usedFmt} of ${capFmt} ${metric === 'voice' ? 'voice minutes' : 'SMS messages'} this month — about 80% of your cap.`,
    data: {
      metric, threshold,
      used, cap,
      tier: tier.id,
      projected_overage_cents: projectedOverageCents,
    },
  }).catch((err) =>
    console.error('[ResellerUsage] Bell notification failed:', err.message)
  );

  // Email
  if (reseller.primary_email) {
    sendResellerCapWarningEmail({
      to: reseller.primary_email,
      reseller_name: reseller.name,
      tier_name: tier.name,
      metric,
      threshold,
      used,
      cap,
      overage_rate_cents: metric === 'voice' ? overage_voice_cents : overage_sms_cents,
      projected_overage_cents: projectedOverageCents,
      next_tier_name,
      next_tier_monthly_cents,
      current_tier_monthly_cents: tier.monthly_price_cents,
    }).catch((err) =>
      console.error('[ResellerUsage] Cap warning email failed:', err.message)
    );
  } else {
    console.warn(
      `[ResellerUsage] Reseller %s has no primary_email — skipping cap warning email (bell still fired)`,
      reseller.id
    );
  }
}

// ============================================================================
// SQL helpers
// ============================================================================

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
       success, error_message,
       threshold_voice_80_notified, threshold_voice_100_notified,
       threshold_sms_80_notified, threshold_sms_100_notified
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
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
      r.threshold_voice_80_notified, r.threshold_voice_100_notified,
      r.threshold_sms_80_notified, r.threshold_sms_100_notified,
    ]
  );
}

// ============================================================================
// Manual trigger — call from a one-off route or REPL when debugging
// ============================================================================
async function runOnce() {
  console.log("[ResellerUsage] Manual run triggered");
  return await runDailyReport();
}

module.exports = {
  startResellerUsageReporter,
  runOnce,
};

"use strict";

/**
 * services/metricAlerts.js
 *
 * Metric-based alert engine. Runs 10 different checks on various cron schedules.
 * Each check computes a metric for each tenant, compares against thresholds,
 * and fires a notification if anomalous behavior is detected.
 *
 * Dedup strategy: Uses `notifications` table — skips firing if same type
 * fired for same tenant within the configured window (default 24h).
 *
 * All alerts surface via the notification bell (no SMS/email escalation).
 *
 * Added: April 17, 2026
 */

const db = require("../lib/db");
const { createNotification } = require("./notifications");

// ═══════════════════════════════════════════════════════════════
// CONFIG — Thresholds per alert. Tune after real-world data arrives.
// ═══════════════════════════════════════════════════════════════

const CONFIG = {
  // 1. Revenue stall: fire if zero confirmed revenue in N days
  revenue_stall: {
    days_without_revenue: 7,
    dedup_hours: 24,
    min_historical_days: 14, // don't fire for brand-new tenants
  },
  // 2. Conversion drop: this week's booking rate vs previous week
  conversion_drop: {
    drop_threshold_pct: 30,   // 30% week-over-week drop
    min_leads_current: 5,     // need at least 5 leads this week to be meaningful
    min_leads_prior: 5,
    dedup_hours: 24,
  },
  // 3. Negative review: any 1-2 star review in last 30 min
  negative_review: {
    lookback_minutes: 35,     // slightly > cron interval to catch all
    max_rating: 2,
    dedup_hours: 1,           // per-review dedup via review_id
  },
  // 4. Recovery failure: <5% conversion over 14 days
  recovery_failure: {
    lookback_days: 14,
    min_conversion_pct: 5,
    min_sample_size: 10,
    dedup_hours: 48,
  },
  // 5. Call volume anomaly: >70% drop or >200% spike vs 7d avg
  call_volume_anomaly: {
    lookback_hours: 24,
    baseline_days: 7,
    drop_pct: 70,
    spike_pct: 200,
    min_baseline_calls: 10,
    dedup_hours: 24,
  },
  // 6. Call duration anomaly: >2x rolling 7d avg
  call_duration_anomaly: {
    lookback_hours: 24,
    baseline_days: 7,
    spike_multiplier: 2.0,
    min_sample_size: 10,
    dedup_hours: 24,
  },
  // 7. Webhook failures: ≥5 failures in 1 hour (requires twilio_error_log table; graceful fallback if missing)
  webhook_failures: {
    lookback_hours: 1,
    min_failures: 5,
    dedup_hours: 3,
  },
  // 8. OpenAI errors: ≥20% error rate over 30 min (graceful fallback if no error log exists)
  openai_errors: {
    lookback_minutes: 30,
    max_error_rate_pct: 20,
    min_sample_size: 10,
    dedup_hours: 2,
  },
  // 9. Booking → Won conversion: <40% over 30 days
  booking_conversion_drop: {
    lookback_days: 30,
    min_conversion_pct: 40,
    min_sample_size: 10,
    dedup_hours: 48,
  },
  // 10. Spam call surge: ≥10 spam calls in 1 hour
  spam_call_surge: {
    lookback_hours: 1,
    min_spam_calls: 10,
    dedup_hours: 4,
  },
};

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

async function alreadyFiredRecently(tenantId, type, windowHours) {
  const existing = await db.query(
    `SELECT id FROM notifications
     WHERE tenant_id = $1 AND type = $2
     AND created_at > now() - ($3 || ' hours')::interval
     LIMIT 1`,
    [tenantId, type, String(windowHours)]
  );
  return existing.rows.length > 0;
}

async function getActiveTenants() {
  const res = await db.query(`SELECT id, name, company_name FROM tenants`);
  return res.rows;
}

// ═══════════════════════════════════════════════════════════════
// 1. REVENUE STALL — "🚨 Zero revenue in X days"
// ═══════════════════════════════════════════════════════════════

async function checkRevenueStall() {
  const cfg = CONFIG.revenue_stall;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'revenue_stall', cfg.dedup_hours)) continue;

        // Tenant age check — skip fresh tenants
        const ageRes = await db.query(
          `SELECT EXTRACT(EPOCH FROM (now() - created_at)) / 86400.0 as days_old
           FROM tenants WHERE id = $1`, [t.id]
        );
        const daysOld = parseFloat(ageRes.rows[0]?.days_old || 0);
        if (daysOld < cfg.min_historical_days) continue;

        // Check last revenue event (bookings OR leads)
        const revRes = await db.query(
          `SELECT GREATEST(
             COALESCE((SELECT MAX(updated_at) FROM bookings WHERE tenant_id = $1 AND actual_revenue_cents > 0), '1970-01-01'::timestamptz),
             COALESCE((SELECT MAX(updated_at) FROM leads WHERE tenant_id = $1 AND actual_revenue_cents > 0), '1970-01-01'::timestamptz)
           ) as last_revenue_at`,
          [t.id]
        );
        const lastAt = revRes.rows[0]?.last_revenue_at;
        if (!lastAt) continue;

        const daysSince = (Date.now() - new Date(lastAt).getTime()) / 86400000;
        if (daysSince >= cfg.days_without_revenue) {
          await createNotification(t.id, {
            type: 'revenue_stall',
            title: `🚨 Revenue Stall: ${Math.floor(daysSince)} days`,
            body: `No confirmed revenue in ${Math.floor(daysSince)} days. Check your DripJobs Zap and recent job completions.`,
            data: { days_without_revenue: Math.floor(daysSince), last_revenue_at: lastAt },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] revenue_stall tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkRevenueStall failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. CONVERSION DROP — "📉 Bookings dropped 30%+ week-over-week"
// ═══════════════════════════════════════════════════════════════

async function checkConversionDrop() {
  const cfg = CONFIG.conversion_drop;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'conversion_drop', cfg.dedup_hours)) continue;

        const res = await db.query(`
          SELECT
            (SELECT COUNT(*) FROM leads WHERE tenant_id = $1 AND created_at > now() - interval '7 days') as leads_curr,
            (SELECT COUNT(*) FROM bookings WHERE tenant_id = $1 AND created_at > now() - interval '7 days') as book_curr,
            (SELECT COUNT(*) FROM leads WHERE tenant_id = $1 AND created_at BETWEEN now() - interval '14 days' AND now() - interval '7 days') as leads_prev,
            (SELECT COUNT(*) FROM bookings WHERE tenant_id = $1 AND created_at BETWEEN now() - interval '14 days' AND now() - interval '7 days') as book_prev
        `, [t.id]);

        const r = res.rows[0];
        const leadsCurr = parseInt(r.leads_curr, 10);
        const leadsPrev = parseInt(r.leads_prev, 10);
        const bookCurr = parseInt(r.book_curr, 10);
        const bookPrev = parseInt(r.book_prev, 10);

        if (leadsCurr < cfg.min_leads_current || leadsPrev < cfg.min_leads_prior) continue;

        const rateCurr = leadsCurr > 0 ? (bookCurr / leadsCurr) : 0;
        const ratePrev = leadsPrev > 0 ? (bookPrev / leadsPrev) : 0;
        if (ratePrev === 0) continue;

        const dropPct = Math.round(((ratePrev - rateCurr) / ratePrev) * 100);

        if (dropPct >= cfg.drop_threshold_pct) {
          await createNotification(t.id, {
            type: 'conversion_drop',
            title: `📉 Booking Conversion Dropped ${dropPct}%`,
            body: `This week: ${Math.round(rateCurr*100)}% booking rate (${bookCurr}/${leadsCurr}). Last week: ${Math.round(ratePrev*100)}% (${bookPrev}/${leadsPrev}). Check recent AI transcripts.`,
            data: { drop_pct: dropPct, rate_curr: rateCurr, rate_prev: ratePrev, leads_curr: leadsCurr, leads_prev: leadsPrev },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] conversion_drop tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkConversionDrop failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 3. NEGATIVE REVIEW — "⭐ New 1-2 star Google review"
// ═══════════════════════════════════════════════════════════════

async function checkNegativeReview() {
  const cfg = CONFIG.negative_review;
  try {
    // Graceful if google_reviews table doesn't exist
    let reviews;
    try {
      const res = await db.query(`
        SELECT id, tenant_id, google_review_id, reviewer_name, rating, review_text
        FROM google_reviews
        WHERE rating <= $1
          AND created_at > now() - ($2 || ' minutes')::interval
      `, [cfg.max_rating, String(cfg.lookback_minutes)]);
      reviews = res.rows;
    } catch (err) {
      if (err.code === '42P01') return; // table doesn't exist — skip
      throw err;
    }

    for (const rev of reviews) {
      try {
        // Per-review dedup via google_review_id in notification data
        const existing = await db.query(
          `SELECT id FROM notifications
           WHERE tenant_id = $1 AND type = 'negative_review'
           AND data->>'google_review_id' = $2 LIMIT 1`,
          [rev.tenant_id, String(rev.google_review_id)]
        );
        if (existing.rows.length > 0) continue;

        const preview = rev.review_text ? rev.review_text.substring(0, 100) + (rev.review_text.length > 100 ? '...' : '') : '(no text)';
        await createNotification(rev.tenant_id, {
          type: 'negative_review',
          title: `⭐ ${rev.rating}-Star Google Review`,
          body: `${rev.reviewer_name || 'Anonymous'} left a ${rev.rating}-star review: "${preview}". Respond quickly.`,
          data: { google_review_id: rev.google_review_id, rating: rev.rating, reviewer: rev.reviewer_name },
        });
      } catch (err) {
        console.error(`[MetricAlerts] negative_review rev=${rev.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkNegativeReview failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. RECOVERY FAILURE — "📨 AI recovery converting <5%"
// ═══════════════════════════════════════════════════════════════

async function checkRecoveryFailure() {
  const cfg = CONFIG.recovery_failure;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'recovery_failure', cfg.dedup_hours)) continue;

        const res = await db.query(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'converted' THEN 1 ELSE 0 END) as converted
          FROM estimate_recoveries
          WHERE tenant_id = $1 AND created_at > now() - ($2 || ' days')::interval
        `, [t.id, String(cfg.lookback_days)]);

        const total = parseInt(res.rows[0].total, 10);
        const converted = parseInt(res.rows[0].converted, 10);
        if (total < cfg.min_sample_size) continue;

        const pct = (converted / total) * 100;
        if (pct < cfg.min_conversion_pct) {
          await createNotification(t.id, {
            type: 'recovery_failure',
            title: `📨 AI Recovery Failing: ${Math.round(pct)}%`,
            body: `Only ${converted} of ${total} recovery sequences converted over ${cfg.lookback_days} days (${Math.round(pct)}%). Baseline is typically 15%+. Review recovery scripts.`,
            data: { conversion_pct: pct, total, converted, lookback_days: cfg.lookback_days },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] recovery_failure tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkRecoveryFailure failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 5. CALL VOLUME ANOMALY — "📞 Calls dropped/spiked vs 7d avg"
// ═══════════════════════════════════════════════════════════════

async function checkCallVolumeAnomaly() {
  const cfg = CONFIG.call_volume_anomaly;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'call_volume_anomaly', cfg.dedup_hours)) continue;

        const res = await db.query(`
          SELECT
            (SELECT COUNT(*) FROM calls WHERE tenant_id = $1 AND started_at > now() - ($2 || ' hours')::interval) as recent,
            (SELECT COUNT(*) FROM calls WHERE tenant_id = $1 AND started_at BETWEEN now() - ($3 || ' days')::interval AND now()) as baseline_total
        `, [t.id, String(cfg.lookback_hours), String(cfg.baseline_days)]);

        const recent = parseInt(res.rows[0].recent, 10);
        const baselineTotal = parseInt(res.rows[0].baseline_total, 10);
        if (baselineTotal < cfg.min_baseline_calls) continue;

        // Expected calls in same window from baseline avg
        const expected = (baselineTotal / cfg.baseline_days) * (cfg.lookback_hours / 24);
        if (expected < 1) continue;

        const ratio = recent / expected;
        let alertType = null;
        let body = '';

        if (ratio <= (1 - cfg.drop_pct / 100)) {
          alertType = 'drop';
          const dropPct = Math.round((1 - ratio) * 100);
          body = `Calls in last ${cfg.lookback_hours}h: ${recent}. Expected: ~${Math.round(expected)}. That's ${dropPct}% below 7-day baseline. Check phone line + DNS.`;
        } else if (ratio >= (cfg.spike_pct / 100)) {
          alertType = 'spike';
          const spikePct = Math.round((ratio - 1) * 100);
          body = `Calls in last ${cfg.lookback_hours}h: ${recent}. Expected: ~${Math.round(expected)}. That's ${spikePct}% above baseline. Traffic spike or spam attack?`;
        }

        if (alertType) {
          await createNotification(t.id, {
            type: 'call_volume_anomaly',
            title: alertType === 'drop' ? `📞 Call Volume Dropped` : `📞 Call Volume Spike`,
            body,
            data: { anomaly_type: alertType, recent, expected: Math.round(expected), ratio },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] call_volume_anomaly tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkCallVolumeAnomaly failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. CALL DURATION ANOMALY — "⏱️ Avg call duration 2x baseline"
// ═══════════════════════════════════════════════════════════════

async function checkCallDurationAnomaly() {
  const cfg = CONFIG.call_duration_anomaly;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'call_duration_anomaly', cfg.dedup_hours)) continue;

        const res = await db.query(`
          SELECT
            (SELECT AVG(duration_minutes) FROM calls 
             WHERE tenant_id = $1 AND started_at > now() - ($2 || ' hours')::interval
             AND duration_minutes > 0 AND status != 'Spam') as recent_avg,
            (SELECT AVG(duration_minutes) FROM calls 
             WHERE tenant_id = $1 AND started_at > now() - ($3 || ' days')::interval
             AND duration_minutes > 0 AND status != 'Spam') as baseline_avg,
            (SELECT COUNT(*) FROM calls WHERE tenant_id = $1 
             AND started_at > now() - ($3 || ' days')::interval
             AND duration_minutes > 0 AND status != 'Spam') as baseline_count
        `, [t.id, String(cfg.lookback_hours), String(cfg.baseline_days)]);

        const recentAvg = parseFloat(res.rows[0].recent_avg || 0);
        const baselineAvg = parseFloat(res.rows[0].baseline_avg || 0);
        const baselineCount = parseInt(res.rows[0].baseline_count, 10);

        if (baselineCount < cfg.min_sample_size) continue;
        if (baselineAvg < 0.5) continue; // need meaningful baseline
        if (recentAvg === 0) continue;

        const multiplier = recentAvg / baselineAvg;
        if (multiplier >= cfg.spike_multiplier) {
          await createNotification(t.id, {
            type: 'call_duration_anomaly',
            title: `⏱️ Avg Call Duration Spiked`,
            body: `Avg call duration in last ${cfg.lookback_hours}h: ${recentAvg.toFixed(1)} min vs baseline ${baselineAvg.toFixed(1)} min (${multiplier.toFixed(1)}x). AI may be stuck or confused on a new question pattern.`,
            data: { recent_avg_min: recentAvg, baseline_avg_min: baselineAvg, multiplier },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] call_duration_anomaly tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkCallDurationAnomaly failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 7. WEBHOOK FAILURES — "🔧 Twilio errors"
// Uses calls table with status='failed' as proxy (no error log table)
// ═══════════════════════════════════════════════════════════════

async function checkWebhookFailures() {
  const cfg = CONFIG.webhook_failures;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'webhook_failures', cfg.dedup_hours)) continue;

        const res = await db.query(`
          SELECT COUNT(*) as failed
          FROM calls
          WHERE tenant_id = $1
          AND started_at > now() - ($2 || ' hours')::interval
          AND (status = 'failed' OR disposition = 'failed' OR duration_minutes IS NULL)
        `, [t.id, String(cfg.lookback_hours)]);

        const failed = parseInt(res.rows[0].failed, 10);
        if (failed >= cfg.min_failures) {
          await createNotification(t.id, {
            type: 'webhook_failures',
            title: `🔧 ${failed} Failed Calls in ${cfg.lookback_hours}h`,
            body: `Twilio reports ${failed} failed or errored calls in the last ${cfg.lookback_hours} hour(s). Could indicate Render/network outage or code bug. Check recent deploy logs.`,
            data: { failed_count: failed, lookback_hours: cfg.lookback_hours },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] webhook_failures tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkWebhookFailures failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 8. OPENAI ERRORS — "🤖 OpenAI API failing"
// Graceful: uses very short calls as proxy for AI session failures
// ═══════════════════════════════════════════════════════════════

async function checkOpenAIErrors() {
  const cfg = CONFIG.openai_errors;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'openai_errors', cfg.dedup_hours)) continue;

        const res = await db.query(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN COALESCE(duration_minutes, 0) < 0.1 AND status != 'Spam' THEN 1 ELSE 0 END) as ultra_short
          FROM calls
          WHERE tenant_id = $1
          AND started_at > now() - ($2 || ' minutes')::interval
          AND status != 'Spam'
        `, [t.id, String(cfg.lookback_minutes)]);

        const total = parseInt(res.rows[0].total, 10);
        const ultraShort = parseInt(res.rows[0].ultra_short, 10);
        if (total < cfg.min_sample_size) continue;

        const errorRate = (ultraShort / total) * 100;
        if (errorRate >= cfg.max_error_rate_pct) {
          await createNotification(t.id, {
            type: 'openai_errors',
            title: `🤖 AI Session Errors Spike`,
            body: `${Math.round(errorRate)}% of recent calls ended in <6 seconds (${ultraShort} of ${total}). Could indicate OpenAI Realtime API errors, quota issue, or account problem.`,
            data: { error_rate_pct: errorRate, ultra_short: ultraShort, total },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] openai_errors tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkOpenAIErrors failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 9. BOOKING → WON CONVERSION DROP — "💸 Bookings converting <40%"
// ═══════════════════════════════════════════════════════════════

async function checkBookingConversionDrop() {
  const cfg = CONFIG.booking_conversion_drop;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'booking_conversion_drop', cfg.dedup_hours)) continue;

        const res = await db.query(`
          SELECT
            COUNT(*) as total,
            SUM(CASE WHEN LOWER(status) IN ('completed', 'won') OR actual_revenue_cents > 0 THEN 1 ELSE 0 END) as won
          FROM bookings
          WHERE tenant_id = $1
          AND created_at > now() - ($2 || ' days')::interval
        `, [t.id, String(cfg.lookback_days)]);

        const total = parseInt(res.rows[0].total, 10);
        const won = parseInt(res.rows[0].won, 10);
        if (total < cfg.min_sample_size) continue;

        const pct = (won / total) * 100;
        if (pct < cfg.min_conversion_pct) {
          await createNotification(t.id, {
            type: 'booking_conversion_drop',
            title: `💸 Booking → Won: ${Math.round(pct)}%`,
            body: `Only ${won} of ${total} bookings closed as Won over ${cfg.lookback_days} days (${Math.round(pct)}%). Baseline is typically 65%+. Leads may be under-qualified or sales process is slipping.`,
            data: { conversion_pct: pct, total, won, lookback_days: cfg.lookback_days },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] booking_conversion_drop tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkBookingConversionDrop failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 10. SPAM CALL SURGE — "🚫 Spam call burst"
// ═══════════════════════════════════════════════════════════════

async function checkSpamCallSurge() {
  const cfg = CONFIG.spam_call_surge;
  try {
    const tenants = await getActiveTenants();
    for (const t of tenants) {
      try {
        if (await alreadyFiredRecently(t.id, 'spam_call_surge', cfg.dedup_hours)) continue;

        const res = await db.query(`
          SELECT COUNT(*) as spam_count
          FROM calls
          WHERE tenant_id = $1
          AND started_at > now() - ($2 || ' hours')::interval
          AND (status = 'Spam' OR disposition = 'spam')
        `, [t.id, String(cfg.lookback_hours)]);

        const spamCount = parseInt(res.rows[0].spam_count, 10);
        if (spamCount >= cfg.min_spam_calls) {
          await createNotification(t.id, {
            type: 'spam_call_surge',
            title: `🚫 Spam Call Surge: ${spamCount} calls`,
            body: `${spamCount} spam calls detected in the last ${cfg.lookback_hours} hour(s). Possible list scraper attack or targeted abuse. Your AI is correctly filtering them.`,
            data: { spam_count: spamCount, lookback_hours: cfg.lookback_hours },
          });
        }
      } catch (err) {
        console.error(`[MetricAlerts] spam_call_surge tenant=${t.id}:`, err.message);
      }
    }
  } catch (err) {
    console.error("[MetricAlerts] checkSpamCallSurge failed:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// CRON ORCHESTRATORS — grouped by frequency
// ═══════════════════════════════════════════════════════════════

async function runDailyChecks() {
  console.log("[MetricAlerts] Running daily checks…");
  await checkRevenueStall();
  await checkRecoveryFailure();
  await checkBookingConversionDrop();
  console.log("[MetricAlerts] Daily checks complete.");
}

async function runSixHourlyChecks() {
  console.log("[MetricAlerts] Running 6-hour checks…");
  await checkConversionDrop();
  await checkCallVolumeAnomaly();
  await checkCallDurationAnomaly();
  console.log("[MetricAlerts] 6-hour checks complete.");
}

async function runHourlyChecks() {
  console.log("[MetricAlerts] Running hourly checks…");
  await checkWebhookFailures();
  await checkSpamCallSurge();
  console.log("[MetricAlerts] Hourly checks complete.");
}

async function runHalfHourlyChecks() {
  console.log("[MetricAlerts] Running 30-min checks…");
  await checkNegativeReview();
  await checkOpenAIErrors();
  console.log("[MetricAlerts] 30-min checks complete.");
}

module.exports = {
  // Individual checks (exposed for testing)
  checkRevenueStall,
  checkConversionDrop,
  checkNegativeReview,
  checkRecoveryFailure,
  checkCallVolumeAnomaly,
  checkCallDurationAnomaly,
  checkWebhookFailures,
  checkOpenAIErrors,
  checkBookingConversionDrop,
  checkSpamCallSurge,
  // Cron orchestrators
  runDailyChecks,
  runSixHourlyChecks,
  runHourlyChecks,
  runHalfHourlyChecks,
  CONFIG,
};

"use strict";

const db = require("../lib/db");

/**
 * Creates a notification for a specific tenant.
 */
async function createNotification(tenantId, { type, title, body = "", data = {} }) {
  try {
    const q = `
      INSERT INTO notifications (tenant_id, type, title, body, data, created_at)
      VALUES ($1, $2, $3, $4, $5, now())
      RETURNING *
    `;
    const res = await db.query(q, [tenantId, type, title, body, JSON.stringify(data)]);
    console.log(`[Notification] Created: ${type} for tenant ${tenantId}`);
    return res.rows[0];
  } catch (err) {
    console.error("[Notification] Failed to create notification:", err.message);
    return null;
  }
}

/**
 * Retrieves unread notifications for a tenant.
 */
async function getUnreadNotifications(tenantId, limit = 10) {
  try {
    const q = `
      SELECT * FROM notifications 
      WHERE tenant_id = $1 AND read = FALSE 
      ORDER BY created_at DESC 
      LIMIT $2
    `;
    const res = await db.query(q, [tenantId, limit]);
    return res.rows;
  } catch (err) {
    console.error("[Notification] Failed to fetch unread notifications:", err.message);
    return [];
  }
}

async function markAsRead(notificationId, tenantId) {
  try {
    const q = `
      UPDATE notifications 
      SET read = TRUE 
      WHERE id = $1 AND tenant_id = $2
      RETURNING *
    `;
    const res = await db.query(q, [notificationId, tenantId]);
    return res.rows[0];
  } catch (err) {
    console.error("[Notification] Failed to mark as read:", err.message);
    return null;
  }
}

async function markAllAsRead(tenantId) {
  try {
    const q = `
      UPDATE notifications 
      SET read = TRUE 
      WHERE tenant_id = $1 AND read = FALSE
      RETURNING COUNT(*) as count
    `;
    const res = await db.query(q, [tenantId]);
    return res.rows[0];
  } catch (err) {
    console.error("[Notification] Failed to mark all as read:", err.message);
    return { count: 0 };
  }
}

// ─────────────────────────────────────────────────────────
// EVENT-DRIVEN NOTIFICATIONS (business activity)
// Each wrapped in try/catch — notification failures must never
// break the parent business operation.
// ─────────────────────────────────────────────────────────

/**
 * Fires when DripJobs reports a job completed with revenue.
 */
async function notifyRevenueRecovered(tenantId, { amount_cents, customer_name, lead_id, booking_id }) {
  try {
    if (!tenantId || !amount_cents || amount_cents <= 0) return null;

    // Dedup: if we've already notified for this booking, skip.
    if (booking_id) {
      const existing = await db.query(
        `SELECT id FROM notifications 
         WHERE tenant_id = $1 AND type = 'revenue_recovered' 
         AND data->>'booking_id' = $2
         LIMIT 1`,
        [tenantId, String(booking_id)]
      );
      if (existing.rows.length > 0) return null;
    }

    const dollars = (amount_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return await createNotification(tenantId, {
      type: 'revenue_recovered',
      title: `Revenue Recovered: $${dollars}`,
      body: customer_name
        ? `${customer_name}'s job completed — $${dollars} attributed to AI recovery.`
        : `New job completed — $${dollars} in confirmed revenue.`,
      data: { amount_cents, customer_name, lead_id, booking_id },
    });
  } catch (err) {
    console.error("[Notification] notifyRevenueRecovered failed:", err.message);
    return null;
  }
}

/**
 * Fires when a new booking is created.
 */
async function notifyNewBooking(tenantId, { customer_name, service_date, booking_id, lead_id, source }) {
  try {
    if (!tenantId || !booking_id) return null;

    const existing = await db.query(
      `SELECT id FROM notifications 
       WHERE tenant_id = $1 AND type = 'booking_created' 
       AND data->>'booking_id' = $2
       LIMIT 1`,
      [tenantId, String(booking_id)]
    );
    if (existing.rows.length > 0) return null;

    const dateStr = service_date
      ? new Date(service_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;
    return await createNotification(tenantId, {
      type: 'booking_created',
      title: 'New Booking',
      body: customer_name
        ? `${customer_name}${dateStr ? ` is booked for ${dateStr}` : ' has a new booking'}.`
        : `A new appointment was booked${dateStr ? ` for ${dateStr}` : ''}.`,
      data: { customer_name, service_date, booking_id, lead_id, source: source || 'ai' },
    });
  } catch (err) {
    console.error("[Notification] notifyNewBooking failed:", err.message);
    return null;
  }
}

/**
 * Fires when a booking is cancelled (via voice, SMS, dashboard, or CRM webhook).
 * Dedup'd by booking_id so we don't double-bell if cancelBooking is called twice.
 */
async function notifyBookingCancellation(tenantId, { customer_name, service_date, booking_id, lead_id, cancelled_via }) {
  try {
    if (!tenantId || !booking_id) return null;

    const existing = await db.query(
      `SELECT id FROM notifications
       WHERE tenant_id = $1 AND type = 'booking_cancelled'
       AND data->>'booking_id' = $2
       LIMIT 1`,
      [tenantId, String(booking_id)]
    );
    if (existing.rows.length > 0) return null;

    const dateStr = service_date
      ? new Date(service_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      : null;

    const sourceLabel = {
      voice:     'AI voice call',
      sms:       'SMS reply',
      dashboard: 'Dashboard',
      crm:       'CRM',
    }[cancelled_via] || 'Unknown source';

    return await createNotification(tenantId, {
      type: 'booking_cancelled',
      title: 'Appointment Cancelled',
      body: customer_name
        ? `${customer_name} cancelled their ${dateStr || 'upcoming'} appointment via ${sourceLabel}.`
        : `An appointment was cancelled via ${sourceLabel}.`,
      data: { customer_name, service_date, booking_id, lead_id, cancelled_via },
    });
  } catch (err) {
    console.error("[Notification] notifyBookingCancellation failed:", err.message);
    return null;
  }
}

/**
 * Fires when a new lead is captured. Skips auto-created CRM leads.
 */
async function notifyNewLead(tenantId, { customer_name, phone, source, lead_id }) {
  try {
    if (!tenantId || !lead_id) return null;

    const skipSources = ['crm_job_completed', 'crm_job_won'];
    if (source && skipSources.includes(source)) return null;

    const existing = await db.query(
      `SELECT id FROM notifications 
       WHERE tenant_id = $1 AND type = 'lead_captured' 
       AND data->>'lead_id' = $2
       LIMIT 1`,
      [tenantId, String(lead_id)]
    );
    if (existing.rows.length > 0) return null;

    const sourceLabel = {
      phone:    'Phone call',
      sms:      'Text message',
      facebook: 'Facebook',
      web:      'Website',
      referral: 'Referral',
      widget:   'Chat widget',
    }[source] || (source ? source.replace(/_/g, ' ') : 'Unknown source');

    return await createNotification(tenantId, {
      type: 'lead_captured',
      title: 'New Lead',
      body: customer_name
        ? `${customer_name} came in via ${sourceLabel}.`
        : `New lead via ${sourceLabel}${phone ? ` — ${phone}` : ''}.`,
      data: { customer_name, phone, source, lead_id },
    });
  } catch (err) {
    console.error("[Notification] notifyNewLead failed:", err.message);
    return null;
  }
}

/**
 * Fires when an estimate is sent with $5k+.
 */
const HOT_LEAD_THRESHOLD_CENTS = 500000;

async function notifyHotLead(tenantId, { customer_name, amount_cents, lead_id, phone }) {
  try {
    if (!tenantId || !lead_id) return null;
    if (!amount_cents || amount_cents < HOT_LEAD_THRESHOLD_CENTS) return null;

    const existing = await db.query(
      `SELECT id FROM notifications 
       WHERE tenant_id = $1 AND type = 'hot_lead' 
       AND data->>'lead_id' = $2
       LIMIT 1`,
      [tenantId, String(lead_id)]
    );
    if (existing.rows.length > 0) return null;

    const dollars = (amount_cents / 100).toLocaleString('en-US');
    return await createNotification(tenantId, {
      type: 'hot_lead',
      title: `Hot Lead: $${dollars} Estimate`,
      body: customer_name
        ? `${customer_name} just received a $${dollars} estimate. Personal follow-up recommended.`
        : `High-value estimate ($${dollars}) sent — follow up personally${phone ? ` at ${phone}` : ''}.`,
      data: { customer_name, amount_cents, lead_id, phone },
    });
  } catch (err) {
    console.error("[Notification] notifyHotLead failed:", err.message);
    return null;
  }
}

/**
 * Fires when a child location's Stripe sync fails. Apr 20, 2026.
 * Dedups within a 24-hour window so a single broken location doesn't
 * spam the bell every time someone hits the retry button or loads
 * the page. The retry button on Locations.jsx is the action — this
 * notification just gets eyes on the problem.
 */
async function notifyStripeSyncFailed(parentTenantId, { child_tenant_id, child_name, error_message }) {
  try {
    if (!parentTenantId || !child_tenant_id) return null;

    const existing = await db.query(
      `SELECT id FROM notifications
       WHERE tenant_id = $1
         AND type = 'stripe_sync_failed'
         AND data->>'child_tenant_id' = $2
         AND created_at > now() - interval '24 hours'
       LIMIT 1`,
      [parentTenantId, String(child_tenant_id)]
    );
    if (existing.rows.length > 0) return null;

    const displayName = child_name || "A location";
    const errorSnippet = error_message
      ? (error_message.length > 120 ? error_message.slice(0, 117) + "..." : error_message)
      : "Stripe rejected the billing item.";

    return await createNotification(parentTenantId, {
      type: 'stripe_sync_failed',
      title: 'Location Billing Issue',
      body: `${displayName} couldn't sync to your Stripe subscription. ${errorSnippet} Open the Locations page to retry.`,
      data: { child_tenant_id, child_name, error_message },
    });
  } catch (err) {
    console.error("[Notification] notifyStripeSyncFailed failed:", err.message);
    return null;
  }
}

/**
 * Fires when the estimate recovery sequence actually begins sending —
 * i.e. after the first touch passes all gates and goes out. Moved here
 * from recovery creation time (June 8, 2026) so the notification means
 * "a real follow-up went out," not "a recovery row was created."
 *
 * Copy is rendered from the tenant's ACTUAL channels + cadence rather
 * than hardcoded boilerplate. The old version always said "21 days,
 * texts + calls + voicemails" regardless of config, which misreported
 * SMS-only / voice-off tenants and fired even when gates suppressed all
 * sends (the Paragon phantom-notification bug).
 *
 * channels: array like ['SMS','voice'] derived from the recovery settings
 * cadenceDayCount: number of touches in the active cadence (preset or custom)
 * Both optional — falls back to a generic line if not supplied.
 */
async function notifyEstimateRecoveryStarted(tenantId, { customer_name, lead_id, recovery_id, channels, cadenceDayCount }) {
  try {
    if (!tenantId || !recovery_id) return null;

    const existing = await db.query(
      `SELECT id FROM notifications 
       WHERE tenant_id = $1 AND type = 'estimate_recovery_started' 
       AND data->>'recovery_id' = $2
       LIMIT 1`,
      [tenantId, String(recovery_id)]
    );
    if (existing.rows.length > 0) return null;

    // Build an honest channel phrase from what's actually enabled.
    const chanList = Array.isArray(channels) ? channels.filter(Boolean) : [];
    let channelPhrase = "follow-ups";
    if (chanList.length === 1) {
      channelPhrase = chanList[0] === "voice" ? "calls" : `${chanList[0]} messages`;
    } else if (chanList.length > 1) {
      const labelMap = { SMS: "texts", sms: "texts", voice: "calls", email: "emails" };
      const labeled = chanList.map((c) => labelMap[c] || c);
      channelPhrase = labeled.slice(0, -1).join(", ") + " and " + labeled[labeled.length - 1];
    }

    const touchPhrase = Number.isFinite(cadenceDayCount) && cadenceDayCount > 0
      ? `over ${cadenceDayCount} touch${cadenceDayCount === 1 ? "" : "es"}`
      : "";

    const detail = [channelPhrase, touchPhrase].filter(Boolean).join(" ");

    return await createNotification(tenantId, {
      type: 'estimate_recovery_started',
      title: 'AI Follow-Up Started',
      body: customer_name
        ? `AI is now following up with ${customer_name} via ${detail}.`
        : `AI follow-up sequence started for a new estimate (${detail}).`,
      data: { customer_name, lead_id, recovery_id, channels: chanList, cadenceDayCount: cadenceDayCount || null },
    });
  } catch (err) {
    console.error("[Notification] notifyEstimateRecoveryStarted failed:", err.message);
    return null;
  }
}

/**
 * Fires when a new customer is added to a reseller — either via manual
 * AddCustomerSheet or via public self-signup link. Notifies the RESELLER
 * (not the new customer) so they can see who's joining their portfolio.
 *
 * tenantId here is the RESELLER's tenant id, not the new customer's.
 * Apr 23, 2026.
 */
async function notifyResellerNewCustomer(resellerTenantId, { customer_tenant_id, customer_name, customer_email, via }) {
  try {
    if (!resellerTenantId || !customer_tenant_id) return null;

    // Dedup on customer_tenant_id so the same signup never bells twice
    // (e.g. if a webhook retries or the manual-add API is double-clicked).
    const existing = await db.query(
      `SELECT id FROM notifications
       WHERE tenant_id = $1
         AND type = 'reseller_new_customer'
         AND data->>'customer_tenant_id' = $2
       LIMIT 1`,
      [resellerTenantId, String(customer_tenant_id)]
    );
    if (existing.rows.length > 0) return null;

    const sourceLabel = via === 'public_signup'
      ? 'signed up via your link'
      : 'was added to your account';

    return await createNotification(resellerTenantId, {
      type: 'reseller_new_customer',
      title: 'New Customer',
      body: `${customer_name} ${sourceLabel}.${customer_email ? ` (${customer_email})` : ''}`,
      data: { customer_tenant_id, customer_name, customer_email, via },
    });
  } catch (err) {
    console.error("[Notification] notifyResellerNewCustomer failed:", err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────
// SCHEDULED CHECKS (existing — unchanged)
// ─────────────────────────────────────────────────────────

async function checkHungUpRates() {
  try {
    const tenants = await db.query("SELECT id FROM tenants");
    for (const t of tenants.rows) {
    const stats = await db.query(`
  SELECT 
    COUNT(*) as total,
    SUM(CASE WHEN (disposition IS NULL OR disposition = 'completed') 
         AND transfer_to IS NULL 
         AND status NOT ILIKE '%booked%' 
         AND status != 'Estimate Scheduled' 
         AND status != 'FollowUp Needed' 
         AND COALESCE(duration_minutes, 0) < 1.0 THEN 1 ELSE 0 END) as hung_up
  FROM calls 
  WHERE tenant_id = $1 
  AND started_at > now() - interval '24 hours'
  AND status != 'Spam'
  AND (disposition IS NULL OR disposition != 'spam')
`, [t.id]); 

      const total = parseInt(stats.rows[0].total, 10);
      const hung_up = parseInt(stats.rows[0].hung_up, 10);
      
      if (total >= 5 && (hung_up / total) > 0.1) {
        await createNotification(t.id, {
          type: 'high_hangup_rate',
          title: 'High Hang-up Rate Alert',
          body: `Notice: Your AI hang-up rate is ${Math.round((hung_up / total) * 100)}% in the last 24h. You might want to review recent transcripts.`,
          data: { rate: hung_up / total, total, hung_up }
        });
      }
    }
  } catch (err) {
    console.error("[Notification] Hang-up rate check failed:", err.message);
  }
}

async function sendDailySummary() {
  try {
    const tenants = await db.query("SELECT id FROM tenants");
    for (const t of tenants.rows) {
      const stats = await db.query(`
        SELECT 
          (SELECT COUNT(*) FROM calls WHERE tenant_id = $1 AND started_at > now() - interval '24 hours') as total_calls,
          (SELECT COUNT(*) FROM bookings WHERE tenant_id = $1 AND created_at > now() - interval '24 hours') as new_bookings,
          (SELECT COUNT(*) FROM leads WHERE tenant_id = $1 AND created_at > now() - interval '24 hours') as new_leads
      `, [t.id]);

      const { total_calls, new_bookings, new_leads } = stats.rows[0];
      if (parseInt(total_calls) > 0 || parseInt(new_leads) > 0 || parseInt(new_bookings) > 0) {
        await createNotification(t.id, {
          type: 'daily_summary',
          title: 'Daily Performance Summary',
          body: `Last 24h: ${total_calls} calls handled, ${new_leads} new leads, and ${new_bookings} bookings made.`,
          data: { total_calls, new_bookings, new_leads }
        });
      }
    }
  } catch (err) {
    console.error("[Notification] Daily summary failed:", err.message);
  }
}

async function checkUsageAlerts() {
  try {
    const tenants = await db.query("SELECT id, plan FROM tenants");
    
    const PLAN_LIMITS = {
      basic: { minutes: 500, sms: 500 },
      pro: { minutes: 1200, sms: 1500 },
      elite: { minutes: 3000, sms: 4000 }
    };

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    for (const t of tenants.rows) {
      const planKey = (t.plan || "basic").toLowerCase();
      const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.basic;

      const [voiceRes, smsRes] = await Promise.all([
        db.query(
          "SELECT COALESCE(SUM(duration_sec), 0) as total_sec FROM recordings WHERE tenant_id = $1 AND created_at >= $2",
          [t.id, startOfMonth]
        ),
        db.query(
          "SELECT COUNT(*) as total_sms FROM messages WHERE tenant_id = $1 AND direction = 'outbound' AND channel = 'sms' AND created_at >= $2",
          [t.id, startOfMonth]
        )
      ]);

      const usedMinutes = Math.ceil(parseInt(voiceRes.rows[0].total_sec, 10) / 60);
      const usedSms = parseInt(smsRes.rows[0].total_sms, 10);

      const voicePercent = (usedMinutes / limits.minutes) * 100;
      const smsPercent = (usedSms / limits.sms) * 100;
      const maxPercent = Math.max(voicePercent, smsPercent);

      let threshold = 0;
      if (maxPercent >= 100) threshold = 100;
      else if (maxPercent >= 80) threshold = 80;

      if (threshold > 0) {
        const existing = await db.query(`
          SELECT id FROM notifications 
          WHERE tenant_id = $1 AND type = 'usage_alert' 
          AND data->>'threshold' = $2 
          AND created_at >= $3
        `, [t.id, threshold.toString(), startOfMonth]);

        if (existing.rows.length === 0) {
          await createNotification(t.id, {
            type: 'usage_alert',
            title: `Usage Alert: ${threshold}% Reached`,
            body: threshold === 100 
              ? "You have reached 100% of your monthly limit. AI services may be restricted."
              : `Caution: You have reached ${threshold}% of your monthly allowance.`,
            data: { threshold, usedMinutes, usedSms, voicePercent, smsPercent }
          });
        }
      }
    }
  } catch (err) {
    console.error("[Notification] Usage alert check failed:", err.message);
  }
}

module.exports = {
  createNotification,
  getUnreadNotifications,
  markAsRead,
  markAllAsRead,
  checkHungUpRates,
  sendDailySummary,
  checkUsageAlerts,
  // Event-driven notifications
  notifyRevenueRecovered,
  notifyNewBooking,
  notifyBookingCancellation,
  notifyNewLead,
  notifyHotLead,
  notifyEstimateRecoveryStarted,
  notifyStripeSyncFailed,
  notifyResellerNewCustomer,
  HOT_LEAD_THRESHOLD_CENTS,
};

"use strict";

const db = require("../lib/db");

/**
 * Creates a notification for a specific tenant.
 * @param {string|number} tenantId - The ID of the tenant.
 * @param {Object} options - Notification options.
 * @param {string} options.type - Type of notification (e.g., 'booking_created', 'missed_call').
 * @param {string} options.title - Short descriptive title.
 * @param {string} [options.body] - Detailed body text.
 * @param {Object} [options.data] - Additional metadata for the notification.
 * @returns {Promise<Object>} The created notification record.
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
 * @param {string|number} tenantId - The ID of the tenant.
 * @param {number} [limit=10] - Number of notifications to fetch.
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

/**
 * Marks a notification as read.
 * @param {number} notificationId - The ID of the notification.
 * @param {string|number} tenantId - Security check tenantId.
 */
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

/**
 * Marks all notifications as read for a tenant.
 * @param {string|number} tenantId - The ID of the tenant.
 */
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

/**
 * Checks for high hung-up rates (>10%) in the last 24h.
 */
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
               AND status != 'Spam' 
               AND COALESCE(duration_minutes, 0) < 1.0 THEN 1 ELSE 0 END) as hung_up
        FROM calls 
        WHERE tenant_id = $1 AND started_at > now() - interval '24 hours'
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

/**
 * Sends a daily performance summary notification.
 */
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

/**
 * Checks for usage alerts (80% and 100%) for all tenants.
 */
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
        // Check if we already notified for this threshold this month
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
  checkUsageAlerts
};

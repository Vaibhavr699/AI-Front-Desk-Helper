"use strict";

const db = require("../lib/db");
const { sendUsageAlertEmail } = require("./email");

const PLAN_LIMITS = {
  basic: { minutes: 500, sms: 500 },
  pro: { minutes: 1200, sms: 1500 },
  elite: { minutes: 3000, sms: 4000 }
};

/**
 * Calculate current month usage for a tenant.
 */
async function getTenantUsage(tenantId) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [tenantRes, voiceRes, smsRes] = await Promise.all([
    db.query("SELECT plan, company_name, usage_alert_thresholds, usage_alerts_enabled, alert_history FROM tenants WHERE id = $1", [tenantId]),
    db.query(
      "SELECT COALESCE(SUM(duration_sec), 0) as total_sec FROM recordings WHERE tenant_id = $1 AND created_at >= $2",
      [tenantId, startOfMonth]
    ),
    db.query(
      "SELECT COUNT(*) as total_sms FROM messages WHERE tenant_id = $1 AND direction = 'outbound' AND channel = 'sms' AND created_at >= $2",
      [tenantId, startOfMonth]
    )
  ]);

  const tenant = tenantRes.rows[0];
  if (!tenant) return null;

  const planKey = (tenant.plan || "basic").toLowerCase();
  const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.basic;

  const usedSeconds = parseInt(voiceRes.rows[0].total_sec, 10);
  const usedMinutes = Math.ceil(usedSeconds / 60);
  const usedSms = parseInt(smsRes.rows[0].total_sms, 10);

  const voicePercent = (usedMinutes / limits.minutes) * 100;
  const smsPercent = (usedSms / limits.sms) * 100;
  const maxPercentRaw = Math.max(voicePercent, smsPercent);
  const maxPercent = Math.min(maxPercentRaw, 100);

  return {
    tenantId,
    tenantName: tenant.company_name,
    plan: planKey,
    limits,
    current: {
      minutes: usedMinutes,
      sms: usedSms,
      seconds: usedSeconds
    },
    percent: maxPercent,
    thresholds: tenant.usage_alert_thresholds || { "75": true, "90": true, "100": true },
    alertsEnabled: tenant.usage_alerts_enabled !== false,
    alertHistory: tenant.alert_history || []
  };
}

/**
 * Check if usage crossed any thresholds and send alerts.
 */
async function checkAndSendUsageAlerts(tenantId) {
  const usage = await getTenantUsage(tenantId);
  if (!usage || !usage.alertsEnabled) return;

  const thresholds = [100, 90, 75];
  const activeThresholds = Object.keys(usage.thresholds).filter(k => usage.thresholds[k]).map(Number).sort((a, b) => b - a);

  // Find the highest threshold reached
  const reached = activeThresholds.find(t => usage.percent >= t);
  if (!reached) return;

  // Check if we already sent an alert for this threshold this month
  const monthKey = new Date().toISOString().slice(0, 7); // "2024-03"
  const alreadySent = usage.alertHistory.some(a => a.threshold === reached && a.month === monthKey);

  if (!alreadySent) {
    console.log(`[UsageAlert] Sending ${reached}% alert for ${usage.tenantName} (${tenantId})`);
    
    // Get owner email
    const ownerRes = await db.query(
      `SELECT email FROM users u 
       JOIN tenant_users tu ON u.id = tu.user_id 
       WHERE tu.tenant_id = $1 AND tu.role = 'owner' LIMIT 1`,
      [tenantId]
    );
    const ownerEmail = ownerRes.rows[0]?.email;

    if (ownerEmail) {
      await sendUsageAlertEmail(ownerEmail, usage.tenantName, reached, usage.limits, usage.current);
      
      // Update alert history
      const newAlert = { threshold: reached, month: monthKey, sentAt: new Date().toISOString() };
      await db.query(
        "UPDATE tenants SET alert_history = alert_history || $1::jsonb, last_alert_sent_at = now() WHERE id = $2",
        [JSON.stringify(newAlert), tenantId]
      );
    } else {
      console.warn(`[UsageAlert] No owner email found for tenant ${tenantId}`);
    }
  }
}

module.exports = {
  getTenantUsage,
  checkAndSendUsageAlerts
};

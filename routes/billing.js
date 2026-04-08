const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { getGuaranteedTenantId, requireRole, ROLES } = require("../lib/auth");

// Only Owners and Admins can access billing
router.use(requireRole([ROLES.OWNER, ROLES.ADMIN]));

const PLAN_LIMITS = {
  basic: { minutes: 500, sms: 500, price: 297 },
  pro: { minutes: 1200, sms: 1500, price: 497 },
  elite: { minutes: 3000, sms: 4000, price: 997 }
};

const OVERAGE_RATES = {
  minute: 0.30,
  sms: 0.10
};


router.get("/usage", async (req, res) => {
  try {
    const tenantId = getGuaranteedTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    // Get current month range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Get tenant plan & bundle info
    const tenantRes = await db.query(
      "SELECT plan, bundle_minutes_balance, usage_alert_thresholds, usage_alerts_enabled FROM tenants WHERE id = $1", 
      [tenantId]
    );
    const tenantRaw = tenantRes.rows[0] || {};
    const planKey = (tenantRaw.plan || "basic").toLowerCase();
    const bundleMinutesBalance = tenantRaw.bundle_minutes_balance || 0;
    const alertThresholds = tenantRaw.usage_alert_thresholds || { "75": true, "90": true, "100": true };
    const alertsEnabled = tenantRaw.usage_alerts_enabled !== false;
    const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.basic;

    const [voiceRes, smsRes] = await Promise.all([
      // 1. Voice Usage (Sum of duration_sec)
      db.query(
        "SELECT COALESCE(SUM(duration_sec), 0) as total_sec FROM recordings WHERE tenant_id = $1 AND created_at >= $2",
        [tenantId, startOfMonth]
      ),
      // 2. SMS Usage (Count of outbound messages)
      db.query(
        "SELECT COUNT(*) as total_sms FROM messages WHERE tenant_id = $1 AND direction = 'outbound' AND channel = 'sms' AND created_at >= $2",
        [tenantId, startOfMonth]
      )
    ]);

    const usedSeconds = parseInt(voiceRes.rows[0].total_sec, 10);
    const usedMinutes = Math.ceil(usedSeconds / 60);
    const usedSms = parseInt(smsRes.rows[0].total_sms, 10);

    // Overage Tracker
    const extraMinutes = Math.max(0, usedMinutes - limits.minutes);
    const extraSms = Math.max(0, usedSms - limits.sms);
    
    const costMinutes = extraMinutes * OVERAGE_RATES.minute;
    const costSms = extraSms * OVERAGE_RATES.sms;

    // Monthly Projection
    const dayOfMonth = now.getDate();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    
    const projectedMinutes = Math.round((usedMinutes / dayOfMonth) * daysInMonth);
    const projectedSms = Math.round((usedSms / dayOfMonth) * daysInMonth);
    
    const projectedExtraMin = Math.max(0, projectedMinutes - limits.minutes);
    const projectedExtraSms = Math.max(0, projectedSms - limits.sms);
    const projectedOverageCost = (projectedExtraMin * OVERAGE_RATES.minute) + (projectedExtraSms * OVERAGE_RATES.sms);

    const voicePercent = (usedMinutes / limits.minutes) * 100;
    const smsPercent = (usedSms / limits.sms) * 100;
    const maxPercent = Math.max(voicePercent, smsPercent);

    res.json({
      plan: planKey,
      limits,
      alertThresholds,
      alertsEnabled,
      current: {
        minutes: usedMinutes,
        sms: usedSms,
        seconds: usedSeconds,
        bundle_minutes_balance: bundleMinutesBalance
      },
      overage: {
        extraMinutes,
        extraSms,
        costMinutes,
        costSms,
        totalCost: costMinutes + costSms
      },
      projection: {
        minutes: projectedMinutes,
        sms: projectedSms,
        overageCost: projectedOverageCost
      },
      status: {
        percent: maxPercent,
        reached: [75, 90, 100].filter(t => maxPercent >= t).sort((a,b) => b-a)[0] || null
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/alerts", async (req, res) => {
  try {
    const tenantId = getGuaranteedTenantId(req);
    const { thresholds, enabled } = req.body;
    if (!thresholds && enabled === undefined) return res.status(400).json({ error: "No changes provided" });

    const updates = [];
    const values = [];
    if (thresholds) {
      updates.push("usage_alert_thresholds = $" + (updates.length + 1));
      values.push(JSON.stringify(thresholds));
    }
    if (enabled !== undefined) {
      updates.push("usage_alerts_enabled = $" + (updates.length + 1));
      values.push(enabled);
    }
    values.push(tenantId);
    
    const sql = `UPDATE tenants SET ${updates.join(", ")}, updated_at = now() WHERE id = $${values.length}`;
    await db.query(sql, values);
    
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

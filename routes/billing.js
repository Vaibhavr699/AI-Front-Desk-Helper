const express = require("express");
const router = express.Router();
const db = require("../lib/db");

const PLAN_LIMITS = {
  basic: { minutes: 300, sms: 500, price: 297 },
  pro: { minutes: 800, sms: 1500, price: 497 },
  elite: { minutes: 2000, sms: 4000, price: 997 }
};

const OVERAGE_RATES = {
  minute: 0.30,
  sms: 0.10
};

function getTenantIdFromQuery(req) {
  return req.query.tenant_id || (req.user && req.user.tenant_id);
}

router.get("/usage", async (req, res) => {
  try {
    const tenantId = getTenantIdFromQuery(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    // Get current month range
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    
    // Get tenant plan
    const tenantRes = await db.query("SELECT plan FROM tenants WHERE id = $1", [tenantId]);
    const planKey = (tenantRes.rows[0]?.plan || "basic").toLowerCase();
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

    res.json({
      plan: planKey,
      limits,
      current: {
        minutes: usedMinutes,
        sms: usedSms,
        seconds: usedSeconds
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
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

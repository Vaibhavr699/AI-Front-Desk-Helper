"use strict";

const express = require("express");
const router = express.Router();
const db = require("../lib/db");
const { getGuaranteedTenantId } = require("../lib/auth");
const { handleReviewsWebhook } = require("./reviews");

// Only Owners and Admins can access billing
router.use(function(req, res, next) {
  const authLib = require("../lib/auth");
  return authLib.requireRole([authLib.ROLES.OWNER, authLib.ROLES.ADMIN])(req, res, next);
});

const PLAN_LIMITS = {
  basic: { minutes: 500, sms: 500, price: 297 },
  pro: { minutes: 1200, sms: 1500, price: 497 },
  elite: { minutes: 3000, sms: 4000, price: 997 }
};

const OVERAGE_RATES = {
  minute: 0.30,
  sms: 0.10
};

// ── GET /api/billing/usage ────────────────────────────────────────────────────
router.get("/usage", async (req, res) => {
  try {
    const tenantId = getGuaranteedTenantId(req);
    if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const tenantRes = await db.query(
      "SELECT plan, bundle_minutes_balance, usage_alert_thresholds, usage_alerts_enabled, reviews_addon_active FROM tenants WHERE id = $1",
      [tenantId]
    );
    const tenantRaw = tenantRes.rows[0] || {};
    const planKey = (tenantRaw.plan || "basic").toLowerCase();
    const bundleMinutesBalance = tenantRaw.bundle_minutes_balance || 0;
    const alertThresholds = tenantRaw.usage_alert_thresholds || { "75": true, "90": true, "100": true };
    const alertsEnabled = tenantRaw.usage_alerts_enabled !== false;
    const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.basic;

    const [voiceRes, smsRes] = await Promise.all([
      db.query(
        "SELECT COALESCE(SUM(duration_sec), 0) as total_sec FROM recordings WHERE tenant_id = $1 AND created_at >= $2",
        [tenantId, startOfMonth]
      ),
      db.query(
        "SELECT COUNT(*) as total_sms FROM messages WHERE tenant_id = $1 AND direction = 'outbound' AND channel = 'sms' AND created_at >= $2",
        [tenantId, startOfMonth]
      )
    ]);

    const usedSeconds = parseInt(voiceRes.rows[0].total_sec, 10);
    const usedMinutes = Math.ceil(usedSeconds / 60);
    const usedSms = parseInt(smsRes.rows[0].total_sms, 10);

    const extraMinutes = Math.max(0, usedMinutes - limits.minutes);
    const extraSms = Math.max(0, usedSms - limits.sms);
    const costMinutes = extraMinutes * OVERAGE_RATES.minute;
    const costSms = extraSms * OVERAGE_RATES.sms;

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
      addons: {
        reviews: tenantRaw.reviews_addon_active || planKey === "elite",
      },
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
        reached: [75, 90, 100].filter(t => maxPercent >= t).sort((a, b) => b - a)[0] || null
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Server error" });
  }
});

// ── POST /api/billing/alerts ──────────────────────────────────────────────────
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

// ── POST /api/billing/webhook ─────────────────────────────────────────────────
// Stripe webhook — handles all subscription events including Reviews add-on
router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
  const sig = req.headers["stripe-signature"];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature error:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {

      // ── Reviews add-on events ──────────────────────────────────────────────
      case "checkout.session.completed":
        await handleReviewsWebhook(event, db);
        break;

      case "customer.subscription.deleted":
        await handleReviewsWebhook(event, db);
        break;

      case "customer.subscription.updated":
        await handleReviewsWebhook(event, db);
        break;

      // ── Main plan subscription events ──────────────────────────────────────
      case "customer.subscription.created": {
        const sub = event.data.object;
        const customerId = sub.customer;
        const priceId = sub.items?.data?.[0]?.price?.id;
const planMap = {
  [process.env.STRIPE_PRICE_BASIC]:         "basic",
  [process.env.STRIPE_PRICE_PRO]:           "pro",
  [process.env.STRIPE_PRICE_ELITE]:         "elite",
  [process.env.STRIPE_PRICE_BASIC_ANNUAL]:  "basic",
  [process.env.STRIPE_PRICE_PRO_ANNUAL]:    "pro",
  [process.env.STRIPE_PRICE_ELITE_ANNUAL]:  "elite",
};
        const newPlan = planMap[priceId];
        if (newPlan && customerId) {
          await db.query(
            "UPDATE tenants SET plan = $1, stripe_subscription_id = $2 WHERE stripe_customer_id = $3",
            [newPlan, sub.id, customerId]
          );
        }
        break;
      }

      case "invoice.payment_succeeded": {
        const invoice = event.data.object;
        await db.query(
          "UPDATE tenants SET subscription_status = 'active' WHERE stripe_customer_id = $1",
          [invoice.customer]
        ).catch(() => {});
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object;
        await db.query(
          "UPDATE tenants SET subscription_status = 'past_due' WHERE stripe_customer_id = $1",
          [invoice.customer]
        ).catch(() => {});
        break;
      }

      default:
        // Ignore unhandled events
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});

module.exports = router;

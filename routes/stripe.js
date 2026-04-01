"use strict";

const express = require("express");
const { createCheckoutSession, createPortalSession, handleWebhookEvent, stripe } = require("../lib/stripe");
const { getTenantIdFromQuery, requireRole, ROLES } = require("../lib/auth");

const router = express.Router();

// Only Owners and Admins can access Stripe checkout/portal
router.use(requireRole([ROLES.OWNER, ROLES.ADMIN]));

/**
 * POST /api/stripe/checkout
 * Create a Stripe Checkout session for a plan subscription.
 * Body: { tenant_id, plan_id, return_url? }
 */
router.post("/checkout", async (req, res) => {
    try {
        const tenant_id = getTenantIdFromQuery(req);
        const { plan_id, return_url } = req.body || {};
        if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });
        if (!plan_id) return res.status(400).json({ error: "plan_id required" });

        const result = await createCheckoutSession(tenant_id, plan_id, return_url);
        res.json(result);
    } catch (e) {
        console.error("[Stripe] Checkout error:", e.message);
        res.status(400).json({ error: e.message });
    }
});

/**
 * POST /api/stripe/checkout-bundle
 * Create a Stripe Checkout session for a one-time minute bundle purchase.
 * Body: { tenant_id, minutes, price_id, return_url? }
 */
router.post("/checkout-bundle", async (req, res) => {
    try {
        const tenant_id = getTenantIdFromQuery(req);
        const { minutes, price_id, return_url } = req.body || {};
        if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });
        if (!minutes) return res.status(400).json({ error: "minutes required" });
        if (!price_id) return res.status(400).json({ error: "price_id required" });

        const { createBundleCheckoutSession } = require("../lib/stripe");
        const result = await createBundleCheckoutSession(tenant_id, minutes, price_id, return_url);
        res.json(result);
    } catch (e) {
        console.error("[Stripe] Bundle checkout error:", e.message);
        res.status(400).json({ error: e.message });
    }
});

/**
 * POST /api/stripe/checkout-addon-number
 * Create a Stripe Checkout session for a recurring $12/mo additional phone number.
 * Body: { tenant_id, return_url? }
 */
router.post("/checkout-addon-number", async (req, res) => {
    try {
        const tenant_id = getTenantIdFromQuery(req);
        const { return_url } = req.body || {};
        if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

        const { createAddonNumberCheckoutSession } = require("../lib/stripe");
        const result = await createAddonNumberCheckoutSession(tenant_id, return_url);
        res.json(result);
    } catch (e) {
        console.error("[Stripe] Add-on number checkout error:", e.message);
        res.status(400).json({ error: e.message });
    }
});

/**
 * POST /api/stripe/portal
 * Create a Stripe Billing Portal session for managing the subscription.
 * Body: { tenant_id, return_url? }
 */
router.post("/portal", async (req, res) => {
    try {
        const tenant_id = getTenantIdFromQuery(req);
        const { return_url } = req.body || {};
        if (!tenant_id) return res.status(400).json({ error: "tenant_id required" });

        const result = await createPortalSession(tenant_id, return_url);
        res.json(result);
    } catch (e) {
        console.error("[Stripe] Portal error:", e.message);
        res.status(400).json({ error: e.message });
    }
});

/**
 * GET /api/stripe/status?tenant_id=xxx
 * Get the current subscription status for a tenant.
 */
router.get("/status", async (req, res) => {
    try {
        const tenantId = getTenantIdFromQuery(req);
        if (!tenantId) return res.status(400).json({ error: "tenant_id required" });

        const db = require("../lib/db");
        const tenant = await db.query(
            "SELECT plan, subscription_status, stripe_customer_id, stripe_subscription_id FROM tenants WHERE id = $1",
            [tenantId]
        ).then((r) => r.rows[0]);

        if (!tenant) return res.status(404).json({ error: "Tenant not found" });

        const result = {
            plan: tenant.plan || "basic",
            subscription_status: tenant.subscription_status || "inactive",
            has_stripe: !!tenant.stripe_customer_id,
            has_subscription: !!tenant.stripe_subscription_id,
        };

        // If there's an active Stripe subscription, fetch billing details
        if (stripe && tenant.stripe_subscription_id) {
            try {
                const sub = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
                result.current_period_end = sub.current_period_end;
                result.cancel_at_period_end = sub.cancel_at_period_end;
            } catch (_) {
                // Subscription might be deleted
            }
        }

        res.json(result);
    } catch (e) {
        console.error("[Stripe] Status error:", e.message);
        res.status(500).json({ error: "Server error" });
    }
});

module.exports = router;

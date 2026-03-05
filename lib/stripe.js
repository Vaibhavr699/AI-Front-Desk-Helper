"use strict";

const Stripe = require("stripe");
const db = require("./db");
const { getPlan } = require("./plans");

const secretKey = process.env.STRIPE_SECRET_KEY;
const stripe = secretKey ? new Stripe(secretKey) : null;

/**
 * Get or create a Stripe customer for a tenant.
 */
async function getOrCreateCustomer(tenantId) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const tenant = await db.query(
        "SELECT id, name, company_name, stripe_customer_id FROM tenants WHERE id = $1",
        [tenantId]
    ).then((r) => r.rows[0]);
    if (!tenant) throw new Error("Tenant not found");

    if (tenant.stripe_customer_id) {
        return tenant.stripe_customer_id;
    }

    // Get the user's email for the customer
    const user = await db.query(
        "SELECT email FROM dashboard_users WHERE tenant_id = $1 LIMIT 1",
        [tenantId]
    ).then((r) => r.rows[0]);

    const customer = await stripe.customers.create({
        name: tenant.company_name || tenant.name,
        email: user?.email || undefined,
        metadata: { tenant_id: tenantId },
    });

    await db.query(
        "UPDATE tenants SET stripe_customer_id = $1, updated_at = now() WHERE id = $2",
        [customer.id, tenantId]
    );

    return customer.id;
}

/**
 * Create a Stripe Checkout session for subscribing to a plan.
 * Returns the Checkout session URL.
 */
async function createCheckoutSession(tenantId, planId, returnUrl) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const plan = getPlan(planId);
    if (!plan.stripePriceId) {
        throw new Error(`Plan '${planId}' has no Stripe Price ID configured. Set it in lib/plans.js.`);
    }

    const customerId = await getOrCreateCustomer(tenantId);

    // Check if tenant already has an active subscription
    const tenant = await db.query(
        "SELECT stripe_subscription_id, subscription_status FROM tenants WHERE id = $1",
        [tenantId]
    ).then((r) => r.rows[0]);

    if (tenant?.stripe_subscription_id && ["active", "trialing"].includes(tenant.subscription_status)) {
        // Changing plans — use the billing portal instead
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl || process.env.FRONTEND_URL || "http://localhost:5173/plans",
        });
        return { url: portalSession.url, type: "portal" };
    }

    // New subscription — create checkout session
    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [
            {
                price: plan.stripePriceId,
                quantity: 1,
            },
        ],
        metadata: {
            tenant_id: tenantId,
            plan_id: planId,
        },
        subscription_data: {
            metadata: {
                tenant_id: tenantId,
                plan_id: planId,
            },
        },
        success_url: (returnUrl || process.env.FRONTEND_URL || "http://localhost:5173") + "/plans?success=1",
        cancel_url: (returnUrl || process.env.FRONTEND_URL || "http://localhost:5173") + "/plans?canceled=1",
        allow_promotion_codes: true,
    });

    return { url: session.url, type: "checkout" };
}

/**
 * Create a billing portal session for managing subscription.
 */
async function createPortalSession(tenantId, returnUrl) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const customerId = await getOrCreateCustomer(tenantId);

    const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || process.env.FRONTEND_URL || "http://localhost:5173/plans",
    });

    return { url: session.url };
}

/**
 * Handle Stripe webhook events. Call this from the webhook route.
 */
async function handleWebhookEvent(event) {
    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const tenantId = session.metadata?.tenant_id;
            const planId = session.metadata?.plan_id;
            if (tenantId && session.subscription) {
                await db.query(
                    "UPDATE tenants SET stripe_subscription_id = $1, subscription_status = 'active', plan = $2, updated_at = now() WHERE id = $3",
                    [session.subscription, planId || "basic", tenantId]
                );
                console.log("[Stripe] Checkout completed tenantId=%s plan=%s subscriptionId=%s", tenantId, planId, session.subscription);
            }
            break;
        }

        case "customer.subscription.updated": {
            const subscription = event.data.object;
            const tenantId = subscription.metadata?.tenant_id;
            if (tenantId) {
                // Map Stripe status to our status
                const status = subscription.status; // active, past_due, canceled, unpaid, trialing, etc.
                // Try to detect plan from the price
                const priceId = subscription.items?.data?.[0]?.price?.id;
                let planId = null;
                if (priceId) {
                    const { PLANS } = require("./plans");
                    for (const [id, p] of Object.entries(PLANS)) {
                        if (p.stripePriceId === priceId) {
                            planId = id;
                            break;
                        }
                    }
                }
                const updates = ["subscription_status = $1", "updated_at = now()"];
                const params = [status];
                if (planId) {
                    updates.push(`plan = $${params.length + 1}`);
                    params.push(planId);
                }
                params.push(tenantId);
                await db.query(
                    `UPDATE tenants SET ${updates.join(", ")} WHERE id = $${params.length}`,
                    params
                );
                console.log("[Stripe] Subscription updated tenantId=%s status=%s plan=%s", tenantId, status, planId || "(unchanged)");
            }
            break;
        }

        case "customer.subscription.deleted": {
            const subscription = event.data.object;
            const tenantId = subscription.metadata?.tenant_id;
            if (tenantId) {
                await db.query(
                    "UPDATE tenants SET subscription_status = 'canceled', stripe_subscription_id = NULL, updated_at = now() WHERE id = $1",
                    [tenantId]
                );
                console.log("[Stripe] Subscription canceled tenantId=%s", tenantId);
            }
            break;
        }

        case "invoice.payment_failed": {
            const invoice = event.data.object;
            const customerId = invoice.customer;
            if (customerId) {
                await db.query(
                    "UPDATE tenants SET subscription_status = 'past_due', updated_at = now() WHERE stripe_customer_id = $1",
                    [customerId]
                );
                console.log("[Stripe] Payment failed customerId=%s", customerId);
            }
            break;
        }

        default:
            // Unhandled event type
            break;
    }
}

module.exports = {
    stripe,
    getOrCreateCustomer,
    createCheckoutSession,
    createPortalSession,
    handleWebhookEvent,
};

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
        "SELECT id, name, company_name, primary_email, stripe_customer_id FROM tenants WHERE id = $1",
        [tenantId]
    ).then((r) => r.rows[0]);
    if (!tenant) throw new Error("Tenant not found");

    if (tenant.stripe_customer_id) {
        return tenant.stripe_customer_id;
    }

    // Prefer tenant.primary_email (set for reseller customers + churn transfers),
    // fall back to dashboard_users.email for legacy direct-signup tenants.
    let email = tenant.primary_email || null;
    if (!email) {
        const user = await db.query(
            "SELECT email FROM dashboard_users WHERE tenant_id = $1 LIMIT 1",
            [tenantId]
        ).then((r) => r.rows[0]);
        email = user?.email || undefined;
    }

    const customer = await stripe.customers.create({
        name: tenant.company_name || tenant.name,
        email: email || undefined,
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
 */
async function createCheckoutSession(tenantId, planId, returnUrl, interval) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const plan = getPlan(planId);
    const isAnnual = interval === "annual";
    const basePriceId = isAnnual ? plan.stripePriceIdAnnual : plan.stripePriceId;

    if (!basePriceId) {
        throw new Error(`Plan '${planId}' has no Stripe Price ID configured for interval '${interval || "monthly"}'. Set it in lib/plans.js.`);
    }

    const customerId = await getOrCreateCustomer(tenantId);

    const tenant = await db.query(
        "SELECT business_type, stripe_subscription_id, subscription_status, plan_overrides, promo_expires_at FROM tenants WHERE id = $1",
        [tenantId]
    ).then((r) => r.rows[0]);

    if (tenant?.stripe_subscription_id && ["active", "trialing"].includes(tenant.subscription_status) && planId !== "nurturing_addon") {
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl || `${process.env.FRONTEND_URL || "http://localhost:5173"}/plans`,
        });
        return { url: portalSession.url, type: "portal" };
    }

    if (planId === "nurturing_addon" && tenant?.stripe_nurturing_subscription_id) {
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl || `${process.env.FRONTEND_URL || "http://localhost:5173"}/plans`,
        });
        return { url: portalSession.url, type: "portal" };
    }

    const promoActive = !tenant?.promo_expires_at || new Date(tenant.promo_expires_at) > new Date();
    const overrides = tenant?.plan_overrides || {};
    const planOverride = overrides[planId] || {};

    const hasMonthlyOverride = planOverride.monthly != null && promoActive;
    const hasSetupOverride = planOverride.setup != null && promoActive;

    let monthlyPriceId = isAnnual ? plan.stripePriceIdAnnual : plan.stripePriceId;
    if (hasMonthlyOverride && !isAnnual) {
        const overridePrice = await stripe.prices.create({
            unit_amount: planOverride.monthly,
            currency: "usd",
            recurring: { interval: "month" },
            product_data: {
                name: `${plan.name} Plan (Custom)`,
                metadata: { plan_id: planId, tenant_id: tenantId, type: "override" },
            },
        });
        monthlyPriceId = overridePrice.id;
        console.log("[Stripe] Created override monthly price %s (%d cents) for tenant %s (Plan: %s)", overridePrice.id, planOverride.monthly, tenantId, planId);
    }

    const lineItems = [
        {
            price: monthlyPriceId,
            quantity: 1,
        },
    ];

    let targetSetupFeeId = plan.stripeSetupFeeId;
    if (tenant?.business_type === "location") {
        targetSetupFeeId = process.env.STRIPE_SETUP_BASIC;
        console.log("[Stripe] Overriding setup fee to $197 for child location tenant %s (Plan: %s)", tenantId, planId);
    }

    if (hasSetupOverride && planOverride.setup === 0) {
        console.log("[Stripe] Setup fee waived for tenant %s (Plan: %s)", tenantId, planId);
    } else if (targetSetupFeeId) {
        if (hasSetupOverride && planOverride.setup > 0) {
            const overrideSetup = await stripe.prices.create({
                unit_amount: planOverride.setup,
                currency: "usd",
                product_data: {
                    name: `${plan.name} Setup Fee (Custom)`,
                    metadata: { plan_id: planId, tenant_id: tenantId, type: "setup_override" },
                },
            });
            lineItems.push({ price: overrideSetup.id, quantity: 1 });
            console.log("[Stripe] Created override setup price %s (%d cents) for tenant %s (Plan: %s)", overrideSetup.id, planOverride.setup, tenantId, planId);
        } else {
            lineItems.push({ price: targetSetupFeeId, quantity: 1 });
        }
    }

    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: lineItems,
        metadata: {
            tenant_id: tenantId,
            plan_id: planId,
        },
        subscription_data: {
            metadata: {
                tenant_id: tenantId,
                plan_id: planId,
                billing_interval: interval || "monthly",
            },
        },
        success_url: returnUrl ? `${returnUrl}?success=1` : `${process.env.FRONTEND_URL || "http://localhost:5173"}/plans?success=1`,
        cancel_url: returnUrl ? `${returnUrl}?canceled=1` : `${process.env.FRONTEND_URL || "http://localhost:5173"}/plans?canceled=1`,
        allow_promotion_codes: true,
    });

    return { url: session.url, type: "checkout" };
}

/**
 * Create a Stripe Checkout session for a one-time minute bundle purchase.
 */
async function createBundleCheckoutSession(tenantId, minutes, priceId, returnUrl) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const customerId = await getOrCreateCustomer(tenantId);

    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "payment",
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        metadata: {
            tenant_id: tenantId,
            type: "bundle",
            minutes: minutes.toString(),
        },
        success_url: returnUrl ? `${returnUrl}?success=1` : `${process.env.FRONTEND_URL || "http://localhost:5173"}/outbound?success=1`,
        cancel_url: returnUrl ? `${returnUrl}?canceled=1` : `${process.env.FRONTEND_URL || "http://localhost:5173"}/outbound?canceled=1`,
        allow_promotion_codes: true,
    });

    return { url: session.url, type: "checkout_bundle" };
}

/**
 * Create a Stripe Checkout session for an additional phone number subscription ($12/mo).
 */
async function createAddonNumberCheckoutSession(tenantId, returnUrl) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const customerId = await getOrCreateCustomer(tenantId);

    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [
            {
                price: process.env.STRIPE_PRICE_ADDON_NUMBER,
                quantity: 1,
            },
        ],
        metadata: {
            tenant_id: tenantId,
            type: "addon_number",
        },
        subscription_data: {
            metadata: {
                tenant_id: tenantId,
                type: "addon_number",
            },
        },
        success_url: returnUrl ? `${returnUrl}&success=1` : `${process.env.FRONTEND_URL || "http://localhost:5173"}/settings?tab=numbers&success=1`,
        cancel_url: returnUrl ? `${returnUrl}&canceled=1` : `${process.env.FRONTEND_URL || "http://localhost:5173"}/settings?tab=numbers&canceled=1`,
        allow_promotion_codes: true,
    });

    return { url: session.url, type: "checkout_addon" };
}

/**
 * Create a Stripe Checkout session for a FRANCHISEE accepting a self_pays invite.
 */
async function createFranchiseeInviteCheckoutSession({
    childTenantId,
    parentTenantId,
    planId,
    interval,
    acceptToken,
    successReturnUrl,
}) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const plan = getPlan(planId);
    const isAnnual = interval === "annual";
    const basePriceId = isAnnual ? plan.stripePriceIdAnnual : plan.stripePriceId;

    if (!basePriceId) {
        throw new Error(`Plan '${planId}' has no Stripe Price ID configured for interval '${interval || "monthly"}'. Set it in lib/plans.js.`);
    }

    const child = await db.query(
        `SELECT id, name, company_name, parent_id, billing_responsibility,
                franchisee_invite_token, franchisee_invite_expires_at, franchisee_invite_accepted_at,
                stripe_customer_id, stripe_subscription_id
           FROM tenants WHERE id = $1`,
        [childTenantId]
    ).then((r) => r.rows[0]);

    if (!child) throw new Error("Franchisee tenant not found");
    if (child.parent_id !== parentTenantId) throw new Error("Parent/child mismatch");
    if (child.billing_responsibility !== "self_pays") {
        throw new Error("This location is not configured for self-pay billing");
    }
    if (child.franchisee_invite_accepted_at) {
        throw new Error("This invite has already been accepted");
    }
    if (child.franchisee_invite_token !== acceptToken) {
        throw new Error("Invalid or expired invite token");
    }
    if (child.franchisee_invite_expires_at && new Date(child.franchisee_invite_expires_at) < new Date()) {
        throw new Error("Invite has expired. Ask your franchisor to resend.");
    }
    if (child.stripe_subscription_id) {
        throw new Error("This franchisee already has an active subscription");
    }

    const customerId = await getOrCreateCustomer(childTenantId);

    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [
            {
                price: basePriceId,
                quantity: 1,
            },
        ],
        metadata: {
            tenant_id: childTenantId,
            plan_id: planId,
            type: "franchisee_invite",
            parent_tenant_id: parentTenantId,
            franchisee_invite_token: acceptToken,
        },
        subscription_data: {
            metadata: {
                tenant_id: childTenantId,
                plan_id: planId,
                billing_interval: interval || "monthly",
                type: "franchisee_invite",
                parent_tenant_id: parentTenantId,
            },
        },
        success_url: successReturnUrl
            ? `${successReturnUrl}?success=1&tenant_id=${childTenantId}`
            : `${process.env.FRONTEND_URL || "http://localhost:5173"}/welcome?success=1&tenant_id=${childTenantId}`,
        cancel_url: successReturnUrl
            ? `${successReturnUrl}?canceled=1`
            : `${process.env.FRONTEND_URL || "http://localhost:5173"}/franchisee-invite/${acceptToken}?canceled=1`,
        allow_promotion_codes: true,
    });

    console.log(
        "[Stripe] Created franchisee invite checkout sessionId=%s child=%s parent=%s plan=%s",
        session.id,
        childTenantId,
        parentTenantId,
        planId
    );

    return { url: session.url, type: "franchisee_invite_checkout" };
}

/**
 * Create a Stripe Checkout session for a franchise zee paying their own subscription.
 *
 * Apr 29, 2026 — Phase 6 Franchise.
 * Different from createFranchiseeInviteCheckoutSession — that's a one-time token-gated
 * accept flow. This is the everyday paywall: an authenticated zee owner who hasn't yet
 * subscribed clicks "Subscribe" and lands in checkout.
 *
 * Honors plan_overrides.franchise.monthly for per-zee custom pricing (e.g. Groovy Hues
 * negotiated $225). Falls back to STRIPE_PRICE_FRANCHISE env var as the default.
 *
 * Refuses to create a session if:
 *   - tenant is not on plan='franchise' (wrong endpoint)
 *   - tenant.plan_overrides.billing_mode === 'manual' (admin override)
 *   - tenant already has an active subscription (returns portal URL instead)
 */
async function createFranchiseZeeCheckoutSession(tenantId, returnUrl) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const tenant = await db.query(
        `SELECT id, name, company_name, plan, plan_overrides, parent_id,
                stripe_subscription_id, subscription_status
           FROM tenants WHERE id = $1`,
        [tenantId]
    ).then((r) => r.rows[0]);

    if (!tenant) throw new Error("Tenant not found");
    if (tenant.plan !== "franchise") {
        throw new Error("createFranchiseZeeCheckoutSession is only valid for franchise-tier tenants");
    }

    const overrides = tenant.plan_overrides || {};
    if (overrides.billing_mode === "manual") {
        throw new Error("This zee is on manual billing — admin must invoice externally. Contact corporate.");
    }

    if (tenant.stripe_subscription_id && ["active", "trialing"].includes(tenant.subscription_status)) {
        // Already subscribed — bounce to portal so they can manage instead
        const customerId = await getOrCreateCustomer(tenantId);
        const portalSession = await stripe.billingPortal.sessions.create({
            customer: customerId,
            return_url: returnUrl || `${process.env.FRONTEND_URL || "http://localhost:5173"}/dashboard`,
        });
        return { url: portalSession.url, type: "portal" };
    }

    const customerId = await getOrCreateCustomer(tenantId);

    // Resolve price: prefer per-zee override, fall back to STRIPE_PRICE_FRANCHISE env var
    const monthlyOverrideCents = overrides.franchise?.monthly;
    let lineItem;

    if (monthlyOverrideCents != null && Number.isFinite(monthlyOverrideCents) && monthlyOverrideCents > 0) {
        // Custom per-zee price — create on the fly via price_data
        const overridePrice = await stripe.prices.create({
            unit_amount: monthlyOverrideCents,
            currency: "usd",
            recurring: { interval: "month" },
            product_data: {
                name: `AI Front Desk Franchise — ${tenant.company_name || tenant.name}`,
                metadata: {
                    plan_id: "franchise",
                    tenant_id: tenantId,
                    type: "franchise_zee_override",
                },
            },
        });
        lineItem = { price: overridePrice.id, quantity: 1 };
        console.log(
            "[Stripe] Created franchise zee override price %s (%d cents) for tenant %s",
            overridePrice.id,
            monthlyOverrideCents,
            tenantId
        );
    } else {
        // No override — use the standard $225/mo Stripe price
        const defaultPriceId = process.env.STRIPE_PRICE_FRANCHISE;
        if (!defaultPriceId) {
            throw new Error("STRIPE_PRICE_FRANCHISE not configured. Set it on Render.");
        }
        lineItem = { price: defaultPriceId, quantity: 1 };
    }

    const frontend = process.env.FRONTEND_URL || "http://localhost:5173";
    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [lineItem],
        metadata: {
            tenant_id: tenantId,
            plan_id: "franchise",
            type: "franchise_zee_subscribe",
            parent_tenant_id: tenant.parent_id || "",
        },
        subscription_data: {
            metadata: {
                tenant_id: tenantId,
                plan_id: "franchise",
                type: "franchise_zee_subscribe",
                parent_tenant_id: tenant.parent_id || "",
                billing_interval: "monthly",
            },
        },
        success_url: returnUrl
            ? `${returnUrl}?stripe_checkout=success`
            : `${frontend}/dashboard?stripe_checkout=success`,
        cancel_url: returnUrl
            ? `${returnUrl}?stripe_checkout=canceled`
            : `${frontend}/franchise-paywall?canceled=1`,
        allow_promotion_codes: true,
    });

    console.log(
        "[Stripe] Created franchise zee checkout sessionId=%s tenant=%s parent=%s",
        session.id,
        tenantId,
        tenant.parent_id
    );

    return { url: session.url, type: "checkout" };
}

/**
 * Sync existing Stripe subscription to match latest plan overrides.
 */
async function syncStripeSubscription(tenantId) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const tenant = await db.query(
        "SELECT id, plan, plan_overrides, promo_expires_at, stripe_subscription_id FROM tenants WHERE id = $1",
        [tenantId]
    ).then((r) => r.rows[0]);

    if (!tenant || !tenant.stripe_subscription_id) return { ok: false, reason: "no_subscription" };

    const planId = tenant.plan || "basic";
    const plan = getPlan(planId);

    const promoActive = !tenant.promo_expires_at || new Date(tenant.promo_expires_at) > new Date();
    const overrides = tenant.plan_overrides || {};
    const planOverride = overrides[planId] || {};
    const hasMonthlyOverride = planOverride.monthly != null && promoActive;

    try {
        const subscription = await stripe.subscriptions.retrieve(tenant.stripe_subscription_id);
        const itemId = subscription.items.data[0]?.id;
        if (!itemId) throw new Error("Subscription has no items");

        let targetPriceId = plan.stripePriceId;

        if (hasMonthlyOverride) {
            const overridePrice = await stripe.prices.create({
                unit_amount: planOverride.monthly,
                currency: "usd",
                recurring: { interval: "month" },
                product_data: {
                    name: `${plan.name} Plan (Custom Override)`,
                    metadata: { plan_id: planId, tenant_id: tenantId, type: "sync_override" },
                },
            });
            targetPriceId = overridePrice.id;
        }

        if (subscription.items.data[0].price.id === targetPriceId) {
            return { ok: true, changed: false };
        }

        await stripe.subscriptions.update(tenant.stripe_subscription_id, {
            items: [{
                id: itemId,
                price: targetPriceId,
            }],
            proration_behavior: "none",
        });

        console.log("[Stripe] Synced subscription %s to price %s for tenant %s", tenant.stripe_subscription_id, targetPriceId, tenantId);
        return { ok: true, changed: true, priceId: targetPriceId };
    } catch (err) {
        console.error("[Stripe] syncStripeSubscription error:", err.message);
        return { ok: false, error: err.message };
    }
}

/**
 * Create a billing portal session for managing subscription.
 */
async function createPortalSession(tenantId, returnUrl) {
    if (!stripe) throw new Error("Stripe not configured — set STRIPE_SECRET_KEY");

    const customerId = await getOrCreateCustomer(tenantId);

    const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl || `${process.env.FRONTEND_URL || "http://localhost:5173"}/plans`,
    });

    return { url: session.url };
}

/**
 * Handle Stripe webhook events.
 *
 * Apr 21 Step 9: added 'churn_direct_billing' branch in checkout.session.completed
 * that calls completeChurnDirectBilling to clear the grace token + activate
 * subscription for customers transferred from a churned reseller.
 *
 * Apr 29, 2026 Phase 6: added 'franchise_zee_subscribe' branch for franchise zees
 * paying their own subscription via the paywall flow.
 */
async function handleWebhookEvent(event) {
    const { handleResellerStripeEvent } = require('./resellerStripe');
    if (await handleResellerStripeEvent(event)) return;

    switch (event.type) {
        case "checkout.session.completed": {
            const session = event.data.object;
            const tenantId = session.metadata?.tenant_id;
            const type = session.metadata?.type;
            const minutes = parseInt(session.metadata?.minutes || "0", 10);
            const planId = session.metadata?.plan_id;

            if (tenantId && type === "addon_number") {
                await db.query(
                    "UPDATE tenants SET extra_numbers_count = COALESCE(extra_numbers_count, 0) + 1, updated_at = now() WHERE id = $1",
                    [tenantId]
                );
                console.log("[Stripe] Extra phone number add-on checkout completed tenantId=%s", tenantId);
            } else if (tenantId && type === "bundle" && minutes > 0) {
                await db.query(
                    "UPDATE tenants SET bundle_minutes_balance = COALESCE(bundle_minutes_balance, 0) + $1, updated_at = now() WHERE id = $2",
                    [minutes, tenantId]
                );
                console.log("[Stripe] Bundle checkout completed tenantId=%s minutes=%d", tenantId, minutes);
            } else if (tenantId && type === "franchisee_invite" && session.subscription) {
                // FRANCHISEE INVITE COMPLETED — Apr 19 self_pays flow
                const parentTenantId = session.metadata?.parent_tenant_id || null;
                await db.query(
                    `UPDATE tenants
                        SET stripe_subscription_id = $1,
                            subscription_status = 'active',
                            plan = $2,
                            franchisee_invite_accepted_at = now(),
                            franchisee_invite_token = NULL,
                            franchisee_invite_expires_at = NULL,
                            is_suspended = false,
                            updated_at = now()
                      WHERE id = $3`,
                    [session.subscription, planId || "basic", tenantId]
                );
                console.log(
                    "[Stripe] Franchisee invite checkout completed franchisee=%s parent=%s plan=%s subscriptionId=%s",
                    tenantId,
                    parentTenantId,
                    planId,
                    session.subscription
                );
            } else if (tenantId && type === "franchise_zee_subscribe" && session.subscription) {
                // Apr 29, 2026 — Phase 6 Franchise.
                // Zee owner just paid for their subscription via the paywall.
                // Plan is already 'franchise' from when admin created the tenant —
                // we only flip subscription_status to 'active' and record the sub ID.
                const parentTenantId = session.metadata?.parent_tenant_id || null;
                await db.query(
                    `UPDATE tenants
                        SET stripe_subscription_id = $1,
                            subscription_status = 'active',
                            updated_at = now()
                      WHERE id = $2`,
                    [session.subscription, tenantId]
                );
                console.log(
                    "[Stripe] Franchise zee subscribe completed franchisee=%s parent=%s subscriptionId=%s",
                    tenantId,
                    parentTenantId,
                    session.subscription
                );
            } else if (tenantId && type === "churn_direct_billing" && session.subscription) {
                // APR 21 STEP 9 — customer transferred from churned reseller just
                // completed direct-billing setup. Clear their grace token +
                // activate their subscription. See lib/resellerBilling.
                //   completeChurnDirectBilling for the DB flip.
                const { completeChurnDirectBilling } = require('./resellerBilling');
                try {
                    await completeChurnDirectBilling(
                        db,
                        tenantId,
                        session.customer,
                        session.subscription
                    );
                    // Also update plan if we have it in metadata (should always be present)
                    if (planId) {
                        await db.query(
                            "UPDATE tenants SET plan = $1, updated_at = now() WHERE id = $2",
                            [planId, tenantId]
                        );
                    }
                    console.log(
                        "[Stripe] Churn direct-billing activated tenantId=%s plan=%s subscriptionId=%s",
                        tenantId,
                        planId,
                        session.subscription
                    );
                } catch (err) {
                    console.error("[Stripe] Churn direct-billing completion failed:", err);
                }
            } else if (tenantId && session.subscription) {
                // Standard plan subscription path
                if (planId === "nurturing_addon") {
                    await db.query(
                        "UPDATE tenants SET stripe_nurturing_subscription_id = $1, nurturing_enabled = true, updated_at = now() WHERE id = $2",
                        [session.subscription, tenantId]
                    );
                    console.log("[Stripe] Nurturing Add-on checkout completed tenantId=%s", tenantId);
                } else {
                    const resolvedPlan = planId || "basic";
                    if (resolvedPlan === "elite") {
                        await db.query(
                            "UPDATE tenants SET stripe_subscription_id = $1, subscription_status = 'active', plan = $2, brand_mode = 'white_label', updated_at = now() WHERE id = $3",
                            [session.subscription, resolvedPlan, tenantId]
                        );
                        console.log("[Stripe] Checkout completed tenantId=%s plan=elite subscriptionId=%s brand_mode=white_label (auto)", tenantId, session.subscription);
                    } else {
                        await db.query(
                            "UPDATE tenants SET stripe_subscription_id = $1, subscription_status = 'active', plan = $2, updated_at = now() WHERE id = $3",
                            [session.subscription, resolvedPlan, tenantId]
                        );
                        console.log("[Stripe] Checkout completed tenantId=%s plan=%s subscriptionId=%s", tenantId, resolvedPlan, session.subscription);
                    }
                }
            }
            break;
        }

        case "customer.subscription.updated": {
            const subscription = event.data.object;
            const tenantId = subscription.metadata?.tenant_id;
            if (tenantId) {
                const status = subscription.status;
                const priceId = subscription.items?.data?.[0]?.price?.id;
                let planId = null;
                if (priceId) {
                    const { PLANS } = require("./plans");
                    for (const [id, p] of Object.entries(PLANS)) {
                        if (p.stripePriceId === priceId || p.stripePriceIdAnnual === priceId) {
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

                    if (planId === "elite") {
                        updates.push("brand_mode = 'white_label'");
                    }
                }
                params.push(tenantId);
                await db.query(
                    `UPDATE tenants SET ${updates.join(", ")} WHERE id = $${params.length}`,
                    params
                );
                console.log(
                    "[Stripe] Subscription updated tenantId=%s status=%s plan=%s%s",
                    tenantId,
                    status,
                    planId || "(unchanged)",
                    planId === "elite" ? " brand_mode=white_label (auto)" : ""
                );
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
            break;
    }
}

module.exports = {
    stripe,
    getOrCreateCustomer,
    createCheckoutSession,
    createBundleCheckoutSession,
    createAddonNumberCheckoutSession,
    createFranchiseeInviteCheckoutSession,
    createFranchiseZeeCheckoutSession,
    createPortalSession,
    syncStripeSubscription,
    handleWebhookEvent,
};

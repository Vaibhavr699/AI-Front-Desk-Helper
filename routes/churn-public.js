"use strict";

// ============================================================================
// routes/churn-public.js
// Apr 23, 2026 — Phase 3 Reseller Ops Item 3
// ============================================================================
// Public (no-auth) endpoints for the post-churn direct-billing setup flow.
// Customers reach this via tokenized links sent by sendResellerChurnTransferEmail
// when their reseller cancels their subscription.
//
// Mount in server.js ABOVE the global /api authMiddleware:
//   app.use('/api/churn-public', require('./routes/churn-public'));
//
// Companion files:
//   - lib/resellerBilling.js  → findTenantByChurnGraceToken, completeChurnDirectBilling
//   - lib/stripe.js           → checkout.session.completed handler reads
//                               metadata.type='churn_direct_billing' and calls
//                               completeChurnDirectBilling to finalize
//   - dashboard/src/pages/ChurnSetupDirectBilling.jsx → frontend
// ============================================================================

const express = require('express');
const router = express.Router();

const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

const db = require('../lib/db');
const { findTenantByChurnGraceToken } = require('../lib/resellerBilling');
const { getPlan } = require('../lib/plans');

const APP_URL = process.env.APP_URL || 'https://aifrontdeskhelper.com';

// Customer plans only — reseller tiers (starter/growth/scale) are not
// valid here. We default to 'basic' if a customer somehow has an
// unexpected plan value (defense-in-depth, mirrors the validation we
// added to routes/reseller.js POST /customers earlier today).
const ALLOWED_PLANS = ['basic', 'pro', 'elite'];

// ===========================================================================
// GET /api/churn-public/:token
// Validates the grace token + returns tenant info for the frontend page.
// ===========================================================================
router.get('/:token', async (req, res) => {
  try {
    const tenant = await findTenantByChurnGraceToken(db, req.params.token);

    if (!tenant) {
      return res.status(404).json({
        error: 'This link is invalid or has already been used.',
        code: 'TOKEN_NOT_FOUND',
      });
    }

    if (tenant.expired) {
      return res.status(410).json({
        error: 'This link has expired. Please contact support@aifrontdeskhelper.com to restore service.',
        code: 'TOKEN_EXPIRED',
        expired_at: tenant.churn_grace_expires_at,
      });
    }

    // Look up plan pricing so the page can show "$X/mo" without the
    // frontend hardcoding price tables.
    const planId = ALLOWED_PLANS.includes((tenant.plan || '').toLowerCase())
      ? tenant.plan.toLowerCase()
      : 'basic';
    let planInfo = null;
    try {
      const plan = getPlan(planId);
      planInfo = {
        id: planId,
        name: plan.name,
        monthly_price_cents: plan.monthlyPriceCents || null,
      };
    } catch {
      planInfo = { id: planId, name: planId, monthly_price_cents: null };
    }

    return res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        primary_email: tenant.primary_email,
        plan: planId,
      },
      plan: planInfo,
      originating_reseller_name: tenant.originating_reseller_name || 'your previous provider',
      expires_at: tenant.churn_grace_expires_at,
    });
  } catch (err) {
    console.error('[churn-public/:token:get]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// POST /api/churn-public/:token/checkout
// Creates a Stripe Checkout session to set up direct billing.
// Per Drew Apr 23: NO $197 setup fee for churn-transferred customers (they're
// already onboarded — penalizing them for their reseller's cancellation is
// the wrong move). Same plan they had under reseller is the default.
// ===========================================================================
router.post('/:token/checkout', async (req, res) => {
  if (!stripe) {
    return res.status(500).json({ error: 'Stripe not configured' });
  }

  try {
    const tenant = await findTenantByChurnGraceToken(db, req.params.token);

    if (!tenant) {
      return res.status(404).json({ error: 'Invalid link', code: 'TOKEN_NOT_FOUND' });
    }
    if (tenant.expired) {
      return res.status(410).json({ error: 'Link expired', code: 'TOKEN_EXPIRED' });
    }

    // Defense in depth — if the customer already has an active direct
    // subscription (e.g. they completed checkout in another tab), don't
    // double-charge them. Send them straight to the welcome page.
    const { rows: currentRows } = await db.query(
      `SELECT stripe_subscription_id, subscription_status, billing_owner
         FROM tenants WHERE id = $1`,
      [tenant.id]
    );
    const current = currentRows[0];
    if (
      current?.stripe_subscription_id &&
      ['active', 'trialing'].includes(current.subscription_status) &&
      current.billing_owner === 'direct'
    ) {
      return res.json({
        already_active: true,
        redirect_url: `${APP_URL}/churn/welcome?already_active=1`,
      });
    }

    const planId = ALLOWED_PLANS.includes((tenant.plan || '').toLowerCase())
      ? tenant.plan.toLowerCase()
      : 'basic';
    const plan = getPlan(planId);

    // Default to monthly; we can offer annual upsell on the page later
    // if needed. Annual selection would be a body param: { interval: 'annual' }
    const interval = req.body?.interval === 'annual' ? 'annual' : 'monthly';
    const priceId = interval === 'annual' ? plan.stripePriceIdAnnual : plan.stripePriceId;

    if (!priceId) {
      return res.status(500).json({
        error: `Plan ${planId} has no ${interval} price configured`,
        code: 'PRICE_MISSING',
      });
    }

    // Get-or-create Stripe customer record. We can't reuse the helper from
    // lib/stripe.js because that uses tenant.stripe_customer_id, but a
    // churn-transferred customer most likely doesn't have one yet (they
    // were billed through the reseller's Stripe account, not ours).
    let stripeCustomerId = null;
    if (current?.stripe_subscription_id || tenant.stripe_customer_id) {
      const { rows: c } = await db.query(
        'SELECT stripe_customer_id FROM tenants WHERE id = $1',
        [tenant.id]
      );
      stripeCustomerId = c[0]?.stripe_customer_id || null;
    }
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: tenant.primary_email,
        name: tenant.name,
        metadata: {
          tenant_id: tenant.id,
          churn_transfer: 'true',
          originated_reseller_id: tenant.churn_grace_originated_reseller_id || '',
        },
      });
      stripeCustomerId = customer.id;
      await db.query(
        'UPDATE tenants SET stripe_customer_id = $1, updated_at = now() WHERE id = $2',
        [stripeCustomerId, tenant.id]
      );
    }

    // Build the checkout session. CRITICAL: metadata.type='churn_direct_billing'
    // is what triggers lib/stripe.js handleWebhookEvent to call
    // completeChurnDirectBilling on success (clears grace token, activates sub).
    // No setup fee per Drew spec.
    const session = await stripe.checkout.sessions.create({
      customer: stripeCustomerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        tenant_id: tenant.id,
        plan_id: planId,
        type: 'churn_direct_billing',
        churn_grace_token: req.params.token,
        billing_interval: interval,
      },
      subscription_data: {
        metadata: {
          tenant_id: tenant.id,
          plan_id: planId,
          billing_interval: interval,
          type: 'churn_direct_billing',
        },
      },
      success_url: `${APP_URL}/churn/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${APP_URL}/churn/setup-direct-billing/${req.params.token}?canceled=1`,
      allow_promotion_codes: true,
    });

    console.log(
      '[churn-public/checkout] sessionId=%s tenant=%s plan=%s interval=%s',
      session.id,
      tenant.id,
      planId,
      interval
    );

    return res.json({
      checkout_url: session.url,
      session_id: session.id,
    });
  } catch (err) {
    console.error('[churn-public/:token/checkout]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

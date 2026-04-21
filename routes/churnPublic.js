"use strict";

// ============================================================================
// routes/churnPublic.js
// Apr 21, 2026 — Step 9: Reseller Churn Direct-Billing Setup (public routes)
// ============================================================================
// PUBLIC (no auth) endpoints for customers whose reseller canceled.
//
// Flow:
//   1. Reseller's Stripe subscription is deleted (webhook)
//   2. transferCustomersToDirect generates a grace token per customer
//   3. Customer receives email with URL /churn/setup-direct-billing/{token}
//   4. Frontend page calls GET /churn/setup-direct-billing/:token to verify
//      token + show tenant info + plan
//   5. User clicks "Set Up Billing" → frontend calls
//      POST /churn/setup-direct-billing/:token/checkout
//   6. This creates a Stripe checkout session with metadata:
//        type='churn_direct_billing', tenant_id, churn_token
//   7. On checkout.session.completed, lib/stripe.js webhook handler detects
//      type='churn_direct_billing' and calls completeChurnDirectBilling()
//      which clears the grace token + activates the subscription.
//
// Security notes:
//   - Routes are UNAUTHENTICATED — the grace token IS the credential (32 bytes
//     of entropy, single-use, 30-day TTL, stored in a partial unique index)
//   - Token validation is the ONLY gate on these endpoints — don't leak any
//     sensitive data in responses (we return name/plan only)
//   - NO PII from the originating reseller is exposed; only the reseller's
//     display name is returned for the "you were transferred from X" copy
// ============================================================================

const express = require('express');
const router = express.Router();

const db = require('../lib/db');
const {
  findTenantByChurnGraceToken,
  GRACE_PERIOD_MS,
} = require('../lib/resellerBilling');
const { getOrCreateCustomer } = require('../lib/stripe');
const { getPlan } = require('../lib/plans');

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

// ===========================================================================
// GET /churn/setup-direct-billing/:token
// Verify token + return tenant info for the setup page
// ===========================================================================
router.get('/setup-direct-billing/:token', async (req, res) => {
  try {
    const tenant = await findTenantByChurnGraceToken(db, req.params.token);

    if (!tenant) {
      return res.status(404).json({
        error: 'Invalid or unknown setup link',
        code: 'INVALID_TOKEN',
      });
    }

    if (tenant.expired) {
      return res.status(410).json({
        error: 'This setup link has expired. Please contact support to restore service.',
        code: 'TOKEN_EXPIRED',
        expired_at: tenant.churn_grace_expires_at,
      });
    }

    // Return only the minimum needed to render the setup page.
    // No PII beyond what's already on the customer's own record.
    return res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
        primary_email: tenant.primary_email,
      },
      originating_reseller_name: tenant.originating_reseller_name || null,
      grace_expires_at: tenant.churn_grace_expires_at,
      grace_days_remaining: Math.max(
        0,
        Math.ceil(
          (new Date(tenant.churn_grace_expires_at).getTime() - Date.now()) /
            (24 * 60 * 60 * 1000)
        )
      ),
    });
  } catch (err) {
    console.error('[churnPublic:verify]', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ===========================================================================
// POST /churn/setup-direct-billing/:token/checkout
// Body: { interval?: 'monthly' | 'annual' }
// Creates a Stripe checkout session for direct billing. On completion, the
// webhook handler in lib/stripe.js clears the grace token + activates.
// ===========================================================================
router.post('/setup-direct-billing/:token/checkout', async (req, res) => {
  try {
    const tenant = await findTenantByChurnGraceToken(db, req.params.token);

    if (!tenant) {
      return res.status(404).json({
        error: 'Invalid or unknown setup link',
        code: 'INVALID_TOKEN',
      });
    }

    if (tenant.expired) {
      return res.status(410).json({
        error: 'This setup link has expired. Please contact support.',
        code: 'TOKEN_EXPIRED',
      });
    }

    const interval = req.body?.interval === 'annual' ? 'annual' : 'monthly';
    const planId = tenant.plan || 'basic';
    const plan = getPlan(planId);
    const priceId = interval === 'annual' ? plan.stripePriceIdAnnual : plan.stripePriceId;

    if (!priceId) {
      return res.status(500).json({
        error: `Plan '${planId}' has no Stripe Price ID configured for ${interval} billing`,
        code: 'MISSING_PRICE_ID',
      });
    }

    // Reuse the main getOrCreateCustomer helper so direct-billing customers
    // are created with the same Stripe customer pattern as any other tenant.
    const customerId = await getOrCreateCustomer(tenant.id);

    const appUrl = process.env.APP_URL || process.env.FRONTEND_URL || 'https://aifrontdeskhelper.com';
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      // CRITICAL: type='churn_direct_billing' metadata is the signal that the
      // webhook handler in lib/stripe.js uses to call completeChurnDirectBilling
      // (which clears the grace token). Don't rename without updating that handler.
      metadata: {
        tenant_id: tenant.id,
        plan_id: planId,
        type: 'churn_direct_billing',
        churn_token: req.params.token,
        billing_interval: interval,
      },
      subscription_data: {
        metadata: {
          tenant_id: tenant.id,
          plan_id: planId,
          type: 'churn_direct_billing',
          billing_interval: interval,
        },
      },
      success_url: `${appUrl}/churn/complete?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/churn/setup-direct-billing/${req.params.token}`,
      allow_promotion_codes: true,
    });

    console.log(
      '[churnPublic:checkout] Created checkout session %s for tenant %s plan=%s interval=%s',
      session.id,
      tenant.id,
      planId,
      interval
    );

    return res.json({ checkout_url: session.url, session_id: session.id });
  } catch (err) {
    console.error('[churnPublic:checkout]', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
});

module.exports = router;

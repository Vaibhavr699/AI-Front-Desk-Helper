"use strict";

// ============================================================================
// lib/resellerStripe.js
// Apr 20, 2026 — Phase 2 WL Reseller Account Type (Stripe integration)
// ============================================================================
// Handles:
//   - Checkout session creation (initial subscription + upgrades)
//   - Billing portal session (cancel, update payment method, change tier)
//   - Webhook dispatcher for customer.subscription.* events on resellers
//   - Subscription activated → updates tenant tier fields
//   - Subscription updated → detects tier changes, updates limit/wholesale rate
//   - Subscription deleted → triggers customer transfer to direct billing
//
// Depends on: migration 037, lib/resellerPlans.js, lib/resellerBilling.js
// ============================================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const db = require('./db');
const {
  getResellerTier,
  getResellerStripePriceId,
} = require('./resellerPlans');
const { transferCustomersToDirect } = require('./resellerBilling');

// ---------------------------------------------------------------------------
// Helper: reverse-lookup tier from Stripe price ID
// ---------------------------------------------------------------------------
function resolveTierFromPriceId(priceId) {
  if (!priceId) return null;
  const mapping = {
    [process.env.STRIPE_RESELLER_STARTER_MONTHLY]: 'starter',
    [process.env.STRIPE_RESELLER_STARTER_ANNUAL]: 'starter',
    [process.env.STRIPE_RESELLER_GROWTH_MONTHLY]: 'growth',
    [process.env.STRIPE_RESELLER_GROWTH_ANNUAL]: 'growth',
    [process.env.STRIPE_RESELLER_SCALE_MONTHLY]: 'scale',
    [process.env.STRIPE_RESELLER_SCALE_ANNUAL]: 'scale',
  };
  return mapping[priceId] || null;
}

// ---------------------------------------------------------------------------
// Helper: ensure reseller has a Stripe customer record
// ---------------------------------------------------------------------------
async function ensureStripeCustomer(reseller) {
  if (reseller.stripe_customer_id) return reseller.stripe_customer_id;

  const customer = await stripe.customers.create({
    email: reseller.primary_email,
    name: reseller.name,
    metadata: {
      tenant_id: reseller.id,
      account_type: 'reseller',
    },
  });

  const { error } = await db
    .from('tenants')
    .update({
      stripe_customer_id: customer.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', reseller.id);
  if (error) throw new Error(`Failed to save stripe_customer_id: ${error.message}`);

  return customer.id;
}

// ===========================================================================
// createResellerCheckoutSession
// Used for: initial subscription AND tier upgrades/downgrades
// ===========================================================================
async function createResellerCheckoutSession({
  reseller,
  tier,
  interval = 'monthly',
  successUrl,
  cancelUrl,
}) {
  if (!reseller || reseller.account_type !== 'reseller') {
    throw new Error('Tenant is not a reseller');
  }

  const priceId = getResellerStripePriceId(tier, interval);
  const stripeCustomerId = await ensureStripeCustomer(reseller);

  const session = await stripe.checkout.sessions.create({
    customer: stripeCustomerId,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    mode: 'subscription',
    success_url: successUrl,
    cancel_url: cancelUrl,
    allow_promotion_codes: true,
    subscription_data: {
      metadata: {
        tenant_id: reseller.id,
        account_type: 'reseller',
        reseller_tier: tier,
        billing_interval: interval,
      },
    },
    metadata: {
      tenant_id: reseller.id,
      account_type: 'reseller',
      reseller_tier: tier,
      billing_interval: interval,
    },
  });

  return session;
}

// ===========================================================================
// createResellerBillingPortalSession
// Used for: cancel, payment method updates, tier changes after subscription
// ===========================================================================
async function createResellerBillingPortalSession({ reseller, returnUrl }) {
  if (!reseller.stripe_customer_id) {
    throw new Error('Reseller has no Stripe customer record yet — must subscribe first');
  }

  const session = await stripe.billingPortal.sessions.create({
    customer: reseller.stripe_customer_id,
    return_url: returnUrl,
  });

  return session;
}

// ===========================================================================
// Webhook handler: customer.subscription.created
// Fires when reseller completes initial checkout → activate subscription
// ===========================================================================
async function handleResellerSubscriptionCreated(subscription) {
  const tenantId = subscription.metadata?.tenant_id;
  const tier = subscription.metadata?.reseller_tier;

  if (!tenantId || !tier) {
    console.warn(
      '[resellerStripe] subscription.created missing tenant_id or reseller_tier:',
      subscription.id
    );
    return;
  }

  const tierDef = getResellerTier(tier);

  const { error } = await db
    .from('tenants')
    .update({
      stripe_subscription_id: subscription.id,
      subscription_status: subscription.status,
      reseller_tier: tier,
      reseller_customer_limit: tierDef.customer_limit,
      reseller_wholesale_rate_cents: tierDef.wholesale_rate_cents,
      updated_at: new Date().toISOString(),
    })
    .eq('id', tenantId);

  if (error) {
    console.error('[resellerStripe] failed to activate reseller:', error);
    return;
  }

  console.log(
    `[resellerStripe] activated reseller ${tenantId} on ${tier} (status: ${subscription.status})`
  );

  // TODO Step 5 email: sendResellerWelcomeEmail
  console.log(`[resellerStripe] TODO email: reseller welcome → tenant ${tenantId}`);
}

// ===========================================================================
// Webhook handler: customer.subscription.updated
// Fires on tier changes, renewal, payment_method updates, etc.
// ===========================================================================
async function handleResellerSubscriptionUpdated(subscription) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return;

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const newTier = resolveTierFromPriceId(priceId);

  const updates = {
    subscription_status: subscription.status,
    updated_at: new Date().toISOString(),
  };

  if (newTier) {
    const tierDef = getResellerTier(newTier);
    updates.reseller_tier = newTier;
    updates.reseller_customer_limit = tierDef.customer_limit;
    updates.reseller_wholesale_rate_cents = tierDef.wholesale_rate_cents;
  }

  const { error } = await db
    .from('tenants')
    .update(updates)
    .eq('id', tenantId);

  if (error) {
    console.error('[resellerStripe] failed to update reseller subscription:', error);
    return;
  }

  console.log(
    `[resellerStripe] updated reseller ${tenantId}: status=${subscription.status}${newTier ? ` tier=${newTier}` : ''}`
  );
}

// ===========================================================================
// Webhook handler: customer.subscription.deleted
// Fires on cancellation → trigger customer transfer to direct billing
// ===========================================================================
async function handleResellerSubscriptionDeleted(subscription) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return;

  console.log(
    `[resellerStripe] reseller ${tenantId} subscription canceled — initiating customer transfer`
  );

  try {
    // Transfer all customers to direct billing (DB flip handled by lib helper)
    const transferred = await transferCustomersToDirect(db, tenantId);

    // Mark reseller inactive
    await db
      .from('tenants')
      .update({
        subscription_status: 'canceled',
        updated_at: new Date().toISOString(),
      })
      .eq('id', tenantId);

    console.log(
      `[resellerStripe] transferred ${transferred.length} customers from reseller ${tenantId} to direct billing`
    );

    // TODO Step 6: for each transferred customer, create direct Stripe sub + send notification
    for (const customer of transferred) {
      console.log(
        `[resellerStripe] TODO Step 6: direct-billing Stripe sub + churn email → ${customer.primary_email}`
      );
    }
  } catch (err) {
    console.error('[resellerStripe] churn handler failed:', err);
  }
}

// ===========================================================================
// Webhook dispatcher
// Wire into your existing Stripe webhook handler — see Part 5 of Step 5.
// Returns true if event was a reseller event and was handled.
// Returns false for non-reseller events (fall through to existing logic).
// ===========================================================================
async function handleResellerStripeEvent(event) {
  const obj = event.data?.object;
  if (!obj) return false;

  // Only handle events where metadata.account_type === 'reseller'
  const isReseller = obj.metadata?.account_type === 'reseller';
  if (!isReseller) return false;

  switch (event.type) {
    case 'customer.subscription.created':
      await handleResellerSubscriptionCreated(obj);
      return true;
    case 'customer.subscription.updated':
      await handleResellerSubscriptionUpdated(obj);
      return true;
    case 'customer.subscription.deleted':
      await handleResellerSubscriptionDeleted(obj);
      return true;
    case 'checkout.session.completed':
      // Subscription created event will fire separately; just log here.
      console.log(
        `[resellerStripe] checkout.session.completed for reseller tenant ${obj.metadata?.tenant_id}`
      );
      return true;
    default:
      return false;
  }
}

module.exports = {
  createResellerCheckoutSession,
  createResellerBillingPortalSession,
  handleResellerSubscriptionCreated,
  handleResellerSubscriptionUpdated,
  handleResellerSubscriptionDeleted,
  handleResellerStripeEvent,
  resolveTierFromPriceId,
};

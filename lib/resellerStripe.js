"use strict";

// ============================================================================
// lib/resellerStripe.js
// Apr 20, 2026 — Phase 2 WL Reseller Account Type (Stripe integration)
// Apr 21, 2026 — Step 9: churn transfer now fully wired (emails + grace
//                        tokens via transferCustomersToDirect), cleared TODO.
// ============================================================================
// Uses pg Pool (lib/db.js) with raw SQL. Matches existing lib/stripe.js pattern.
//
// Handles:
//   - Checkout session creation (initial subscription + tier changes)
//   - Billing portal session
//   - Webhook dispatcher for customer.subscription.* events on resellers
//   - Tier change detection → auto-updates tenant reseller_tier, limit, wholesale
//   - Cancellation → triggers customer transfer to direct billing
//
// Depends on: migration 037 + 038, lib/db.js, lib/resellerPlans.js,
//             lib/resellerBilling.js, services/resellerEmail.js
// ============================================================================

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const db = require('./db');
const {
  getResellerTier,
  getResellerStripePriceId,
} = require('./resellerPlans');
const { transferCustomersToDirect } = require('./resellerBilling');
const { sendResellerWelcomeEmail } = require('../services/resellerEmail');

// ---------------------------------------------------------------------------
// Reverse-lookup tier from Stripe price ID
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
// Ensure reseller has a Stripe customer record
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

  await db.query(
    `UPDATE tenants
        SET stripe_customer_id = $1, updated_at = now()
      WHERE id = $2`,
    [customer.id, reseller.id]
  );

  return customer.id;
}

// ===========================================================================
// createResellerCheckoutSession
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
// Webhook: customer.subscription.created
// ===========================================================================
async function handleResellerSubscriptionCreated(subscription) {
  const tenantId = subscription.metadata?.tenant_id;
  const tier = subscription.metadata?.reseller_tier;

  if (!tenantId || !tier) {
    console.warn(
      '[resellerStripe] subscription.created missing metadata:',
      subscription.id
    );
    return;
  }

  const tierDef = getResellerTier(tier);

  await db.query(
    `UPDATE tenants
        SET stripe_subscription_id = $1,
            subscription_status = $2,
            reseller_tier = $3,
            reseller_customer_limit = $4,
            reseller_wholesale_rate_cents = $5,
            updated_at = now()
      WHERE id = $6`,
    [
      subscription.id,
      subscription.status,
      tier,
      tierDef.customer_limit,
      tierDef.wholesale_rate_cents,
      tenantId,
    ]
  );

  console.log(
    `[resellerStripe] activated reseller ${tenantId} on ${tier} (status: ${subscription.status})`
  );

  // Apr 21 Step 9: wire the welcome email (replaces TODO Step 6).
  // Load the fresh tenant row so we have primary_email + name + reseller_code.
  try {
    const { rows } = await db.query(
      `SELECT id, name, primary_email, reseller_code
         FROM tenants WHERE id = $1`,
      [tenantId]
    );
    const t = rows[0];
    if (t && t.primary_email) {
      await sendResellerWelcomeEmail({
        to: t.primary_email,
        reseller_name: t.name,
        tier_name: tierDef.name,
        reseller_code: t.reseller_code,
      }).catch((err) =>
        console.error('[resellerStripe] welcome email send failed:', err.message)
      );
    } else {
      console.warn(
        '[resellerStripe] reseller %s has no primary_email, skipping welcome email',
        tenantId
      );
    }
  } catch (err) {
    console.error('[resellerStripe] welcome email lookup failed:', err.message);
  }
}

// ===========================================================================
// Webhook: customer.subscription.updated
// ===========================================================================
async function handleResellerSubscriptionUpdated(subscription) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return;

  const priceId = subscription.items?.data?.[0]?.price?.id;
  const newTier = resolveTierFromPriceId(priceId);

  if (newTier) {
    const tierDef = getResellerTier(newTier);
    await db.query(
      `UPDATE tenants
          SET subscription_status = $1,
              reseller_tier = $2,
              reseller_customer_limit = $3,
              reseller_wholesale_rate_cents = $4,
              updated_at = now()
        WHERE id = $5`,
      [
        subscription.status,
        newTier,
        tierDef.customer_limit,
        tierDef.wholesale_rate_cents,
        tenantId,
      ]
    );
    console.log(
      `[resellerStripe] updated reseller ${tenantId}: status=${subscription.status} tier=${newTier}`
    );
  } else {
    // Status change only (no tier change detected)
    await db.query(
      `UPDATE tenants
          SET subscription_status = $1, updated_at = now()
        WHERE id = $2`,
      [subscription.status, tenantId]
    );
    console.log(
      `[resellerStripe] updated reseller ${tenantId}: status=${subscription.status}`
    );
  }
}

// ===========================================================================
// Webhook: customer.subscription.deleted → trigger churn
// ===========================================================================
// Apr 21 Step 9: transferCustomersToDirect now handles the full churn flow
// internally (grace tokens, 30-day expiration, emails). This handler just:
//   1. Calls the transfer
//   2. Marks the reseller's subscription canceled
//   3. Clears the reseller's stripe_subscription_id (prevents future webhook
//      events on this sub from matching the tenant row)
//   4. Logs the per-customer outcome for debugging
async function handleResellerSubscriptionDeleted(subscription) {
  const tenantId = subscription.metadata?.tenant_id;
  if (!tenantId) return;

  console.log(
    `[resellerStripe] reseller ${tenantId} subscription canceled — initiating customer transfer`
  );

  try {
    const result = await transferCustomersToDirect(db, tenantId);

    // Mark the reseller canceled + detach the now-gone subscription.
    // We keep reseller_tier + reseller_code set so the tenants_reseller_
    // fields_consistency CHECK constraint stays satisfied (the account is
    // still account_type='reseller', just inactive).
    await db.query(
      `UPDATE tenants
          SET subscription_status = 'canceled',
              stripe_subscription_id = NULL,
              updated_at = now()
        WHERE id = $1`,
      [tenantId]
    );

    // Apr 23, 2026: result is now a structured object (was previously a flat
    // array of customers). New shape: { attempted, transferred, failed,
    // emails_sent, emails_failed, customers[], errors[] }.
    console.log(
      `[resellerStripe] Churn complete: reseller=%s attempted=%d transferred=%d failed=%d emails_sent=%d emails_failed=%d`,
      tenantId,
      result.attempted,
      result.transferred,
      result.failed,
      result.emails_sent,
      result.emails_failed
    );

    // Loud alarm if any DB updates failed — these are stuck customers
    // who need manual SQL cleanup (the same situation we hit Apr 23
    // when migration 041 hadn't run yet).
    if (result.failed > 0) {
      console.error(
        '[resellerStripe] CRITICAL: %d customers FAILED to transfer for reseller %s. Manual cleanup required. Errors: %j',
        result.failed,
        tenantId,
        result.errors.filter((e) => e.stage === 'db_update')
      );
    }

    // Per-customer breadcrumb for debugging failed emails (need manual
    // outreach since customer doesn't know their service is being moved).
    for (const customer of result.customers) {
      if (!customer.email_sent) {
        console.warn(
          '[resellerStripe] Churn email NOT sent to customer=%s (%s) — manual outreach needed. Grace expires %s.',
          customer.id,
          customer.primary_email || '(no email)',
          customer.grace_expires_at
        );
      }
    }
  } catch (err) {
    console.error('[resellerStripe] churn handler failed:', err);
  }
}
// ===========================================================================
// Webhook dispatcher
// Wire into your existing lib/stripe.js handleWebhookEvent — returns true if
// event was a reseller event (short-circuit), false for non-reseller.
// ===========================================================================
async function handleResellerStripeEvent(event) {
  const obj = event.data?.object;
  if (!obj) return false;

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

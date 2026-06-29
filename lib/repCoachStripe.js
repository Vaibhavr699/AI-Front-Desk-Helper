"use strict";

const Stripe = require("stripe");
const { provisionFromCheckout } = require("../services/repCoachProvisioning");

const secretKey = process.env.REP_COACH_STRIPE_SECRET_KEY || process.env.STRIPE_SECRET_KEY;
const webhookSecret = process.env.REP_COACH_STRIPE_WEBHOOK_SECRET;
const client = secretKey ? new Stripe(secretKey) : null;

function isConfigured() {
  return Boolean(client && webhookSecret);
}

function constructEvent(rawBody, signature) {
  return client.webhooks.constructEvent(rawBody, signature, webhookSecret);
}

function priceToTier(price) {
  if (!price) return "standard";
  const key = (price.lookup_key || "").toLowerCase();
  if (key.includes("elite")) return "elite";
  if (key.includes("pro")) return "pro";
  if (key.includes("standard")) return "standard";
  const amount = price.unit_amount || 0;
  if (amount >= 24900) return "elite";
  if (amount >= 19900) return "pro";
  return "standard";
}

async function resolveTier(session) {
  if (!client) return "standard";
  try {
    const items = await client.checkout.sessions.listLineItems(session.id, {
      limit: 1,
      expand: ["data.price"],
    });
    return priceToTier(items.data[0]?.price);
  } catch (err) {
    console.error("[RepCoachStripe] resolveTier failed, defaulting to standard:", err.message);
    return "standard";
  }
}

// Standalone signup: a 14-day-trial subscription checkout (card up-front,
// 1 rep seat at the entry bracket). GUESSED DEFAULTS (flag for Drew):
//   - trial_period_days: 14
//   - payment_method_collection: 'always' (card required to start the trial)
//   - 1 seat, T1 bracket price (REP_COACH_STRIPE_PRICE_T1, falls back to *_STANDARD)
const TRIAL_DAYS = 14;
const TRIAL_PRICE =
  process.env.REP_COACH_STRIPE_PRICE_T1 || process.env.REP_COACH_STRIPE_PRICE_STANDARD;

async function createTrialCheckout({ email, magicToken, successUrl, cancelUrl }) {
  if (!client) throw new Error("Rep Coach Stripe not configured");
  if (!TRIAL_PRICE) throw new Error("REP_COACH_STRIPE_PRICE_T1 not set");
  const session = await client.checkout.sessions.create({
    mode: "subscription",
    customer_email: email,
    client_reference_id: magicToken,
    line_items: [{ price: TRIAL_PRICE, quantity: 1 }],
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      metadata: { type: "rep_coach", account_type: "standalone" },
    },
    payment_method_collection: "always",
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  return { url: session.url, id: session.id };
}

async function handleEvent(event) {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const tier = await resolveTier(session);
      let trialEnd = null;
      if (session.subscription && client) {
        try {
          const sub = await client.subscriptions.retrieve(session.subscription);
          trialEnd = sub.trial_end || null;
        } catch (err) {
          console.error("[RepCoachStripe] sub retrieve failed:", err.message);
        }
      }
      await provisionFromCheckout(session, {
        tier,
        isTrial: Boolean(trialEnd),
        trialEnd,
      });
      break;
    }
    // Trial converts to paid (or any status change): keep the tenant in sync.
    case "customer.subscription.updated": {
      const sub = event.data.object;
      await syncSubscriptionStatus(sub);
      break;
    }
    // GUESSED DEFAULT (flag for Drew): rely on Stripe Smart Retries for dunning;
    // we just record the failure. No early lock here — lock happens only on the
    // terminal subscription.deleted below. Data is never deleted.
    case "invoice.payment_failed": {
      const inv = event.data.object;
      console.warn("[RepCoachStripe] payment failed sub=%s", inv.subscription);
      await markSubscriptionStatus(inv.subscription, "past_due");
      break;
    }
    // Terminal: Stripe exhausted retries (or canceled). Paywall-lock the tenant
    // but DO NOT delete data (Drew's locked decision).
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await markSubscriptionStatus(sub.id, "canceled", { lock: true });
      break;
    }
    default:
      break;
  }
}

async function syncSubscriptionStatus(sub) {
  // active | trialing | past_due | canceled → mirror onto the tenant.
  const status = sub.status === "trialing" ? "trialing" : sub.status;
  await markSubscriptionStatus(sub.id, status, {
    repCoachEnabled: ["active", "trialing"].includes(sub.status),
    trialEnd: sub.trial_end || null,
  });
}

async function markSubscriptionStatus(subscriptionId, status, opts = {}) {
  if (!subscriptionId) return;
  const db = require("./db");
  const sets = ["subscription_status = $2", "updated_at = now()"];
  const params = [subscriptionId, status];
  if (opts.lock === true) {
    sets.push("rep_coach_enabled = false");
  } else if (typeof opts.repCoachEnabled === "boolean") {
    params.push(opts.repCoachEnabled);
    sets.push(`rep_coach_enabled = $${params.length}`);
  }
  await db.query(
    `UPDATE tenants SET ${sets.join(", ")} WHERE stripe_subscription_id = $1`,
    params,
  );
  if (Object.prototype.hasOwnProperty.call(opts, "trialEnd")) {
    const trialDate = opts.trialEnd ? new Date(opts.trialEnd * 1000) : null;
    await db.query(
      `UPDATE dashboard_users u
          SET trial_ends_at = $2, updated_at = now()
         FROM tenants t
        WHERE u.tenant_id = t.id AND t.stripe_subscription_id = $1
          AND u.rep_coach_account_type = 'standalone'`,
      [subscriptionId, trialDate],
    );
  }
}

module.exports = { isConfigured, constructEvent, handleEvent, createTrialCheckout };

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

async function handleEvent(event) {
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const tier = await resolveTier(session);
    await provisionFromCheckout(session, { tier });
  }
}

module.exports = { isConfigured, constructEvent, handleEvent };

"use strict";

const db = require("./db");
const { stripe, getOrCreateCustomer } = require("./stripe");

// ── Volume pricing — 4 quantity brackets (Drew's spec) ──────────────────────
// GUESSED DEFAULT (flag for Drew): one Stripe price per bracket, keyed by env.
// Price per seat drops as the team's total active rep-seat count rises. The
// whole team bills at the single bracket its total count falls into.
//   1–2  $149  REP_COACH_STRIPE_PRICE_T1
//   3–9  $129  REP_COACH_STRIPE_PRICE_T2
//   10–24 $109 REP_COACH_STRIPE_PRICE_T3
//   25+  $89   REP_COACH_STRIPE_PRICE_T4
// Legacy *_STANDARD/_PRO/_ELITE envs are kept as a fallback so existing test
// data + Step-4 work doesn't break before the new price IDs exist.
const BRACKETS = [
  { min: 1, max: 2, key: "t1", price: process.env.REP_COACH_STRIPE_PRICE_T1 },
  { min: 3, max: 9, key: "t2", price: process.env.REP_COACH_STRIPE_PRICE_T2 },
  { min: 10, max: 24, key: "t3", price: process.env.REP_COACH_STRIPE_PRICE_T3 },
  { min: 25, max: Infinity, key: "t4", price: process.env.REP_COACH_STRIPE_PRICE_T4 },
];

// Back-compat: old named-tier envs still resolvable if the new T1-T4 are unset.
const TIER_PRICE = {
  standard: process.env.REP_COACH_STRIPE_PRICE_STANDARD,
  pro: process.env.REP_COACH_STRIPE_PRICE_PRO,
  elite: process.env.REP_COACH_STRIPE_PRICE_ELITE,
};

function bracketForCount(count) {
  if (!count || count < 1) return null;
  return BRACKETS.find((b) => count >= b.min && count <= b.max) || null;
}

async function countActiveRepSeats(tenantId) {
  const r = await db.query(
    `SELECT count(*)::int AS n
       FROM dashboard_users
      WHERE tenant_id = $1 AND rep_seat_active = true
        AND (seat_type IS NULL OR seat_type = 'rep')`,
    [tenantId],
  );
  return r.rows[0]?.n || 0;
}

async function createSub(tenantId, items) {
  const customerId = await getOrCreateCustomer(tenantId);
  const sub = await stripe.subscriptions.create({
    customer: customerId,
    items,
    metadata: { tenant_id: tenantId, type: "rep_coach" },
    proration_behavior: "create_prorations",
  });
  await db.query(
    "UPDATE tenants SET rep_coach_subscription_id = $1, updated_at = now() WHERE id = $2",
    [sub.id, tenantId],
  );
  return sub.id;
}

async function syncRepCoachSubscription(tenantId) {
  if (!stripe) return { ok: false, reason: "stripe_not_configured" };

  const tRes = await db.query(
    "SELECT rep_coach_subscription_id, rep_coach_enabled FROM tenants WHERE id = $1",
    [tenantId],
  );
  const tenant = tRes.rows[0];
  if (!tenant) return { ok: false, reason: "tenant_not_found" };

  const seatCount = await countActiveRepSeats(tenantId);
  const bracket = bracketForCount(seatCount);
  // Single line item: the bracket price × total active rep seats.
  const desired =
    tenant.rep_coach_enabled && bracket && bracket.price
      ? [{ price: bracket.price, quantity: seatCount }]
      : [];

  const subId = tenant.rep_coach_subscription_id;

  if (desired.length === 0) {
    if (subId) {
      try {
        await stripe.subscriptions.cancel(subId);
      } catch (_) {}
      await db.query(
        "UPDATE tenants SET rep_coach_subscription_id = NULL, updated_at = now() WHERE id = $1",
        [tenantId],
      );
    }
    return { ok: true, subscriptionId: null, items: [] };
  }

  if (!subId) {
    const id = await createSub(tenantId, desired);
    return { ok: true, subscriptionId: id, items: desired };
  }

  let existing;
  try {
    existing = await stripe.subscriptions.retrieve(subId);
  } catch (_) {
    const id = await createSub(tenantId, desired);
    return { ok: true, subscriptionId: id, items: desired };
  }

  const desiredByPrice = new Map(desired.map((d) => [d.price, d.quantity]));
  const updates = [];
  for (const item of existing.items.data) {
    const priceId = item.price.id;
    if (desiredByPrice.has(priceId)) {
      updates.push({ id: item.id, quantity: desiredByPrice.get(priceId) });
      desiredByPrice.delete(priceId);
    } else {
      updates.push({ id: item.id, deleted: true });
    }
  }
  for (const [priceId, quantity] of desiredByPrice.entries()) {
    updates.push({ price: priceId, quantity });
  }

  await stripe.subscriptions.update(subId, {
    items: updates,
    proration_behavior: "create_prorations",
  });
  return { ok: true, subscriptionId: subId, items: desired };
}

module.exports = {
  syncRepCoachSubscription,
  countActiveRepSeats,
  bracketForCount,
  BRACKETS,
  TIER_PRICE,
};

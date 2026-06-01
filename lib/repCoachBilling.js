"use strict";

const db = require("./db");
const { stripe, getOrCreateCustomer } = require("./stripe");

const TIER_PRICE = {
  standard: process.env.REP_COACH_STRIPE_PRICE_STANDARD,
  pro: process.env.REP_COACH_STRIPE_PRICE_PRO,
  elite: process.env.REP_COACH_STRIPE_PRICE_ELITE,
};

async function countActiveSeatsByTier(tenantId) {
  const r = await db.query(
    `SELECT rep_seat_tier AS tier, count(*)::int AS n
       FROM dashboard_users
      WHERE tenant_id = $1 AND rep_seat_active = true
      GROUP BY rep_seat_tier`,
    [tenantId],
  );
  const counts = {};
  for (const row of r.rows) counts[row.tier] = row.n;
  return counts;
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

  const counts = await countActiveSeatsByTier(tenantId);
  const desired = tenant.rep_coach_enabled
    ? Object.entries(counts)
        .filter(([tier, n]) => n > 0 && TIER_PRICE[tier])
        .map(([tier, n]) => ({ price: TIER_PRICE[tier], quantity: n }))
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

module.exports = { syncRepCoachSubscription, countActiveSeatsByTier, TIER_PRICE };

"use strict";

// ============================================================================
// lib/resellerBilling.js
// Apr 20, 2026 — Phase 2 WL Reseller Account Type
// Apr 21, 2026 — Step 9: transferCustomersToDirect now generates grace
//                        tokens, 30-day expiration, and sends churn emails.
// ============================================================================
// Reseller billing helpers using pg Pool (lib/db.js → { query, getClient, pool }).
// All DB calls use db.query(sql, params) with parameterized raw SQL.
//
// Depends on: migration 037 + 038, lib/resellerPlans.js, services/resellerEmail.js
// ============================================================================

const crypto = require('crypto');
const { getResellerTier, getNextResellerTier } = require('./resellerPlans');
const { sendResellerChurnTransferEmail } = require('../services/resellerEmail');

/** 30 days in milliseconds — grace window before auto-suspension. */
const GRACE_PERIOD_MS = 30 * 24 * 60 * 60 * 1000;

/** Generate a URL-safe random token (~256 bits of entropy). */
function generateGraceToken() {
  return crypto.randomBytes(32).toString('base64url');
}

/**
 * Count active (non-deleted) customer tenants under a reseller.
 */
async function getResellerCustomerCount(db, resellerId) {
  const { rows } = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM tenants
      WHERE reseller_id = $1 AND deleted_at IS NULL`,
    [resellerId]
  );
  return rows[0]?.count || 0;
}

/**
 * Throws RESELLER_AT_CAP if reseller cannot add another customer.
 */
async function validateCanAddCustomer(db, resellerRow) {
  if (!resellerRow || resellerRow.account_type !== 'reseller') {
    const err = new Error('Tenant is not a reseller');
    err.code = 'NOT_A_RESELLER';
    throw err;
  }

  const tier = getResellerTier(resellerRow.reseller_tier);

  if (tier.customer_limit === null) return; // scale = unlimited

  const currentCount = await getResellerCustomerCount(db, resellerRow.id);

  if (currentCount >= tier.customer_limit) {
    const nextTier = getNextResellerTier(tier.id);
    const err = new Error(
      `Reseller at customer cap (${currentCount}/${tier.customer_limit} on ${tier.name}). ` +
      (nextTier
        ? `Upgrade to ${nextTier.name} to add more customers.`
        : 'Contact support — you are on the highest tier.')
    );
    err.code = 'RESELLER_AT_CAP';
    err.statusCode = 402;
    err.current = currentCount;
    err.limit = tier.customer_limit;
    err.tier = tier.id;
    err.next_tier = nextTier ? nextTier.id : null;
    throw err;
  }
}

/**
 * Full tier/usage summary for a reseller's dashboard header.
 */
async function getResellerTierInfo(db, resellerRow) {
  if (!resellerRow || resellerRow.account_type !== 'reseller') {
    throw new Error('Tenant is not a reseller');
  }

  const tier = getResellerTier(resellerRow.reseller_tier);
  const customerCount = await getResellerCustomerCount(db, resellerRow.id);
  const limit = tier.customer_limit;
  const slotsRemaining = limit === null ? null : Math.max(0, limit - customerCount);
  const atCap = limit !== null && customerCount >= limit;
  const utilization = limit === null ? 0 : customerCount / limit;

  return {
    tier: tier.id,
    tier_name: tier.name,
    tier_tagline: tier.tagline,
    monthly_price_cents: tier.monthly_price_cents,
    annual_price_cents: tier.annual_price_cents,
    customer_count: customerCount,
    customer_limit: limit,
    slots_remaining: slotsRemaining,
    at_cap: atCap,
    utilization_pct: Math.round(utilization * 100),
    wholesale_rate_cents: tier.wholesale_rate_cents,
    next_tier: getNextResellerTier(tier.id),
  };
}

/**
 * Transfer all customers of a reseller to direct billing.
 *
 * Apr 21 Step 9 expansion: for each customer, this now ALSO:
 *   1. Generates a unique 32-byte base64url grace token
 *   2. Sets churn_grace_expires_at = now() + 30 days
 *   3. Preserves the originating reseller_id in churn_grace_originated_reseller_id
 *   4. Sends sendResellerChurnTransferEmail with the tokenized setup URL
 *
 * The DB flip + token/expiration fields are set in a SINGLE atomic UPDATE
 * per customer (inside a loop, not a bulk UPDATE, because each row needs a
 * DIFFERENT token). If a particular email send fails, we still return the
 * row in the transferred list — the caller gets visibility and can retry.
 *
 * Returns: array of transferred customer rows, each augmented with
 *   { grace_token, grace_expires_at, email_sent: boolean }
 *
 * Atomicity note: we don't use a transaction here because token generation
 * + per-row update + external email send don't benefit from it — if the
 * process crashes mid-loop, the already-updated rows are still in a valid
 * state (reseller_id=NULL + grace_token set), and the cron suspension logic
 * uses grace_expires_at as the authority regardless.
 */
async function transferCustomersToDirect(db, resellerId, options = {}) {
  const appUrl = options.appUrl || process.env.APP_URL || 'https://aifrontdeskhelper.com';

  // Load the reseller row for branding in the email — we need name, logo,
  // brand color, and primary_email for the "contact your reseller" footer.
  const { rows: resellerRows } = await db.query(
    `SELECT id, name, primary_email FROM tenants WHERE id = $1 LIMIT 1`,
    [resellerId]
  );
  const reseller = resellerRows[0];
  if (!reseller) {
    console.warn('[resellerBilling] transferCustomersToDirect: reseller not found', resellerId);
    return [];
  }

  // Snapshot customers BEFORE update (so caller can iterate)
  const { rows: customers } = await db.query(
    `SELECT id, name, primary_email, brand_mode, plan
       FROM tenants
      WHERE reseller_id = $1 AND deleted_at IS NULL`,
    [resellerId]
  );

  if (customers.length === 0) return [];

  const results = {
    attempted: customers.length,
    transferred: 0,
    failed: 0,
    emails_sent: 0,
    emails_failed: 0,
    customers: [],
    errors: [],
  };

  for (const customer of customers) {
    const graceToken = generateGraceToken();
    const graceExpires = new Date(Date.now() + GRACE_PERIOD_MS);
    // Atomic per-customer update: flip reseller fields + stamp grace window.
    // All in one UPDATE so the CHECK constraint tenants_reseller_billing_
    // consistency (reseller_id NULL ↔ billing_owner='direct') is never
    // violated mid-transaction.
    let updateRowCount = 0;
    try {
      const updateResult = await db.query(
        `UPDATE tenants
            SET reseller_id = NULL,
                billing_owner = 'direct',
                churn_grace_token = $2,
                churn_grace_expires_at = $3,
                churn_grace_originated_reseller_id = $4,
                updated_at = now()
          WHERE id = $1`,
        [customer.id, graceToken, graceExpires.toISOString(), resellerId]
      );
      updateRowCount = updateResult.rowCount || 0;
    } catch (err) {
      console.error(
        '[resellerBilling] Failed to flip customer %s during transfer: %s',
        customer.id,
        err.message
      );
      results.failed += 1;
      results.errors.push({ customer_id: customer.id, stage: 'db_update', error: err.message });
      results.customers.push({
        ...customer,
        grace_token: null,
        grace_expires_at: null,
        email_sent: false,
        transfer_error: err.message,
      });
      continue;
    }

    // Check rowCount even if no exception. UPDATE can return 0 rows if the
    // WHERE didn't match (race condition with concurrent delete) — that's a
    // failed transfer too, not a silent success.
    if (updateRowCount === 0) {
      console.error(
        '[resellerBilling] UPDATE matched 0 rows for customer %s — possible concurrent delete',
        customer.id
      );
      results.failed += 1;
      results.errors.push({ customer_id: customer.id, stage: 'db_update', error: 'UPDATE matched 0 rows' });
      continue;
    }

    results.transferred += 1;

    // Fire-and-log the email. Failures here don't roll back the DB flip —
    // the customer's data is already transferred, we just couldn't notify
    // them. Cron will still auto-suspend at day 30 regardless.
    const directBillingUrl = `${appUrl}/churn/setup-direct-billing/${graceToken}`;
    let emailSent = false;
    try {
      if (customer.primary_email) {
        const emailResult = await sendResellerChurnTransferEmail({
          to: customer.primary_email,
          customer_name: customer.name,
          reseller_name: reseller.name,
          direct_billing_url: directBillingUrl,
        });
        emailSent = !!(emailResult && emailResult.ok);
        if (emailSent) {
          results.emails_sent += 1;
        } else {
          results.emails_failed += 1;
          results.errors.push({
            customer_id: customer.id,
            stage: 'email_send',
            error: emailResult?.error || 'Resend returned non-ok',
          });
        }
      } else {
        console.warn(
          '[resellerBilling] Customer %s has no primary_email — skipping churn email. Manual outreach required.',
          customer.id
        );
        results.emails_failed += 1;
        results.errors.push({
          customer_id: customer.id,
          stage: 'email_send',
          error: 'no primary_email on tenant',
        });
      }
    } catch (err) {
      console.error(
        '[resellerBilling] Churn email send failed for customer %s: %s',
        customer.id,
        err.message
      );
      results.emails_failed += 1;
      results.errors.push({
        customer_id: customer.id,
        stage: 'email_send',
        error: err.message,
      });
    }

    results.customers.push({
      ...customer,
      grace_token: graceToken,
      grace_expires_at: graceExpires.toISOString(),
      direct_billing_url: directBillingUrl,
      email_sent: emailSent,
    });
  }

  // Derive an explicit ok flag so callers can't accidentally treat a partial
  // failure as success.
  results.ok = results.failed === 0;

  // Honest accounting — log all four counts so a partial failure is visible
  // (the original version logged transferred=results.length even when every
  // UPDATE failed, which is how the missing-column bug went silent for hours).
  console.log(
    '[resellerBilling] transferCustomersToDirect complete: reseller=%s attempted=%d transferred=%d failed=%d emails_sent=%d emails_failed=%d',
    resellerId,
    results.attempted,
    results.transferred,
    results.failed,
    results.emails_sent,
    results.emails_failed
  );

  if (results.errors.length > 0) {
    console.error(
      '[resellerBilling] transferCustomersToDirect errors (%d): %j',
      results.errors.length,
      results.errors
    );
  }

  return results;
}

/**
 * Clear grace token + expiration after a transferred customer successfully
 * sets up direct billing. Called from the Stripe webhook handler when
 * type='churn_direct_billing' checkout completes.
 */
async function completeChurnDirectBilling(db, tenantId, stripeCustomerId, stripeSubscriptionId) {
  await db.query(
    `UPDATE tenants
        SET stripe_customer_id = $2,
            stripe_subscription_id = $3,
            subscription_status = 'active',
            churn_grace_token = NULL,
            churn_grace_expires_at = NULL,
            updated_at = now()
      WHERE id = $1`,
    [tenantId, stripeCustomerId, stripeSubscriptionId]
  );
  console.log(
    '[resellerBilling] Churn direct-billing completed tenantId=%s stripeSubscriptionId=%s',
    tenantId,
    stripeSubscriptionId
  );
}

/**
 * Look up a tenant by their grace token. Used by the public churn route to
 * validate the token and fetch tenant + originating-reseller info for the
 * direct-billing setup page.
 *
 * Returns null if token is invalid or expired.
 */
async function findTenantByChurnGraceToken(db, token) {
  if (!token || typeof token !== 'string') return null;

  const { rows } = await db.query(
    `SELECT t.id, t.name, t.primary_email, t.phone, t.plan, t.brand_mode,
            t.churn_grace_expires_at, t.churn_grace_originated_reseller_id,
            r.name AS originating_reseller_name
       FROM tenants t
       LEFT JOIN tenants r ON r.id = t.churn_grace_originated_reseller_id
      WHERE t.churn_grace_token = $1
        AND t.deleted_at IS NULL
      LIMIT 1`,
    [token]
  );

  const tenant = rows[0];
  if (!tenant) return null;
  if (!tenant.churn_grace_expires_at) return null;

  const expiresAt = new Date(tenant.churn_grace_expires_at);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt < new Date()) {
    return { ...tenant, expired: true };
  }

  return { ...tenant, expired: false };
}

/**
 * Generate a URL-safe, human-readable reseller code (8 chars, unambiguous).
 */
function generateResellerCode() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

/**
 * Generate a unique reseller code, checking DB for collisions. Retries 5x.
 */
async function generateUniqueResellerCode(db) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateResellerCode();
    const { rows } = await db.query(
      `SELECT id FROM tenants WHERE reseller_code = $1 LIMIT 1`,
      [code]
    );
    if (rows.length === 0) return code;
  }
  throw new Error('Failed to generate unique reseller code after 5 attempts');
}

module.exports = {
  getResellerCustomerCount,
  validateCanAddCustomer,
  getResellerTierInfo,
  transferCustomersToDirect,
  completeChurnDirectBilling,
  findTenantByChurnGraceToken,
  generateResellerCode,
  generateUniqueResellerCode,
  GRACE_PERIOD_MS,
};

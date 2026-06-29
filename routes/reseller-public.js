"use strict";

// ============================================================================
// routes/reseller-public.js
// Apr 20, 2026 — Phase 2 WL Reseller Account Type (PUBLIC signup flow)
// ============================================================================
// Uses pg Pool (lib/db.js) with raw SQL. No auth required on these routes.
//
// Mount in server.js:
//   app.use('/reseller-public', require('./routes/reseller-public'));
//
// TODO Phase 2 hardening: add express-rate-limit middleware
// TODO Step 6: wire sendResellerCustomerWelcomeEmail + sendResellerNewCustomerNotification
// ============================================================================

const express = require('express');
const router = express.Router();

const db = require('../lib/db');
const { auditLog } = require('../lib/auditLogger');
const { validateCanAddCustomer } = require('../lib/resellerBilling');
const { buildTenantInsert } = require('../lib/tenantInsert');
const { normalizeE164Phone } = require('../lib/phone');
const {
  sendResellerCustomerWelcomeEmail,
  sendResellerNewCustomerNotification,
} = require('../services/resellerEmail');
const { notifyResellerNewCustomer } = require('../services/notifications');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function safeAuditLog(payload) {
  try {
    if (typeof auditLog === 'function') {
      await auditLog(db, payload);
    }
  } catch (err) {
    console.error('[reseller-public] audit log failed:', err.message);
  }
}

async function fetchResellerByCode(code) {
  const normalized = (code || '').toLowerCase().trim();
  if (!normalized) return null;

  try {
    const tenantInsert = buildTenantInsert(
      `SELECT * FROM tenants
        WHERE reseller_code = $1
          AND account_type = 'reseller'
          AND deleted_at IS NULL
        LIMIT 1`,
      [normalized]
    );
    return rows[0] || null;
  } catch (err) {
    console.error('[reseller-public] fetchResellerByCode error:', err);
    return null;
  }
}

function isResellerActive(reseller) {
  if (!reseller) return false;
  if (reseller.deleted_at) return false;
  if (reseller.account_type !== 'reseller') return false;

  if (reseller.subscription_status !== undefined && reseller.subscription_status !== null) {
    if (!['active', 'trialing'].includes(reseller.subscription_status)) return false;
  }
  if (reseller.is_suspended === true) return false;
  return true;
}

// ===========================================================================
// GET /reseller-public/:code
// Branded info for signup page
// ===========================================================================
router.get('/:code', async (req, res) => {
  try {
    const reseller = await fetchResellerByCode(req.params.code);
    if (!reseller) {
      return res.status(404).json({
        error: 'Reseller not found',
        code: 'RESELLER_NOT_FOUND',
      });
    }

    const active = isResellerActive(reseller);

    let atCap = false;
    if (active) {
      try {
        await validateCanAddCustomer(db, reseller);
      } catch (err) {
        if (err.code === 'RESELLER_AT_CAP') atCap = true;
      }
    }

    return res.json({
      reseller: {
        name: reseller.name,
        reseller_code: reseller.reseller_code,
        brand_mode: reseller.brand_mode || 'default',
        brand_color: reseller.brand_color || null,
        accent_color: reseller.accent_color || null,
        logo_url: reseller.logo_url || null,
        favicon_url: reseller.favicon_url || null,
      },
      accepting_signups: active && !atCap,
      at_cap: atCap,
      inactive: !active,
    });
  } catch (err) {
    console.error('[reseller-public/:code:get]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ===========================================================================
// POST /reseller-public/:code/signup
// Customer self-onboards under this reseller
// ===========================================================================
router.post('/:code/signup', async (req, res) => {
  const { business_name, primary_email, phone } = req.body || {};

  if (!business_name || !primary_email) {
    return res.status(400).json({
      error: 'business_name and primary_email are required',
      code: 'MISSING_FIELDS',
    });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(primary_email)) {
    return res.status(400).json({
      error: 'Invalid email format',
      code: 'INVALID_EMAIL',
    });
  }

  const trimmedName = String(business_name).trim();
  if (trimmedName.length < 2 || trimmedName.length > 100) {
    return res.status(400).json({
      error: 'business_name must be 2-100 characters',
      code: 'INVALID_NAME',
    });
  }

  try {
    const reseller = await fetchResellerByCode(req.params.code);
    if (!reseller) {
      return res.status(404).json({
        error: 'Reseller not found',
        code: 'RESELLER_NOT_FOUND',
      });
    }

    if (!isResellerActive(reseller)) {
      return res.status(403).json({
        error: 'This reseller is not currently accepting signups',
        code: 'RESELLER_INACTIVE',
      });
    }

    await validateCanAddCustomer(db, reseller);

    // Duplicate email check
    const normalizedEmail = primary_email.toLowerCase().trim();
    const { rows: existingRows } = await db.query(
      `SELECT id FROM tenants
        WHERE primary_email = $1 AND deleted_at IS NULL
        LIMIT 1`,
      [normalizedEmail]
    );
    if (existingRows.length > 0) {
      return res.status(409).json({
        error: 'An account with this email already exists. Please log in or use a different email.',
        code: 'EMAIL_EXISTS',
      });
    }

   // Create customer tenant. tenants.slug + company_name are NOT NULL,
    // so generate a unique slug from the business name and default
    // company_name to the same value (mirrors routes/reseller.js fix).
    const brandMode = reseller.brand_mode || 'ai_branded';

    let baseSlug = trimmedName.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '');
    if (!baseSlug) baseSlug = `customer-${Date.now()}`;

    let slug = baseSlug;
    let attempt = 1;
    while (attempt < 20) {
      const existing = await db.query(
        'SELECT id FROM tenants WHERE slug = $1',
        [slug]
      );
      if (existing.rows.length === 0) break;
      slug = `${baseSlug}-${attempt}`;
      attempt++;
    }
    if (attempt >= 20) {
      return res.status(409).json({
        error: 'Could not generate a unique account identifier. Try a different business name.',
        code: 'SLUG_COLLISION',
      });
    }

    const tenantInsert = buildTenantInsert(
      {
        name: trimmedName,
        slug,
        company_name: trimmedName,
        primary_email: normalizedEmail,
        phone: normalizeE164Phone(phone) || (phone ? String(phone).trim() : null),
        plan: 'basic',
        account_type: 'customer',
        reseller_id: reseller.id,
        billing_owner: 'reseller',
        brand_mode: brandMode,
        stripe_customer_id: null,
        stripe_subscription_id: null,
      },
      'id, name, primary_email'
    );
    const { rows } = await db.query(tenantInsert.sql, tenantInsert.values);
    const created = rows[0];

    await safeAuditLog({
      action: 'reseller.customer.self_signup',
      actor_id: null,
      tenant_id: reseller.id,
      target_type: 'tenant',
      target_id: created.id,
      details: {
        customer_name: trimmedName,
        customer_email: normalizedEmail,
        via: 'public_signup',
        reseller_code: req.params.code,
        ip: req.ip || req.headers['x-forwarded-for'] || null,
        user_agent: req.headers['user-agent'] || null,
      },
    });

   // Send welcome email to the customer with password-set link.
    // Fire-and-forget so a Resend outage doesn't block the signup response.
    const appUrl = (process.env.APP_URL || 'https://aifrontdeskhelper.com').replace(/\/+$/, '');
    sendResellerCustomerWelcomeEmail({
      to: normalizedEmail,
      customer_name: trimmedName,
      reseller_name: reseller.name,
      reseller_contact_email: reseller.primary_email || 'support@aifrontdeskhelper.com',
      reseller_brand_color: reseller.brand_color,
      reseller_logo_url: reseller.logo_url,
      set_password_url: `${appUrl}/reset-password?email=${encodeURIComponent(normalizedEmail)}`,
    }).catch((err) =>
      console.error('[reseller-public/signup] welcome email failed:', err.message)
    );

   // Notify the reseller via in-app bell + email. Both fire-and-forget so
    // a Resend outage or notifications table issue never blocks signup.
    notifyResellerNewCustomer(reseller.id, {
      customer_tenant_id: created.id,
      customer_name: trimmedName,
      customer_email: normalizedEmail,
      via: 'public_signup',
    }).catch((err) =>
      console.error('[reseller-public/signup] bell notification failed:', err.message)
    );

    if (reseller.primary_email) {
      sendResellerNewCustomerNotification({
        to: reseller.primary_email,
        reseller_name: reseller.name,
        customer_name: trimmedName,
        customer_email: normalizedEmail,
        customer_phone: phone ? String(phone).trim() : null,
      }).catch((err) =>
        console.error('[reseller-public/signup] reseller notification email failed:', err.message)
      );
    }

    return res.status(201).json({
      success: true,
      message: 'Account created. Check your email to set your password and log in.',
      customer: {
        id: created.id,
        name: created.name,
        primary_email: created.primary_email,
      },
    });
  } catch (err) {
    if (err.code === 'RESELLER_AT_CAP') {
      return res.status(402).json({
        error: 'This reseller is not currently accepting new signups. Please contact them directly.',
        code: 'RESELLER_AT_CAP',
      });
    }
    console.error('[reseller-public/:code/signup]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;

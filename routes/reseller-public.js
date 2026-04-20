"use strict";

// ============================================================================
// routes/reseller-public.js
// Apr 20, 2026 — Phase 2 WL Reseller Account Type (PUBLIC signup flow)
// ============================================================================
// Mount in server.js:
//   app.use('/reseller-public', require('./routes/reseller-public'));
//
// Endpoints (NO auth required):
//   GET  /reseller-public/:code           → branded info for signup page
//   POST /reseller-public/:code/signup    → customer self-onboards
//
// Depends on: migration 037, lib/resellerBilling.js
//
// TODO Phase 2 hardening: add express-rate-limit middleware
// TODO Step 5: wire sendResellerCustomerWelcomeEmail (with password-set link)
//              and sendResellerNewCustomerNotification into services/email.js
// ============================================================================

const express = require('express');
const router = express.Router();

const db = require('../lib/db');
const { auditLog } = require('../lib/auditLogger');
const { validateCanAddCustomer } = require('../lib/resellerBilling');

// ---------------------------------------------------------------------------
// Helper: safe audit log (never blocks the main request)
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

// ---------------------------------------------------------------------------
// Helper: fetch reseller by code (case-insensitive, status-validated)
// ---------------------------------------------------------------------------
async function fetchResellerByCode(code) {
  const normalized = (code || '').toLowerCase().trim();
  if (!normalized) return null;

  const { data, error } = await db
    .from('tenants')
    .select('*')
    .eq('reseller_code', normalized)
    .eq('account_type', 'reseller')
    .is('deleted_at', null)
    .maybeSingle();

  if (error) {
    console.error('[reseller-public] fetchResellerByCode error:', error);
    return null;
  }
  return data;
}

// ---------------------------------------------------------------------------
// Helper: is reseller accepting signups?
// ---------------------------------------------------------------------------
function isResellerActive(reseller) {
  if (!reseller) return false;
  if (reseller.deleted_at) return false;
  if (reseller.account_type !== 'reseller') return false;

  // If subscription_status column exists, require active or trialing.
  // If column doesn't exist (undefined on row), treat as active (grandfather).
  if (reseller.subscription_status !== undefined && reseller.subscription_status !== null) {
    const ok = ['active', 'trialing'].includes(reseller.subscription_status);
    if (!ok) return false;
  }

  // Same for is_suspended if present
  if (reseller.is_suspended === true) return false;

  return true;
}

// ===========================================================================
// GET /reseller-public/:code
// Public branded info for the signup page
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

    // Check cap without throwing
    let atCap = false;
    if (active) {
      try {
        await validateCanAddCustomer(db, reseller);
      } catch (err) {
        if (err.code === 'RESELLER_AT_CAP') {
          atCap = true;
        }
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
// Create a new customer tenant under this reseller (public self-signup)
// ===========================================================================
router.post('/:code/signup', async (req, res) => {
  const { business_name, primary_email, phone } = req.body || {};

  // -------------------------------------------------------------------------
  // Input validation
  // -------------------------------------------------------------------------
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
    // 1. Look up reseller
    const reseller = await fetchResellerByCode(req.params.code);
    if (!reseller) {
      return res.status(404).json({
        error: 'Reseller not found',
        code: 'RESELLER_NOT_FOUND',
      });
    }

    // 2. Validate reseller active
    if (!isResellerActive(reseller)) {
      return res.status(403).json({
        error: 'This reseller is not currently accepting signups',
        code: 'RESELLER_INACTIVE',
      });
    }

    // 3. Validate tier cap
    await validateCanAddCustomer(db, reseller);

    // 4. Duplicate email check
    const { data: existing, error: dupErr } = await db
      .from('tenants')
      .select('id')
      .eq('primary_email', primary_email)
      .is('deleted_at', null)
      .maybeSingle();
    if (dupErr && dupErr.code !== 'PGRST116') throw dupErr;
    if (existing) {
      return res.status(409).json({
        error: 'An account with this email already exists. Please log in or use a different email.',
        code: 'EMAIL_EXISTS',
      });
    }

    // 5. Create customer tenant
    const newTenant = {
      name: trimmedName,
      primary_email: primary_email.toLowerCase().trim(),
      phone: phone ? String(phone).trim() : null,
      plan: 'growth', // TODO: allow reseller to set default_customer_plan
      account_type: 'customer',
      reseller_id: reseller.id,
      billing_owner: 'reseller',
      brand_mode: reseller.brand_mode || 'default', // cascade reseller brand
      stripe_customer_id: null,
      stripe_subscription_id: null,
    };

    const { data: created, error: insertErr } = await db
      .from('tenants')
      .insert(newTenant)
      .select()
      .single();
    if (insertErr) throw insertErr;

    // 6. Audit log
    await safeAuditLog({
      action: 'reseller.customer.self_signup',
      actor_id: null,
      tenant_id: reseller.id,
      target_type: 'tenant',
      target_id: created.id,
      details: {
        customer_name: trimmedName,
        customer_email: newTenant.primary_email,
        via: 'public_signup',
        reseller_code: req.params.code,
        ip: req.ip || req.headers['x-forwarded-for'] || null,
        user_agent: req.headers['user-agent'] || null,
      },
    });

    // 7. TODO Step 5 emails:
    //    - sendResellerCustomerWelcomeEmail (to customer, with password-set link)
    //    - sendResellerNewCustomerNotification (to reseller)
    console.log(
      `[reseller-public/signup] TODO emails: welcome ${newTenant.primary_email}, notify reseller ${reseller.primary_email}`
    );

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

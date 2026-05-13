"use strict";

/**
 * routes/publicBranding.js
 *
 * Public endpoint (NO AUTH) — returns a tenant's branding from a hostname.
 * Used by the frontend on app mount when it detects it's loaded from a
 * custom domain, so the login page renders with the tenant's logo,
 * company name, and brand color BEFORE the user has a JWT.
 *
 * Endpoints:
 *
 *   GET /api/public/branding/by-hostname?host=app.paragonext.com
 *     Returns: {
 *       tenant_id, custom_domain, company_name,
 *       brand_color, accent_color, logo_url, favicon_url, support_email
 *     }
 *     Returns 404 if the hostname isn't an active custom domain.
 *
 * Tenant resolution priority:
 *   1. req.tenantFromHost (set by lib/hostnameResolver if request came
 *      directly to the custom domain — webhooks, future API proxying)
 *   2. req.query.host (frontend explicitly passes its window.location.hostname)
 *
 * CRITICAL: only return branding-safe public fields. NEVER expose
 * api_key, twilio creds, facebook tokens, internal flags, or anything
 * that would let an unauthenticated caller learn about the tenant's setup.
 *
 * May 13, 2026 — Phase 7 V2 white-label DNS, Step 5b.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");

router.get("/by-hostname", async (req, res) => {
  let tenant = req.tenantFromHost;

  // Fallback: explicit ?host= query param. This is the working path
  // today since the frontend calls the API from a different origin
  // than the custom domain.
  if (!tenant && req.query.host) {
    const host = String(req.query.host).toLowerCase().trim();
    if (!host) {
      return res.status(400).json({ error: "host query param is empty" });
    }
    try {
      const result = await db.query(
        `SELECT id, custom_domain, company_name, name, brand_color,
                accent_color, logo_url, favicon_url, support_email
           FROM tenants
          WHERE custom_domain = $1
            AND custom_domain_status = 'active'
          LIMIT 1`,
        [host]
      );
      if (result.rows.length > 0) {
        tenant = result.rows[0];
      }
    } catch (err) {
      console.error("[publicBranding] DB error host=%s err=%s",
        req.query.host, err.message);
      return res.status(500).json({ error: "Lookup failed" });
    }
  }

  if (!tenant) {
    return res.status(404).json({ error: "Unknown hostname" });
  }

  // Return ONLY branding-safe public fields. This response is visible
  // to anyone who guesses a tenant's custom domain — keep it tight.
  return res.json({
    tenant_id:     tenant.id,
    custom_domain: tenant.custom_domain,
    company_name:  tenant.company_name || tenant.name || null,
    brand_color:   tenant.brand_color || "#E8600A",
    accent_color:  tenant.accent_color || null,
    logo_url:      tenant.logo_url || null,
    favicon_url:   tenant.favicon_url || null,
    support_email: tenant.support_email || null,
  });
});

module.exports = router;

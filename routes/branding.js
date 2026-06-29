"use strict";

/**
 * routes/branding.js
 *
 * White-label custom domain configuration (May 13, 2026).
 *
 * Lets any tenant with brand_mode='white_label' configure a branded
 * dashboard URL (e.g. app.paragonext.com) that routes to their tenant.
 * Three operations: submit a desired domain, verify the CNAME is
 * pointing correctly, disconnect.
 *
 * Endpoints:
 *
 *   GET /api/branding/custom-domain
 *     Returns the tenant's current custom domain config:
 *     { custom_domain, custom_domain_status, custom_domain_verified_at,
 *       cname_target }. Frontend uses this to render the right UI state.
 *
 *   POST /api/branding/custom-domain
 *     Body: { hostname: "app.paragonext.com" }
 *     Saves the desired hostname, sets status='pending', returns the
 *     CNAME target the tenant needs to create in their DNS provider.
 *
 *   POST /api/branding/custom-domain/verify
 *     Does a DNS lookup on the saved hostname. If the CNAME resolves
 *     to our dashboard host, marks the domain as 'active'. Otherwise
 *     marks it as 'failed' so the tenant can retry.
 *
 *   DELETE /api/branding/custom-domain
 *     Disconnects — clears all three custom_domain* columns. Hostname
 *     becomes available for another tenant to claim if they want it.
 *
 * Restrictions:
 *   - Only tenants with brand_mode='white_label' can configure a domain.
 *     Others get 403. Aligns with the May 12 white-label policy: DNS is
 *     a white-label entitlement, not a plan entitlement.
 *   - Hostnames must be valid subdomains (e.g. app.paragonext.com), not
 *     apex domains (paragonext.com). Apex support is intentionally
 *     deferred — different DNS record types, more edge cases, not worth
 *     it for V1.
 *   - One tenant per hostname enforced by the partial unique index on
 *     tenants.custom_domain WHERE status='active'.
 */

const express = require("express");
const router  = express.Router();
const dns     = require("dns").promises;
const db      = require("../lib/db");

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// The hostname tenants point their CNAME at. This is your dashboard's primary
// hostname on Render. When tenants ask "what do I put in my DNS provider?"
// the answer is "a CNAME pointing at this."
const DASHBOARD_CNAME_TARGET = process.env.DASHBOARD_CNAME_TARGET
  || "app.aifrontdeskhelper.com";

// Hostname format validation. Valid examples: app.paragonext.com, dash.foo.io.
// Invalid: bare apex (paragonext.com), IPs, paths, ports, anything with
// special chars beyond letters/digits/hyphens/dots.
//
// Rules enforced:
//   - At least 3 labels (subdomain.domain.tld) — rules out apex domains
//   - Each label 1-63 chars, alphanumeric + hyphens (no leading/trailing hyphen)
//   - Total length under 253 chars (DNS spec)
//   - No protocol prefix, no trailing dot, no path
const HOSTNAME_REGEX = /^(?=.{1,253}$)(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-)){2,}$/i;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/branding/custom-domain
// Read the tenant's current custom domain config for UI rendering.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/custom-domain", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const result = await db.query(
      `SELECT
         custom_domain,
         custom_domain_status,
         custom_domain_verified_at,
         brand_mode
       FROM tenants
       WHERE id = $1`,
      [tenantId]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    // Surface gating info to the frontend so it can hide/show the section
    // appropriately. We don't return the upgrade CTA here — that's the
    // frontend's job based on this flag.
    res.json({
      custom_domain: row.custom_domain,
      custom_domain_status: row.custom_domain_status,
      custom_domain_verified_at: row.custom_domain_verified_at,
      cname_target: DASHBOARD_CNAME_TARGET,
      is_white_label: row.brand_mode === "white_label",
    });
  } catch (err) {
    console.error("[Branding] GET custom-domain failed tenant=%s err=%s",
      tenantId, err.message);
    res.status(500).json({ error: "Failed to load custom domain config" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/branding/custom-domain
// Tenant submits their desired hostname. Saved as 'pending' until verified.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/custom-domain", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { hostname } = req.body || {};

  // ─── Validation ─────────────────────────────────────────────────────────
  if (!hostname || typeof hostname !== "string") {
    return res.status(400).json({ error: "hostname is required" });
  }

  const normalized = hostname.trim().toLowerCase();

  if (!HOSTNAME_REGEX.test(normalized)) {
    return res.status(400).json({
      error: "Invalid hostname. Use a subdomain like app.yourbrand.com — apex domains (yourbrand.com directly) aren't supported."
    });
  }

  // Reserved hostnames the tenant cannot claim — protects our own infra.
  const reserved = [
    "app.aifrontdeskhelper.com",
    "aifrontdeskhelper.com",
    "www.aifrontdeskhelper.com",
    "api.aifrontdeskhelper.com",
  ];
  if (reserved.includes(normalized)) {
    return res.status(400).json({ error: "This hostname is reserved." });
  }

  try {
    // ─── White-label gate ────────────────────────────────────────────────
    // Custom domain is a white-label entitlement. Non-WL tenants get 403.
    const tenantCheck = await db.query(
      `SELECT brand_mode FROM tenants WHERE id = $1`,
      [tenantId]
    );
    if (tenantCheck.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    if (tenantCheck.rows[0].brand_mode !== "white_label") {
      return res.status(403).json({
        error: "Custom domains are available on white-label plans only."
      });
    }

    // ─── Conflict check ──────────────────────────────────────────────────
    // Is another tenant already using this hostname as 'active'?
    // The partial unique index will catch this on insert too, but
    // failing here gives a cleaner error message.
    const conflict = await db.query(
      `SELECT id FROM tenants
        WHERE custom_domain = $1
          AND custom_domain_status = 'active'
          AND id <> $2`,
      [normalized, tenantId]
    );
    if (conflict.rows.length > 0) {
      return res.status(409).json({
        error: "This hostname is already in use by another tenant."
      });
    }

    // ─── Save ────────────────────────────────────────────────────────────
    // Always reset status to 'pending' when a new hostname is saved, even
    // if the tenant is changing from an already-active domain. They have
    // to re-verify any change.
    await db.query(
      `UPDATE tenants
          SET custom_domain = $1,
              custom_domain_status = 'pending',
              custom_domain_verified_at = NULL,
              updated_at = NOW()
        WHERE id = $2`,
      [normalized, tenantId]
    );

    console.log("[Branding] Custom domain saved as pending tenant=%s hostname=%s",
      tenantId, normalized);

    res.json({
      custom_domain: normalized,
      custom_domain_status: "pending",
      cname_target: DASHBOARD_CNAME_TARGET,
      instructions: {
        record_type: "CNAME",
        host: normalized,
        target: DASHBOARD_CNAME_TARGET,
        ttl: 3600,
        note: "Add this CNAME in your domain provider's DNS settings, then click Verify. DNS propagation usually takes 5-15 minutes."
      },
    });
  } catch (err) {
    console.error("[Branding] POST custom-domain failed tenant=%s err=%s",
      tenantId, err.message);
    res.status(500).json({ error: "Failed to save custom domain" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/branding/custom-domain/verify
// Tenant clicks "Verify" — we do a DNS lookup and confirm the CNAME points
// where it should. On success, status flips to 'active' and the domain
// becomes routable.
// ─────────────────────────────────────────────────────────────────────────────
router.post("/custom-domain/verify", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    // ─── Load the pending domain ─────────────────────────────────────────
    const result = await db.query(
      `SELECT custom_domain, custom_domain_status, brand_mode
         FROM tenants
        WHERE id = $1`,
      [tenantId]
    );

    const row = result.rows[0];
    if (!row) {
      return res.status(404).json({ error: "Tenant not found" });
    }
    if (row.brand_mode !== "white_label") {
      return res.status(403).json({
        error: "Custom domains are available on white-label plans only."
      });
    }
    if (!row.custom_domain) {
      return res.status(400).json({
        error: "No custom domain configured. Submit a hostname first."
      });
    }

    const hostname = row.custom_domain;

    // ─── Mark as verifying so concurrent verify clicks don't dogpile ────
    await db.query(
      `UPDATE tenants
          SET custom_domain_status = 'verifying',
              updated_at = NOW()
        WHERE id = $1`,
      [tenantId]
    );

    // ─── DNS lookup ──────────────────────────────────────────────────────
    // dns.resolveCname returns an array of CNAME targets. A correctly
    // configured custom domain should resolve to exactly one CNAME
    // pointing at our dashboard host.
    let cnames = [];
    try {
      cnames = await dns.resolveCname(hostname);
    } catch (dnsErr) {
      // ENOTFOUND or ENODATA means CNAME doesn't exist yet (propagation
      // pending or tenant forgot to create it). NXDOMAIN means the
      // hostname doesn't resolve at all.
      console.warn("[Branding] DNS lookup failed tenant=%s hostname=%s err=%s",
        tenantId, hostname, dnsErr.code || dnsErr.message);

      await db.query(
        `UPDATE tenants
            SET custom_domain_status = 'failed',
                updated_at = NOW()
          WHERE id = $1`,
        [tenantId]
      );

      return res.status(200).json({
        verified: false,
        status: "failed",
        reason: dnsErr.code === "ENOTFOUND" || dnsErr.code === "ENODATA"
          ? "CNAME record not found. Either DNS hasn't propagated yet (wait 5-15 min and retry) or the record hasn't been created in your DNS provider."
          : "DNS lookup failed: " + (dnsErr.code || dnsErr.message),
      });
    }

    // ─── Verify the CNAME target matches ─────────────────────────────────
    // Be forgiving: some DNS providers append trailing dots, some don't.
    // Normalize both sides before comparing.
    const expectedTarget = DASHBOARD_CNAME_TARGET.toLowerCase().replace(/\.$/, "");
    const actualTargets = cnames.map(c => c.toLowerCase().replace(/\.$/, ""));

    const matches = actualTargets.includes(expectedTarget);

    if (!matches) {
      console.warn("[Branding] CNAME mismatch tenant=%s hostname=%s expected=%s actual=%s",
        tenantId, hostname, expectedTarget, actualTargets.join(","));

      await db.query(
        `UPDATE tenants
            SET custom_domain_status = 'failed',
                updated_at = NOW()
          WHERE id = $1`,
        [tenantId]
      );

      return res.status(200).json({
        verified: false,
        status: "failed",
        reason: `CNAME points to "${actualTargets[0] || "(empty)"}" but should point to "${expectedTarget}". Update your DNS record and try again.`,
      });
    }

    // ─── Success — activate the domain ───────────────────────────────────
    await db.query(
      `UPDATE tenants
          SET custom_domain_status = 'active',
              custom_domain_verified_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [tenantId]
    );

    console.log("[Branding] Custom domain verified tenant=%s hostname=%s",
      tenantId, hostname);

    res.json({
      verified: true,
      status: "active",
      custom_domain: hostname,
      verified_at: new Date().toISOString(),
      note: "Your custom domain is now live. Note: SSL certificates are provisioned automatically by Render and may take a few minutes to be issued — your browser may show an SSL warning during that window.",
    });
  } catch (err) {
    console.error("[Branding] verify failed tenant=%s err=%s",
      tenantId, err.message);
    res.status(500).json({ error: "Verification failed: " + err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/branding/custom-domain
// Disconnect. Clears all three custom_domain* columns. The hostname
// becomes available for re-use immediately.
// ─────────────────────────────────────────────────────────────────────────────
router.delete("/custom-domain", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    const result = await db.query(
      `UPDATE tenants
          SET custom_domain = NULL,
              custom_domain_status = NULL,
              custom_domain_verified_at = NULL,
              updated_at = NOW()
        WHERE id = $1
        RETURNING custom_domain`,
      [tenantId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Tenant not found" });
    }

    console.log("[Branding] Custom domain disconnected tenant=%s", tenantId);

    res.json({ disconnected: true });
  } catch (err) {
    console.error("[Branding] DELETE failed tenant=%s err=%s",
      tenantId, err.message);
    res.status(500).json({ error: "Failed to disconnect custom domain" });
  }
});

module.exports = router;

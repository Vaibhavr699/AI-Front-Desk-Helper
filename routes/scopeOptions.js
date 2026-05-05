"use strict";

/**
 * routes/scopeOptions.js
 *
 * Owner-facing scope toggle config (Phase V2, May 5, 2026).
 *
 * Backs the "Standard Scope" tab in tenant Settings. Two endpoints:
 *
 *   GET  /api/scope-options
 *     Returns the list of services this tenant offers, with each service's
 *     available toggles + the tenant's current chosen state. Catalog comes
 *     from vertical_scope_options; tenant overrides come from
 *     tenant_service_scope_options. If a tenant hasn't touched a toggle yet,
 *     `enabled` reflects the catalog's `default_enabled`.
 *
 *   PUT  /api/scope-options
 *     Bulk upsert of toggle state. Body: { changes: [{ service_id, option_key, enabled }, ...] }.
 *     Uses ON CONFLICT to handle both first-time and update writes. Wraps
 *     the batch in a transaction so a partial failure rolls back cleanly.
 *
 * Auth: assumes a `requireAuth`-style middleware ahead of this router that
 * sets req.tenantId. Mirror whatever pattern your other tenant-scoped
 * routes use (e.g. routes/dashboard.js). The x-impersonate-tenant-id header
 * already-fixed chokepoint should populate req.tenantId correctly for both
 * regular and superadmin contexts.
 *
 * Security notes:
 *   - All writes are scoped to req.tenantId — caller can't mutate another
 *     tenant's options even if they pass a different ID in the body.
 *   - Validates that each (service_id, option_key) exists in the catalog
 *     before upserting, so junk inputs don't leave orphan rows.
 *   - vertical_service_id is also implicitly scoped to the tenant's vertical
 *     via the GET join, so the frontend never sees IDs from other verticals.
 */

const express = require("express");
const router  = express.Router();
const db      = require("../lib/db");

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/scope-options
// Returns services + toggles + current state for the calling tenant.
// ─────────────────────────────────────────────────────────────────────────────
router.get("/", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  try {
    // 1. Get the tenant's vertical_id and the services in that vertical.
    //    We join through tenants so we never return services from a vertical
    //    this tenant doesn't belong to.
    const servicesResult = await db.query(
      `SELECT
         vs.id           AS service_id,
         vs.service_slug AS service_slug
       FROM vertical_services vs
       JOIN tenants t ON t.vertical_id = vs.vertical_id
       WHERE t.id = $1
       ORDER BY vs.id`,
      [tenantId]
    );

    if (servicesResult.rows.length === 0) {
      // Tenant has no vertical set, or no services in their vertical.
      // Frontend handles this with an empty-state message.
      return res.json({ services: [] });
    }

    const services = servicesResult.rows;
    const serviceIds = services.map(s => s.service_id);

    // 2. Get all available options for these services + the tenant's overrides
    //    (LEFT JOIN — most options will have no override yet).
    const optionsResult = await db.query(
      `SELECT
         vso.vertical_service_id    AS service_id,
         vso.option_key             AS option_key,
         vso.display_label          AS display_label,
         vso.default_enabled        AS default_enabled,
         vso.affects_includes_text  AS affects_includes_text,
         vso.modifier_type          AS modifier_type,
         vso.price_modifier_default AS price_modifier_default,
         vso.display_order          AS display_order,
         tso.enabled                AS tenant_enabled,
         tso.price_modifier_override AS price_modifier_override
       FROM vertical_scope_options vso
       LEFT JOIN tenant_service_scope_options tso
         ON tso.vertical_service_id = vso.vertical_service_id
        AND tso.option_key          = vso.option_key
        AND tso.tenant_id           = $1
       WHERE vso.vertical_service_id = ANY($2::int[])
       ORDER BY vso.vertical_service_id, vso.display_order`,
      [tenantId, serviceIds]
    );

    // 3. Group options by service_id.
    const byService = {};
    services.forEach(s => {
      byService[s.service_id] = {
        service_id: s.service_id,
        service_slug: s.service_slug,
        options: [],
      };
    });

    optionsResult.rows.forEach(row => {
      // If the tenant has a row in tenant_service_scope_options, use it;
      // otherwise fall back to catalog default.
      const enabled = row.tenant_enabled !== null && row.tenant_enabled !== undefined
        ? row.tenant_enabled
        : row.default_enabled;

      const priceModifier = row.price_modifier_override !== null
        ? row.price_modifier_override
        : row.price_modifier_default;

      byService[row.service_id]?.options.push({
        option_key: row.option_key,
        display_label: row.display_label,
        enabled,
        default_enabled: row.default_enabled,
        affects_includes_text: row.affects_includes_text,
        modifier_type: row.modifier_type,
        price_modifier: priceModifier !== null ? Number(priceModifier) : null,
        display_order: row.display_order,
      });
    });

    res.json({ services: Object.values(byService) });
  } catch (err) {
    console.error("[ScopeOptions] GET failed tenant=%s err=%s", tenantId, err.message);
    res.status(500).json({ error: "Failed to load scope options" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/scope-options
// Bulk upsert. Body: { changes: [{ service_id, option_key, enabled }, ...] }
// ─────────────────────────────────────────────────────────────────────────────
router.put("/", async (req, res) => {
  const tenantId = req.tenantId || req.user?.tenant_id;
  if (!tenantId) {
    return res.status(401).json({ error: "Not authenticated" });
  }

  const { changes } = req.body || {};
  if (!Array.isArray(changes)) {
    return res.status(400).json({ error: "changes must be an array" });
  }
  if (changes.length === 0) {
    return res.json({ ok: true, updated: 0 });
  }
  if (changes.length > 100) {
    // Defensive — the UI sends at most ~20 toggles. A 100+ payload is
    // either a bug or an attack.
    return res.status(400).json({ error: "Too many changes in one request" });
  }

  // Quick-validate shape before touching the DB.
  for (const c of changes) {
    if (typeof c !== "object" || c === null) {
      return res.status(400).json({ error: "Each change must be an object" });
    }
    if (!Number.isInteger(c.service_id)) {
      return res.status(400).json({ error: "service_id must be an integer" });
    }
    if (typeof c.option_key !== "string" || c.option_key.length === 0) {
      return res.status(400).json({ error: "option_key must be a non-empty string" });
    }
    if (typeof c.enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }
  }

  // Use a transaction so partial failures don't leave the toggles in a
  // half-applied state.
  const client = await db.pool.connect();
  let applied = 0;
  try {
    await client.query("BEGIN");

    // Tenant-vertical scope guard: make sure each service_id belongs to
    // this tenant's vertical. Single query, returns the valid IDs.
    const guardResult = await client.query(
      `SELECT vs.id
         FROM vertical_services vs
         JOIN tenants t ON t.vertical_id = vs.vertical_id
        WHERE t.id = $1
          AND vs.id = ANY($2::int[])`,
      [tenantId, changes.map(c => c.service_id)]
    );
    const validServiceIds = new Set(guardResult.rows.map(r => r.id));

    for (const c of changes) {
      if (!validServiceIds.has(c.service_id)) {
        // Silently skip — could be a stale UI state or a tenant trying to
        // set options for a service outside their vertical. Don't 400 the
        // whole batch; just log and continue.
        console.warn("[ScopeOptions] PUT skipping out-of-vertical service tenant=%s service=%s",
          tenantId, c.service_id);
        continue;
      }

      // Validate the option exists in the catalog. Skip if not — frontend
      // shouldn't send junk, but we don't trust input.
      const validOption = await client.query(
        `SELECT 1 FROM vertical_scope_options
          WHERE vertical_service_id = $1 AND option_key = $2`,
        [c.service_id, c.option_key]
      );
      if (validOption.rows.length === 0) {
        console.warn("[ScopeOptions] PUT skipping unknown option tenant=%s service=%s key=%s",
          tenantId, c.service_id, c.option_key);
        continue;
      }

      await client.query(
        `INSERT INTO tenant_service_scope_options
           (tenant_id, vertical_service_id, option_key, enabled, updated_at)
         VALUES ($1, $2, $3, $4, now())
         ON CONFLICT (tenant_id, vertical_service_id, option_key)
         DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
        [tenantId, c.service_id, c.option_key, c.enabled]
      );
      applied += 1;
    }

    await client.query("COMMIT");
    console.log("[ScopeOptions] PUT applied=%d tenant=%s", applied, tenantId);
    res.json({ ok: true, updated: applied });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("[ScopeOptions] PUT failed tenant=%s err=%s", tenantId, err.message);
    res.status(500).json({ error: "Failed to save scope options" });
  } finally {
    client.release();
  }
});

module.exports = router;

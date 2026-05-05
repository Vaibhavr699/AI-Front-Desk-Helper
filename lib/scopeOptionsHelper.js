"use strict";

/**
 * lib/scopeOptionsHelper.js
 *
 * Owner scope toggles → estimator pricing & "What's included" text.
 * Phase V2 (May 5, 2026).
 *
 * PUBLIC API:
 *
 *   applyScopeToQuote({ tenantId, verticalServiceId, basePrice, context })
 *      ── ONE-CALL CONVENIENCE WRAPPER ──
 *      Async. Does everything: fetches tenant scope state, applies pricing
 *      modifiers, builds customer-facing "What's included" string. Returns
 *      a flat object ready to spread into your res.json().
 *
 *      Use this in routes/estimator.js. It's the only function the
 *      estimator route should ever need to call.
 *
 *   getTenantScopeOptions(tenantId, verticalServiceId)
 *      Async. Lower-level: fetches scope state. Use directly only if you
 *      need to inspect/transform options before applying.
 *
 *   applyScopeModifiers(basePrice, scopeOptions, context)
 *      Sync. Lower-level: applies pricing math. Pure function, easy to test.
 *
 *   buildIncludesString(scopeOptions)
 *      Sync. Lower-level: formats the customer-facing prose.
 *
 * Modifier semantics:
 *   percent  — applied to BASE PRICE (not running total). 12 = +12% of base.
 *              Two 10% toggles = +20% (NOT +21% compound).
 *   flat     — added once. 200 = +$200 flat.
 *   per_unit — multiplied by context.unit_counts[option_key]. If no count
 *              is provided, the toggle silently skips (intentional — see
 *              "per_unit caveat" below).
 *   per_lf   — multiplied by context.linear_feet (for fence toggles).
 *   per_sq   — multiplied by context.squares (for roofing toggles).
 *
 * per_unit caveat:
 *   For per_unit toggles to actually apply a price, the estimator widget
 *   must ask a question producing a count for that toggle. As of Phase V2
 *   launch, no painting toggles in mig 058 require this. Future verticals
 *   (especially fencing with "additional gates") will. The widget's question
 *   schema needs the count question added when a per_unit toggle is enabled.
 */

const db = require("./db");

// ─────────────────────────────────────────────────────────────────────────────
// applyScopeToQuote — ONE-CALL CONVENIENCE WRAPPER (USE THIS)
//
// Drop this into your quote endpoint. Pass in the basePrice you computed
// from your existing logic (cost regions, rate overrides, room counts, etc.).
// Receive back a single object you can spread into your response.
//
// Returns:
//   {
//     total:              <basePrice + scope adjustments>,
//     base_before_scope:  <original basePrice>,
//     scope_adjustments:  [{ option_key, display_label, applied_amount, ... }],
//     includes_text:      "Includes: trim and ceilings. Doors quoted separately on walkthrough."
//   }
//
// Failure mode: if anything goes wrong (DB query fails, tenantId missing,
// etc.) returns { total: basePrice, base_before_scope: basePrice,
// scope_adjustments: [], includes_text: "Standard scope." } — i.e. graceful
// degradation. The estimate still ships with no scope adjustment applied.
// ─────────────────────────────────────────────────────────────────────────────
async function applyScopeToQuote({ tenantId, verticalServiceId, basePrice, context = {} } = {}) {
  // Defensive: bad inputs → return basePrice unchanged with empty scope.
  if (!tenantId || !verticalServiceId || !Number.isFinite(basePrice) || basePrice < 0) {
    return {
      total: round2(basePrice || 0),
      base_before_scope: round2(basePrice || 0),
      scope_adjustments: [],
      includes_text: "Standard scope.",
    };
  }

  try {
    const scopeOptions = await getTenantScopeOptions(tenantId, verticalServiceId);
    const pricing = applyScopeModifiers(basePrice, scopeOptions, context);
    const includesText = buildIncludesString(scopeOptions);

    return {
      total: pricing.total,
      base_before_scope: pricing.base,
      scope_adjustments: pricing.scope_adjustments,
      includes_text: includesText,
    };
  } catch (err) {
    // Helper-internal errors should never block an estimate. Log and
    // fall back to baseline pricing.
    console.error(
      "[scopeOptionsHelper] applyScopeToQuote failed tenant=%s service=%s err=%s",
      tenantId,
      verticalServiceId,
      err.message
    );
    return {
      total: round2(basePrice),
      base_before_scope: round2(basePrice),
      scope_adjustments: [],
      includes_text: "Standard scope.",
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// getTenantScopeOptions
// Read catalog + tenant overrides for a single service.
// ─────────────────────────────────────────────────────────────────────────────
async function getTenantScopeOptions(tenantId, verticalServiceId) {
  if (!tenantId || !verticalServiceId) {
    return [];
  }

  try {
    const result = await db.query(
      `SELECT
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
       WHERE vso.vertical_service_id = $2
       ORDER BY vso.display_order`,
      [tenantId, verticalServiceId]
    );

    return result.rows.map((row) => ({
      option_key: row.option_key,
      display_label: row.display_label,
      affects_includes_text: row.affects_includes_text,
      modifier_type: row.modifier_type,
      enabled:
        row.tenant_enabled !== null && row.tenant_enabled !== undefined
          ? row.tenant_enabled
          : row.default_enabled,
      price_modifier:
        row.price_modifier_override !== null && row.price_modifier_override !== undefined
          ? Number(row.price_modifier_override)
          : row.price_modifier_default !== null && row.price_modifier_default !== undefined
          ? Number(row.price_modifier_default)
          : 0,
    }));
  } catch (err) {
    console.error(
      "[scopeOptionsHelper] getTenantScopeOptions failed tenant=%s service=%s err=%s",
      tenantId,
      verticalServiceId,
      err.message
    );
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// applyScopeModifiers
// Walk enabled toggles, apply modifiers, return adjusted total + breakdown.
// Pure function. percent modifiers apply to BASE, not running total.
// ─────────────────────────────────────────────────────────────────────────────
function applyScopeModifiers(basePrice, scopeOptions, context = {}) {
  if (!Number.isFinite(basePrice) || basePrice < 0) {
    throw new TypeError("basePrice must be a non-negative finite number");
  }
  if (!Array.isArray(scopeOptions)) {
    throw new TypeError("scopeOptions must be an array");
  }

  let total = basePrice;
  const adjustments = [];

  for (const opt of scopeOptions) {
    if (!opt.enabled) continue;
    if (!opt.price_modifier && opt.price_modifier !== 0) continue;
    if (opt.price_modifier === 0) continue;

    let amount = 0;

    switch (opt.modifier_type) {
      case "percent":
        amount = basePrice * (opt.price_modifier / 100);
        break;

      case "flat":
        amount = opt.price_modifier;
        break;

      case "per_unit": {
        const qty = context.unit_counts?.[opt.option_key];
        if (qty === undefined || qty === null || qty <= 0) {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[scopeOptionsHelper] per_unit toggle '%s' enabled but no count in context.unit_counts — skipping",
              opt.option_key
            );
          }
          continue;
        }
        amount = opt.price_modifier * qty;
        break;
      }

      case "per_lf": {
        const lf = Number(context.linear_feet);
        if (!Number.isFinite(lf) || lf <= 0) continue;
        amount = opt.price_modifier * lf;
        break;
      }

      case "per_sq": {
        const sq = Number(context.squares);
        if (!Number.isFinite(sq) || sq <= 0) continue;
        amount = opt.price_modifier * sq;
        break;
      }

      default:
        continue;
    }

    if (amount === 0) continue;

    total += amount;
    adjustments.push({
      option_key: opt.option_key,
      display_label: opt.display_label,
      modifier_type: opt.modifier_type,
      modifier_value: opt.price_modifier,
      applied_amount: round2(amount),
    });
  }

  return {
    base: round2(basePrice),
    total: round2(total),
    scope_adjustments: adjustments,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// buildIncludesString
// Customer-facing prose. Same format as ScopeSettings.jsx live preview.
// ─────────────────────────────────────────────────────────────────────────────
function buildIncludesString(scopeOptions) {
  if (!Array.isArray(scopeOptions) || scopeOptions.length === 0) {
    return "Standard scope.";
  }

  const visible = scopeOptions.filter((o) => o.affects_includes_text);
  if (visible.length === 0) {
    return "Standard scope.";
  }

  const enabled = visible
    .filter((o) => o.enabled)
    .map((o) => stripIncludePrefix(o.display_label));

  const disabled = visible
    .filter((o) => !o.enabled)
    .map((o) => stripIncludePrefix(o.display_label));

  const parts = [];

  if (enabled.length > 0) {
    parts.push(`Includes: ${formatList(enabled)}.`);
  }

  if (disabled.length > 0) {
    const list = formatList(disabled);
    parts.push(`${capitalize(list)} quoted separately on walkthrough.`);
  }

  return parts.length > 0 ? parts.join(" ") : "Standard scope.";
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────
function stripIncludePrefix(label) {
  return String(label || "").replace(/^Include\s+/i, "").toLowerCase();
}

function formatList(items) {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

function capitalize(str) {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = {
  applyScopeToQuote,       // ← USE THIS in routes/estimator.js
  getTenantScopeOptions,   // (lower-level, for advanced use)
  applyScopeModifiers,     // (lower-level, for advanced use)
  buildIncludesString,     // (lower-level, for advanced use)
};

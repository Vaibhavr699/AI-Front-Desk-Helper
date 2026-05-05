"use strict";

/**
 * lib/scopeOptionsHelper.js
 *
 * Owner scope toggles → estimator pricing & "What's included" text.
 * Phase V2 (May 5, 2026).
 *
 * Three pure-ish functions, each independently testable:
 *
 *   1. getTenantScopeOptions(tenantId, verticalServiceId)
 *      Async. Reads catalog (vertical_scope_options) + tenant overrides
 *      (tenant_service_scope_options). Returns a flat array with each
 *      toggle's effective state (tenant override OR catalog default).
 *
 *   2. applyScopeModifiers(basePrice, scopeOptions, context)
 *      Sync. Walks enabled toggles, applies modifiers to basePrice,
 *      returns { base, total, scope_adjustments[] }.
 *
 *   3. buildIncludesString(scopeOptions)
 *      Sync. Returns customer-facing prose like:
 *      "Includes: trim & baseboards and ceilings. Doors quoted
 *       separately on walkthrough."
 *
 * The split is intentional. Callers can:
 *   - Cache scope options for a request and reuse for both pricing and text
 *   - Skip pricing entirely (e.g. preview pages that just need text)
 *   - Skip text entirely (e.g. internal admin tools that just need numbers)
 *
 * Modifier semantics:
 *   percent  — applied to BASE PRICE (not running total). 12 = +12% of base.
 *   flat     — added once. 200 = +$200 flat.
 *   per_unit — multiplied by context.unit_counts[option_key]. Caller
 *              must wire up the question → count mapping. If no count
 *              is provided, the toggle SILENTLY DOES NOTHING (logs a
 *              warning). This is by design — see "per_unit caveat" below.
 *   per_lf   — multiplied by context.linear_feet.
 *   per_sq   — multiplied by context.squares (roofing).
 *
 * per_unit caveat:
 *   For per_unit toggles to actually apply a price, the estimator widget
 *   needs to ask a question that produces a count for that toggle. As of
 *   Phase V2 launch, no painting toggles in mig 058 require this — but
 *   future verticals (especially fencing with "additional gates") will.
 *   The estimator widget's question schema needs to be updated to add the
 *   count question whenever a per_unit toggle is enabled. Tracked separately.
 */

const db = require("./db");

// ─────────────────────────────────────────────────────────────────────────────
// 1. getTenantScopeOptions
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
      // Tenant override wins. If no override exists (NULL), use catalog default.
      enabled:
        row.tenant_enabled !== null && row.tenant_enabled !== undefined
          ? row.tenant_enabled
          : row.default_enabled,
      // Same precedence for the price modifier value.
      price_modifier:
        row.price_modifier_override !== null && row.price_modifier_override !== undefined
          ? Number(row.price_modifier_override)
          : row.price_modifier_default !== null && row.price_modifier_default !== undefined
          ? Number(row.price_modifier_default)
          : 0,
    }));
  } catch (err) {
    // Don't block the estimate on a scope query failure. Return empty array,
    // log the error. Estimator falls back to base price + "Standard scope."
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
// 2. applyScopeModifiers
// Walk enabled toggles, apply modifiers, return adjusted total + breakdown.
//
// IMPORTANT: percent modifiers are computed against the ORIGINAL basePrice,
// not the running total. This matches how owners think about pricing — "trim
// adds 12% to the price" doesn't mean compounding with ceilings. Flat amounts
// add after percents.
//
// Negative modifiers are supported (for discount toggles, future use).
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
    // Allow zero-value modifiers to fall through silently (no-op).
    if (opt.price_modifier === 0) continue;

    let amount = 0;

    switch (opt.modifier_type) {
      case "percent":
        // Applied to BASE, not running total.
        amount = basePrice * (opt.price_modifier / 100);
        break;

      case "flat":
        amount = opt.price_modifier;
        break;

      case "per_unit": {
        const qty = context.unit_counts?.[opt.option_key];
        if (qty === undefined || qty === null || qty <= 0) {
          // Silent skip — see "per_unit caveat" in module header.
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
        // Unknown modifier type — skip silently. Catalog CHECK constraint
        // should prevent this, but be defensive.
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
// 3. buildIncludesString
// Customer-facing prose. Same format as the live preview in ScopeSettings.jsx
// so the owner's preview matches what the customer actually sees.
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
  getTenantScopeOptions,
  applyScopeModifiers,
  buildIncludesString,
};

"use strict";

/**
 * lib/scopeOptionsHelper.js
 *
 * Owner scope toggles → estimator pricing & "What's included" text.
 * Phase V2 (May 5, 2026); +scopeToSummaryString (Phase 7 E, May 18, 2026).
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
 *   scopeToSummaryString(estimatorPayload)
 *      Sync. Phase 7 E (May 18, 2026). Converts the widget's estimator_payload
 *      submission object into a short human-readable summary like
 *      "Interior painting · 3 medium rooms · trim included". Used by
 *      routes/estimator.js POST /lead to persist scope context onto the
 *      lead so reps see what the customer was quoted for.
 *
 *      Pure function — never touches DB, never throws. Returns a string
 *      regardless of input shape (falls back to "Estimate requested").
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
// scopeToSummaryString — Phase 7 E (May 18, 2026)
//
// Convert the widget's estimator_payload submission object into a short
// human-readable summary like "Interior painting · 3 medium rooms · trim
// included". Used by routes/estimator.js POST /lead to write
// leads.widget_estimate_scope_summary so the rep sees what the customer
// was quoted for when they arrive in-home.
//
// Pure function. Defensive against any shape — never throws. Handles all
// known vertical payload shapes:
//   - Painting interior:  { service_slug, rooms: [{count, size, type}] }
//   - Painting exterior:  { service_slug, square_footage, stories }
//   - Cabinets:           { service_slug, cabinet_count }
//   - Roofing:            { service_slug, squares, material, stories }
//   - Fence:              { service_slug, linear_feet, material }
//   - Modifiers:          { modifiers: { key: bool } } or { modifier_selections }
//
// Maximum length 200 chars (truncated with ellipsis). Falls back to
// "Estimate requested" if nothing useful can be extracted.
// ─────────────────────────────────────────────────────────────────────────────
function scopeToSummaryString(estimatorPayload) {
  if (!estimatorPayload || typeof estimatorPayload !== "object") {
    return "Estimate requested";
  }

  const parts = [];

  // 1. Service / project type label
  if (estimatorPayload.service_slug) {
    parts.push(formatServiceSlug(estimatorPayload.service_slug));
  } else if (estimatorPayload.project_type) {
    parts.push(formatSlugLabel(estimatorPayload.project_type));
  }

  // 2. Rooms (painting interior pattern)
  if (Array.isArray(estimatorPayload.rooms)) {
    const roomSummary = estimatorPayload.rooms
      .filter((r) => r && typeof r === "object" && Number(r.count) > 0)
      .map((r) => {
        const count = Number(r.count);
        const size = r.size ? String(r.size) : null;
        const type = r.type ? String(r.type) : "room";
        const label = `${count} ${size ? size + " " : ""}${type}${count > 1 ? "s" : ""}`;
        return label.trim();
      })
      .join(", ");
    if (roomSummary) parts.push(roomSummary);
  }

  // 3. Numeric measurements (exterior, roofing, fence, etc.)
  if (numLike(estimatorPayload.square_footage)) {
    parts.push(`${Number(estimatorPayload.square_footage).toLocaleString()} sq ft`);
  }
  if (numLike(estimatorPayload.linear_feet)) {
    parts.push(`${Number(estimatorPayload.linear_feet).toLocaleString()} linear ft`);
  }
  if (numLike(estimatorPayload.squares)) {
    const sq = Number(estimatorPayload.squares);
    parts.push(`${sq} square${sq === 1 ? "" : "s"}`);
  }
  if (numLike(estimatorPayload.cabinet_count)) {
    const cc = Number(estimatorPayload.cabinet_count);
    parts.push(`${cc} cabinet${cc === 1 ? "" : "s"}`);
  }
  if (numLike(estimatorPayload.stories)) {
    const s = Number(estimatorPayload.stories);
    parts.push(`${s} ${s === 1 ? "story" : "stories"}`);
  }

  // 4. Material / style
  if (estimatorPayload.material && typeof estimatorPayload.material === "string") {
    parts.push(formatSlugLabel(estimatorPayload.material));
  }
  if (estimatorPayload.style && typeof estimatorPayload.style === "string") {
    parts.push(formatSlugLabel(estimatorPayload.style));
  }

  // 5. Modifiers (enabled boolean flags only)
  // Support both shapes: { modifiers: { key: true } } and
  // { modifier_selections: { key: value } }
  const modifierObjects = [estimatorPayload.modifiers, estimatorPayload.modifier_selections];
  const enabledMods = new Set();
  for (const modObj of modifierObjects) {
    if (modObj && typeof modObj === "object" && !Array.isArray(modObj)) {
      for (const [key, val] of Object.entries(modObj)) {
        if (val === true || val === "true" || val === 1 || val === "yes") {
          enabledMods.add(formatSlugLabel(key));
        }
      }
    }
  }
  if (enabledMods.size > 0) {
    parts.push(Array.from(enabledMods).join(" + "));
  }

  // 6. Final assembly — cap at 200 chars
  let result = parts.length > 0 ? parts.join(" · ") : "Estimate requested";
  if (result.length > 200) {
    result = result.slice(0, 197) + "...";
  }
  return result;
}

// Internal — returns true if value is a positive finite number (or stringy number)
function numLike(v) {
  if (v == null) return false;
  const n = Number(v);
  return Number.isFinite(n) && n > 0;
}

// Internal — service-slug → human label, with overrides for known slugs
function formatServiceSlug(slug) {
  const map = {
    interior: "Interior painting",
    exterior: "Exterior painting",
    cabinets: "Cabinet refinishing",
    cabinet_refinishing: "Cabinet refinishing",
    deck_fence: "Deck/fence staining",
    fence: "Fence",
    fence_install: "Fence install",
    fence_repair: "Fence repair",
    fence_stain: "Fence staining",
    roof: "Roofing",
    roof_replacement: "Roof replacement",
    roof_repair: "Roof repair",
    roof_inspection: "Roof inspection",
    gutter: "Gutters",
    siding: "Siding",
  };
  return map[slug] || formatSlugLabel(slug);
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

function formatSlugLabel(slug) {
  return String(slug || "")
    .split(/[_-]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
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
  scopeToSummaryString,    // Phase 7 E — widget payload → summary string
};

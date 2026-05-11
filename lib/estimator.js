// ============================================================================
// lib/estimator.js
// ============================================================================
// Phase 7 V1 — Estimator Pricing Engine
//
// Exports:
//   calculateRange(tenantId, serviceSlug, inputs)  → quote or specialized routing
//   getVerticalConfig(tenantId)                    → full widget config bundle
//   validateInputs(serviceSlug, inputs)            → { valid, errors[] }
//
// Architecture:
//   Vertical-aware. Painting V1, Roofing Wave 1, Paragon Exteriors Wave 2
//   (siding, fence, gutters, plus the home_exterior mega-vertical bundling
//   all four trades for multi-trade contractors).
//
// All currency values are integer cents. No floats in money math.
//
// Phase V2 (May 8, 2026) — Scope options now applied to pricing.
//
// Phase 7 Wave 1 — Roofing (May 11, 2026 — Migration 062).
//
// V1.1 (May 11, 2026) — Scope options pricing FIX.
//   modifier_type enum honored: 'percent', 'flat', 'per_sq', 'per_lf',
//   'per_unit'. Additive percent (not compounding) matching
//   scopeOptionsHelper.js. Dollars→cents conversion (×100) inside
//   applyScopeOptions.
//
// V4 (May 11, 2026 — same day) — Paragon Exteriors trades.
//   Three new compute functions:
//     • computeSidingBase  — siding_sqft = floor × storyCoef → squares
//     • computeFenceBase   — base = fence_linear_ft × per_lf_rate
//     • computeGuttersBase — base = gutter_linear_ft × per_lf_rate
//   Dispatcher branches added for 15 new service slugs.
//   validateInputs + checkSpecialized extended.
//   scopeContext built per trade so per_sq / per_lf / per_unit scope
//   options apply correctly:
//     • Roofing & siding: scopeContext.squares
//     • Fence & gutters:  scopeContext.linear_feet
//   The mega-vertical (home_exterior) routes all 20 services through the
//   same dispatch — no special-casing for mega vs standalone trade
//   verticals required, because dispatch is by service_slug not vertical.
// ============================================================================

const db = require("./db");

// Service-slug groupings used by dispatch and validation. Keep these in sync
// with the widget JS's SERVICE_TO_TRADE map and with the seed data in the
// trade-vertical migrations (062 / 063 / 064 / 065) + mega (066).
const ROOFING_SERVICES = ["asphalt_shingle", "metal_standing_seam", "tile", "slate", "flat_epdm"];
const SIDING_SERVICES  = ["siding_vinyl", "siding_fiber_cement", "siding_wood", "siding_stucco", "siding_metal"];
const FENCE_SERVICES   = ["fence_wood_privacy", "fence_vinyl", "fence_chain_link", "fence_aluminum_ornamental", "fence_composite"];
const GUTTER_SERVICES  = ["gutter_aluminum_5in", "gutter_aluminum_6in", "gutter_half_round", "gutter_copper", "gutter_guards"];

// ============================================================================
// EXPORT 1: calculateRange
// ============================================================================
async function calculateRange(tenantId, serviceSlug, inputs = {}) {
  const tenantRes = await db.query(
    `SELECT id, state, vertical_id, cost_region, cost_custom_percentage
       FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId]
  );
  const tenant = tenantRes.rows[0];
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  if (!tenant.vertical_id) throw new Error(`Tenant has no vertical_id: ${tenantId}`);

  // Specialized routing check (runs BEFORE rate lookup)
  const specialized = await checkSpecialized(tenant.vertical_id, serviceSlug, inputs);
  if (specialized.specialized) return specialized;

  // Load service row
  const serviceRes = await db.query(
    `SELECT id, service_slug, pricing_mode, unit, is_specialized
       FROM vertical_services
      WHERE vertical_id = $1 AND service_slug = $2
      LIMIT 1`,
    [tenant.vertical_id, serviceSlug]
  );
  const service = serviceRes.rows[0];
  if (!service) throw new Error(`Service not found: ${serviceSlug}`);
  if (service.is_specialized) {
    return {
      specialized: true,
      reason: "Service flagged as specialized",
      trigger: { service: serviceSlug },
      quote: null,
    };
  }

  const bucketRes = await resolveBucket(tenant);

  // ──────────────────────────────────────────────────────────────────────
  // Compute base price + collect scope-options context per service
  // ──────────────────────────────────────────────────────────────────────
  let baseMin, baseMax;
  const scopeContext = {
    unit_counts: (inputs.unit_counts && typeof inputs.unit_counts === "object")
      ? inputs.unit_counts
      : {},
  };

  if (serviceSlug === "interior") {
    ({ baseMin, baseMax } = await computeInteriorBase(tenant.vertical_id, bucketRes.bucket, inputs));
  } else if (serviceSlug === "exterior") {
    const ext = await computeExteriorBase(tenant.vertical_id, bucketRes.bucket, inputs);
    baseMin = ext.baseMin;
    baseMax = ext.baseMax;
    scopeContext.squares = ext.paintableSqft / 100;
  } else if (serviceSlug === "cabinets") {
    const cab = await computeCabinetsBase(tenant.vertical_id, bucketRes.bucket, inputs);
    baseMin = cab.baseMin;
    baseMax = cab.baseMax;
  } else if (serviceSlug === "deck_fence") {
    const df = await computeDeckFenceBase(tenant.vertical_id, bucketRes.bucket, inputs);
    baseMin = df.baseMin;
    baseMax = df.baseMax;
    if (inputs.deck_size) scopeContext.squares = Number(inputs.deck_size) / 100;
    if (inputs.fence_linear_ft) scopeContext.linear_feet = Number(inputs.fence_linear_ft);
  } else if (ROOFING_SERVICES.includes(serviceSlug)) {
    const roof = await computeRoofingBase(tenant.vertical_id, bucketRes.bucket, serviceSlug, inputs);
    baseMin = roof.baseMin;
    baseMax = roof.baseMax;
    scopeContext.squares = roof.squares;
  } else if (SIDING_SERVICES.includes(serviceSlug)) {
    // V4 — Siding (Paragon Wave 2)
    const sid = await computeSidingBase(tenant.vertical_id, bucketRes.bucket, serviceSlug, inputs);
    baseMin = sid.baseMin;
    baseMax = sid.baseMax;
    scopeContext.squares = sid.squares;
  } else if (FENCE_SERVICES.includes(serviceSlug)) {
    // V4 — Fence (Paragon Wave 2)
    const fnc = await computeFenceBase(tenant.vertical_id, bucketRes.bucket, serviceSlug, inputs);
    baseMin = fnc.baseMin;
    baseMax = fnc.baseMax;
    scopeContext.linear_feet = fnc.linear_feet;
  } else if (GUTTER_SERVICES.includes(serviceSlug)) {
    // V4 — Gutters (Paragon Wave 2)
    const gut = await computeGuttersBase(tenant.vertical_id, bucketRes.bucket, serviceSlug, inputs);
    baseMin = gut.baseMin;
    baseMax = gut.baseMax;
    scopeContext.linear_feet = gut.linear_feet;
  } else {
    throw new Error(`Unsupported service: ${serviceSlug}`);
  }

  // Phase 7 V1.5 — Per-service rate override
  const rateOverrides = await loadServiceRateOverrides(tenantId);
  let overrideAdjustedMin = baseMin;
  let overrideAdjustedMax = baseMax;
  let serviceOverridePct = null;
  if (rateOverrides[serviceSlug] !== undefined) {
    serviceOverridePct = rateOverrides[serviceSlug];
    const factor = 1 + serviceOverridePct;
    overrideAdjustedMin = Math.round(baseMin * factor);
    overrideAdjustedMax = Math.round(baseMax * factor);
  }

  // Apply project modifiers (multiplicative stacking)
  const mods = await loadServiceModifiers(service.id);
  const applied = applyModifiers(overrideAdjustedMin, overrideAdjustedMax, mods, inputs, serviceSlug);
  let finalMin = applied.min;
  let finalMax = applied.max;

  // V1.1 — Apply scope options (additive percent semantics)
  const scopeOpts = await loadServiceScopeOptions(tenantId, service.id);
  const scopeApplied = applyScopeOptions(finalMin, finalMax, scopeOpts, scopeContext);
  finalMin = scopeApplied.min;
  finalMax = scopeApplied.max;

  // Apply custom % override if Z-Hybrid resolved to custom
  if (bucketRes.customMultiplier !== null) {
    finalMin = Math.round(finalMin * bucketRes.customMultiplier);
    finalMax = Math.round(finalMax * bucketRes.customMultiplier);
  }

  return {
    specialized: false,
    range_min_cents: finalMin,
    range_max_cents: finalMax,
    bucket: bucketRes.bucket,
    bucket_source: bucketRes.source,
    service_override_percentage: serviceOverridePct,
    breakdown: {
      ...applied.breakdown,
      base_before_override: { min: baseMin, max: baseMax },
      service_override_pct: serviceOverridePct,
      scope_context: scopeContext,
      scope_options: scopeApplied.breakdown,
    },
  };
}

// ============================================================================
// EXPORT 2: getVerticalConfig
// ============================================================================
async function getVerticalConfig(tenantId) {
  const tenantRes = await db.query(
    `SELECT id, vertical_id, cost_region, cost_custom_percentage,
            estimator_enabled, estimator_pop_enabled, estimator_addon_purchased
       FROM tenants WHERE id = $1 LIMIT 1`,
    [tenantId]
  );
  const tenant = tenantRes.rows[0];
  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);
  if (!tenant.vertical_id) throw new Error(`Tenant has no vertical_id: ${tenantId}`);

  const [verticalRes, servicesRes, modifiersRes, junctionRes, questionsRes] = await Promise.all([
    db.query(`SELECT * FROM verticals WHERE vertical_id = $1`, [tenant.vertical_id]),
    db.query(
      `SELECT * FROM vertical_services WHERE vertical_id = $1 ORDER BY sort_order`,
      [tenant.vertical_id]
    ),
    db.query(
      `SELECT * FROM vertical_modifier_categories WHERE vertical_id = $1 ORDER BY sort_order`,
      [tenant.vertical_id]
    ),
    db.query(
      `SELECT vsmc.*
         FROM vertical_service_modifier_categories vsmc
         JOIN vertical_services vs ON vs.id = vsmc.service_id
        WHERE vs.vertical_id = $1`,
      [tenant.vertical_id]
    ),
    db.query(
      `SELECT * FROM vertical_widget_questions WHERE vertical_id = $1 ORDER BY sort_order`,
      [tenant.vertical_id]
    ),
  ]);

  return {
    tenant: {
      id: tenant.id,
      estimator_enabled: tenant.estimator_enabled,
      pop_enabled: tenant.estimator_pop_enabled,
      addon_purchased: tenant.estimator_addon_purchased,
      cost_region: tenant.cost_region,
      cost_custom_percentage: tenant.cost_custom_percentage,
    },
    vertical: verticalRes.rows[0],
    services: servicesRes.rows,
    modifiers: modifiersRes.rows,
    junction: junctionRes.rows,
    questions: questionsRes.rows,
  };
}

// ============================================================================
// EXPORT 3: validateInputs
// ============================================================================
function validateInputs(serviceSlug, inputs = {}) {
  const errors = [];
  if (!serviceSlug) errors.push("service_slug is required");
  if (!inputs || typeof inputs !== "object") {
    return { valid: false, errors: ["inputs must be an object"] };
  }

  if (serviceSlug === "interior") {
    if (!Array.isArray(inputs.rooms) || inputs.rooms.length === 0) {
      errors.push("interior requires at least one room");
    } else {
      inputs.rooms.forEach((r, i) => {
        if (!["small", "medium", "large", "xl"].includes(r.size)) {
          errors.push(`rooms[${i}].size must be small|medium|large|xl`);
        }
        if (!Number.isInteger(r.count) || r.count < 1) {
          errors.push(`rooms[${i}].count must be integer >= 1`);
        }
      });
    }
  } else if (serviceSlug === "exterior") {
    if (!Number.isFinite(inputs.home_floor_sqft) || inputs.home_floor_sqft < 500) {
      errors.push("home_floor_sqft must be >= 500");
    }
    if (!["single", "split", "two_story", "three_plus"].includes(inputs.stories)) {
      errors.push("stories must be single|split|two_story|three_plus");
    }
  } else if (serviceSlug === "cabinets") {
    const count = inputs.facing_count_exact || inputs.facing_count_midpoint;
    if (!count || count < 1) errors.push("cabinets requires facing count >= 1");
    if (!["paint_to_paint", "stain_to_stain", "stain_to_paint"].includes(inputs.finish_change)) {
      errors.push("finish_change required");
    }
  } else if (serviceSlug === "deck_fence") {
    if (!["deck", "fence", "both"].includes(inputs.deck_or_fence)) {
      errors.push("deck_or_fence must be deck|fence|both");
    }
  } else if (ROOFING_SERVICES.includes(serviceSlug)) {
    if (!Number.isFinite(inputs.home_floor_sqft) || inputs.home_floor_sqft < 500) {
      errors.push("home_floor_sqft must be >= 500");
    }
    if (!["low", "medium", "steep"].includes(inputs.roof_pitch)) {
      errors.push("roof_pitch must be low|medium|steep (very_steep routes to specialized upstream)");
    }
    if (!["single", "two_story"].includes(inputs.stories)) {
      errors.push("stories must be single|two_story (three_plus routes to specialized upstream)");
    }
    if (!["sound", "some_repair"].includes(inputs.decking_condition)) {
      errors.push("decking_condition must be sound|some_repair (major_repair routes to specialized upstream)");
    }
  } else if (SIDING_SERVICES.includes(serviceSlug)) {
    // V4 — Siding validation
    if (!Number.isFinite(inputs.home_floor_sqft) || inputs.home_floor_sqft < 500) {
      errors.push("home_floor_sqft must be >= 500");
    }
    if (!["single", "split", "two_story"].includes(inputs.stories)) {
      errors.push("stories must be single|split|two_story (three_plus routes to specialized upstream)");
    }
  } else if (FENCE_SERVICES.includes(serviceSlug)) {
    // V4 — Fence validation
    if (!Number.isFinite(inputs.fence_linear_ft) || inputs.fence_linear_ft < 10) {
      errors.push("fence_linear_ft must be >= 10");
    }
    if (!["4ft", "6ft", "8ft"].includes(inputs.fence_height)) {
      errors.push("fence_height must be 4ft|6ft|8ft");
    }
  } else if (GUTTER_SERVICES.includes(serviceSlug)) {
    // V4 — Gutters validation
    if (!Number.isFinite(inputs.gutter_linear_ft) || inputs.gutter_linear_ft < 10) {
      errors.push("gutter_linear_ft must be >= 10");
    }
    if (!["single", "two_story"].includes(inputs.gutter_height) &&
        !["single", "two_story"].includes(inputs.stories)) {
      errors.push("gutter_height (or stories) must be single|two_story (three_plus routes to specialized upstream)");
    }
  } else if (serviceSlug !== "specialized") {
    errors.push(`unknown service_slug: ${serviceSlug}`);
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

async function resolveBucket(tenant) {
  if (tenant.cost_region === "custom" && tenant.cost_custom_percentage != null) {
    return {
      bucket: "mid",
      source: "custom",
      customMultiplier: 1 + Number(tenant.cost_custom_percentage) / 100,
    };
  }
  if (["high", "mid", "low"].includes(tenant.cost_region)) {
    return { bucket: tenant.cost_region, source: "tenant_override", customMultiplier: null };
  }
  if (tenant.state) {
    const stateRes = await db.query(
      `SELECT bucket FROM state_cost_buckets WHERE state_code = $1 LIMIT 1`,
      [String(tenant.state).toUpperCase()]
    );
    if (stateRes.rows[0]) {
      return { bucket: stateRes.rows[0].bucket, source: "state_lookup", customMultiplier: null };
    }
  }
  return { bucket: "mid", source: "default", customMultiplier: null };
}

async function checkSpecialized(verticalId, serviceSlug, inputs) {
  if (serviceSlug === "specialized" || inputs.service_type === "specialized") {
    return {
      specialized: true,
      reason: "User selected specialized project",
      trigger: { question: "service_type", value: "specialized" },
      quote: null,
    };
  }

  // Service-level explicit specialized checks (these are widget inputs, not
  // modifier categories — so the generic modifier loop below won't catch them).
  if (serviceSlug === "exterior" && inputs.stories === "three_plus") {
    return {
      specialized: true,
      reason: "3+ stories require in-person estimate",
      trigger: { question: "stories", value: "three_plus" },
      quote: null,
    };
  }
  if (ROOFING_SERVICES.includes(serviceSlug)) {
    if (inputs.stories === "three_plus") {
      return {
        specialized: true,
        reason: "3+ stories require in-person roofing estimate",
        trigger: { question: "stories", value: "three_plus" },
        quote: null,
      };
    }
    if (inputs.roof_pitch === "very_steep") {
      return {
        specialized: true,
        reason: "Very steep pitch (12/12+) requires in-person estimate",
        trigger: { question: "roof_pitch", value: "very_steep" },
        quote: null,
      };
    }
    if (inputs.decking_condition === "major_repair") {
      return {
        specialized: true,
        reason: "Major decking damage requires in-person assessment",
        trigger: { question: "decking_condition", value: "major_repair" },
        quote: null,
      };
    }
  }
  // V4 — Siding service-level specialized routing
  if (SIDING_SERVICES.includes(serviceSlug) && inputs.stories === "three_plus") {
    return {
      specialized: true,
      reason: "3+ stories require in-person siding estimate",
      trigger: { question: "stories", value: "three_plus" },
      quote: null,
    };
  }
  // V4 — Gutters: support either gutter_height (mega-vertical modifier) OR
  // stories (standalone gutters vertical widget question). Mega-vertical's
  // gutter_height is also a modifier with routes_to:specialized so the
  // generic modifier loop will catch it; this is belt-and-suspenders.
  if (GUTTER_SERVICES.includes(serviceSlug)) {
    if (inputs.gutter_height === "three_plus" || inputs.stories === "three_plus") {
      return {
        specialized: true,
        reason: "3+ stories require in-person gutter estimate",
        trigger: { question: "gutter_height", value: "three_plus" },
        quote: null,
      };
    }
  }

  // Generic modifier-driven specialized routing — catches everything tagged
  // with routes_to:"specialized" in modifier_category options.
  const modsRes = await db.query(
    `SELECT category_slug, options
       FROM vertical_modifier_categories
      WHERE vertical_id = $1`,
    [verticalId]
  );

  for (const mod of modsRes.rows) {
    const selected = inputs[mod.category_slug];
    if (selected === undefined || selected === null) continue;
    const selections = Array.isArray(selected) ? selected : [selected];
    for (const sel of selections) {
      const opt = (mod.options || []).find((o) => o.value === sel);
      if (opt && opt.routes_to === "specialized") {
        return {
          specialized: true,
          reason: `${mod.category_slug}: ${opt.label}`,
          trigger: { question: mod.category_slug, value: sel },
          quote: null,
        };
      }
    }
  }
  return { specialized: false };
}

async function loadServiceModifiers(serviceId) {
  const res = await db.query(
    `SELECT vmc.id, vmc.category_slug, vmc.modifier_type, vmc.multi_select, vmc.options,
            vsmc.required, vsmc.sort_order
       FROM vertical_service_modifier_categories vsmc
       JOIN vertical_modifier_categories vmc ON vmc.id = vsmc.modifier_category_id
      WHERE vsmc.service_id = $1
      ORDER BY vsmc.sort_order`,
    [serviceId]
  );
  return res.rows;
}

async function loadServiceRateOverrides(tenantId) {
  const res = await db.query(
    `SELECT service_slug, percentage_adjustment
       FROM tenant_service_rate_overrides
      WHERE tenant_id = $1`,
    [tenantId]
  );
  const overrides = {};
  for (const row of res.rows) {
    overrides[row.service_slug] = Number(row.percentage_adjustment);
  }
  return overrides;
}

async function loadServiceScopeOptions(tenantId, serviceId) {
  const res = await db.query(
    `SELECT
       vso.option_key,
       vso.display_label,
       vso.modifier_type,
       COALESCE(tso.enabled, vso.default_enabled) AS enabled,
       COALESCE(tso.price_modifier_override, vso.price_modifier_default) AS price_modifier
     FROM vertical_scope_options vso
     LEFT JOIN tenant_service_scope_options tso
       ON tso.vertical_service_id = vso.vertical_service_id
      AND tso.option_key          = vso.option_key
      AND tso.tenant_id           = $1
    WHERE vso.vertical_service_id = $2`,
    [tenantId, serviceId]
  );
  return res.rows;
}

// ----------------------------------------------------------------------------
// applyScopeOptions — V1.1 (May 11, 2026), unchanged in V4
// See top-of-file docblock for semantics.
// ----------------------------------------------------------------------------
function applyScopeOptions(baseMin, baseMax, scopeOpts, context = {}) {
  let min = baseMin;
  let max = baseMax;
  const originalMin = baseMin;
  const originalMax = baseMax;
  const breakdown = [];

  for (const opt of scopeOpts || []) {
    if (!opt.enabled) {
      breakdown.push({ option: opt.option_key, skipped: "disabled" });
      continue;
    }
    if (opt.price_modifier === null || opt.price_modifier === undefined) {
      breakdown.push({ option: opt.option_key, skipped: "no_modifier" });
      continue;
    }

    const modifier = Number(opt.price_modifier);
    if (!Number.isFinite(modifier) || modifier === 0) {
      breakdown.push({ option: opt.option_key, skipped: "zero_or_nan_modifier" });
      continue;
    }

    const type = String(opt.modifier_type || "").toLowerCase();

    if (type === "percent") {
      const addMin = Math.round(originalMin * modifier / 100);
      const addMax = Math.round(originalMax * modifier / 100);
      min += addMin;
      max += addMax;
      breakdown.push({ option: opt.option_key, type: "percent", percent: modifier, addMin, addMax });
      continue;
    }
    if (type === "flat") {
      const addCents = Math.round(modifier * 100);
      min += addCents;
      max += addCents;
      breakdown.push({ option: opt.option_key, type: "flat", dollars: modifier, addCents });
      continue;
    }
    if (type === "per_sq") {
      const sq = Number(context.squares);
      if (!Number.isFinite(sq) || sq <= 0) {
        breakdown.push({ option: opt.option_key, skipped: "per_sq_missing_squares_context" });
        continue;
      }
      const addCents = Math.round(modifier * sq * 100);
      min += addCents;
      max += addCents;
      breakdown.push({ option: opt.option_key, type: "per_sq", dollarsPerSq: modifier, squares: sq, addCents });
      continue;
    }
    if (type === "per_lf") {
      const lf = Number(context.linear_feet);
      if (!Number.isFinite(lf) || lf <= 0) {
        breakdown.push({ option: opt.option_key, skipped: "per_lf_missing_linear_feet_context" });
        continue;
      }
      const addCents = Math.round(modifier * lf * 100);
      min += addCents;
      max += addCents;
      breakdown.push({ option: opt.option_key, type: "per_lf", dollarsPerLf: modifier, linear_feet: lf, addCents });
      continue;
    }
    if (type === "per_unit") {
      const qty = Number(context.unit_counts?.[opt.option_key]);
      if (!Number.isFinite(qty) || qty <= 0) {
        breakdown.push({
          option: opt.option_key,
          skipped: "per_unit_missing_count",
          note: "widget must pass inputs.unit_counts[option_key] to apply this toggle",
        });
        continue;
      }
      const addCents = Math.round(modifier * qty * 100);
      min += addCents;
      max += addCents;
      breakdown.push({ option: opt.option_key, type: "per_unit", dollarsPerUnit: modifier, count: qty, addCents });
      continue;
    }

    breakdown.push({ option: opt.option_key, skipped: `unknown_modifier_type:${type}` });
  }

  return { min, max, breakdown };
}

// ============================================================================
// Service-specific base computations
// ============================================================================

async function computeInteriorBase(verticalId, bucket, inputs) {
  const ratesRes = await db.query(
    `SELECT unit, base_rate_min_cents, base_rate_max_cents
       FROM vertical_default_rates
      WHERE vertical_id = $1 AND service_slug = 'interior' AND cost_region = $2`,
    [verticalId, bucket]
  );

  const rateBySize = {};
  for (const r of ratesRes.rows) {
    rateBySize[r.unit.replace("room_", "")] = {
      min: r.base_rate_min_cents,
      max: r.base_rate_max_cents,
    };
  }

  let totalMin = 0;
  let totalMax = 0;
  for (const room of inputs.rooms || []) {
    const rate = rateBySize[room.size];
    if (!rate) throw new Error(`No interior rate for size: ${room.size}`);
    totalMin += rate.min * room.count;
    totalMax += rate.max * room.count;
  }
  return { baseMin: totalMin, baseMax: totalMax };
}

async function computeExteriorBase(verticalId, bucket, inputs) {
  const storyCoef = { single: 0.85, split: 1.20, two_story: 1.50 }[inputs.stories];
  if (!storyCoef) throw new Error(`Unknown stories value: ${inputs.stories}`);
  const paintableSqft = Number(inputs.home_floor_sqft) * storyCoef;

  const rateRes = await db.query(
    `SELECT base_rate_min_cents, base_rate_max_cents
       FROM vertical_default_rates
      WHERE vertical_id = $1 AND service_slug = 'exterior'
        AND cost_region = $2 AND unit = 'paintable_sqft'
      LIMIT 1`,
    [verticalId, bucket]
  );
  const rate = rateRes.rows[0];
  if (!rate) throw new Error("No exterior rate for paintable_sqft");

  return {
    baseMin: Math.round(paintableSqft * rate.base_rate_min_cents),
    baseMax: Math.round(paintableSqft * rate.base_rate_max_cents),
    paintableSqft,
  };
}

async function computeCabinetsBase(verticalId, bucket, inputs) {
  const facings = Number(inputs.facing_count_exact || inputs.facing_count_midpoint || 0);
  if (facings < 1) throw new Error("Cabinets require facing count >= 1");

  const rateRes = await db.query(
    `SELECT base_rate_min_cents, base_rate_max_cents
       FROM vertical_default_rates
      WHERE vertical_id = $1 AND service_slug = 'cabinets'
        AND cost_region = $2 AND unit = 'door_drawer_facing'
      LIMIT 1`,
    [verticalId, bucket]
  );
  const rate = rateRes.rows[0];
  if (!rate) throw new Error("No cabinets rate for door_drawer_facing");

  return {
    baseMin: facings * rate.base_rate_min_cents,
    baseMax: facings * rate.base_rate_max_cents,
  };
}

async function computeDeckFenceBase(verticalId, bucket, inputs) {
  let min = 0;
  let max = 0;
  const wantsDeck = inputs.deck_or_fence === "deck" || inputs.deck_or_fence === "both";
  const wantsFence = inputs.deck_or_fence === "fence" || inputs.deck_or_fence === "both";

  if (wantsDeck) {
    if (!inputs.deck_size) throw new Error("deck_size required for deck");
    const rateRes = await db.query(
      `SELECT base_rate_min_cents, base_rate_max_cents
         FROM vertical_default_rates
        WHERE vertical_id = $1 AND service_slug = 'deck_fence'
          AND cost_region = $2 AND unit = 'deck_sqft'
        LIMIT 1`,
      [verticalId, bucket]
    );
    const r = rateRes.rows[0];
    if (!r) throw new Error("No deck_fence rate for deck_sqft");
    min += Number(inputs.deck_size) * r.base_rate_min_cents;
    max += Number(inputs.deck_size) * r.base_rate_max_cents;
  }
  if (wantsFence) {
    if (!inputs.fence_linear_ft) throw new Error("fence_linear_ft required for fence");
    const rateRes = await db.query(
      `SELECT base_rate_min_cents, base_rate_max_cents
         FROM vertical_default_rates
        WHERE vertical_id = $1 AND service_slug = 'deck_fence'
          AND cost_region = $2 AND unit = 'fence_linear_ft'
        LIMIT 1`,
      [verticalId, bucket]
    );
    const r = rateRes.rows[0];
    if (!r) throw new Error("No deck_fence rate for fence_linear_ft");
    min += Number(inputs.fence_linear_ft) * r.base_rate_min_cents;
    max += Number(inputs.fence_linear_ft) * r.base_rate_max_cents;
  }
  return { baseMin: Math.round(min), baseMax: Math.round(max) };
}

// ----------------------------------------------------------------------------
// Roofing base — Phase 7 Wave 1
// ----------------------------------------------------------------------------
async function computeRoofingBase(verticalId, bucket, serviceSlug, inputs) {
  const pitchMultiplier = {
    low:    1.0308,
    medium: 1.1180,
    steep:  1.3017,
  }[inputs.roof_pitch];
  if (!pitchMultiplier) throw new Error(`Unknown roof_pitch value: ${inputs.roof_pitch}`);

  const floorsCount = { single: 1.0, two_story: 2.0 }[inputs.stories];
  if (!floorsCount) throw new Error(`Unknown stories value for roofing: ${inputs.stories}`);

  const floorSqft = Number(inputs.home_floor_sqft);
  if (!Number.isFinite(floorSqft) || floorSqft < 500) {
    throw new Error(`home_floor_sqft must be >= 500, got ${inputs.home_floor_sqft}`);
  }

  const footprintSqft = floorSqft / floorsCount;
  const roofSqft = footprintSqft * pitchMultiplier;
  const squares = roofSqft / 100;

  const rateRes = await db.query(
    `SELECT base_rate_min_cents, base_rate_max_cents
       FROM vertical_default_rates
      WHERE vertical_id = $1 AND service_slug = $2
        AND cost_region = $3 AND unit = 'square'
      LIMIT 1`,
    [verticalId, serviceSlug, bucket]
  );
  const rate = rateRes.rows[0];
  if (!rate) throw new Error(`No roofing rate for ${serviceSlug} at ${bucket} bucket`);

  return {
    baseMin: Math.round(squares * rate.base_rate_min_cents),
    baseMax: Math.round(squares * rate.base_rate_max_cents),
    squares,
  };
}

// ----------------------------------------------------------------------------
// Siding base — V4 (Paragon Exteriors launch, May 11 2026)
//
// Geometric model:
//   siding_sqft = home_floor_sqft × story_coefficient
//   squares     = siding_sqft / 100
//   base        = squares × per-square rate
//
// Story coefficients match the exterior painting pattern (same wall surface
// math applies). The split-level coefficient (1.20) accounts for the typical
// roughly-1.5-story footprint of split-level homes.
// ----------------------------------------------------------------------------
async function computeSidingBase(verticalId, bucket, serviceSlug, inputs) {
  const storyCoef = { single: 0.85, split: 1.20, two_story: 1.50 }[inputs.stories];
  if (!storyCoef) throw new Error(`Unknown stories value for siding: ${inputs.stories}`);

  const floorSqft = Number(inputs.home_floor_sqft);
  if (!Number.isFinite(floorSqft) || floorSqft < 500) {
    throw new Error(`home_floor_sqft must be >= 500, got ${inputs.home_floor_sqft}`);
  }

  const sidingSqft = floorSqft * storyCoef;
  const squares = sidingSqft / 100;

  const rateRes = await db.query(
    `SELECT base_rate_min_cents, base_rate_max_cents
       FROM vertical_default_rates
      WHERE vertical_id = $1 AND service_slug = $2
        AND cost_region = $3 AND unit = 'square'
      LIMIT 1`,
    [verticalId, serviceSlug, bucket]
  );
  const rate = rateRes.rows[0];
  if (!rate) throw new Error(`No siding rate for ${serviceSlug} at ${bucket} bucket`);

  return {
    baseMin: Math.round(squares * rate.base_rate_min_cents),
    baseMax: Math.round(squares * rate.base_rate_max_cents),
    squares,
  };
}

// ----------------------------------------------------------------------------
// Fence base — V4 (Paragon Exteriors launch, May 11 2026)
//
// Simple per-linear-foot model:
//   base = fence_linear_ft × per_lf_rate
//
// No geometric calculation — fence_height effects are applied via the
// fence_height modifier category (project modifier), not baked into the base.
// ----------------------------------------------------------------------------
async function computeFenceBase(verticalId, bucket, serviceSlug, inputs) {
  const lf = Number(inputs.fence_linear_ft);
  if (!Number.isFinite(lf) || lf < 10) {
    throw new Error(`fence_linear_ft must be >= 10, got ${inputs.fence_linear_ft}`);
  }

  const rateRes = await db.query(
    `SELECT base_rate_min_cents, base_rate_max_cents
       FROM vertical_default_rates
      WHERE vertical_id = $1 AND service_slug = $2
        AND cost_region = $3 AND unit = 'linear_foot'
      LIMIT 1`,
    [verticalId, serviceSlug, bucket]
  );
  const rate = rateRes.rows[0];
  if (!rate) throw new Error(`No fence rate for ${serviceSlug} at ${bucket} bucket`);

  return {
    baseMin: Math.round(lf * rate.base_rate_min_cents),
    baseMax: Math.round(lf * rate.base_rate_max_cents),
    linear_feet: lf,
  };
}

// ----------------------------------------------------------------------------
// Gutters base — V4 (Paragon Exteriors launch, May 11 2026)
//
// Simple per-linear-foot model:
//   base = gutter_linear_ft × per_lf_rate
//
// Height/story labor scaling applied via gutter_height modifier category.
// Downspouts billed per-unit via downspouts_count flat_per_item modifier.
// ----------------------------------------------------------------------------
async function computeGuttersBase(verticalId, bucket, serviceSlug, inputs) {
  const lf = Number(inputs.gutter_linear_ft);
  if (!Number.isFinite(lf) || lf < 10) {
    throw new Error(`gutter_linear_ft must be >= 10, got ${inputs.gutter_linear_ft}`);
  }

  const rateRes = await db.query(
    `SELECT base_rate_min_cents, base_rate_max_cents
       FROM vertical_default_rates
      WHERE vertical_id = $1 AND service_slug = $2
        AND cost_region = $3 AND unit = 'linear_foot'
      LIMIT 1`,
    [verticalId, serviceSlug, bucket]
  );
  const rate = rateRes.rows[0];
  if (!rate) throw new Error(`No gutter rate for ${serviceSlug} at ${bucket} bucket`);

  return {
    baseMin: Math.round(lf * rate.base_rate_min_cents),
    baseMax: Math.round(lf * rate.base_rate_max_cents),
    linear_feet: lf,
  };
}

// ----------------------------------------------------------------------------
// Modifier application — multiplicative stacking, home_style filtered for exterior
// ----------------------------------------------------------------------------
function applyModifiers(baseMin, baseMax, mods, inputs, serviceSlug) {
  let min = baseMin;
  let max = baseMax;
  const breakdown = { base: { min: baseMin, max: baseMax }, applied: [] };

  for (const mod of mods || []) {
    if (serviceSlug === "exterior" && mod.category_slug === "home_style") {
      breakdown.applied.push({ category: "home_style", skipped: "filtered_for_exterior" });
      continue;
    }

    let selected = inputs[mod.category_slug];
    if (mod.modifier_type === "flat_per_item" && (selected === undefined || selected === null)) {
      selected = inputs[`${mod.category_slug}_count`];
    }
    if (selected === undefined || selected === null) continue;

    const selections = Array.isArray(selected) ? selected : [selected];

    if (mod.modifier_type === "percentage") {
      for (const sel of selections) {
        const opt = (mod.options || []).find((o) => o.value === sel);
        if (!opt) continue;
        if (opt.adjustment === null || opt.adjustment === undefined) continue;
        const factor = 1 + Number(opt.adjustment);
        min = Math.round(min * factor);
        max = Math.round(max * factor);
        breakdown.applied.push({ category: mod.category_slug, value: sel, factor });
      }
    } else if (mod.modifier_type === "flat_per_item") {
      const count = Number(selections[0]) || 0;
      const opt = (mod.options || [])[0];
      if (opt && count > 0) {
        const addCents = count * Number(opt.adjustment);
        min += addCents;
        max += addCents;
        breakdown.applied.push({ category: mod.category_slug, count, addCents });
      }
    } else if (mod.modifier_type === "flat_per_project") {
      const opt = (mod.options || []).find((o) => o.value === selections[0]);
      if (opt && opt.adjustment) {
        const addCents = Number(opt.adjustment);
        min += addCents;
        max += addCents;
        breakdown.applied.push({ category: mod.category_slug, addCents });
      }
    }
  }

  return { min, max, breakdown };
}

// ============================================================================
module.exports = {
  calculateRange,
  getVerticalConfig,
  validateInputs,
};

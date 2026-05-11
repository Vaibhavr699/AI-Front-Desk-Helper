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
//   Vertical-aware (Painting V1, Roofing V1 Wave 1, others V2+ via config only).
//   Multiplicative modifier stacking for PROJECT modifiers (year_built,
//   home_style, complexity). Additive math for SCOPE option percent toggles.
//   Z-Hybrid bucket resolution.
//   home_style modifier filtered from exterior (overlaps with stories coef).
//   Specialized routing returns structured object, never throws.
//
// All currency values are integer cents. No floats in money math.
//
// Phase V2 (May 8, 2026) — Scope options now applied to pricing.
//
// Phase 7 Wave 1 — Roofing (May 11, 2026 — Migration 062).
//
// V1.1 (May 11, 2026 — same day as Wave 1) — Scope options pricing FIX.
//   The applyScopeOptions function had been silently skipping every scope
//   option since Phase V2 (May 8) because it expected modifier_type values
//   ('percentage', 'flat_per_project', 'flat_per_item') that the DB CHECK
//   constraint disallows. The real enum is 'percent', 'flat', 'per_sq',
//   'per_lf', 'per_unit'. V1.1 rewrites applyScopeOptions to honor those
//   actual values + accepts a `context` parameter for area/length/count
//   inputs. calculateRange now builds context per service before invoking.
//
//   Units (confirmed via SELECT on production data, May 11 2026):
//     flat / per_sq / per_lf / per_unit → DOLLARS in price_modifier_default
//                                         (multiplied by 100 for cents output)
//     percent → INTEGER PERCENT (e.g. 18 = +18%)
//
//   Math semantics (aligned with lib/scopeOptionsHelper.js applyScopeModifiers):
//     percent → ADDITIVE on BASE (the value passed into applyScopeOptions).
//               Two 10% toggles = +20% (NOT +21% compound). Each percent
//               adjustment computed against the base, then summed in.
//     flat / per_sq / per_lf / per_unit → independent additions in cents.
//
//   Project modifiers (applyModifiers) continue to compound multiplicatively.
//   That's correct: project modifiers like year_built and home_style describe
//   characteristics of the home that scale the underlying labor rate, so they
//   stack multiplicatively. Scope options are independent features ("we'll do
//   trim too") and stack additively. Two different math regimes intentionally.
//
//   Impact: After V1.1, painting prices reflect 7 percent + 1 flat scope
//   options that were previously silent. 3 painting per_unit options will
//   continue to skip until the widget captures their counts (Wave 1.2).
//   Roofing's 15 per_sq + 15 flat scope options now affect price (all 30).
//
//   Future V1.2: consolidate this function with scopeOptionsHelper.js
//   applyScopeModifiers behind a unit-agnostic core. Two implementations
//   today because: this one works on a min/max range in cents; the helper
//   works on a single price in dollars. Same enum interpretation, different
//   surface.
// ============================================================================

const db = require("./db");

// ============================================================================
// EXPORT 1: calculateRange
// ============================================================================
async function calculateRange(tenantId, serviceSlug, inputs = {}) {
  // Load tenant + vertical assignment
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

  // Resolve cost bucket (Z-Hybrid: custom > region > state lookup > mid default)
  const bucketRes = await resolveBucket(tenant);

  // ──────────────────────────────────────────────────────────────────────
  // Compute base price + collect scope-options context per service
  // ──────────────────────────────────────────────────────────────────────
  // V1.1: scopeContext is the bag of per-service measurements (squares,
  // linear_feet, unit_counts) that applyScopeOptions needs to evaluate
  // per_sq / per_lf / per_unit toggles. Built service-by-service so the
  // numbers come from the same math that built the base.
  let baseMin, baseMax;
  const scopeContext = {
    // Pass-through: widget can optionally provide counts keyed by option_key
    // (e.g. { include_doors: 8 }). When not provided, per_unit toggles skip.
    unit_counts: (inputs.unit_counts && typeof inputs.unit_counts === "object")
      ? inputs.unit_counts
      : {},
  };

  if (serviceSlug === "interior") {
    ({ baseMin, baseMax } = await computeInteriorBase(tenant.vertical_id, bucketRes.bucket, inputs));
    // Interior: percent + per_unit scope options. Squares N/A for interior.
  } else if (serviceSlug === "exterior") {
    const ext = await computeExteriorBase(tenant.vertical_id, bucketRes.bucket, inputs);
    baseMin = ext.baseMin;
    baseMax = ext.baseMax;
    // Exterior: percent + (future) per_sq. paintable_sqft is the natural area metric.
    scopeContext.squares = ext.paintableSqft / 100;
  } else if (serviceSlug === "cabinets") {
    const cab = await computeCabinetsBase(tenant.vertical_id, bucketRes.bucket, inputs);
    baseMin = cab.baseMin;
    baseMax = cab.baseMax;
    // Cabinets: percent + per_unit (counted via inputs.unit_counts).
  } else if (serviceSlug === "deck_fence") {
    const df = await computeDeckFenceBase(tenant.vertical_id, bucketRes.bucket, inputs);
    baseMin = df.baseMin;
    baseMax = df.baseMax;
    // Deck/Fence: deck uses squares (deck_size/100), fence uses linear_feet.
    if (inputs.deck_size) scopeContext.squares = Number(inputs.deck_size) / 100;
    if (inputs.fence_linear_ft) scopeContext.linear_feet = Number(inputs.fence_linear_ft);
  } else if (["asphalt_shingle", "metal_standing_seam", "tile", "slate", "flat_epdm"].includes(serviceSlug)) {
    const roof = await computeRoofingBase(tenant.vertical_id, bucketRes.bucket, serviceSlug, inputs);
    baseMin = roof.baseMin;
    baseMax = roof.baseMax;
    // Roofing: per_sq + flat scope options. Squares from the geometric calc.
    scopeContext.squares = roof.squares;
  } else {
    throw new Error(`Unsupported service: ${serviceSlug}`);
  }

  // Phase 7 V1.5 — Per-service rate override (May 4, 2026)
  // Applied to base BEFORE modifier stacking. This way modifiers stack on the
  // tenant's adjusted base rate, which produces correct results when tenant says
  // "I charge 20% more for interior overall."
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

  // Apply project modifiers (multiplicative stacking, home_style filtered for exterior)
  const mods = await loadServiceModifiers(service.id);
  const applied = applyModifiers(overrideAdjustedMin, overrideAdjustedMax, mods, inputs, serviceSlug);
  let finalMin = applied.min;
  let finalMax = applied.max;

  // V1.1 — Apply scope options with context. Was silently no-op before today
  // (modifier_type enum mismatch). See top-of-file V1.1 note for details.
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
  } else if (["asphalt_shingle", "metal_standing_seam", "tile", "slate", "flat_epdm"].includes(serviceSlug)) {
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
  } else if (serviceSlug !== "specialized") {
    errors.push(`unknown service_slug: ${serviceSlug}`);
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

// Z-Hybrid bucket resolution
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

// Specialized routing — checks all input values against routes_to markers
async function checkSpecialized(verticalId, serviceSlug, inputs) {
  if (serviceSlug === "specialized" || inputs.service_type === "specialized") {
    return {
      specialized: true,
      reason: "User selected specialized project",
      trigger: { question: "service_type", value: "specialized" },
      quote: null,
    };
  }
  if (serviceSlug === "exterior" && inputs.stories === "three_plus") {
    return {
      specialized: true,
      reason: "3+ stories require in-person estimate",
      trigger: { question: "stories", value: "three_plus" },
      quote: null,
    };
  }
  if (["asphalt_shingle", "metal_standing_seam", "tile", "slate", "flat_epdm"].includes(serviceSlug)) {
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

// Phase 7 V1.5 (May 4, 2026).
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

// Phase V2 (May 8, 2026).
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
// applyScopeOptions — V1.1 (May 11, 2026)
//
// Applies owner-configured scope toggles to a base price range, returning
// the adjusted range + a per-option breakdown. Stacks AFTER applyModifiers
// so scope toggles act on a base that already reflects project answers.
//
// SEMANTICS — must match lib/scopeOptionsHelper.js applyScopeModifiers:
//
//   percent → ADDITIVE on BASE. Each enabled percent toggle computes
//     `addend = base × (modifier/100)` against the base values PASSED INTO
//     this function (NOT the running total). Two 10% toggles = +20% of base,
//     not +21% compounded. Stored as integer percent (18 = +18%).
//
//   flat → dollars added once when enabled. Stored as dollars (200 = $200).
//     Converted to cents (×100) before adding.
//
//   per_sq → dollars per 100sqft. Needs context.squares. Converted to cents.
//   per_lf → dollars per linear foot. Needs context.linear_feet. Cents.
//   per_unit → dollars per item. Needs context.unit_counts[option_key].
//     Silently skips (with logged reason) when no count is provided —
//     this is intentional, the widget hasn't always plumbed counts yet.
//
// Inputs in cents, outputs in cents. DB values in dollars (for flat/per_X)
// or integer percent. Conversion handled inside.
// ----------------------------------------------------------------------------
function applyScopeOptions(baseMin, baseMax, scopeOpts, context = {}) {
  let min = baseMin;
  let max = baseMax;
  // Percent toggles use the ORIGINAL base, not the running total — additive
  // semantics matching scopeOptionsHelper.js. Two 10% toggles = +20%, not +21%.
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

    // ── 'percent' — additive on ORIGINAL base. Unitless. ────────────────
    if (type === "percent") {
      const addMin = Math.round(originalMin * modifier / 100);
      const addMax = Math.round(originalMax * modifier / 100);
      min += addMin;
      max += addMax;
      breakdown.push({
        option: opt.option_key,
        type: "percent",
        percent: modifier,
        addMin,
        addMax,
      });
      continue;
    }

    // ── 'flat' — dollars added once. Convert dollars→cents (×100). ──────
    if (type === "flat") {
      const addCents = Math.round(modifier * 100);
      min += addCents;
      max += addCents;
      breakdown.push({ option: opt.option_key, type: "flat", dollars: modifier, addCents });
      continue;
    }

    // ── 'per_sq' — dollars per square (100 sqft). Needs context.squares. ─
    if (type === "per_sq") {
      const sq = Number(context.squares);
      if (!Number.isFinite(sq) || sq <= 0) {
        breakdown.push({ option: opt.option_key, skipped: "per_sq_missing_squares_context" });
        continue;
      }
      const addCents = Math.round(modifier * sq * 100);
      min += addCents;
      max += addCents;
      breakdown.push({
        option: opt.option_key,
        type: "per_sq",
        dollarsPerSq: modifier,
        squares: sq,
        addCents,
      });
      continue;
    }

    // ── 'per_lf' — dollars per linear foot. Needs context.linear_feet. ──
    if (type === "per_lf") {
      const lf = Number(context.linear_feet);
      if (!Number.isFinite(lf) || lf <= 0) {
        breakdown.push({ option: opt.option_key, skipped: "per_lf_missing_linear_feet_context" });
        continue;
      }
      const addCents = Math.round(modifier * lf * 100);
      min += addCents;
      max += addCents;
      breakdown.push({
        option: opt.option_key,
        type: "per_lf",
        dollarsPerLf: modifier,
        linear_feet: lf,
        addCents,
      });
      continue;
    }

    // ── 'per_unit' — dollars per item. Needs context.unit_counts[key]. ──
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
      breakdown.push({
        option: opt.option_key,
        type: "per_unit",
        dollarsPerUnit: modifier,
        count: qty,
        addCents,
      });
      continue;
    }

    // Unknown type — log and skip. Legacy aliases ('percentage',
    // 'flat_per_project', 'flat_per_item') would land here, but the DB
    // CHECK constraint prevents them from being stored.
    breakdown.push({ option: opt.option_key, skipped: `unknown_modifier_type:${type}` });
  }

  return { min, max, breakdown };
}

// Service-specific base computations
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

// V1.1: returns paintableSqft alongside baseMin/baseMax so calculateRange
// can use it as context.squares for any future per_sq scope option on exterior.
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
// Roofing base — Phase 7 Wave 1 (Migration 062, May 11 2026)
//
// V1.1: returns `squares` alongside baseMin/baseMax so calculateRange can
// pass it to applyScopeOptions as context.squares (per_sq scope options).
// ----------------------------------------------------------------------------
async function computeRoofingBase(verticalId, bucket, serviceSlug, inputs) {
  const pitchMultiplier = {
    low:    1.0308,  // ~3/12 — nearly flat
    medium: 1.1180,  // ~6/12 — typical residential, most common
    steep:  1.3017,  // ~10/12 — cathedral, victorian
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

// Project modifier application — multiplicative stacking. UNCHANGED in V1.1.
// (Scope options use additive math via applyScopeOptions above; project
// modifiers stack multiplicatively because they describe characteristics
// of the home that scale the underlying labor rate.)
function applyModifiers(baseMin, baseMax, mods, inputs, serviceSlug) {
  let min = baseMin;
  let max = baseMax;
  const breakdown = { base: { min: baseMin, max: baseMax }, applied: [] };

  for (const mod of mods || []) {
    // ENGINE FILTER: home_style overlaps with stories coef on exterior — skip.
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

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
//   Vertical-aware (Painting V1, Roofing/Fencing V2+ via config only).
//   Multiplicative modifier stacking. Z-Hybrid bucket resolution.
//   home_style modifier filtered from exterior (overlaps with stories coef).
//   Specialized routing returns structured object, never throws.
//
// All currency values are integer cents. No floats in money math.
//
// Phase V2 (May 8, 2026) — Scope options now applied to pricing.
//   Owner-configured "what's included" toggles (trim, ceilings, doors, etc.)
//   from the Standard Scope settings tab now actually affect the quote.
//   Stack between project-answer modifiers and the regional cost multiplier.
//   See loadServiceScopeOptions + applyScopeOptions below.
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

  // Compute base by service type
  let baseMin, baseMax;
  if (serviceSlug === "interior") {
    ({ baseMin, baseMax } = await computeInteriorBase(tenant.vertical_id, bucketRes.bucket, inputs));
  } else if (serviceSlug === "exterior") {
    ({ baseMin, baseMax } = await computeExteriorBase(tenant.vertical_id, bucketRes.bucket, inputs));
  } else if (serviceSlug === "cabinets") {
    ({ baseMin, baseMax } = await computeCabinetsBase(tenant.vertical_id, bucketRes.bucket, inputs));
  } else if (serviceSlug === "deck_fence") {
    ({ baseMin, baseMax } = await computeDeckFenceBase(tenant.vertical_id, bucketRes.bucket, inputs));
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

  // Apply modifiers (multiplicative stacking, home_style filtered for exterior)
  const mods = await loadServiceModifiers(service.id);
  const applied = applyModifiers(overrideAdjustedMin, overrideAdjustedMax, mods, inputs, serviceSlug);
  let finalMin = applied.min;
  let finalMax = applied.max;

  // Phase V2 — Apply scope options (May 8, 2026)
  // Owner-configured "what's included by default" toggles from the Standard
  // Scope settings tab. Stacks on top of customer-answered modifiers — e.g.,
  // trim ON adds +12% to whatever price the project answers produced.
  // Disabled toggles contribute nothing and surface as "quoted separately on
  // walkthrough" in the includes_text overlay (see routes/estimator.js).
  const scopeOpts = await loadServiceScopeOptions(tenantId, service.id);
  const scopeApplied = applyScopeOptions(finalMin, finalMax, scopeOpts);
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

// Load per-service rate overrides for a tenant.
// Returns map: { service_slug: percentage_adjustment }.
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

// Load per-service scope options for a tenant — Phase V2 (May 8, 2026).
//
// Returns array of { option_key, display_label, modifier_type, enabled, price_modifier }.
// Falls back to catalog defaults (default_enabled / price_modifier_default) when
// the tenant has no override row in tenant_service_scope_options for that option.
//
// This mirrors the read pattern in routes/scopeOptions.js GET handler so what
// the dashboard shows the owner is exactly what the pricing engine applies.
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

// Apply scope option modifiers to a base price range — Phase V2 (May 8, 2026).
//
// Stacks AFTER applyModifiers so scope toggles compound on the customer's
// project answers. Disabled toggles are skipped entirely (they appear as
// "quoted separately on walkthrough" in the includes_text overlay).
//
// SUPPORTED modifier_type values:
//   "percentage"       → multiplies price by (1 + modifier). Compounds with
//                        other percentage modifiers.
//   "flat_per_project" → adds modifier (in cents) once when the toggle is ON.
//
// SKIPPED:
//   "flat_per_item"    → A binary scope toggle has no count input from the
//                        widget (we never ask "how many doors?"), so applying
//                        $75 per item is impossible without inventing a number.
//                        To use these correctly, either change the option's
//                        modifier_type to flat_per_project (one fixed amount
//                        when ON) or add a per-item count question to the
//                        widget. Logged in breakdown for visibility.
function applyScopeOptions(baseMin, baseMax, scopeOpts) {
  let min = baseMin;
  let max = baseMax;
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

    if (opt.modifier_type === "percentage") {
      const factor = 1 + modifier;
      min = Math.round(min * factor);
      max = Math.round(max * factor);
      breakdown.push({ option: opt.option_key, type: "percentage", factor });
    } else if (opt.modifier_type === "flat_per_project") {
      min += modifier;
      max += modifier;
      breakdown.push({ option: opt.option_key, type: "flat_per_project", addCents: modifier });
    } else if (opt.modifier_type === "flat_per_item") {
      breakdown.push({
        option: opt.option_key,
        skipped: "flat_per_item_needs_count",
        modifier_cents: modifier,
      });
    } else {
      breakdown.push({ option: opt.option_key, skipped: `unknown_type_${opt.modifier_type}` });
    }
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

// Modifier application — multiplicative stacking, home_style filtered for exterior
function applyModifiers(baseMin, baseMax, mods, inputs, serviceSlug) {
  let min = baseMin;
  let max = baseMax;
  const breakdown = { base: { min: baseMin, max: baseMax }, applied: [] };

  for (const mod of mods || []) {
    // ENGINE FILTER: home_style overlaps with stories coef on exterior — skip.
    // Cleanup migration to remove the junction row is in Rahul queue.
    if (serviceSlug === "exterior" && mod.category_slug === "home_style") {
      breakdown.applied.push({ category: "home_style", skipped: "filtered_for_exterior" });
      continue;
    }

    // Inputs use category_slug; for flat_per_item, fallback to <slug>_count
    let selected = inputs[mod.category_slug];
    if (mod.modifier_type === "flat_per_item" && (selected === undefined || selected === null)) {
      selected = inputs[`${mod.category_slug}_count`];
    }
    if (selected === undefined || selected === null) continue;

    const selections = Array.isArray(selected) ? selected : [selected];

    if (mod.modifier_type === "percentage") {
      // Both single-select and multi-select compound multiplicatively
      for (const sel of selections) {
        const opt = (mod.options || []).find((o) => o.value === sel);
        if (!opt) continue;
        if (opt.adjustment === null || opt.adjustment === undefined) continue; // routes_to handled upstream
        const factor = 1 + Number(opt.adjustment);
        min = Math.round(min * factor);
        max = Math.round(max * factor);
        breakdown.applied.push({ category: mod.category_slug, value: sel, factor });
      }
    } else if (mod.modifier_type === "flat_per_item") {
      // glass_inserts: count × $35 (3500 cents). Single seeded option.
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

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
// NOTE: Adjust the `supabase` import path on line below to match the existing
//       project pattern (e.g. require('../db') or require('../lib/supabase')).
// ============================================================================

const { supabase } = require('./db');

// ============================================================================
// EXPORT 1: calculateRange
// ============================================================================
async function calculateRange(tenantId, serviceSlug, inputs = {}) {
  // --- Load tenant + vertical assignment
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, state, vertical_id, cost_region, cost_custom_percentage')
    .eq('id', tenantId)
    .single();
  if (tErr || !tenant) throw new Error(`Tenant not found: ${tenantId}`);
  if (!tenant.vertical_id) throw new Error(`Tenant has no vertical_id: ${tenantId}`);

  // --- Specialized routing check (runs BEFORE rate lookup)
  const specialized = await checkSpecialized(tenant.vertical_id, serviceSlug, inputs);
  if (specialized.specialized) return specialized;

  // --- Load service row
  const { data: service, error: sErr } = await supabase
    .from('vertical_services')
    .select('id, service_slug, pricing_mode, unit, is_specialized')
    .eq('vertical_id', tenant.vertical_id)
    .eq('service_slug', serviceSlug)
    .single();
  if (sErr || !service) throw new Error(`Service not found: ${serviceSlug}`);
  if (service.is_specialized) {
    return {
      specialized: true,
      reason: 'Service flagged as specialized',
      trigger: { service: serviceSlug },
      quote: null,
    };
  }

  // --- Resolve cost bucket (Z-Hybrid: custom > region > state lookup > mid default)
  const bucketRes = await resolveBucket(tenant);

  // --- Compute base by service type
  let baseMin, baseMax;
  if (serviceSlug === 'interior') {
    ({ baseMin, baseMax } = await computeInteriorBase(tenant.vertical_id, bucketRes.bucket, inputs));
  } else if (serviceSlug === 'exterior') {
    ({ baseMin, baseMax } = await computeExteriorBase(tenant.vertical_id, bucketRes.bucket, inputs));
  } else if (serviceSlug === 'cabinets') {
    ({ baseMin, baseMax } = await computeCabinetsBase(tenant.vertical_id, bucketRes.bucket, inputs));
  } else if (serviceSlug === 'deck_fence') {
    ({ baseMin, baseMax } = await computeDeckFenceBase(tenant.vertical_id, bucketRes.bucket, inputs));
  } else {
    throw new Error(`Unsupported service: ${serviceSlug}`);
  }

  // --- Apply modifiers (multiplicative stacking, home_style filtered for exterior)
  const mods = await loadServiceModifiers(service.id);
  const applied = applyModifiers(baseMin, baseMax, mods, inputs, serviceSlug);
  let finalMin = applied.min;
  let finalMax = applied.max;

  // --- Apply custom % override if Z-Hybrid resolved to custom
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
    breakdown: applied.breakdown,
  };
}

// ============================================================================
// EXPORT 2: getVerticalConfig
// ============================================================================
async function getVerticalConfig(tenantId) {
  const { data: tenant, error: tErr } = await supabase
    .from('tenants')
    .select('id, vertical_id, cost_region, cost_custom_percentage, estimator_widget_enabled, estimator_pop_enabled, estimator_addon_purchased')
    .eq('id', tenantId)
    .single();
  if (tErr || !tenant) throw new Error(`Tenant not found: ${tenantId}`);
  if (!tenant.vertical_id) throw new Error(`Tenant has no vertical_id: ${tenantId}`);

  const [vertical, services, modifiers, junction, questions] = await Promise.all([
    supabase.from('verticals').select('*').eq('vertical_id', tenant.vertical_id).single().then(r => r.data),
    supabase.from('vertical_services').select('*').eq('vertical_id', tenant.vertical_id).order('sort_order').then(r => r.data),
    supabase.from('vertical_modifier_categories').select('*').eq('vertical_id', tenant.vertical_id).order('sort_order').then(r => r.data),
    supabase.from('vertical_service_modifier_categories').select('*').then(r => r.data),
    supabase.from('vertical_widget_questions').select('*').eq('vertical_id', tenant.vertical_id).order('sort_order').then(r => r.data),
  ]);

  return {
    tenant: {
      id: tenant.id,
      widget_enabled: tenant.estimator_widget_enabled,
      pop_enabled: tenant.estimator_pop_enabled,
      addon_purchased: tenant.estimator_addon_purchased,
      cost_region: tenant.cost_region,
      cost_custom_percentage: tenant.cost_custom_percentage,
    },
    vertical,
    services,
    modifiers,
    junction,
    questions,
  };
}

// ============================================================================
// EXPORT 3: validateInputs
// ============================================================================
function validateInputs(serviceSlug, inputs = {}) {
  const errors = [];
  if (!serviceSlug) errors.push('service_slug is required');
  if (!inputs || typeof inputs !== 'object') {
    return { valid: false, errors: ['inputs must be an object'] };
  }

  if (serviceSlug === 'interior') {
    if (!Array.isArray(inputs.rooms) || inputs.rooms.length === 0) {
      errors.push('interior requires at least one room');
    } else {
      inputs.rooms.forEach((r, i) => {
        if (!['small', 'medium', 'large', 'xl'].includes(r.size)) {
          errors.push(`rooms[${i}].size must be small|medium|large|xl`);
        }
        if (!Number.isInteger(r.count) || r.count < 1) {
          errors.push(`rooms[${i}].count must be integer >= 1`);
        }
      });
    }
  } else if (serviceSlug === 'exterior') {
    if (!Number.isFinite(inputs.home_floor_sqft) || inputs.home_floor_sqft < 500) {
      errors.push('home_floor_sqft must be >= 500');
    }
    if (!['single', 'split', 'two_story', 'three_plus'].includes(inputs.stories)) {
      errors.push('stories must be single|split|two_story|three_plus');
    }
  } else if (serviceSlug === 'cabinets') {
    const count = inputs.facing_count_exact || inputs.facing_count_midpoint;
    if (!count || count < 1) errors.push('cabinets requires facing count >= 1');
    if (!['paint_to_paint', 'stain_to_stain', 'stain_to_paint'].includes(inputs.finish_change)) {
      errors.push('finish_change required');
    }
  } else if (serviceSlug === 'deck_fence') {
    if (!['deck', 'fence', 'both'].includes(inputs.deck_or_fence)) {
      errors.push('deck_or_fence must be deck|fence|both');
    }
  } else if (serviceSlug !== 'specialized') {
    errors.push(`unknown service_slug: ${serviceSlug}`);
  }

  return { valid: errors.length === 0, errors };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

// Z-Hybrid bucket resolution
async function resolveBucket(tenant) {
  if (tenant.cost_region === 'custom' && tenant.cost_custom_percentage != null) {
    return {
      bucket: 'mid',
      source: 'custom',
      customMultiplier: 1 + Number(tenant.cost_custom_percentage) / 100,
    };
  }
  if (['high', 'mid', 'low'].includes(tenant.cost_region)) {
    return { bucket: tenant.cost_region, source: 'tenant_override', customMultiplier: null };
  }
  if (tenant.state) {
    const { data } = await supabase
      .from('state_cost_buckets')
      .select('bucket')
      .eq('state_code', String(tenant.state).toUpperCase())
      .single();
    if (data) return { bucket: data.bucket, source: 'state_lookup', customMultiplier: null };
  }
  return { bucket: 'mid', source: 'default', customMultiplier: null };
}

// Specialized routing — checks all input values against routes_to markers
async function checkSpecialized(verticalId, serviceSlug, inputs) {
  if (serviceSlug === 'specialized' || inputs.service_type === 'specialized') {
    return {
      specialized: true,
      reason: 'User selected specialized project',
      trigger: { question: 'service_type', value: 'specialized' },
      quote: null,
    };
  }
  if (serviceSlug === 'exterior' && inputs.stories === 'three_plus') {
    return {
      specialized: true,
      reason: '3+ stories require in-person estimate',
      trigger: { question: 'stories', value: 'three_plus' },
      quote: null,
    };
  }

  // Scan modifier options for routes_to: 'specialized'
  const { data: mods } = await supabase
    .from('vertical_modifier_categories')
    .select('category_slug, options')
    .eq('vertical_id', verticalId);

  for (const mod of mods || []) {
    const selected = inputs[mod.category_slug];
    if (selected === undefined || selected === null) continue;
    const selections = Array.isArray(selected) ? selected : [selected];
    for (const sel of selections) {
      const opt = (mod.options || []).find(o => o.value === sel);
      if (opt && opt.routes_to === 'specialized') {
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
  // Two-query join — avoids relying on supabase relationship auto-detection
  const { data: junction } = await supabase
    .from('vertical_service_modifier_categories')
    .select('modifier_category_id, required, sort_order')
    .eq('service_id', serviceId)
    .order('sort_order');
  if (!junction || junction.length === 0) return [];

  const ids = junction.map(j => j.modifier_category_id);
  const { data: cats } = await supabase
    .from('vertical_modifier_categories')
    .select('id, category_slug, modifier_type, multi_select, options')
    .in('id', ids);

  const byId = new Map((cats || []).map(c => [c.id, c]));
  return junction
    .map(j => byId.get(j.modifier_category_id))
    .filter(Boolean);
}

// Service-specific base computations
async function computeInteriorBase(verticalId, bucket, inputs) {
  const { data: rates } = await supabase
    .from('vertical_default_rates')
    .select('unit, base_rate_min_cents, base_rate_max_cents')
    .eq('vertical_id', verticalId)
    .eq('service_slug', 'interior')
    .eq('cost_region', bucket);

  const rateBySize = {};
  for (const r of rates || []) {
    rateBySize[r.unit.replace('room_', '')] = {
      min: r.base_rate_min_cents,
      max: r.base_rate_max_cents,
    };
  }

  let totalMin = 0, totalMax = 0;
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

  const { data: rate } = await supabase
    .from('vertical_default_rates')
    .select('base_rate_min_cents, base_rate_max_cents')
    .eq('vertical_id', verticalId)
    .eq('service_slug', 'exterior')
    .eq('cost_region', bucket)
    .eq('unit', 'paintable_sqft')
    .single();
  if (!rate) throw new Error('No exterior rate for paintable_sqft');

  return {
    baseMin: Math.round(paintableSqft * rate.base_rate_min_cents),
    baseMax: Math.round(paintableSqft * rate.base_rate_max_cents),
  };
}

async function computeCabinetsBase(verticalId, bucket, inputs) {
  const facings = Number(inputs.facing_count_exact || inputs.facing_count_midpoint || 0);
  if (facings < 1) throw new Error('Cabinets require facing count >= 1');

  const { data: rate } = await supabase
    .from('vertical_default_rates')
    .select('base_rate_min_cents, base_rate_max_cents')
    .eq('vertical_id', verticalId)
    .eq('service_slug', 'cabinets')
    .eq('cost_region', bucket)
    .eq('unit', 'door_drawer_facing')
    .single();
  if (!rate) throw new Error('No cabinets rate for door_drawer_facing');

  return {
    baseMin: facings * rate.base_rate_min_cents,
    baseMax: facings * rate.base_rate_max_cents,
  };
}

async function computeDeckFenceBase(verticalId, bucket, inputs) {
  let min = 0, max = 0;
  const wantsDeck = inputs.deck_or_fence === 'deck' || inputs.deck_or_fence === 'both';
  const wantsFence = inputs.deck_or_fence === 'fence' || inputs.deck_or_fence === 'both';

  if (wantsDeck) {
    if (!inputs.deck_size) throw new Error('deck_size required for deck');
    const { data: r } = await supabase
      .from('vertical_default_rates')
      .select('base_rate_min_cents, base_rate_max_cents')
      .eq('vertical_id', verticalId).eq('service_slug', 'deck_fence')
      .eq('cost_region', bucket).eq('unit', 'deck_sqft').single();
    min += Number(inputs.deck_size) * r.base_rate_min_cents;
    max += Number(inputs.deck_size) * r.base_rate_max_cents;
  }
  if (wantsFence) {
    if (!inputs.fence_linear_ft) throw new Error('fence_linear_ft required for fence');
    const { data: r } = await supabase
      .from('vertical_default_rates')
      .select('base_rate_min_cents, base_rate_max_cents')
      .eq('vertical_id', verticalId).eq('service_slug', 'deck_fence')
      .eq('cost_region', bucket).eq('unit', 'fence_linear_ft').single();
    min += Number(inputs.fence_linear_ft) * r.base_rate_min_cents;
    max += Number(inputs.fence_linear_ft) * r.base_rate_max_cents;
  }
  return { baseMin: Math.round(min), baseMax: Math.round(max) };
}

// Modifier application — multiplicative stacking, home_style filtered for exterior
function applyModifiers(baseMin, baseMax, mods, inputs, serviceSlug) {
  let min = baseMin, max = baseMax;
  const breakdown = { base: { min: baseMin, max: baseMax }, applied: [] };

  for (const mod of mods || []) {
    // ENGINE FILTER: home_style overlaps with stories coef on exterior — skip.
    // Cleanup migration to remove the junction row is in Rahul queue.
    if (serviceSlug === 'exterior' && mod.category_slug === 'home_style') {
      breakdown.applied.push({ category: 'home_style', skipped: 'filtered_for_exterior' });
      continue;
    }

    // Inputs use category_slug; for flat_per_item, fallback to <slug>_count
    let selected = inputs[mod.category_slug];
    if (mod.modifier_type === 'flat_per_item' && (selected === undefined || selected === null)) {
      selected = inputs[`${mod.category_slug}_count`];
    }
    if (selected === undefined || selected === null) continue;

    const selections = Array.isArray(selected) ? selected : [selected];

    if (mod.modifier_type === 'percentage') {
      // Both single-select and multi-select compound multiplicatively
      for (const sel of selections) {
        const opt = (mod.options || []).find(o => o.value === sel);
        if (!opt) continue;
        if (opt.adjustment === null || opt.adjustment === undefined) continue; // routes_to handled upstream
        const factor = 1 + Number(opt.adjustment);
        min = Math.round(min * factor);
        max = Math.round(max * factor);
        breakdown.applied.push({ category: mod.category_slug, value: sel, factor });
      }
    } else if (mod.modifier_type === 'flat_per_item') {
      // glass_inserts: count × $35 (3500 cents). Single seeded option.
      const count = Number(selections[0]) || 0;
      const opt = (mod.options || [])[0];
      if (opt && count > 0) {
        const addCents = count * Number(opt.adjustment);
        min += addCents;
        max += addCents;
        breakdown.applied.push({ category: mod.category_slug, count, addCents });
      }
    } else if (mod.modifier_type === 'flat_per_project') {
      const opt = (mod.options || []).find(o => o.value === selections[0]);
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

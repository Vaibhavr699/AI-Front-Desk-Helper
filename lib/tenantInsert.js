"use strict";

const TENANT_INSERT_DEFAULTS = {
  timezone: "America/Chicago",
  business_type: "standalone",
  account_type: "customer",
  parent_mode: "operating_hq",
  billing_owner: "direct",
  billing_responsibility: "parent_pays",
  plan: "basic",
  brand_mode: "ai_branded",
  follow_up_enabled: true,
  is_suspended: false,
  ai_master_enabled: true,
  ai_answers_after_hours: false,
  ring_first_enabled: false,
  ring_first_timeout_seconds: 20,
  estimator_enabled: false,
  estimator_pop_enabled: false,
  estimator_addon_purchased: false,
};

function buildTenantInsert(overrides, returning = "*") {
  const row = { ...TENANT_INSERT_DEFAULTS, ...(overrides || {}) };
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  const columns = entries.map(([key]) => key);
  const values = entries.map(([, value]) => value);
  const placeholders = values.map((_, index) => `$${index + 1}`);

  return {
    sql: `INSERT INTO tenants (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING ${returning}`,
    values,
  };
}

module.exports = {
  TENANT_INSERT_DEFAULTS,
  buildTenantInsert,
};

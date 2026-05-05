"use strict";
const { createClient } = require("@supabase/supabase-js");

const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

async function logAction({
  tenant_id = null,
  organization_id = null,
  user_id = null,
  action,
  entity_type = null,
  entity_id = null,
  old_value = null,
  new_value = null,
  ip_address = null,
  user_agent = null,
}) {
  try {
    if (!supabase) {
      console.warn("[auditLogger] Skipping log: Supabase SDK not initialized due to missing ENV variables.");
      return;
    }
    
    if (!action) {
      console.warn("[auditLogger] Missing action");
      return;
    }

    const resolvedTenantId = tenant_id || organization_id;
    const payload = {
      user_id: user_id ? String(user_id) : null,
      tenant_id: resolvedTenantId ? String(resolvedTenantId) : null,
      action: String(action),
      entity_type: entity_type ? String(entity_type) : null,
      entity_id: entity_id ? String(entity_id) : null,
      old_value: old_value ?? null,
      new_value: new_value ?? null,
      ip_address: ip_address ? String(ip_address) : null,
      user_agent: user_agent ? String(user_agent) : null,
    };

    const { error } = await supabase.from("audit_logs").insert(payload);

    if (error) {
      console.error("[auditLogger] ERROR:", JSON.stringify({
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint,
        payload,
      }));
    } else {
      console.log("[auditLogger] SUCCESS:", action);
    }
  } catch (err) {
    console.error("[auditLogger] Unexpected error:", err);
  }
}

async function auditLog(_db, payload = {}) {
  return logAction({
    tenant_id: payload.tenant_id || payload.organization_id,
    user_id: payload.user_id || payload.actor_id,
    action: payload.action,
    entity_type: payload.entity_type || payload.target_type,
    entity_id: payload.entity_id || payload.target_id,
    old_value: payload.old_value || null,
    new_value: payload.new_value || payload.details || null,
    ip_address: payload.ip_address || null,
    user_agent: payload.user_agent || null,
  });
}

module.exports = { logAction, auditLog };

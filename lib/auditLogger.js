"use strict";
const { createClient } = require("@supabase/supabase-js");
const supabase = process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY 
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  : null;

/**
 * Write a row to audit_logs.
 *
 * Migration 060 (May 9, 2026): added dnc_trigger_source param so TCPA
 * opt-out audit events can record what fired the DNC (sms_keyword,
 * sms_intent, voice_intent, owner_dashboard, compliance_email).
 * Non-DNC callers can omit it — defaults to null, payload unchanged.
 */
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
  dnc_trigger_source = null,
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
      // Legacy column compatibility: audit_logs.organization_id was renamed to
      // tenant_id during the SOC 2 schema migration, but the old column kept
      // its NOT NULL constraint and was never dropped. Every INSERT has been
      // silently 23502'ing as a result. Dual-write the same value until that
      // column is dropped (planned: future migration).
      organization_id: resolvedTenantId ? String(resolvedTenantId) : null,
      action: String(action),
      entity_type: entity_type ? String(entity_type) : null,
      entity_id: entity_id ? String(entity_id) : null,
      old_value: old_value ?? null,
      new_value: new_value ?? null,
      ip_address: ip_address ? String(ip_address) : null,
      user_agent: user_agent ? String(user_agent) : null,
      dnc_trigger_source: dnc_trigger_source ? String(dnc_trigger_source) : null,
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
    dnc_trigger_source: payload.dnc_trigger_source || null,
  });
}

module.exports = { logAction, auditLog };

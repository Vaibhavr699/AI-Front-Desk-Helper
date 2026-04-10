"use strict";

const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.warn("[auditLogger] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
}

const supabase = createClient(
  supabaseUrl || "",
  supabaseServiceRoleKey || ""
);

async function logAction({
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
    if (!action) {
      console.warn("[auditLogger] Missing required field: action");
      return;
    }

    const payload = {
      organization_id: organization_id ? String(organization_id) : null,
      user_id: user_id ? String(user_id) : null,
      action: String(action),
      entity_type: entity_type ? String(entity_type) : null,
      entity_id: entity_id ? String(entity_id) : null,
      old_value,
      new_value,
      ip_address: ip_address ? String(ip_address) : null,
      user_agent: user_agent ? String(user_agent) : null,
    };

    const { error } = await supabase.from("audit_logs").insert(payload);

    if (error) {
      console.error(
        "[auditLogger] Audit log failed:",
        JSON.stringify(
          {
            code: error.code,
            message: error.message,
            details: error.details,
            hint: error.hint,
            payload,
          },
          null,
          2
        )
      );
    } else {
      console.log("[auditLogger] Audit log inserted:", action);
    }
  } catch (err) {
    console.error(
      "[auditLogger] Unexpected error:",
      JSON.stringify(
        {
          message: err.message,
          stack: err.stack,
        },
        null,
        2
      )
    );
  }
}

module.exports = { logAction };

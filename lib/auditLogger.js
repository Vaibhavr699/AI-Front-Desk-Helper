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

function isUuid(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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
      action,
      old_value,
      new_value,
    };

    if (isUuid(organization_id)) payload.organization_id = organization_id;
    if (isUuid(user_id)) payload.user_id = user_id;

    if (entity_type !== null) payload.entity_type = entity_type;
    if (entity_id !== null) payload.entity_id = String(entity_id);
    if (ip_address !== null) payload.ip_address = String(ip_address);
    if (user_agent !== null) payload.user_agent = String(user_agent);

    const { error } = await supabase.from("audit_logs").insert(payload);

    if (error) {
      console.error("[auditLogger] FULL ERROR:");
      console.error("CODE:", error.code);
      console.error("MESSAGE:", error.message);
      console.error("DETAILS:", error.details);
      console.error("HINT:", error.hint);
      console.error("PAYLOAD:", payload);
    }
  } catch (err) {
    console.error("[auditLogger] Unexpected error:", err);
  }
}

module.exports = { logAction };

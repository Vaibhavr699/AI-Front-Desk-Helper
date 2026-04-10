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
  organization_id,
  user_id,
  action,
  old_value = null,
  new_value = null,
}) {
  try {
    if (!organization_id || !action) {
      console.warn("[auditLogger] Missing required fields:", {
        organization_id,
        action,
      });
      return;
    }

    const { error } = await supabase.from("audit_logs").insert({
      organization_id,
      user_id,
      action,
      old_value,
      new_value,
    });

    if (error) {
      console.error("[auditLogger] Audit log failed:", error);
    }
  } catch (err) {
    console.error("[auditLogger] Unexpected error:", err);
  }
}

module.exports = { logAction };

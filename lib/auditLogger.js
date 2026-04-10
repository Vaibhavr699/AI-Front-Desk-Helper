import { supabase } from "../supabaseClient";

export async function logAction({
  organization_id,
  user_id,
  action,
  new_value,
  old_value = null,
}) {
  const { error } = await supabase.from("audit_logs").insert({
    organization_id,
    user_id,
    action,
    new_value,
    old_value,
  });

  if (error) {
    console.error("Audit log failed:", error);
  }
}

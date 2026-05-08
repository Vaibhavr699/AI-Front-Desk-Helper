"use strict";

const db = require("../lib/db");
const notificationService = require("./notifications");

/**
 * Derive contact_method from available signals when not explicitly passed.
 * Priority: explicit arg > ID prefix > lead_source heuristics > 'unknown'.
 */
function deriveContactMethod(explicit, input, leadSource) {
  if (explicit) return explicit;
  if (typeof input === "string" && input.startsWith("fb-")) return "facebook";
  if (typeof input === "string" && input.startsWith("web-")) return "web_form";
  if (leadSource && /dripjobs|crm|webhook/i.test(leadSource)) return "crm";
  return "unknown";
}

/** Get or create a lead by phone number or external ID for a tenant */
async function getOrCreateLead(tenantId, phoneOrId, name = null, leadSource = null, contactMethod = null) {
  if (!tenantId || !phoneOrId) return null;
  const input = String(phoneOrId).trim();

  let res;

  // 1. Try to find by specialized external ID columns first if it's an ID
  if (input.startsWith("fb-")) {
    const fbId = input.replace("fb-", "");
    res = await db.query("SELECT * FROM leads WHERE tenant_id = $1 AND (facebook_id = $2 OR phone = $3)", [tenantId, fbId, input]);
  } else if (input.startsWith("web-")) {
    const webId = input.replace("web-", "");
    res = await db.query("SELECT * FROM leads WHERE tenant_id = $1 AND (web_id = $2 OR phone = $3)", [tenantId, webId, input]);
  } else {
    // Standard phone lookup
    res = await db.query("SELECT * FROM leads WHERE tenant_id = $1 AND phone = $2", [tenantId, input]);
  }

  if (res.rows.length > 0) {
    const lead = res.rows[0];

    // Sync external ID if missing but present in query
    if (input.startsWith("fb-") && !lead.facebook_id) {
       await db.query("UPDATE leads SET facebook_id = $1 WHERE id = $2", [input.replace("fb-", ""), lead.id]);
    } else if (input.startsWith("web-") && !lead.web_id) {
       await db.query("UPDATE leads SET web_id = $1 WHERE id = $2", [input.replace("web-", ""), lead.id]);
    }

    // If we have a name now but didn't before, update it
    if (name && !lead.name) {
      const updated = await db.query(
        "UPDATE leads SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
        [name, lead.id]
      );
      return updated.rows[0];
    }
    // NOTE: contact_method is intentionally NOT updated on existing leads.
    // It represents original acquisition channel and is immutable after INSERT.
    return lead;
  }

  // 2. Create new
  const facebook_id = input.startsWith("fb-") ? input.replace("fb-", "") : null;
  const web_id      = input.startsWith("web-") ? input.replace("web-", "") : null;
  const resolvedContactMethod = deriveContactMethod(contactMethod, input, leadSource);

  try {
    res = await db.query(
      `INSERT INTO leads (tenant_id, phone, name, status, lead_source, facebook_id, web_id, contact_method)
       VALUES ($1, $2, $3, 'New Lead', $4, $5, $6, $7)
       RETURNING *`,
      [tenantId, input, name, leadSource, facebook_id, web_id, resolvedContactMethod]
    );
    const newLead = res.rows[0];

    // 🆕 Fire new-lead notification (never blocks lead creation)
    notificationService.notifyNewLead(tenantId, {
      customer_name:  newLead.name,
      phone:          newLead.phone,
      source:         newLead.lead_source,
      contact_method: newLead.contact_method,
      lead_id:        newLead.id,
    }).catch((e) => console.error("[Leads] notifyNewLead failed:", e.message));

    return newLead;
  } catch (err) {
    // Handle race condition: retry lookup
    if (err.code === '23505') {
      return getOrCreateLead(tenantId, phoneOrId, name, leadSource, contactMethod);
    }
    throw err;
  }
}

async function updateLeadStatus(id, status) {
  return db.query(
    "UPDATE leads SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, status",
    [status, id]
  );
}

async function updateLeadInfo(id, data) {
  const fields = [];
  const values = [];
  let i = 1;

  // NOTE: contact_method is NOT in this allow-list — immutable after INSERT by design.
  // do_not_contact is also NOT in this allow-list — must go through setDoNotContact()
  // so the cascade (cancel recoveries + nurtures) and the audit fields fire correctly.
  // If an admin needs to bypass, do it via direct SQL.
  const allowed = [
    'name', 'email', 'address', 'project_type', 'notes', 'status',
    'estimated_revenue_cents', 'actual_revenue_cents', 'lead_source', 'has_sms_consent', 'last_consent_at',
    'last_consent_id', 'phone', 'facebook_id', 'web_id'
  ];
  for (const key of allowed) {
    if (data[key] !== undefined) {
      fields.push(`${key} = $${i++}`);
      values.push(data[key]);
    }
  }

  if (fields.length === 0) return null;

  values.push(id);
  const query = `UPDATE leads SET ${fields.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING *`;
  const res = await db.query(query, values);
  return res.rows[0];
}

async function getLeadById(id) {
  const res = await db.query(`
    SELECT l.*,
           sc.consent_text, sc.ip_address, sc.user_agent, sc.page_url, sc.source as consent_source,
           du.name as do_not_contact_set_by_name
    FROM leads l
    LEFT JOIN sms_consents sc   ON l.last_consent_id      = sc.id
    LEFT JOIN dashboard_users du ON l.do_not_contact_set_by = du.id
    WHERE l.id = $1
  `, [id]);
  return res.rows[0];
}

async function getLeadsByTenant(tenantIds, limit = 50, offset = 0) {
  // Accept either a single ID string or an array
  const ids = Array.isArray(tenantIds) ? tenantIds : [tenantIds];
  const res = await db.query(
    "SELECT * FROM leads WHERE tenant_id = ANY($1) ORDER BY updated_at DESC LIMIT $2 OFFSET $3",
    [ids, limit, offset]
  );
  return res.rows;
}

/**
 * Set / clear the do_not_contact flag for a lead.
 *
 * When flipping ON (value=true), this also CANCELS any active estimate
 * recoveries and pending nurturing schedule rows for the lead, so the
 * dashboard reflects clean state immediately and no cron tick can fire
 * a stray text. The cron-level suppression checks (services/estimateRecovery
 * and services/nurturing) are the durable defense — this cascade is the
 * "make it instant" cleanup.
 *
 * When flipping OFF (value=false), the lead is reopened to future
 * automation, but previously cancelled sequences stay cancelled. This is
 * intentional — un-cancelling old sequences would surprise users.
 *
 * Returns: { lead, cancelled_recoveries, cancelled_nurtures }
 *
 * options:
 *   - userId: dashboard_users.id of the person flipping the toggle (audit)
 *   - reason: optional free-text reason ("customer asked us to stop")
 *   - cascade: defaults true; set false to flip the flag without
 *     cancelling sequences (rarely needed — admin debugging only)
 */
async function setDoNotContact(leadId, value, options = {}) {
  if (!leadId) throw new Error("setDoNotContact: leadId required");
  const { userId = null, reason = null, cascade = true } = options;
  const flagging = Boolean(value);

  // 1. Update the lead row. Source of truth.
  const leadRes = await db.query(
    `UPDATE leads
        SET do_not_contact         = $1,
            do_not_contact_set_at  = CASE WHEN $1 THEN now() ELSE NULL END,
            do_not_contact_set_by  = CASE WHEN $1 THEN $2 ELSE NULL END,
            do_not_contact_reason  = CASE WHEN $1 THEN $3 ELSE NULL END,
            updated_at             = now()
      WHERE id = $4
      RETURNING *`,
    [flagging, userId, reason, leadId]
  );

  const lead = leadRes.rows[0];
  if (!lead) {
    throw new Error(`setDoNotContact: lead ${leadId} not found`);
  }

  let cancelled_recoveries = 0;
  let cancelled_nurtures = 0;

  // 2. Cascade only when turning ON. Best-effort: log + continue on errors.
  // The cron-level checks would catch anything we miss here on the next tick.
  if (flagging && cascade) {
    try {
      const recRes = await db.query(
        `UPDATE estimate_recoveries
            SET status = 'cancelled', updated_at = now()
          WHERE tenant_id = $1
            AND lead_id   = $2
            AND status IN ('active', 'paused', 'dormant')
          RETURNING id`,
        [lead.tenant_id, leadId]
      );
      cancelled_recoveries = recRes.rowCount || 0;
    } catch (err) {
      console.error("[Leads] setDoNotContact: recovery cascade failed leadId=%s err=%s",
        leadId, err.message);
    }

    try {
      const nurRes = await db.query(
        `UPDATE nurturing_schedule
            SET status = 'cancelled', updated_at = now()
          WHERE lead_id = $1
            AND status IN ('pending', 'scheduled')
          RETURNING id`,
        [leadId]
      );
      cancelled_nurtures = nurRes.rowCount || 0;
    } catch (err) {
      console.error("[Leads] setDoNotContact: nurture cascade failed leadId=%s err=%s",
        leadId, err.message);
    }
  }

  console.log(
    "[Leads] setDoNotContact leadId=%s flag=%s userId=%s cancelled_recoveries=%d cancelled_nurtures=%d reason=%s",
    leadId, flagging, userId || "(none)", cancelled_recoveries, cancelled_nurtures, reason || "(none)"
  );

  return { lead, cancelled_recoveries, cancelled_nurtures };
}

module.exports = {
  getOrCreateLead,
  updateLeadStatus,
  updateLeadInfo,
  getLeadById,
  getLeadsByTenant,
  setDoNotContact,
};

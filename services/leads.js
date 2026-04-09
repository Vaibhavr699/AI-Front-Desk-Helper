"use strict";

const db = require("../lib/db");

/** Get or create a lead by phone number or external ID for a tenant */
async function getOrCreateLead(tenantId, phoneOrId, name = null, leadSource = null) {
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
    return lead;
  }
  
  // 2. Create new
  const facebook_id = input.startsWith("fb-") ? input.replace("fb-", "") : null;
  const web_id = input.startsWith("web-") ? input.replace("web-", "") : null;

  try {
    res = await db.query(
      `INSERT INTO leads (tenant_id, phone, name, status, lead_source, facebook_id, web_id)
       VALUES ($1, $2, $3, 'New Lead', $4, $5, $6)
       RETURNING *`,
      [tenantId, input, name, leadSource, facebook_id, web_id]
    );
    return res.rows[0];
  } catch (err) {
    // Handle race condition: retry lookup
    if (err.code === '23505') {
      return getOrCreateLead(tenantId, phoneOrId, name, leadSource);
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
           sc.consent_text, sc.ip_address, sc.user_agent, sc.page_url, sc.source as consent_source
    FROM leads l
    LEFT JOIN sms_consents sc ON l.last_consent_id = sc.id
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

module.exports = {
  getOrCreateLead,
  updateLeadStatus,
  updateLeadInfo,
  getLeadById,
  getLeadsByTenant
};

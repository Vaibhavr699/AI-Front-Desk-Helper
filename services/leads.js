"use strict";

const db = require("../lib/db");

/** Get or create a lead by phone number for a tenant */
async function getOrCreateLead(tenantId, phone, name = null, leadSource = null) {
  if (!tenantId || !phone) return null;
  const normalizedPhone = String(phone).trim();
  
  // Try to find
  let res = await db.query(
    "SELECT * FROM leads WHERE tenant_id = $1 AND phone = $2",
    [tenantId, normalizedPhone]
  );
  
  if (res.rows.length > 0) {
    // If we have a name now but didn't before, update it
    if (name && !res.rows[0].name) {
      const updated = await db.query(
        "UPDATE leads SET name = $1, updated_at = now() WHERE id = $2 RETURNING *",
        [name, res.rows[0].id]
      );
      return updated.rows[0];
    }
    return res.rows[0];
  }
  
  // Create new
  try {
    res = await db.query(
      `INSERT INTO leads (tenant_id, phone, name, status, lead_source)
       VALUES ($1, $2, $3, 'New Lead', $4)
       RETURNING *`,
      [tenantId, normalizedPhone, name, leadSource]
    );
    return res.rows[0];
  } catch (err) {
    // Handle race condition: check again
    if (err.code === '23505') { // Unique violation
      res = await db.query(
        "SELECT * FROM leads WHERE tenant_id = $1 AND phone = $2",
        [tenantId, normalizedPhone]
      );
      return res.rows[0];
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
  
  const allowed = ['name', 'email', 'address', 'project_type', 'notes', 'status', 'estimated_revenue_cents', 'lead_source'];
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
  const res = await db.query("SELECT * FROM leads WHERE id = $1", [id]);
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

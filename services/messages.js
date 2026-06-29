"use strict";

const db = require("../lib/db");

async function saveMessage(tenantId, leadId, channel, direction, body, metadata = {}) {
  try {
    const res = await db.query(
      `INSERT INTO messages (tenant_id, lead_id, channel, direction, body, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [tenantId, leadId, channel, direction, body, JSON.stringify(metadata)]
    );
    
    // Also touch the lead to update its updated_at timestamp
    if (leadId) {
      await db.query("UPDATE leads SET updated_at = now() WHERE id = $1", [leadId]);
    }
    
    return res.rows[0];
  } catch (err) {
    console.error("[Messages] Failed to save message:", err.message);
    return null;
  }
}

async function getLeadMessages(leadId, limit = 50) {
  const res = await db.query(
    "SELECT * FROM messages WHERE lead_id = $1 ORDER BY created_at DESC LIMIT $2",
    [leadId, limit]
  );
  return res.rows;
}

module.exports = {
  saveMessage,
  getLeadMessages
};

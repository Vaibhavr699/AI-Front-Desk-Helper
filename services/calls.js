"use strict";

const db = require("../lib/db");

async function createCall(tenantId, twilioCallSid, fromNumber, toNumber, direction = "inbound") {
  const res = await db.query(
    `INSERT INTO calls (tenant_id, twilio_call_sid, from_number, to_number, direction, status)
     VALUES ($1, $2, $3, $4, $5, 'in_progress')
     ON CONFLICT (twilio_call_sid) DO UPDATE SET 
       updated_at = now(),
       from_number = EXCLUDED.from_number,
       to_number = EXCLUDED.to_number,
       direction = EXCLUDED.direction
     RETURNING *`,
    [tenantId, twilioCallSid, fromNumber, toNumber, direction]
  );
  return res.rows[0];
}

async function getCallByTwilioSid(twilioCallSid) {
  const res = await db.query(
    "SELECT * FROM calls WHERE twilio_call_sid = $1 LIMIT 1",
    [twilioCallSid]
  );
  return res.rows[0] || null;
}

async function getCallById(id) {
  const res = await db.query("SELECT * FROM calls WHERE id = $1", [id]);
  return res.rows[0] || null;
}

async function updateCall(id, updates) {
  const allowed = ["status", "disposition", "transferred", "transfer_to", "recording_sid", "ended_at", "metadata"];
  const set = [];
  const values = [];
  let i = 1;
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      set.push(`${key} = $${i}`);
      values.push(updates[key]);
      i++;
    }
  }
  if (set.length === 0) return null;
  set.push("updated_at = now()");
  values.push(id);
  const res = await db.query(
    `UPDATE calls SET ${set.join(", ")} WHERE id = $${i} RETURNING *`,
    values
  );
  return res.rows[0] || null;
}

async function updateCallByTwilioSid(twilioCallSid, updates) {
  const call = await getCallByTwilioSid(twilioCallSid);
  if (!call) return null;
  return updateCall(call.id, updates);
}

module.exports = {
  createCall,
  getCallByTwilioSid,
  getCallById,
  updateCall,
  updateCallByTwilioSid,
};

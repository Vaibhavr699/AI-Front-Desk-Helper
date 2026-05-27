"use strict";

const express = require("express");
const db = require("../../lib/db");
const { repAuthChain } = require("../../lib/requireRep");
const twilioLib = require("../../lib/twilio");
const { normalizeE164Phone } = require("../../lib/phone");

const router = express.Router();

const BASE_URL = (process.env.BASE_URL || "").replace(/\/$/, "");

router.post("/initiate", ...repAuthChain, async (req, res) => {
  try {
    if (!req.rep.tenant_flags?.rep_coach_enabled) {
      return res.status(403).json({ error: "Rep Coach not enabled" });
    }
    const { lead_id } = req.body || {};
    if (!lead_id) return res.status(400).json({ error: "lead_id required" });

    const leadR = await db.query(
      "SELECT id, phone, name FROM leads WHERE id = $1 AND tenant_id = $2",
      [lead_id, req.rep.tenant_id],
    );
    const lead = leadR.rows[0];
    if (!lead) return res.status(404).json({ error: "Lead not found" });
    if (!lead.phone) return res.status(400).json({ error: "Lead has no phone number" });

    const callerIdR = await db.query(
      `SELECT COALESCE(
        (SELECT rep_caller_id_number FROM dashboard_users WHERE id = $1 AND rep_caller_id_number IS NOT NULL),
        (SELECT phone FROM phone_numbers WHERE tenant_id = $2 AND is_active = true LIMIT 1)
      ) AS caller_id`,
      [req.rep.id, req.rep.tenant_id],
    );
    const callerId = callerIdR.rows[0]?.caller_id;
    if (!callerId) {
      return res.status(400).json({ error: "No caller ID available. Configure a phone number first." });
    }

    const client = twilioLib.getClientForTenant({ id: req.rep.tenant_id });
    const confName = `rep-call-${req.rep.id}-${Date.now()}`;

    const customerCall = await client.calls.create({
      to: lead.phone,
      from: callerId,
      url: `${BASE_URL}/twilio/rep-call-connect?conf=${encodeURIComponent(confName)}`,
      record: true,
      recordingStatusCallback: `${BASE_URL}/twilio/rep-recording-status?repUserId=${req.rep.id}&leadId=${lead_id}&tenantId=${req.rep.tenant_id}`,
      statusCallback: `${BASE_URL}/twilio/rep-call-status`,
    });

    await db.query(
      `INSERT INTO recording_consents
         (tenant_id, lead_id, rep_user_id, consent_status, consent_method)
       VALUES ($1, $2, $3, 'obtained', 'tts_voip')`,
      [req.rep.tenant_id, lead_id, req.rep.id],
    );

    res.json({
      call_sid: customerCall.sid,
      conference: confName,
      status: "initiating",
      lead_name: lead.name,
    });
  } catch (e) {
    console.error("[rep/call/initiate]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/:callSid/status", ...repAuthChain, async (req, res) => {
  try {
    const client = twilioLib.getClientForTenant({ id: req.rep.tenant_id });
    const call = await client.calls(req.params.callSid).fetch();
    res.json({ status: call.status, duration: call.duration });
  } catch (e) {
    res.status(500).json({ error: "Could not fetch call status" });
  }
});

router.post("/:callSid/end", ...repAuthChain, async (req, res) => {
  try {
    const client = twilioLib.getClientForTenant({ id: req.rep.tenant_id });
    await client.calls(req.params.callSid).update({ status: "completed" });
    res.json({ status: "completed" });
  } catch (e) {
    res.status(500).json({ error: "Could not end call" });
  }
});

module.exports = router;

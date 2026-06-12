"use strict";

const express = require("express");
const fs = require("fs");
const multer = require("multer");
const db = require("../../lib/db");
const repAuth = require("../../lib/repAuth");
const { repAuthChain } = require("../../lib/requireRep");
const { stitchSession, cleanupWorkDir } = require("../../services/inHomeStitch");
const { clearSession, chunkPath, sessionDir } = require("../../lib/inHomeChunkStore");
const {
  uploadToS3,
  transcribeBuffer,
  diarizeTranscript,
} = require("../../services/fieldRecording");
const { analyzeConversation } = require("../../lib/coachingEngine");

const router = express.Router();
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

async function processSessionRecording({ session, tenantId, repUserId }) {
  let stitched = null;
  try {
    stitched = await stitchSession(session.id);
    if (!stitched) return;

    const convR = await db.query(
      `INSERT INTO coaching_conversations
         (tenant_id, source_type, rep_user_id, lead_id, duration_seconds)
       VALUES ($1, 'in_home_session', $2, $3, $4)
       RETURNING id`,
      [tenantId, repUserId, session.lead_id || null, 0],
    );
    const conversationId = convR.rows[0].id;

    await db.query(
      `UPDATE in_home_sessions
          SET coaching_conversation_id = $1
        WHERE id = $2`,
      [conversationId, session.id],
    );

    const s3Key = await uploadToS3(tenantId, conversationId, stitched.buffer, "m4a");
    const result = await transcribeBuffer(stitched.buffer, "m4a");

    let transcript = result.segments;
    try {
      const diarized = await diarizeTranscript(result.text);
      if (diarized && diarized.length >= 2) transcript = diarized;
    } catch (err) {
      console.error("[inHomeStitch] diarization failed:", err.message);
    }

    await db.query(
      `UPDATE coaching_conversations
          SET transcript = $1::jsonb,
              duration_seconds = COALESCE(NULLIF($2, 0), duration_seconds),
              metadata = jsonb_build_object('s3_key', $3, 'in_home_session_id', $4),
              updated_at = now()
        WHERE id = $5`,
      [JSON.stringify(transcript), result.duration, s3Key, session.id, conversationId],
    );
    await analyzeConversation({ conversationId });
    console.log(
      "[inHomeStitch] stored session=%s conversation=%s chunks=%s",
      session.id,
      conversationId,
      stitched.chunkCount,
    );
  } catch (err) {
    console.error("[inHomeStitch] processing failed session=%s: %s", session.id, err.message);
  } finally {
    if (stitched) cleanupWorkDir(stitched.workDir);
    clearSession(session.id);
  }
}

const VALID_NETWORK_MODES = new Set(["online", "degraded", "offline"]);

function shapeSession(row) {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    user_id: row.user_id,
    lead_id: row.lead_id,
    started_at: row.started_at,
    ended_at: row.ended_at,
    consent_obtained: row.consent_obtained === true,
    consent_type: row.consent_type,
    consent_state: row.consent_state,
    device_type: row.device_type,
    network_mode: row.network_mode,
    transcript: row.transcript || [],
    disc_progression: row.disc_progression || null,
    coaching_alerts: row.coaching_alerts || null,
    walkthrough_checklist_completed: row.walkthrough_checklist_completed || null,
    outcome: row.outcome,
    estimate_value_cents: row.estimate_value_cents,
    rep_satisfaction: row.rep_satisfaction,
    customer_signals: row.customer_signals || null,
    delivery_mode_used: row.delivery_mode_used || null,
  };
}

function shapeAlert(row) {
  return {
    id: row.id,
    session_id: row.session_id,
    alert_type: row.alert_type,
    alert_content: row.alert_content,
    alert_color: row.alert_color,
    alert_urgency: row.alert_urgency,
    cue_type: row.cue_type || null,
    watch_label: row.watch_label || null,
    fired_at: row.fired_at,
    window_start: row.window_start || null,
    window_end: row.window_end || null,
    dismissed_at: row.dismissed_at || null,
    delivery_method: row.delivery_method,
    rep_action_taken: row.rep_action_taken,
    outcome_after: row.outcome_after,
    payload: row.payload || null,
  };
}

router.post("/start", ...repAuthChain, async (req, res) => {
  try {
    const {
      lead_id,
      consent_obtained,
      consent_type,
      consent_state,
      device_type,
      network_mode,
    } = req.body || {};

    if (consent_obtained !== true && consent_obtained !== false) {
      return res
        .status(400)
        .json({ error: "consent_obtained (boolean) is required" });
    }

    if (lead_id) {
      const r = await db.query(
        "SELECT id FROM leads WHERE id = $1 AND tenant_id = $2",
        [lead_id, req.rep.tenant_id],
      );
      if (!r.rows[0]) {
        return res.status(404).json({ error: "Lead not found" });
      }
    }

    if (network_mode && !VALID_NETWORK_MODES.has(network_mode)) {
      return res.status(400).json({
        error: `network_mode must be one of: ${[...VALID_NETWORK_MODES].join(", ")}`,
      });
    }

    const insert = await db.query(
      `INSERT INTO in_home_sessions
         (tenant_id, user_id, lead_id, started_at, consent_obtained,
          consent_type, consent_state, device_type, network_mode)
       VALUES ($1, $2, $3, now(), $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        req.rep.tenant_id,
        req.rep.id,
        lead_id || null,
        !!consent_obtained,
        consent_type || null,
        consent_state || null,
        device_type || null,
        network_mode || "online",
      ],
    );
    const session = insert.rows[0];

    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_in_home_started",
      metadata: {
        session_id: session.id,
        lead_id: lead_id || null,
        consent_obtained: !!consent_obtained,
        consent_state: consent_state || null,
        device_type: device_type || null,
      },
    });

    res.json({
      session: shapeSession(session),
      ws_path: `/ws/rep/in-home/${session.id}`,
    });
  } catch (e) {
    console.error("[rep/in-home/start]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/end", ...repAuthChain, async (req, res) => {
  try {
    const {
      session_id,
      outcome,
      estimate_value_cents,
      customer_signals,
      delivery_mode_used,
    } = req.body || {};
    if (!session_id) {
      return res.status(400).json({ error: "session_id required" });
    }

    const r = await db.query(
      `SELECT * FROM in_home_sessions
        WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
      [session_id, req.rep.id, req.rep.tenant_id],
    );
    const session = r.rows[0];
    if (!session) return res.status(404).json({ error: "Session not found" });
    if (session.ended_at) {
      return res.json({ session: shapeSession(session), already_ended: true });
    }

    const update = await db.query(
      `UPDATE in_home_sessions
          SET ended_at            = now(),
              outcome             = COALESCE($1, outcome),
              estimate_value_cents = COALESCE($2, estimate_value_cents),
              customer_signals    = COALESCE($3::jsonb, customer_signals),
              delivery_mode_used  = COALESCE($4::jsonb, delivery_mode_used)
        WHERE id = $5
        RETURNING *`,
      [
        outcome || null,
        Number.isFinite(Number(estimate_value_cents))
          ? Number(estimate_value_cents)
          : null,
        customer_signals ? JSON.stringify(customer_signals) : null,
        delivery_mode_used ? JSON.stringify(delivery_mode_used) : null,
        session_id,
      ],
    );

    const durationMs =
      new Date(update.rows[0].ended_at).getTime() -
      new Date(update.rows[0].started_at).getTime();

    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_in_home_ended",
      metadata: {
        session_id,
        outcome: outcome || null,
        duration_seconds: Math.round(durationMs / 1000),
      },
    });

    res.json({ session: shapeSession(update.rows[0]) });

    setImmediate(() => {
      processSessionRecording({
        session: update.rows[0],
        tenantId: req.rep.tenant_id,
        repUserId: req.rep.id,
      });
    });
  } catch (e) {
    console.error("[rep/in-home/end]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/sessions", ...repAuthChain, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const r = await db.query(
      `SELECT id, lead_id, started_at, ended_at, outcome,
              estimate_value_cents, rep_satisfaction, consent_state
         FROM in_home_sessions
        WHERE user_id = $1 AND tenant_id = $2
        ORDER BY started_at DESC
        LIMIT $3`,
      [req.rep.id, req.rep.tenant_id, limit],
    );
    res.json({ sessions: r.rows });
  } catch (e) {
    console.error("[rep/in-home/sessions]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/sessions/:id", ...repAuthChain, async (req, res) => {
  try {
    const [sessionRes, alertsRes] = await Promise.all([
      db.query(
        `SELECT * FROM in_home_sessions
          WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
        [req.params.id, req.rep.id, req.rep.tenant_id],
      ),
      db.query(
        `SELECT * FROM in_home_alerts
          WHERE session_id = $1
          ORDER BY fired_at ASC`,
        [req.params.id],
      ),
    ]);
    const session = sessionRes.rows[0];
    if (!session) return res.status(404).json({ error: "Session not found" });
    res.json({
      session: shapeSession(session),
      alerts: alertsRes.rows.map(shapeAlert),
    });
  } catch (e) {
    console.error("[rep/in-home/sessions/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post(
  "/sessions/:id/feedback",
  ...repAuthChain,
  async (req, res) => {
    try {
      const satisfaction = Number(req.body?.rep_satisfaction);
      if (!Number.isInteger(satisfaction) || satisfaction < 1 || satisfaction > 5) {
        return res
          .status(400)
          .json({ error: "rep_satisfaction must be an integer 1-5" });
      }
      const r = await db.query(
        `UPDATE in_home_sessions
            SET rep_satisfaction = $1
          WHERE id = $2 AND user_id = $3 AND tenant_id = $4
          RETURNING *`,
        [satisfaction, req.params.id, req.rep.id, req.rep.tenant_id],
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Session not found" });
      res.json({ session: shapeSession(r.rows[0]) });
    } catch (e) {
      console.error("[rep/in-home/sessions/:id/feedback]", e);
      res.status(500).json({ error: "Server error" });
    }
  },
);

router.post(
  "/sessions/:id/chunks",
  ...repAuthChain,
  chunkUpload.single("chunk"),
  async (req, res) => {
    try {
      const seq = Number(req.body?.seq);
      if (!Number.isInteger(seq) || seq < 0) {
        return res.status(400).json({ error: "seq must be a non-negative integer" });
      }
      if (!req.file) {
        return res.status(400).json({ error: "chunk file required" });
      }
      const r = await db.query(
        `SELECT id FROM in_home_sessions
          WHERE id = $1 AND user_id = $2 AND tenant_id = $3`,
        [req.params.id, req.rep.id, req.rep.tenant_id],
      );
      if (!r.rows[0]) return res.status(404).json({ error: "Session not found" });

      const dest = chunkPath(req.params.id, seq);
      if (!fs.existsSync(dest)) {
        fs.mkdirSync(sessionDir(req.params.id), { recursive: true });
        fs.writeFileSync(dest, req.file.buffer);
      }
      res.json({ seq, stored: true });
    } catch (e) {
      console.error("[rep/in-home/sessions/:id/chunks]", e);
      res.status(500).json({ error: "Server error" });
    }
  },
);

module.exports = router;

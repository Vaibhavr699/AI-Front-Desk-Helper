"use strict";

// routes/coachingTest.js
// TEMPORARY — Phase 6 A1 smoke test endpoint. Delete after verification.
// Auth: shared secret via X-Test-Secret header.

const express = require("express");
const db = require("../lib/db");
const { analyzeConversation } = require("../lib/coachingEngine");

const router = express.Router();

router.use((req, res, next) => {
  const secret = req.headers["x-test-secret"];
  if (!secret || secret !== process.env.COACHING_TEST_SECRET) {
    return res.status(403).json({ error: "forbidden" });
  }
  next();
});

router.post("/run", async (req, res) => {
  try {
    const { tenant_id, transcript, conversation_id, industry } = req.body || {};

    let convId = conversation_id;

    if (!convId) {
      if (!tenant_id) {
        return res.status(400).json({ error: "tenant_id required when no conversation_id supplied" });
      }
      if (!Array.isArray(transcript) || transcript.length === 0) {
        return res.status(400).json({ error: "transcript array required when no conversation_id supplied" });
      }

      const insertResult = await db.query(
        `INSERT INTO coaching_conversations
           (tenant_id, source_type, industry, transcript, customer_name)
         VALUES ($1, 'rep_recording', $2, $3::jsonb, 'Smoke Test Customer')
         RETURNING id`,
        [tenant_id, industry || "painting", JSON.stringify(transcript)]
      );
      convId = insertResult.rows[0].id;
    }

    const analyzeResult = await analyzeConversation({ conversationId: convId });

    const conv = await db.query(
      `SELECT id, tenant_id, source_type, industry, customer_name,
              overall_score, scored_at, scoring_model,
              buyer_persona, persona_confidence, persona_signals, persona_detected_at
         FROM coaching_conversations
        WHERE id = $1`,
      [convId]
    ).then((r) => r.rows[0]);

    const scores = await db.query(
      `SELECT dimension, score, rationale
         FROM coaching_scores
        WHERE conversation_id = $1
        ORDER BY dimension`,
      [convId]
    ).then((r) => r.rows);

    res.json({
      ok: true,
      conversation_id: convId,
      analyze_result: analyzeResult,
      conversation: conv,
      scores,
    });
  } catch (err) {
    console.error("[coachingTest] error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

"use strict";

const express = require("express");
const multer = require("multer");
const db = require("../../lib/db");
const { repAuthChain } = require("../../lib/requireRep");
const { isTwoPartyConsentState } = require("../../lib/consentStates");
const { uploadToS3, transcribeBuffer, diarizeTranscript } = require("../../services/fieldRecording");
const { analyzeConversation } = require("../../lib/coachingEngine");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

router.post("/upload", ...repAuthChain, upload.single("audio"), async (req, res) => {
  try {
    if (!req.rep.tenant_flags?.rep_coach_enabled) {
      return res.status(403).json({ error: "Rep Coach not enabled" });
    }
    if (!req.file) {
      return res.status(400).json({ error: "Audio file required" });
    }
    const { lead_id, consent_status, consent_method, consent_state, duration_seconds } = req.body || {};
    if (!lead_id) {
      return res.status(400).json({ error: "lead_id required" });
    }
    if (isTwoPartyConsentState(consent_state) && consent_status !== "obtained") {
      return res.status(403).json({ error: "Consent required in two-party consent states" });
    }
    const leadCheck = await db.query(
      "SELECT id FROM leads WHERE id = $1 AND tenant_id = $2",
      [lead_id, req.rep.tenant_id],
    );
    if (!leadCheck.rows[0]) {
      return res.status(404).json({ error: "Lead not found" });
    }

    const ext = req.file.originalname?.split(".").pop() || "m4a";
    const buffer = req.file.buffer;

    const convR = await db.query(
      `INSERT INTO coaching_conversations
         (tenant_id, source_type, rep_user_id, lead_id, duration_seconds)
       VALUES ($1, 'rep_recording', $2, $3, $4)
       RETURNING id`,
      [req.rep.tenant_id, req.rep.id, lead_id, parseInt(duration_seconds, 10) || 0],
    );
    const conversationId = convR.rows[0].id;

    await db.query(
      `INSERT INTO recording_consents
         (tenant_id, coaching_conversation_id, lead_id, rep_user_id,
          consent_status, consent_method, consent_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        req.rep.tenant_id, conversationId, lead_id, req.rep.id,
        consent_status || "not_required",
        consent_method || "one_party_state",
        consent_state || null,
      ],
    );

    res.json({ conversation_id: conversationId, status: "processing" });

    setImmediate(async () => {
      try {
        const s3Key = await uploadToS3(req.rep.tenant_id, conversationId, buffer, ext);
        const result = await transcribeBuffer(buffer, ext);

        // Single-mic recordings have no speaker labels — diarize into
        // rep/customer turns so the scoring engine sees a two-sided
        // conversation. Fall back to raw segments if diarization fails.
        let transcript = result.segments;
        try {
          const diarized = await diarizeTranscript(result.text);
          if (diarized && diarized.length >= 2) transcript = diarized;
        } catch (err) {
          console.error("[fieldRecording] diarization failed:", err.message);
        }

        await db.query(
          `UPDATE coaching_conversations
              SET transcript = $1::jsonb,
                  duration_seconds = COALESCE(NULLIF($2, 0), duration_seconds),
                  metadata = jsonb_build_object('s3_key', $3),
                  updated_at = now()
            WHERE id = $4`,
          [JSON.stringify(transcript), result.duration, s3Key, conversationId],
        );
        await analyzeConversation({ conversationId });
        console.log("[fieldRecording] analyzed conversation=%s lead=%s", conversationId, lead_id);
      } catch (err) {
        console.error("[fieldRecording] async processing failed:", err.message);
      }
    });
  } catch (e) {
    console.error("[rep/recording/upload]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

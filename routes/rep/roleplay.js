"use strict";

const express = require("express");
const multer = require("multer");
const db = require("../../lib/db");
const repAuth = require("../../lib/repAuth");
const { repAuthChain } = require("../../lib/requireRep");
const {
  generateAiTurn,
  generateCustomPersona,
  scoreRoleplay,
} = require("../../lib/roleplayAi");
const { transcribeBuffer } = require("../../services/fieldRecording");
const { synthesizeRoleplayAudio } = require("../../services/roleplayTts");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });

function shapeScenario(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    industry: row.industry,
    scenario_type: row.scenario_type,
    difficulty: row.difficulty,
    skills_trained: row.skills_trained || [],
    disc_type: row.disc_type,
    is_template: row.is_template,
    is_custom: !row.is_template,
  };
}

function shapeSession(row, scenario) {
  return {
    id: row.id,
    scenario_id: row.scenario_id,
    scenario: scenario ? shapeScenario(scenario) : null,
    custom_scenario_text: row.custom_scenario_text,
    transcript: row.transcript || [],
    scoring: row.scoring || null,
    outcome: row.outcome,
    duration_seconds: row.duration_seconds,
    started_at: row.started_at,
    completed_at: row.completed_at,
  };
}

router.get("/scenarios", ...repAuthChain, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT id, tenant_id, title, description, industry, scenario_type,
              difficulty, skills_trained, disc_type, is_template, created_at
         FROM roleplay_scenarios
        WHERE is_template = true
          AND (tenant_id IS NULL OR tenant_id = $1)
        ORDER BY (tenant_id IS NULL) DESC, difficulty ASC NULLS LAST, title ASC`,
      [req.rep.tenant_id]
    );
    res.json({ scenarios: r.rows.map(shapeScenario) });
  } catch (e) {
    console.error("[rep/roleplay/scenarios]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/start", ...repAuthChain, async (req, res) => {
  try {
    const { scenario_id, custom_text } = req.body || {};
    if (!scenario_id && !custom_text) {
      return res.status(400).json({ error: "scenario_id or custom_text required" });
    }

    let scenario = null;
    let customPersonaPrompt = null;
    let opening = null;

    if (scenario_id) {
      const r = await db.query(
        `SELECT * FROM roleplay_scenarios
          WHERE id = $1 AND (tenant_id IS NULL OR tenant_id = $2)`,
        [scenario_id, req.rep.tenant_id]
      );
      if (!r.rows[0]) {
        return res.status(404).json({ error: "Scenario not found" });
      }
      scenario = r.rows[0];
      opening = scenario.initial_opening;
    } else {
      try {
        const generated = await generateCustomPersona(String(custom_text));
        scenario = {
          id: null,
          title: generated.title,
          industry: null,
          scenario_type: "custom",
          disc_type: generated.disc_type,
          skills_trained: [],
          caller_persona_prompt: generated.caller_persona_prompt,
          initial_opening: generated.initial_opening,
        };
        customPersonaPrompt = generated.caller_persona_prompt;
        opening = generated.initial_opening;
      } catch (err) {
        console.error("[rep/roleplay/start] custom persona failed:", err.message);
        return res.status(502).json({ error: "Couldn't build that scenario. Try a different description." });
      }
    }

    const openingTurn = {
      role: "customer",
      text: opening,
      at: new Date().toISOString(),
    };

    const insert = await db.query(
      `INSERT INTO roleplay_sessions
         (tenant_id, user_id, scenario_id, custom_scenario_text,
          custom_persona_prompt, custom_opening, transcript, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
       RETURNING id, scenario_id, custom_scenario_text, transcript, started_at, completed_at,
                 scoring, outcome, duration_seconds`,
      [
        req.rep.tenant_id,
        req.rep.id,
        scenario_id || null,
        custom_text || null,
        customPersonaPrompt,
        custom_text ? opening : null,
        JSON.stringify([openingTurn]),
      ]
    );

    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_roleplay_started",
      metadata: { scenario_id: scenario_id || null, custom: !!custom_text },
    });

    res.json({
      session: shapeSession(insert.rows[0], scenario_id ? scenario : null),
      opening,
    });
  } catch (e) {
    console.error("[rep/roleplay/start]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/respond", ...repAuthChain, async (req, res) => {
  try {
    const { session_id, message } = req.body || {};
    if (!session_id || typeof message !== "string" || !message.trim()) {
      return res.status(400).json({ error: "session_id and message required" });
    }

    const r = await db.query(
      `SELECT s.*,
              sc.title, sc.industry, sc.scenario_type, sc.disc_type,
              sc.skills_trained, sc.caller_persona_prompt
         FROM roleplay_sessions s
         LEFT JOIN roleplay_scenarios sc ON sc.id = s.scenario_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.tenant_id = $3`,
      [session_id, req.rep.id, req.rep.tenant_id]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: "Session not found" });
    if (row.completed_at) {
      return res.status(409).json({ error: "Session already ended" });
    }

    const scenarioForAi = {
      title: row.title,
      industry: row.industry,
      scenario_type: row.scenario_type,
      disc_type: row.disc_type,
      skills_trained: row.skills_trained || [],
      caller_persona_prompt: row.caller_persona_prompt || row.custom_persona_prompt,
    };

    const transcript = row.transcript || [];
    const repTurn = {
      role: "rep",
      text: String(message).trim(),
      at: new Date().toISOString(),
    };
    const nextTranscript = [...transcript, repTurn];

    let aiTurn;
    try {
      aiTurn = await generateAiTurn(scenarioForAi, nextTranscript);
    } catch (err) {
      console.error("[rep/roleplay/respond] ai turn failed:", err.message);
      return res.status(502).json({ error: "Customer is quiet. Try again in a moment." });
    }

    const updated = [...nextTranscript, aiTurn];
    await db.query(
      "UPDATE roleplay_sessions SET transcript = $1::jsonb WHERE id = $2",
      [JSON.stringify(updated), session_id]
    );

    res.json({ rep_turn: repTurn, ai_turn: aiTurn });
  } catch (e) {
    console.error("[rep/roleplay/respond]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/respond-voice", ...repAuthChain, upload.single("audio"), async (req, res) => {
  try {
    const session_id = req.body?.session_id;
    if (!session_id || !req.file) {
      return res.status(400).json({ error: "session_id and audio required" });
    }

    const r = await db.query(
      `SELECT s.*,
              sc.title, sc.industry, sc.scenario_type, sc.disc_type,
              sc.skills_trained, sc.caller_persona_prompt
         FROM roleplay_sessions s
         LEFT JOIN roleplay_scenarios sc ON sc.id = s.scenario_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.tenant_id = $3`,
      [session_id, req.rep.id, req.rep.tenant_id]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: "Session not found" });
    if (row.completed_at) {
      return res.status(409).json({ error: "Session already ended" });
    }

    let repText = "";
    try {
      const ext = req.file.originalname?.split(".").pop() || "m4a";
      const t = await transcribeBuffer(req.file.buffer, ext);
      repText = (t.text || "").trim();
    } catch (err) {
      console.error("[rep/roleplay/respond-voice] transcribe failed:", err.message);
      return res.status(502).json({ error: "Couldn't hear that. Try again." });
    }
    if (!repText) {
      return res.status(422).json({ error: "Didn't catch that — try speaking again." });
    }

    const scenarioForAi = {
      title: row.title,
      industry: row.industry,
      scenario_type: row.scenario_type,
      disc_type: row.disc_type,
      skills_trained: row.skills_trained || [],
      caller_persona_prompt: row.caller_persona_prompt || row.custom_persona_prompt,
    };

    const transcript = row.transcript || [];
    const repTurn = { role: "rep", text: repText, at: new Date().toISOString() };
    const nextTranscript = [...transcript, repTurn];

    let aiTurn;
    try {
      aiTurn = await generateAiTurn(scenarioForAi, nextTranscript);
    } catch (err) {
      console.error("[rep/roleplay/respond-voice] ai turn failed:", err.message);
      return res.status(502).json({ error: "Customer is quiet. Try again in a moment." });
    }

    const updated = [...nextTranscript, aiTurn];
    await db.query(
      "UPDATE roleplay_sessions SET transcript = $1::jsonb WHERE id = $2",
      [JSON.stringify(updated), session_id]
    );

    let aiAudioBase64 = null;
    try {
      const buf = await synthesizeRoleplayAudio(aiTurn.text);
      if (buf) aiAudioBase64 = buf.toString("base64");
    } catch (err) {
      console.error("[rep/roleplay/respond-voice] tts failed:", err.message);
    }

    res.json({ rep_turn: repTurn, ai_turn: aiTurn, ai_audio_base64: aiAudioBase64 });
  } catch (e) {
    console.error("[rep/roleplay/respond-voice]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/speak", ...repAuthChain, async (req, res) => {
  try {
    const text = typeof req.body?.text === "string" ? req.body.text.trim() : "";
    if (!text) return res.status(400).json({ error: "text required" });
    const buf = await synthesizeRoleplayAudio(text);
    if (!buf) return res.status(502).json({ error: "Couldn't synthesize audio" });
    res.json({ audio_base64: buf.toString("base64") });
  } catch (e) {
    console.error("[rep/roleplay/speak]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.post("/end", ...repAuthChain, async (req, res) => {
  try {
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: "session_id required" });

    const r = await db.query(
      `SELECT s.*, sc.title, sc.industry, sc.scenario_type, sc.disc_type,
              sc.skills_trained, sc.caller_persona_prompt
         FROM roleplay_sessions s
         LEFT JOIN roleplay_scenarios sc ON sc.id = s.scenario_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.tenant_id = $3`,
      [session_id, req.rep.id, req.rep.tenant_id]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: "Session not found" });
    if (row.completed_at) {
      return res.json({
        scoring: row.scoring,
        outcome: row.outcome,
        duration_seconds: row.duration_seconds,
      });
    }

    const scenarioForAi = {
      title: row.title,
      industry: row.industry,
      scenario_type: row.scenario_type,
      disc_type: row.disc_type,
      skills_trained: row.skills_trained || [],
      caller_persona_prompt: row.caller_persona_prompt || row.custom_persona_prompt,
    };

    let scoring;
    try {
      scoring = await scoreRoleplay(scenarioForAi, row.transcript || [], req.rep.tenant_id);
    } catch (err) {
      console.error("[rep/roleplay/end] scoring failed:", err.message);
      return res.status(502).json({ error: "Couldn't score this session. Try again." });
    }

    const startedAt = new Date(row.started_at).getTime();
    const durationSeconds = Math.round((Date.now() - startedAt) / 1000);

    await db.query(
      `UPDATE roleplay_sessions
          SET scoring          = $1::jsonb,
              outcome          = $2,
              duration_seconds = $3,
              completed_at     = now()
        WHERE id = $4`,
      [JSON.stringify(scoring), scoring.outcome, durationSeconds, session_id]
    );

    await repAuth.logRepEvent(req, {
      user_id: req.rep.id,
      tenant_id: req.rep.tenant_id,
      event_type: "rep_roleplay_completed",
      metadata: {
        session_id,
        scenario_id: row.scenario_id,
        outcome: scoring.outcome,
        overall_score: scoring.overall_score,
        duration_seconds: durationSeconds,
      },
    });

    res.json({ scoring, outcome: scoring.outcome, duration_seconds: durationSeconds });
  } catch (e) {
    console.error("[rep/roleplay/end]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/sessions", ...repAuthChain, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const r = await db.query(
      `SELECT s.id, s.scenario_id, s.custom_scenario_text, s.scoring,
              s.outcome, s.duration_seconds, s.started_at, s.completed_at,
              sc.title AS scenario_title, sc.disc_type AS scenario_disc
         FROM roleplay_sessions s
         LEFT JOIN roleplay_scenarios sc ON sc.id = s.scenario_id
        WHERE s.user_id = $1 AND s.tenant_id = $2
        ORDER BY s.started_at DESC
        LIMIT $3`,
      [req.rep.id, req.rep.tenant_id, limit]
    );
    res.json({
      sessions: r.rows.map((s) => ({
        id: s.id,
        scenario_id: s.scenario_id,
        scenario_title: s.scenario_title || (s.custom_scenario_text ? "Custom scenario" : "Scenario"),
        scenario_disc: s.scenario_disc,
        overall_score: s.scoring?.overall_score ?? null,
        outcome: s.outcome,
        duration_seconds: s.duration_seconds,
        started_at: s.started_at,
        completed_at: s.completed_at,
      })),
    });
  } catch (e) {
    console.error("[rep/roleplay/sessions]", e);
    res.status(500).json({ error: "Server error" });
  }
});

router.get("/sessions/:id", ...repAuthChain, async (req, res) => {
  try {
    const r = await db.query(
      `SELECT s.*,
              sc.id AS scenario_table_id,
              sc.tenant_id AS scenario_tenant_id,
              sc.title AS scenario_title,
              sc.description, sc.industry, sc.scenario_type, sc.difficulty,
              sc.skills_trained, sc.disc_type, sc.is_template
         FROM roleplay_sessions s
         LEFT JOIN roleplay_scenarios sc ON sc.id = s.scenario_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.tenant_id = $3`,
      [req.params.id, req.rep.id, req.rep.tenant_id]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ error: "Session not found" });

    const scenarioPayload = row.scenario_id
      ? {
          id: row.scenario_id,
          title: row.scenario_title,
          description: row.description,
          industry: row.industry,
          scenario_type: row.scenario_type,
          difficulty: row.difficulty,
          skills_trained: row.skills_trained || [],
          disc_type: row.disc_type,
          is_template: row.is_template,
          is_custom: !row.is_template,
        }
      : null;

    res.json({
      id: row.id,
      scenario_id: row.scenario_id,
      scenario: scenarioPayload,
      custom_scenario_text: row.custom_scenario_text,
      custom_opening: row.custom_opening,
      transcript: row.transcript || [],
      scoring: row.scoring || null,
      outcome: row.outcome,
      duration_seconds: row.duration_seconds,
      started_at: row.started_at,
      completed_at: row.completed_at,
    });
  } catch (e) {
    console.error("[rep/roleplay/sessions/:id]", e);
    res.status(500).json({ error: "Server error" });
  }
});

module.exports = router;

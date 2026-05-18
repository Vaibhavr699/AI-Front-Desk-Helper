"use strict";

/**
 * lib/coachingEngine.js
 *
 * Phase 6 — AI+Sales Coaching Engine.
 * May 14, 2026 (A1 initial); May 18, 2026 (A6 one-sided handling).
 *
 * Public API:
 *
 *   scoreConversation({ conversationId, force })
 *     GPT-4o → 8 dimension scores → coaching_scores rows + coaching_conversations.overall_score.
 *     Idempotent unless force=true. Phase 6 A6: skips GPT-4o for 0-customer-turn calls
 *     and records scoring_skip_reason.
 *
 *   detectPersona({ conversationId, force })
 *     GPT-4o → buyer_persona + signals → coaching_conversations + leads (if lead_id set).
 *     Idempotent unless force=true. Phase 6 A6: skips GPT-4o for <2-customer-turn calls
 *     and records persona_skip_reason.
 *
 *   buildCoachingPromptInjection({ tenantId, persona, category, limit })
 *     Reads approved coaching_rules, returns prompt-injectable text block.
 *
 *   analyzeConversation({ conversationId })
 *     Parallel score + detect, for use as post-conversation kicker from server.js (A2).
 *
 *   analyzeTranscript(transcript, durationSeconds)
 *     Returns { totalTurns, customerTurns, agentTurns, skipReason }. Used internally
 *     by scoreConversation + detectPersona and exported for tests / introspection.
 *
 * Error handling: public functions return { ok, ... } and never throw.
 * Failures degrade gracefully — a coaching glitch never breaks customer-facing AI flow.
 */

const OpenAI = require("openai");
const db = require("./db");
const notificationsService = require("../services/notifications");

let _openai = null;
function getOpenAI() {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY not configured");
    }
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const SCORING_MODEL = "gpt-4o-2024-08-06";
const PERSONA_MODEL = "gpt-4o-2024-08-06";

// ──── 8-dimension scoring rubric ─────────────────────────────────────────────
const SCORING_DIMENSIONS = [
  { key: "rapport", label: "Rapport" },
  { key: "property_walkthrough", label: "Property Walkthrough" },
  { key: "discovery", label: "Discovery" },
  { key: "education", label: "Education" },
  { key: "value_framing", label: "Value Framing" },
  { key: "objection_handling", label: "Objection Handling" },
  { key: "close", label: "Close" },
  { key: "professionalism", label: "Professionalism" },
];

const SCORING_SYSTEM_PROMPT = `You are an expert home services sales coach analyzing a recorded sales conversation. Score the rep's performance across 8 dimensions on a 0-10 scale:

- 10 = textbook execution
- 7-8 = strong, minor gaps
- 5-6 = adequate, real coaching opportunities
- 3-4 = significantly off-track
- 0-2 = absent or actively harmful

DIMENSIONS:
1. rapport — opened warmly, used customer name, built personal connection, found common ground
2. property_walkthrough — surveyed the space methodically (rooms/areas/condition/history per area)
3. discovery — uncovered motivation, timeline, budget signal, decision-maker structure
4. education — positioned expertise (process, materials, timeline, warranty) without jargon-dumping
5. value_framing — connected solution to customer's stated needs; anchored on transformation, not features
6. objection_handling — acknowledged + validated + reframed; not defensive, not capitulating
7. close — asked for the sale or specific next step; locked a date/action/commitment
8. professionalism — tone, language, respect for time, clarity; penalize filler/talking over customer

For each dimension provide: numeric score (decimals OK), 1-3 sentence rationale, 1-3 evidence references with turn_index + brief quote + why.

If a dimension lacked opportunity (e.g. customer ended early before close possible), score 5.0 and note in rationale.

Return ONLY valid JSON in this shape:
{
  "scores": [
    {
      "dimension": "rapport",
      "score": 7.5,
      "rationale": "Opened warmly...",
      "evidence": [
        { "turn_index": 2, "quote": "Hi Sarah, thanks for calling", "why": "warm open with name" }
      ]
    }
  ],
  "overall_score": 6.8
}

All 8 dimensions required in the array.`;

const PERSONAS = [
  { key: "researcher", label: "The Researcher", desc: "analytical, gathers quotes, asks specs/warranty/materials, slow decision", signals: "asks follow-up questions; uses 'research', 'compare', 'specs'; wants documentation; references competitor details" },
  { key: "protector", label: "The Protector", desc: "safety-first; trust + proof oriented", signals: "asks insurance/licensing/background; mentions kids/pets/elderly; asks references; concerned who's in their home" },
  { key: "status_seeker", label: "The Status Seeker", desc: "wants the best; transformation-focused; premium-oriented", signals: "uses 'beautiful', 'transform', 'upgrade'; mentions premium brands; style over function; asks top-tier options" },
  { key: "pragmatist", label: "The Pragmatist", desc: "solve-it-fast; low patience; scheduling-driven", signals: "speaks fast; asks 'when can you start' early; uses 'just', 'quick', 'simple'; skips specs" },
  { key: "negotiator", label: "The Negotiator", desc: "price-driven; will push; bundles for value", signals: "asks price first; mentions competitor quotes by price; uses 'deal', 'discount', 'best price'; tries to reduce scope" },
  { key: "collaborator", label: "The Collaborator", desc: "needs partner aligned; defers decisions", signals: "mentions spouse/partner; uses 'we' over 'I'; 'I need to check with...'; wants joint follow-up" },
];

const PERSONA_SYSTEM_PROMPT = `You are an expert in buyer psychology analyzing a home services customer conversation. Identify the dominant buyer persona based on language, questions, and cues.

PERSONAS:
${PERSONAS.map((p) => `- ${p.key} (${p.label}): ${p.desc}\n  Signals: ${p.signals}`).join("\n\n")}

Use 'unknown' only when the conversation is too short (<3 customer turns) or rep dominated entirely.

People aren't pure types — pick the dominant persona and note secondary signals.

Return ONLY valid JSON:
{
  "buyer_persona": "researcher",
  "confidence": 0.78,
  "signals": {
    "primary_cues": ["mentioned warranty 3x", "asked about VOC levels twice"],
    "secondary_persona": "protector",
    "secondary_cues": ["asked about insurance once"],
    "reasoning": "1-2 sentence summary of why this persona over others"
  }
}

Confidence: 0.00-1.00. Below 0.4 → strongly consider 'unknown'.`;

// ──── HELPERS ────────────────────────────────────────────────────────────────

async function loadConversation(conversationId) {
  const result = await db.query(
    `SELECT id, tenant_id, lead_id, transcript, duration_seconds,
            scored_at, persona_detected_at, source_type, industry
       FROM coaching_conversations
      WHERE id = $1`,
    [conversationId]
  );
  return result.rows[0] || null;
}

function formatTranscriptForLLM(transcript) {
  if (!Array.isArray(transcript) || transcript.length === 0) return "";
  return transcript
    .map((turn, idx) => {
      const speaker = (turn.role === "rep" || turn.role === "agent" || turn.role === "assistant") ? "Rep" : "Customer";
      return `[${idx}] ${speaker}: ${turn.text || ""}`;
    })
    .join("\n");
}

// ──── Phase 6 A6 (May 18, 2026) — Pre-flight transcript analysis ────────────
//
// Returns { totalTurns, customerTurns, agentTurns, skipReason }
//
// skipReason values:
//   'empty_transcript'             — transcript missing or empty
//   'silent_call'                  — 0 customer turns AND duration < 30 sec
//   'one_sided_transcript'         — 0 customer turns (likely pre-Whisper-fix
//                                     or no-customer-speech call)
//   'insufficient_customer_speech' — 1 customer turn (too short for persona)
//   null                            — analyzable transcript, proceed normally
//
// Both scoreConversation and detectPersona call this. Persona requires >= 2
// customer turns; scoring tolerates 1 customer turn but skips 0-turn calls.
//
// Background: prior to the May 15 Whisper transcription config fix, all
// transcripts were one-sided (agent only). Those 26 backfilled rows scored
// 5.0-5.3 with persona='unknown', cluttering the dashboard with calls that
// genuinely cannot be analyzed. Pre-flight skipping saves API costs and
// enables clean dashboard filtering via the {persona,scoring}_skip_reason cols.
function analyzeTranscript(transcript, durationSeconds = 0) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    return { totalTurns: 0, customerTurns: 0, agentTurns: 0, skipReason: "empty_transcript" };
  }
  let customerTurns = 0;
  let agentTurns = 0;
  for (const turn of transcript) {
    const role = turn?.role;
    if (role === "customer" || role === "user") {
      customerTurns++;
    } else if (role === "agent" || role === "rep" || role === "assistant") {
      agentTurns++;
    }
  }
  let skipReason = null;
  if (customerTurns === 0 && durationSeconds > 0 && durationSeconds < 30) {
    skipReason = "silent_call";
  } else if (customerTurns === 0) {
    skipReason = "one_sided_transcript";
  } else if (customerTurns < 2) {
    skipReason = "insufficient_customer_speech";
  }
  return {
    totalTurns: transcript.length,
    customerTurns,
    agentTurns,
    skipReason,
  };
}

function safeJsonParse(text) {
  if (!text) return null;
  const cleaned = text.replace(/```json\s*/i, "").replace(/```\s*$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ──── PUBLIC: scoreConversation ──────────────────────────────────────────────

async function scoreConversation({ conversationId, force = false } = {}) {
  try {
    const conv = await loadConversation(conversationId);
    if (!conv) return { ok: false, reason: "conversation_not_found" };
    if (conv.scored_at && !force) {
      return { ok: true, skipped: true, reason: "already_scored" };
    }

    const transcriptText = formatTranscriptForLLM(conv.transcript);
    if (!transcriptText) return { ok: false, reason: "empty_transcript" };

    // ──── Phase 6 A6: Skip scoring for one-sided/silent calls ──────────────
    //
    // Scoring a transcript with 0 customer turns produces meaningless 5.0-5.3
    // scores (the 26-call backfill problem). Cheaper + cleaner to skip the
    // GPT-4o call entirely and record the skip reason for dashboard filtering.
    //
    // Calls with 1 customer turn ARE still scored — a single customer response
    // is enough signal to evaluate rep performance roughly, even if not enough
    // for persona classification.
    const transcriptAnalysis = analyzeTranscript(conv.transcript, conv.duration_seconds || 0);
    if (transcriptAnalysis.customerTurns === 0) {
      console.log(
        "[coachingEngine] Skipping score conv=%s reason=%s customer_turns=0 agent_turns=%d",
        conversationId, transcriptAnalysis.skipReason, transcriptAnalysis.agentTurns
      );
      await db.query(
        `UPDATE coaching_conversations
            SET scoring_skip_reason = $1,
                customer_turn_count = $2,
                scored_at = now(),
                updated_at = now()
          WHERE id = $3`,
        [transcriptAnalysis.skipReason, transcriptAnalysis.customerTurns, conversationId]
      );
      return {
        ok: true,
        skipped: true,
        reason: transcriptAnalysis.skipReason,
        customer_turns: 0,
      };
    }

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: SCORING_MODEL,
      messages: [
        { role: "system", content: SCORING_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Industry: ${conv.industry || "unknown"}\nSource: ${conv.source_type}\n\nTranscript:\n${transcriptText}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    const raw = completion.choices[0]?.message?.content;
    const parsed = safeJsonParse(raw);
    if (!parsed || !Array.isArray(parsed.scores)) {
      console.error("[coachingEngine] scoreConversation: malformed LLM response conv=%s", conversationId);
      return { ok: false, reason: "malformed_response" };
    }

    const validDims = new Set(SCORING_DIMENSIONS.map((d) => d.key));
    const validScores = parsed.scores.filter(
      (s) =>
        s &&
        validDims.has(s.dimension) &&
        typeof s.score === "number" &&
        s.score >= 0 &&
        s.score <= 10
    );

    if (validScores.length === 0) return { ok: false, reason: "no_valid_scores" };

    let overall =
      typeof parsed.overall_score === "number" && parsed.overall_score >= 0 && parsed.overall_score <= 10
        ? parsed.overall_score
        : validScores.reduce((sum, s) => sum + s.score, 0) / validScores.length;
    overall = Math.round(overall * 10) / 10;

    // Upsert each score row (unique constraint on conversation_id+dimension)
    for (const s of validScores) {
      await db.query(
        `INSERT INTO coaching_scores
           (conversation_id, tenant_id, dimension, score, rationale, evidence)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (conversation_id, dimension) DO UPDATE
           SET score = EXCLUDED.score,
               rationale = EXCLUDED.rationale,
               evidence = EXCLUDED.evidence`,
        [
          conversationId,
          conv.tenant_id,
          s.dimension,
          s.score,
          s.rationale || null,
          s.evidence ? JSON.stringify(s.evidence) : null,
        ]
      );
    }

    // Phase 6 A6: also set customer_turn_count + clear scoring_skip_reason on
    // successful scoring (in case a row was previously marked skipped and is
    // being re-analyzed with force=true on better data).
    await db.query(
      `UPDATE coaching_conversations
          SET overall_score = $1,
              scored_at = now(),
              scoring_model = $2,
              customer_turn_count = $3,
              scoring_skip_reason = NULL,
              updated_at = now()
        WHERE id = $4`,
      [overall, SCORING_MODEL, transcriptAnalysis.customerTurns, conversationId]
    );

    // ─────────────────────────────────────────────────────────────────────
    // Phase 6 A5 (May 15, 2026) — low-score notification.
    //
    // When a call scores below 5.0, fire a bell notification so the owner
    // gets pulled into the Call Coach page to review. Deduped per
    // conversation_id so manual rescores never re-notify. Failure-tolerant:
    // a notification error never blocks scoring. Scoring is critical;
    // notification is an enhancement.
    //
    // Threshold rationale: rose-colored (sub-5.0) is the "actually
    // problematic" bucket in the UI. The 26 backfilled rows scored
    // 5.0-5.3 from one-sided transcripts so they don't trigger; once the
    // transcript fix lands and real two-sided scoring distributes, this
    // catches the genuine misses.
    // ─────────────────────────────────────────────────────────────────────
    try {
      const LOW_SCORE_THRESHOLD = 5.0;
      if (overall < LOW_SCORE_THRESHOLD) {
        const dup = await db.query(
          `SELECT id FROM notifications
             WHERE tenant_id = $1
               AND type = 'call_coach_low_score'
               AND data->>'conversation_id' = $2
             LIMIT 1`,
          [conv.tenant_id, conversationId]
        );
        if (dup.rows.length === 0) {
          notificationsService.createNotification(conv.tenant_id, {
            type: "call_coach_low_score",
            title: "Call scored low — coaching opportunity",
            body: `Overall: ${overall.toFixed(1)}/10. Tap to review the AI coaching breakdown.`,
            data: {
              conversation_id: conversationId,
              overall_score: overall,
              link: `/call-coach/${conversationId}`,
            },
          }).catch((e) =>
            console.error("[coachingEngine] low-score notification failed:", e.message)
          );
          console.log(
            "[coachingEngine] Low-score notification fired conv=%s score=%s",
            conversationId,
            overall
          );
        }
      }
    } catch (notifErr) {
      console.error("[coachingEngine] Low-score notification error:", notifErr.message);
    }

    console.log("[coachingEngine] Scored conv=%s overall=%s dims=%d", conversationId, overall, validScores.length);
    return { ok: true, overall_score: overall, dimensions_scored: validScores.length };
  } catch (err) {
    console.error("[coachingEngine] scoreConversation error:", err.message);
    return { ok: false, error: err.message };
  }
}

// ──── PUBLIC: detectPersona ──────────────────────────────────────────────────

async function detectPersona({ conversationId, force = false } = {}) {
  try {
    const conv = await loadConversation(conversationId);
    if (!conv) return { ok: false, reason: "conversation_not_found" };
    if (conv.persona_detected_at && !force) {
      return { ok: true, skipped: true, reason: "already_detected" };
    }

    const transcriptText = formatTranscriptForLLM(conv.transcript);
    if (!transcriptText) return { ok: false, reason: "empty_transcript" };

    // ──── Phase 6 A6: Skip persona detection when customer speech insufficient ─
    //
    // Persona classification needs at least 2 customer turns to identify
    // signals (questions asked, language used, decision-making style). With
    // 0-1 customer turns, GPT-4o defaults to "unknown" with ~0.0 confidence
    // — wasted API call producing no signal.
    //
    // Skip + record reason. Dashboard filters these out so owners see only
    // calls that actually classified.
    const transcriptAnalysis = analyzeTranscript(conv.transcript, conv.duration_seconds || 0);
    if (transcriptAnalysis.customerTurns < 2) {
      console.log(
        "[coachingEngine] Skipping persona conv=%s reason=%s customer_turns=%d",
        conversationId, transcriptAnalysis.skipReason, transcriptAnalysis.customerTurns
      );
      await db.query(
        `UPDATE coaching_conversations
            SET buyer_persona = 'unknown',
                persona_confidence = 0,
                persona_signals = $1::jsonb,
                persona_skip_reason = $2,
                customer_turn_count = $3,
                persona_detected_at = now(),
                updated_at = now()
          WHERE id = $4`,
        [
          JSON.stringify({
            skip_reason: transcriptAnalysis.skipReason,
            customer_turn_count: transcriptAnalysis.customerTurns,
            total_turns: transcriptAnalysis.totalTurns,
            agent_turns: transcriptAnalysis.agentTurns,
          }),
          transcriptAnalysis.skipReason,
          transcriptAnalysis.customerTurns,
          conversationId,
        ]
      );
      return {
        ok: true,
        skipped: true,
        reason: transcriptAnalysis.skipReason,
        customer_turns: transcriptAnalysis.customerTurns,
      };
    }

    const openai = getOpenAI();
    const completion = await openai.chat.completions.create({
      model: PERSONA_MODEL,
      messages: [
        { role: "system", content: PERSONA_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Industry: ${conv.industry || "unknown"}\n\nTranscript:\n${transcriptText}`,
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content;
    const parsed = safeJsonParse(raw);
    if (!parsed || !parsed.buyer_persona) {
      console.error("[coachingEngine] detectPersona: malformed LLM response conv=%s", conversationId);
      return { ok: false, reason: "malformed_response" };
    }

    const validPersonas = new Set([
      "researcher", "protector", "status_seeker", "pragmatist",
      "negotiator", "collaborator", "unknown"
    ]);
    const persona = validPersonas.has(parsed.buyer_persona) ? parsed.buyer_persona : "unknown";
    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : null;
    const signalsJson = parsed.signals ? JSON.stringify(parsed.signals) : null;

    // Phase 6 A6: also set customer_turn_count + clear persona_skip_reason on
    // successful detection (in case row was previously marked skipped).
    await db.query(
      `UPDATE coaching_conversations
          SET buyer_persona = $1,
              persona_signals = $2,
              persona_confidence = $3,
              persona_skip_reason = NULL,
              customer_turn_count = $4,
              persona_detected_at = now(),
              updated_at = now()
        WHERE id = $5`,
      [persona, signalsJson, confidence, transcriptAnalysis.customerTurns, conversationId]
    );

    // Propagate to leads if linked
    if (conv.lead_id) {
      await db.query(
        `UPDATE leads
            SET buyer_persona = $1,
                persona_signals = $2,
                persona_confidence = $3,
                persona_detected_at = now()
          WHERE id = $4`,
        [persona, signalsJson, confidence, conv.lead_id]
      );
    }

    console.log("[coachingEngine] Detected persona conv=%s persona=%s confidence=%s", conversationId, persona, confidence);
    return { ok: true, persona, confidence };
  } catch (err) {
    console.error("[coachingEngine] detectPersona error:", err.message);
    return { ok: false, error: err.message };
  }
}

// ──── PUBLIC: buildCoachingPromptInjection ───────────────────────────────────

async function buildCoachingPromptInjection({ tenantId, persona = null, category = null, limit = 20 } = {}) {
  try {
    if (!tenantId) return "";

    const params = [tenantId];
    let where = `tenant_id = $1 AND status = 'approved'`;
    if (category) {
      params.push(category);
      where += ` AND category = $${params.length}`;
    }

    const result = await db.query(
      `SELECT category, rule_type, rule_text, priority, close_correlation, persona_affinity
         FROM coaching_rules
        WHERE ${where}
        ORDER BY priority DESC, close_correlation DESC NULLS LAST, last_reinforced_at DESC
        LIMIT $${params.length + 1}`,
      [...params, limit]
    );

    if (result.rows.length === 0) return "";

    let rules = result.rows;
    if (persona && persona !== "unknown") {
      rules = rules
        .map((r) => ({ ...r, _affinity: r.persona_affinity?.[persona] ?? null }))
        .sort((a, b) => {
          if (a._affinity != null && b._affinity != null) return b._affinity - a._affinity;
          if (a._affinity != null) return -1;
          if (b._affinity != null) return 1;
          return 0;
        });
    }

    const dos = rules.filter((r) => r.rule_type === "do").map((r) => `- ${r.rule_text}`);
    const donts = rules.filter((r) => r.rule_type === "dont").map((r) => `- ${r.rule_text}`);
    const whenThens = rules.filter((r) => r.rule_type === "when_then").map((r) => `- ${r.rule_text}`);

    let block = "## COACHING RULES (learned from prior feedback on real conversations)\n";
    if (dos.length) block += `\nALWAYS:\n${dos.join("\n")}\n`;
    if (donts.length) block += `\nNEVER:\n${donts.join("\n")}\n`;
    if (whenThens.length) block += `\nSITUATIONAL:\n${whenThens.join("\n")}\n`;

    return block.trim();
  } catch (err) {
    console.error("[coachingEngine] buildCoachingPromptInjection error:", err.message);
    return "";
  }
}

// ──── PUBLIC: analyzeConversation (convenience wrapper) ──────────────────────

async function analyzeConversation({ conversationId } = {}) {
  const [scoreResult, personaResult] = await Promise.all([
    scoreConversation({ conversationId }),
    detectPersona({ conversationId }),
  ]);

  return {
    ok: scoreResult.ok || personaResult.ok,
    scoring: scoreResult,
    persona: personaResult,
  };
}

module.exports = {
  scoreConversation,
  detectPersona,
  buildCoachingPromptInjection,
  analyzeConversation,
  analyzeTranscript, // exported for tests / introspection
  SCORING_DIMENSIONS,
  PERSONAS,
};

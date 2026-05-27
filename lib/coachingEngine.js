"use strict";

/**
 * lib/coachingEngine.js
 *
 * Phase 6 — AI+Sales Coaching Engine.
 * Phase 8A — DISC Classifier v0 (added May 19, 2026).
 * Phase 8E — AI self-grade on low-confidence DISC (added May 19, 2026).
 *
 * May 14, 2026 (A1 initial); May 18, 2026 (A6 one-sided handling);
 * May 19, 2026 (Phase 8A DISC dual-output + 8E AI self-grade in detectPersona).
 *
 * Public API:
 *
 *   scoreConversation({ conversationId, force })
 *     GPT-4o → 8 dimension scores → coaching_scores rows + coaching_conversations.overall_score.
 *     Idempotent unless force=true. Phase 6 A6: skips GPT-4o for 0-customer-turn calls
 *     and records scoring_skip_reason.
 *
 *   detectPersona({ conversationId, force })
 *     GPT-4o → buyer_persona + signals + DISC quadrant → coaching_conversations + leads.
 *     Phase 8A: SAME GPT-4o call now returns BOTH persona AND DISC quadrant
 *     classification (D/I/S/C with primary + optional secondary). One call,
 *     two views on the same customer. Idempotent unless force=true.
 *
 *   buildCoachingPromptInjection({ tenantId, persona, category, limit })
 *     Reads approved coaching_rules, returns prompt-injectable text block.
 *     NOTE Phase 8A: DISC is NOT wired into prompt injection yet — waiting on
 *     8E owner accuracy feedback before propagating classifications into live
 *     AI receptionist prompts.
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

// ──── Phase 8A — DISC quadrant definitions ──────────────────────────────────
//
// Classic DISC: 4 axes capturing how someone naturally communicates and
// makes decisions. NOT mapped 1:1 from the existing personas — GPT-4o
// classifies independently on the same transcript. The two views often
// correlate (e.g. Researcher tends to score high C, Negotiator high D),
// but the model is free to disagree, and disagreement is itself signal.
//
// Why 4 quadrants instead of using the 6 personas? DISC is universal
// (works across industries, generalizes to rep coaching for any trade);
// personas are home-services-specific. DISC is the customer-facing label
// shown to reps on the lead detail and (in 8B) the pre-visit briefing.
const DISC_QUADRANTS = [
  { key: "D", label: "Dominant",       desc: "direct, results-focused, fast-paced, decisive; tolerates risk; impatient with detail",       signals: "short clipped sentences; 'just tell me the price'; interrupts; pushes for outcomes; uses 'when', 'how much', 'bottom line'" },
  { key: "I", label: "Influencer",     desc: "enthusiastic, relational, optimistic; sells the dream; talks vision and feel",                 signals: "uses 'love', 'amazing', 'gorgeous', 'transform'; tells stories; asks about you personally; expressive tone; long answers" },
  { key: "S", label: "Steady",         desc: "supportive, patient, loyal; needs reassurance; values harmony; consensus-driven decisions",    signals: "mentions spouse/family decisions; asks about timing impact on household; soft tone; 'I want to make sure...'; cautious commitment" },
  { key: "C", label: "Conscientious",  desc: "analytical, precise, quality-focused; wants documentation, specs, process; risk-averse",       signals: "asks specs/materials/warranty; references competitor details; uses 'specifically', 'exactly', 'process'; pauses to think" },
];

const PERSONA_SYSTEM_PROMPT = `You are an expert in buyer psychology analyzing a home services customer conversation. Provide TWO independent classifications of the customer:

═══════════════════════════════════════════════════════════════════════════
1. BUYER PERSONA — home-services-specific behavior pattern (pick one).
═══════════════════════════════════════════════════════════════════════════

${PERSONAS.map((p) => `- ${p.key} (${p.label}): ${p.desc}\n  Signals: ${p.signals}`).join("\n\n")}

Use 'unknown' only when the conversation is too short (<3 customer turns) or rep dominated entirely.

═══════════════════════════════════════════════════════════════════════════
2. DISC QUADRANT — universal communication/decision style.
═══════════════════════════════════════════════════════════════════════════

${DISC_QUADRANTS.map((d) => `- ${d.key} (${d.label}): ${d.desc}\n  Signals: ${d.signals}`).join("\n\n")}

DISC instructions:
- Score each quadrant 0.00-1.00. Scores must sum to ~1.0 (±0.1 acceptable).
- "primary" = the quadrant with the highest score (D, I, S, or C). If your
  overall classification confidence is below 0.4, set primary to "unknown".
- "secondary" = the second-highest quadrant IF its score is at least 0.20
  AND within 0.20 of primary. Otherwise null. (This avoids labels like "DC"
  where C scores 0.45 and D scores 0.05 — that's just C with noise.)
- Classify DISC independently from the persona above. Use the same
  transcript evidence but evaluate the universal communication style, not
  the home-services-specific behavior. Often they correlate (e.g. a
  Researcher persona is usually high C), but you are free to disagree —
  disagreement is meaningful signal.

People aren't pure types. For BOTH classifications, note the dominant
pattern plus secondary signals.

═══════════════════════════════════════════════════════════════════════════
Return ONLY valid JSON in this exact shape:
═══════════════════════════════════════════════════════════════════════════

{
  "buyer_persona": "researcher",
  "confidence": 0.78,
  "signals": {
    "primary_cues": ["mentioned warranty 3x", "asked about VOC levels twice"],
    "secondary_persona": "protector",
    "secondary_cues": ["asked about insurance once"],
    "reasoning": "1-2 sentence summary of why this persona over others"
  },
  "disc": {
    "primary": "C",
    "secondary": "S",
    "scores": { "D": 0.10, "I": 0.15, "S": 0.30, "C": 0.45 },
    "confidence": 0.72,
    "primary_cues": ["asked specifically about paint specs", "wanted process documentation"],
    "secondary_cues": ["mentioned needing to check with spouse"],
    "reasoning": "1-2 sentence summary of why this DISC profile"
  }
}

Persona confidence: 0.00-1.00. Below 0.4 → strongly consider buyer_persona='unknown'.
DISC confidence: 0.00-1.00. Below 0.4 → set disc.primary='unknown' but still return scores for debugging.`;

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
//   'insufficient_customer_speech' — 1 customer turn (too short for persona/DISC)
//   null                            — analyzable transcript, proceed normally
//
// Both scoreConversation and detectPersona call this. Persona/DISC require
// >= 2 customer turns; scoring tolerates 1 customer turn but skips 0-turn calls.
//
// Background: prior to the May 15 Whisper transcription config fix, all
// transcripts were one-sided (agent only). Those 26 backfilled rows scored
// 5.0-5.3 with persona='unknown', cluttering the dashboard with calls that
// genuinely cannot be analyzed. Pre-flight skipping saves API costs and
// enables clean dashboard filtering via the {persona,scoring,disc}_skip_reason cols.
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

// ──── Phase 8A — DISC payload validator + normalizer ────────────────────────
//
// Returns { disc, skipReason } where disc is the cleaned object ready for
// the DB and skipReason is set if classification should be marked low-conf
// (we still store the scores for debugging, but null out primary/secondary).
//
// Validation rules:
//   - All 4 quadrant scores present, each numeric in [0, 1]
//   - Scores sum to 1.0 ± 0.1 → normalize by dividing by sum
//   - Outside that tolerance → reject (skipReason='disc_score_invalid')
//   - primary must be in {D,I,S,C,unknown}; defaults to 'unknown' if missing
//   - secondary only kept if score >= 0.20 AND within 0.20 of primary
//   - confidence < 0.4 → primary forced to 'unknown', skipReason='low_confidence_classification'
function validateAndNormalizeDisc(raw) {
  if (!raw || typeof raw !== "object") {
    return { disc: null, skipReason: "disc_missing" };
  }

  const scores = raw.scores || {};
  const D = Number(scores.D);
  const I = Number(scores.I);
  const S = Number(scores.S);
  const C = Number(scores.C);

  if (![D, I, S, C].every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) {
    return { disc: null, skipReason: "disc_score_invalid" };
  }

  const sum = D + I + S + C;
  if (sum < 0.9 || sum > 1.1) {
    return { disc: null, skipReason: "disc_score_invalid" };
  }

  // Normalize to exactly 1.0 (model often returns 0.95-1.05)
  const norm = {
    D: Math.round((D / sum) * 100) / 100,
    I: Math.round((I / sum) * 100) / 100,
    S: Math.round((S / sum) * 100) / 100,
    C: Math.round((C / sum) * 100) / 100,
  };

  const VALID = new Set(["D", "I", "S", "C"]);

  // Compute primary from highest score (don't trust model's primary field
  // blindly — it has occasionally returned a primary that didn't match the
  // highest score in testing). Cross-check with model's stated primary.
  const sorted = Object.entries(norm).sort((a, b) => b[1] - a[1]);
  const computedPrimary = sorted[0][0];
  const computedSecondary = sorted[1][0];
  const primaryScore = sorted[0][1];
  const secondaryScore = sorted[1][1];

  const confidence = typeof raw.confidence === "number"
    ? Math.max(0, Math.min(1, raw.confidence))
    : null;

  // Low-confidence path: store scores for debugging, null out the label
  if (confidence != null && confidence < 0.4) {
    return {
      disc: {
        primary: "unknown",
        secondary: null,
        scores: norm,
        confidence,
        signals: {
          primary_cues: Array.isArray(raw.primary_cues) ? raw.primary_cues : [],
          secondary_cues: Array.isArray(raw.secondary_cues) ? raw.secondary_cues : [],
          reasoning: typeof raw.reasoning === "string" ? raw.reasoning : null,
          computed_primary: computedPrimary, // for debugging
        },
      },
      skipReason: "low_confidence_classification",
    };
  }

  // Secondary kept only if its score is meaningful AND close to primary
  const SECONDARY_MIN = 0.20;
  const SECONDARY_GAP_MAX = 0.20;
  const keepSecondary =
    VALID.has(computedSecondary) &&
    secondaryScore >= SECONDARY_MIN &&
    (primaryScore - secondaryScore) <= SECONDARY_GAP_MAX;

  return {
    disc: {
      primary: VALID.has(computedPrimary) ? computedPrimary : "unknown",
      secondary: keepSecondary ? computedSecondary : null,
      scores: norm,
      confidence,
      signals: {
        primary_cues: Array.isArray(raw.primary_cues) ? raw.primary_cues : [],
        secondary_cues: Array.isArray(raw.secondary_cues) ? raw.secondary_cues : [],
        reasoning: typeof raw.reasoning === "string" ? raw.reasoning : null,
      },
    },
    skipReason: null,
  };
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
    // for persona/DISC classification.
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
          content: `${conv.source_type === "ai_sms"
  ? "CHANNEL: This is a TEXT (SMS) conversation, not a phone call. Score it fairly for the SMS medium — 'property_walkthrough' cannot happen over text, so score it 5.0 (neutral, no opportunity) unless the rep explicitly arranged an in-person walkthrough. Judge rapport, discovery, education, value framing, objection handling and close by what's achievable in writing.\n\n"
  : ""}Industry: ${conv.industry || "unknown"}\nSource: ${conv.source_type}\n\nTranscript:\n${transcriptText}`,
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
//
// Phase 8A (May 19, 2026): single GPT-4o call now returns BOTH the existing
// 6-persona classification AND the 4-quadrant DISC profile. Same transcript,
// same call, two independent classifications. The persona feeds prompt
// injection (Phase 6B); DISC is customer-facing intel (Phase 8 stack).
//
// Skip conditions apply to both — if customer_turn_count < 2 we skip the
// entire GPT-4o call and mark both persona_skip_reason and disc_skip_reason.

async function detectPersona({ conversationId, force = false } = {}) {
  try {
    const conv = await loadConversation(conversationId);
    if (!conv) return { ok: false, reason: "conversation_not_found" };
    if (conv.persona_detected_at && !force) {
      return { ok: true, skipped: true, reason: "already_detected" };
    }

    const transcriptText = formatTranscriptForLLM(conv.transcript);
    if (!transcriptText) return { ok: false, reason: "empty_transcript" };

    // ──── Phase 6 A6: Skip persona/DISC when customer speech insufficient ──
    //
    // Persona AND DISC classification both need at least 2 customer turns to
    // identify signals (questions asked, language used, decision-making
    // style). With 0-1 customer turns, GPT-4o defaults to "unknown" with
    // ~0.0 confidence — wasted API call producing no signal.
    //
    // Skip + record reason on BOTH persona_skip_reason and disc_skip_reason.
    // Dashboard filters these out so owners see only calls that classified.
    const transcriptAnalysis = analyzeTranscript(conv.transcript, conv.duration_seconds || 0);
    if (transcriptAnalysis.customerTurns < 2) {
      console.log(
        "[coachingEngine] Skipping persona+DISC conv=%s reason=%s customer_turns=%d",
        conversationId, transcriptAnalysis.skipReason, transcriptAnalysis.customerTurns
      );
      await db.query(
        `UPDATE coaching_conversations
            SET buyer_persona = 'unknown',
                persona_confidence = 0,
                persona_signals = $1::jsonb,
                persona_skip_reason = $2,
                disc_primary = 'unknown',
                disc_secondary = NULL,
                disc_scores = NULL,
                disc_confidence = 0,
                disc_signals = NULL,
                disc_skip_reason = $2,
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

    // ──── Persona extraction (unchanged from Phase 6) ──────────────────────
    const validPersonas = new Set([
      "researcher", "protector", "status_seeker", "pragmatist",
      "negotiator", "collaborator", "unknown"
    ]);
    const persona = validPersonas.has(parsed.buyer_persona) ? parsed.buyer_persona : "unknown";
    const personaConfidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : null;
    const personaSignalsJson = parsed.signals ? JSON.stringify(parsed.signals) : null;

    // ──── DISC extraction (Phase 8A) ───────────────────────────────────────
    //
    // validateAndNormalizeDisc handles all the edge cases: malformed scores,
    // non-summing scores, low confidence, secondary-too-weak. Returns null
    // disc if the payload is fundamentally broken (we store skip_reason and
    // null fields), or a clean object ready for the DB.
    const discResult = validateAndNormalizeDisc(parsed.disc);
    const discPrimary = discResult.disc ? discResult.disc.primary : "unknown";
    const discSecondary = discResult.disc ? discResult.disc.secondary : null;
    const discScoresJson = discResult.disc ? JSON.stringify(discResult.disc.scores) : null;
    const discConfidence = discResult.disc ? discResult.disc.confidence : null;
    const discSignalsJson = discResult.disc?.signals ? JSON.stringify(discResult.disc.signals) : null;
    const discSkipReason = discResult.skipReason; // null on success, set on low-conf or invalid

    // Phase 6 A6 + Phase 8A: write persona AND DISC in one UPDATE.
    // Clear persona_skip_reason / disc_skip_reason where applicable.
    await db.query(
      `UPDATE coaching_conversations
          SET buyer_persona = $1,
              persona_signals = $2,
              persona_confidence = $3,
              persona_skip_reason = NULL,
              disc_primary = $4,
              disc_secondary = $5,
              disc_scores = $6,
              disc_confidence = $7,
              disc_signals = $8,
              disc_skip_reason = $9,
              customer_turn_count = $10,
              persona_detected_at = now(),
              updated_at = now()
        WHERE id = $11`,
      [
        persona,
        personaSignalsJson,
        personaConfidence,
        discPrimary,
        discSecondary,
        discScoresJson,
        discConfidence,
        discSignalsJson,
        discSkipReason,
        transcriptAnalysis.customerTurns,
        conversationId,
      ]
    );

    if (conv.lead_id) {
      await aggregateDiscForLead(conv.lead_id);
    }

    // ──── Phase 8E AI self-grade: flag low-confidence DISC for human review ──
    //
    // When confidence is in the 0.4-0.6 "uncertain but classified" band,
    // create a disc_feedback row from the AI itself. Captures the model's
    // own hesitation as feedback signal without a second GPT call. Owners
    // and reps then validate or correct via the Customer Intel card.
    //
    // Confidence bands:
    //   < 0.4   → already short-circuited to 'unknown' by validateAndNormalizeDisc
    //              with disc_skip_reason='low_confidence_classification'. No
    //              feedback row needed — the classification itself was rejected.
    //   0.4-0.6 → CLASSIFIED but uncertain. AI flags for human review.
    //   ≥ 0.6   → AI trusts itself. No flag.
    //
    // AI rows use was_accurate=NULL (not asserting, just flagging). Owner
    // /rep feedback then sets was_accurate true/false in a separate row.
    // Failure-tolerant: a feedback insert error never blocks classification.
    try {
      const AI_FLAG_LOW = 0.4;
      const AI_FLAG_HIGH = 0.6;

      const shouldFlag =
        discResult.disc &&
        typeof discConfidence === "number" &&
        discConfidence > AI_FLAG_LOW &&
        discConfidence < AI_FLAG_HIGH &&
        discPrimary !== "unknown";

      if (shouldFlag) {
        const aiReason =
          discResult.disc?.signals?.reasoning ||
          `Low classification confidence (${(discConfidence * 100).toFixed(0)}%) — secondary type may be primary`;

        db.query(
          `INSERT INTO disc_feedback (
             tenant_id, conversation_id, lead_id,
             submitted_by_user_id, submitted_by_role,
             classified_primary, classified_secondary, classified_confidence,
             was_accurate, corrected_primary, corrected_secondary,
             reason
           ) VALUES (
             $1, $2, $3,
             NULL, 'ai',
             $4, $5, $6,
             NULL, NULL, NULL,
             $7
           )`,
          [
            conv.tenant_id,
            conversationId,
            conv.lead_id || null,
            discPrimary,
            discSecondary,
            discConfidence,
            String(aiReason).slice(0, 1000),
          ]
        ).catch((e) =>
          console.error("[coachingEngine] AI self-grade insert failed:", e.message)
        );

        console.log(
          "[coachingEngine] AI flagged conv=%s disc=%s conf=%s for human review",
          conversationId, discPrimary, discConfidence
        );
      }
    } catch (selfGradeErr) {
      console.error("[coachingEngine] AI self-grade error:", selfGradeErr.message);
    }

    console.log(
      "[coachingEngine] Detected conv=%s persona=%s pConf=%s disc=%s/%s dConf=%s",
      conversationId, persona, personaConfidence,
      discPrimary, discSecondary || "-", discConfidence
    );
    return {
      ok: true,
      persona,
      persona_confidence: personaConfidence,
      disc_primary: discPrimary,
      disc_secondary: discSecondary,
      disc_confidence: discConfidence,
      disc_skip_reason: discSkipReason,
    };
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

async function aggregateDiscForLead(leadId) {
  try {
    const r = await db.query(
      `SELECT disc_primary, disc_secondary, disc_confidence, disc_scores, disc_signals,
              buyer_persona, persona_signals, persona_confidence,
              duration_seconds, scored_at
         FROM coaching_conversations
        WHERE lead_id = $1
          AND disc_primary IS NOT NULL
          AND disc_primary != 'unknown'
        ORDER BY scored_at DESC`,
      [leadId],
    );
    if (r.rows.length === 0) return;

    if (r.rows.length === 1) {
      const c = r.rows[0];
      await db.query(
        `UPDATE leads
            SET buyer_persona = $1, persona_signals = $2, persona_confidence = $3,
                persona_detected_at = now(),
                disc_primary = $4, disc_secondary = $5, disc_scores = $6,
                disc_confidence = $7, disc_signals = $8, disc_detected_at = now()
          WHERE id = $9`,
        [c.buyer_persona, c.persona_signals, c.persona_confidence,
         c.disc_primary, c.disc_secondary, c.disc_scores,
         c.disc_confidence, c.disc_signals, leadId],
      );
      return;
    }

    const scores = { D: 0, I: 0, S: 0, C: 0 };
    let totalWeight = 0;
    let bestPersona = r.rows[0].buyer_persona;
    let bestPersonaSignals = r.rows[0].persona_signals;
    const allSignals = [];

    for (let i = 0; i < r.rows.length; i++) {
      const c = r.rows[i];
      const recency = 1 / (i + 1);
      const dur = Math.max(c.duration_seconds || 60, 30);
      const weight = recency * Math.sqrt(dur / 60);
      const cs = c.disc_scores || {};
      for (const q of ["D", "I", "S", "C"]) {
        scores[q] += (cs[q] || 0) * weight;
      }
      totalWeight += weight;
      if (c.disc_signals) allSignals.push(...(Array.isArray(c.disc_signals) ? c.disc_signals : []));
    }

    for (const q of ["D", "I", "S", "C"]) {
      scores[q] = Math.round((scores[q] / totalWeight) * 100) / 100;
    }
    const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const primary = sorted[0][0];
    const secondary = sorted[1][1] > 0.2 ? sorted[1][0] : null;
    const confidence = Math.min(0.99, Math.round((sorted[0][1] / (sorted[0][1] + sorted[1][1] + 0.01)) * 100) / 100);

    await db.query(
      `UPDATE leads
          SET buyer_persona = $1, persona_signals = $2, persona_confidence = $3,
              persona_detected_at = now(),
              disc_primary = $4, disc_secondary = $5, disc_scores = $6,
              disc_confidence = $7, disc_signals = $8, disc_detected_at = now()
        WHERE id = $9`,
      [bestPersona, bestPersonaSignals, confidence,
       primary, secondary, JSON.stringify(scores),
       confidence, JSON.stringify(allSignals.slice(0, 20)), leadId],
    );
  } catch (err) {
    console.error("[coachingEngine] aggregateDiscForLead error:", err.message);
  }
}

module.exports = {
  scoreConversation,
  detectPersona,
  buildCoachingPromptInjection,
  analyzeConversation,
  analyzeTranscript,
  validateAndNormalizeDisc,
  aggregateDiscForLead,
  SCORING_DIMENSIONS,
  PERSONAS,
  DISC_QUADRANTS,
};

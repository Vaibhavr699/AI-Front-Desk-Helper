"use strict";

// ═══════════════════════════════════════════════════════════════════════
// Phase 9B step 2 — LLM linguistic classifier (voice only)
// May 27, 2026
//
// Step 1 (services/linguisticExtraction.js) populates deterministic
// signals (sentence count, length, time/price/brand markers) and writes
// one row per conversation. This step 2 sweep fills in the 4 GPT-judged
// columns that step 1 left NULL:
//   - customer_open_question_count    (open-ended questions)
//   - customer_closed_question_count  (yes/no, factual questions)
//   - customer_detail_question_count  (specificity-probing questions)
//   - customer_specificity_score      (0.0–1.0 generic→highly specific)
//
// Separate file + separate cron from step 1 because:
//   - Cost shape differs: step 1 is deterministic + free, step 2 is paid
//     GPT-4o calls. Failure in one should not block the other.
//   - 9C will eventually want to truncate the 4 LLM columns and re-run
//     this sweep alone with an upgraded classifier — separation makes
//     that a one-line ops command.
//
// Selection logic (matches mig addendum idx_cls_llm_pending):
//   - customer_open_question_count IS NULL  (LLM hasn't run yet)
//   - skip_reason IS NULL                   (not a thin-conversation skip)
//   - extracted_at IS NOT NULL              (step 1 has actually written
//                                            the row — defensive, the
//                                            row's existence implies this)
//   - llm_attempts < MAX_LLM_ATTEMPTS       (don't loop on bad transcripts)
//
// Each tick:
//   1. Find up to BATCH_SIZE candidate rows
//   2. For each: join back to coaching_conversations.transcript, extract
//      customer turns, call GPT-4o with structured outputs, write the
//      4 columns. Increment llm_attempts and stamp llm_last_attempt_at
//      regardless of success — a "permanent" failure stops looping
//      after MAX_LLM_ATTEMPTS ticks.
//
// SCHEMA TOUCHED (mig 073 + May 27 addendum):
//   - conversation_linguistic_signals
//       customer_open_question_count    int  (filled by this sweep)
//       customer_closed_question_count  int  (filled by this sweep)
//       customer_detail_question_count  int  (filled by this sweep)
//       customer_specificity_score      real (filled by this sweep)
//       llm_attempts                    int  NOT NULL DEFAULT 0  (addendum)
//       llm_last_attempt_at             tstz                     (addendum)
//   - coaching_conversations.transcript jsonb  (read for customer turns)
// ═══════════════════════════════════════════════════════════════════════

const db = require("../lib/db");
const fetch = require("node-fetch");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = "gpt-4o";
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

// 25/tick × 96 ticks/day = 2,400/day ceiling. At ~$0.005/call all-in,
// worst case ~$12/day sustained backlog. Step 1's 100/tick will always
// feed faster than this drains, so step 2 is the rate-limit by design.
const BATCH_SIZE = 25;

// After 5 attempts on the same conversation, give up. A bad transcript
// (encoding issues, schema mismatch from the model, etc.) shouldn't loop
// forever and bleed $0.005 per tick. 5 attempts × 15 min/tick = 75 min
// of automatic retries before the row goes permanently NULL.
const MIN_CUSTOMER_TURNS = 2;
const MAX_LLM_ATTEMPTS = 5;

// In-process lock prevents overlapping ticks on a single Render instance.
// If/when we scale beyond 1 instance, the UPDATE ... WHERE llm_attempts =
// $original guards against double-processing across instances (last-write
// wins is fine; we'd just pay twice for the same conversation occasionally).
let sweepInProgress = false;

// ─────────────────────────────────────────────────────────────────────
// Parse customer turns from a jsonb-array transcript. Mirrors the
// step 1 helper exactly — same defensive shape handling, same role
// normalization. Duplicated rather than imported because step 1's file
// keeps it as an internal helper and we want step 2 to stand alone.
// Returns string[] of customer-side utterances in order.
// ─────────────────────────────────────────────────────────────────────
function parseCustomerTurns(transcript) {
  if (!Array.isArray(transcript)) return [];

  const turns = [];
  for (const turn of transcript) {
    if (!turn || typeof turn !== "object") continue;
    const role = String(turn.role || "").trim().toLowerCase();
    if (role !== "customer") continue;
    const text = typeof turn.text === "string" ? turn.text.trim() : "";
    if (text.length > 0) turns.push(text);
  }
  return turns;
}

// ─────────────────────────────────────────────────────────────────────
// Find conversations whose deterministic signals row exists but whose
// LLM columns are still NULL. Joined to coaching_conversations.transcript
// so we get the customer turns in one query — saves a per-row roundtrip.
//
// ASC by extracted_at: drain oldest first, same as step 1. Important
// because 9C downstream wants the rows that have been sitting longest
// to get a complete 9-column shape first, useful for training data.
// ─────────────────────────────────────────────────────────────────────
async function findPendingConversations(limit) {
  const { rows } = await db.query(
    `SELECT cls.conversation_id,
            cls.tenant_id,
            cls.llm_attempts,
            cc.transcript
       FROM conversation_linguistic_signals cls
       JOIN coaching_conversations cc ON cc.id = cls.conversation_id
      WHERE cls.customer_open_question_count IS NULL
        AND cls.skip_reason IS NULL
        AND cls.extracted_at IS NOT NULL
        AND cls.llm_attempts < $1
      ORDER BY cls.extracted_at ASC
      LIMIT $2`,
    [MAX_LLM_ATTEMPTS, limit]
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────
// Stamp an attempt on the row whether or not the LLM call succeeded.
// Called before the LLM call so a process crash or network hang still
// counts as an attempt — protects against infinite-retry loops on rows
// that consistently kill the worker.
// ─────────────────────────────────────────────────────────────────────
async function bumpAttempt(conversationId) {
  await db.query(
    `UPDATE conversation_linguistic_signals
        SET llm_attempts = llm_attempts + 1,
            llm_last_attempt_at = now()
      WHERE conversation_id = $1`,
    [conversationId]
  );
}

// ─────────────────────────────────────────────────────────────────────
// Write the 4 LLM columns. Only called on success; failures leave the
// columns NULL so the next tick re-selects the row (until MAX_LLM_ATTEMPTS).
// ─────────────────────────────────────────────────────────────────────
async function writeLlmSignals(conversationId, signals) {
  await db.query(
    `UPDATE conversation_linguistic_signals
        SET customer_open_question_count   = $2,
            customer_closed_question_count = $3,
            customer_detail_question_count = $4,
            customer_specificity_score     = $5
      WHERE conversation_id = $1`,
    [
      conversationId,
      signals.customer_open_question_count,
      signals.customer_closed_question_count,
      signals.customer_detail_question_count,
      signals.customer_specificity_score,
    ]
  );
}

// ─────────────────────────────────────────────────────────────────────
// Call GPT-4o with structured outputs. Returns the 4 signal fields or
// throws. We send ONLY customer turns — the classifier is profiling
// customer linguistic style, not the agent's, and agent turns would
// double our token spend for no signal.
//
// Pattern matches services/varianceCoaching.js (Phase 7E) and the SMS
// orchestrator's text.format.type:"json_schema" usage — same Responses
// API shape we've proven in prod.
// ─────────────────────────────────────────────────────────────────────
async function classifyWithGpt(customerTurns) {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const systemPrompt = [
    "You analyze customer-side conversation turns to extract linguistic profile signals.",
    "You will receive ONLY the customer's utterances from a phone or SMS conversation with a home-services business. The agent's side is NOT included.",
    "",
    "Return four integer/float metrics:",
    "",
    "1. customer_open_question_count: Count of OPEN-ENDED questions the customer asked.",
    "   Open-ended = invites a multi-word, exploratory answer. Starts with words like 'how', 'why', 'what kind of', 'tell me about', 'what's involved in'.",
    "   Examples: 'How do you handle prep work?', 'What's involved in painting cabinets?', 'Why does the deck need two coats?'",
    "",
    "2. customer_closed_question_count: Count of CLOSED questions (yes/no or single-factual-answer).",
    "   Closed = expects a short, bounded answer.",
    "   Examples: 'Do you do interior?', 'Are you licensed?', 'Can you come Friday?', 'Is that $500?'",
    "",
    "3. customer_detail_question_count: Count of questions probing for SPECIFICS (numbers, materials, timeline, process detail).",
    "   These can overlap with open or closed — a question can be both detail-probing AND closed (e.g., 'Is the paint Sherwin-Williams?').",
    "   Examples: 'What brand of paint?', 'How many coats?', 'How long will it take?', 'What's the warranty length?'",
    "",
    "4. customer_specificity_score: Float 0.0–1.0 measuring how specific the customer is about their project overall.",
    "   0.0 = totally vague ('I kinda need some painting done, not sure what')",
    "   0.3 = some specifics ('I want my living room painted')",
    "   0.6 = clear scope ('Three rooms, eggshell finish, want it done in two weeks')",
    "   1.0 = highly specific ('1850 sqft, 3 bed 2 bath, semi-gloss on trim, Behr Marquee, by Memorial Day, $4-6k budget')",
    "   Judge on the cumulative content across all turns, not the longest turn.",
    "",
    "If a customer asks no questions at all, return 0 for the count fields. Specificity score should reflect their declarative statements in that case.",
    "Count each question once. Rhetorical questions ('You know what I mean?') do NOT count.",
  ].join("\n");

  const userPrompt = [
    "Customer turns (in order):",
    "",
    ...customerTurns.map((t, i) => `[${i + 1}] ${t}`),
  ].join("\n");

  const payload = {
    model: OPENAI_MODEL,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "linguistic_signals",
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            customer_open_question_count: {
              type: "integer",
              minimum: 0,
            },
            customer_closed_question_count: {
              type: "integer",
              minimum: 0,
            },
            customer_detail_question_count: {
              type: "integer",
              minimum: 0,
            },
            customer_specificity_score: {
              type: "number",
              minimum: 0,
              maximum: 1,
            },
          },
          required: [
            "customer_open_question_count",
            "customer_closed_question_count",
            "customer_detail_question_count",
            "customer_specificity_score",
          ],
        },
        strict: true,
      },
    },
  };

  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`OpenAI classifier failed (${response.status}): ${body.slice(0, 400)}`);
  }

  const parsed = await response.json();
  const outputText =
    parsed.output_text ||
    parsed.output?.[0]?.content?.find((item) => item.type === "output_text")?.text ||
    "{}";

  let signals;
  try {
    signals = JSON.parse(outputText);
  } catch (err) {
    throw new Error(`OpenAI classifier returned non-JSON: ${outputText.slice(0, 200)}`);
  }

  // Defense-in-depth: validate the shape even though strict:true should
  // guarantee it. If the model ever returns something weird (mid-prompt
  // schema change, OpenAI bug, etc.), better to throw and retry than to
  // write garbage into the row.
  const required = [
    "customer_open_question_count",
    "customer_closed_question_count",
    "customer_detail_question_count",
    "customer_specificity_score",
  ];
  for (const key of required) {
    if (signals[key] == null) {
      throw new Error(`OpenAI classifier missing field: ${key}`);
    }
  }

  return signals;
}

// ─────────────────────────────────────────────────────────────────────
// Process one conversation. Never throws — errors are caught and logged
// so one bad row doesn't poison the whole sweep tick.
//
// Order matters: bumpAttempt BEFORE the LLM call so a hung fetch still
// counts as an attempt. Without this, a misbehaving model + 25/tick
// concurrency could rack up real API spend on the same row forever.
// ─────────────────────────────────────────────────────────────────────
async function processConversation(row) {
  const { conversation_id, tenant_id, transcript } = row;

  try {
    const customerTurns = parseCustomerTurns(transcript);

    // Defensive: step 1 already filtered MIN_CUSTOMER_TURNS via skip_reason,
    // so by the time a row reaches step 2 it should always have enough.
    // If something slipped through (corrupted transcript, schema drift),
    // mark the row attempted and bail rather than calling GPT on nothing.
    if (customerTurns.length < MIN_CUSTOMER_TURNS) {
      await bumpAttempt(conversation_id);
      console.warn(
        "[linguisticLlmClassifier] conv=%s tenant=%s skipped: only %d customer turns (step 1 should have caught this)",
        conversation_id,
        tenant_id,
        customerTurns.length
      );
      return { processed: false, skipped: true };
    }

    await bumpAttempt(conversation_id);

    const signals = await classifyWithGpt(customerTurns);
    await writeLlmSignals(conversation_id, signals);

    return { processed: true, skipped: false };
  } catch (err) {
    console.error(
      "[linguisticLlmClassifier] conv=%s tenant=%s err=%s",
      conversation_id,
      tenant_id,
      err.message
    );
    return { processed: false, skipped: false };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main sweep — called by the cron every 15 min.
//
// Sequential processing inside one tick (not parallel) because:
//   - 25 concurrent GPT-4o calls would hammer the rate limit harder than
//     needed; the deterministic step 1 will always feed faster than this
//     drains, so there's no upside to parallelism.
//   - Sequential makes the log output readable when debugging a tick.
//
// Idempotent: a process crash mid-tick leaves any unwritten rows still
// pending (customer_open_question_count IS NULL), so the next tick
// picks them up. The bumpAttempt-before-call pattern bounds retries.
// ─────────────────────────────────────────────────────────────────────
async function runLinguisticLlmSweep() {
  if (sweepInProgress) {
    console.warn("[linguisticLlmClassifier] sweep already in progress, skipping tick");
    return { ok: false, reason: "already_running" };
  }
  sweepInProgress = true;

  const startedAt = Date.now();
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  try {
    if (!OPENAI_API_KEY) {
      console.warn("[linguisticLlmClassifier] OPENAI_API_KEY not set, skipping sweep");
      return { ok: false, reason: "missing_api_key" };
    }

    const candidates = await findPendingConversations(BATCH_SIZE);

    if (candidates.length === 0) {
      return { ok: true, processed: 0, skipped: 0, errors: 0, elapsedMs: Date.now() - startedAt };
    }

    console.log("[linguisticLlmClassifier] sweep start batch=%d", candidates.length);

    for (const row of candidates) {
      const result = await processConversation(row);
      if (result.processed) {
        processed++;
      } else if (result.skipped) {
        skipped++;
      } else {
        errors++;
      }
    }

    const elapsedMs = Date.now() - startedAt;
    console.log(
      "[linguisticLlmClassifier] sweep done batch=%d processed=%d skipped=%d errors=%d elapsedMs=%d",
      candidates.length,
      processed,
      skipped,
      errors,
      elapsedMs
    );

    return { ok: true, processed, skipped, errors, elapsedMs };
  } catch (err) {
    console.error("[linguisticLlmClassifier] sweep failed: %s", err.message);
    return { ok: false, error: err.message, elapsedMs: Date.now() - startedAt };
  } finally {
    sweepInProgress = false;
  }
}

module.exports = {
  runLinguisticLlmSweep,
  // Exported for tests + future tooling.
  parseCustomerTurns,
  classifyWithGpt,
  processConversation,
};

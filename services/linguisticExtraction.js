"use strict";

// ═══════════════════════════════════════════════════════════════════════
// Phase 9B step 1 — linguistic signal extraction (voice only)
// May 27, 2026
//
// Reads completed voice coaching_conversations, runs deterministic
// extractors, upserts one row per conversation into
// conversation_linguistic_signals. SMS is held until the open SMS-capture
// diagnostic closes — see the early-return below.
//
// Step 1 populates 5 of the 9 signal columns (sentence count, avg sentence
// length, time/price/brand markers). The 4 question/specificity columns
// stay NULL until step 2 wires in the GPT-4o classifier. That's fine —
// the columns are nullable per mig 073, and 9C's training will consume
// whatever's populated.
//
// SCHEMA ASSUMPTIONS (flagged for verification):
//   - coaching_conversations.id           uuid                   ✓ from mig 073 FK
//   - coaching_conversations.tenant_id    uuid                   ✓ from mig 073 FK
//   - coaching_conversations.source_type  text   GUESS — voice value uncertain
//   - coaching_conversations.transcript   text   GUESS — flat "User: …\nAssistant: …\n"
//   - coaching_conversations.scored_at    ts     GUESS — "complete" marker; could be `status` enum instead
//   - tenants.vertical_id                 int    ✓ confirmed across mig refs
//
// If any GUESS is wrong, the rename is one line per column. The structure
// — read conversation, parse customer turns, run extractors, upsert —
// stays identical.
// ═══════════════════════════════════════════════════════════════════════

const db = require("../lib/db");
const { runDeterministicExtractors } = require("./linguisticExtractors/deterministic");
const { getBrandListForVertical } = require("./linguisticExtractors/brandLists");

// How many conversations to process per cron tick. Keeps each run short
// even after a backlog. The cron fires every 15 min so 100/tick = 9600/day
// throughput, far above any realistic conversation volume.
const BATCH_SIZE = 100;

// Minimum customer turns / inbound messages required to extract. Below
// this we write the row with skip_reason set, matching the persona_skip_reason
// pattern called out in mig 073's comment.
const MIN_CUSTOMER_TURNS = 2;

// ─────────────────────────────────────────────────────────────────────
// Parse a flat voice transcript ("User: hi there\nAssistant: hello\n...")
// into a list of customer-side utterances. Returns string[] — each element
// is one customer turn's text, with the "User: " prefix stripped.
//
// We treat any line beginning with "User:" (case-insensitive, optional
// whitespace) as a customer turn. Multi-line turns are folded — if a
// User line is followed by more User lines without an Assistant in
// between, they merge into one utterance (rare but possible from VAD
// fragmentation in server.js's transcript builder).
// ─────────────────────────────────────────────────────────────────────
function parseCustomerTurnsFromFlatTranscript(transcript) {
  if (!transcript || typeof transcript !== "string") return [];

  const lines = transcript.split("\n");
  const turns = [];
  let buffer = null;

  for (const line of lines) {
    const userMatch = line.match(/^\s*User\s*:\s*(.*)$/i);
    const assistantMatch = line.match(/^\s*Assistant\s*:/i);

    if (userMatch) {
      const text = userMatch[1].trim();
      if (buffer !== null) {
        // Continuation of a customer turn — fold into the existing buffer.
        buffer = (buffer + " " + text).trim();
      } else {
        buffer = text;
      }
    } else if (assistantMatch) {
      // Assistant turn closes the current customer buffer.
      if (buffer !== null) {
        if (buffer.length > 0) turns.push(buffer);
        buffer = null;
      }
    }
    // Other lines (blank, malformed) are ignored.
  }

  // Flush any trailing customer buffer (call ended mid-customer-turn).
  if (buffer !== null && buffer.length > 0) turns.push(buffer);

  return turns;
}

// ─────────────────────────────────────────────────────────────────────
// Find conversations that need linguistic signal extraction.
//
// Query: voice conversations that are complete (scored_at IS NOT NULL —
// the coaching scorer already ran, so the conversation is settled) and
// have no row in conversation_linguistic_signals yet.
//
// We deliberately key off "no signal row exists" rather than a flag on
// coaching_conversations — keeps the conversation table read-only from
// this pipeline's perspective, and means a backfill is just "delete from
// conversation_linguistic_signals where ..." plus letting the cron catch up.
// ─────────────────────────────────────────────────────────────────────
async function findConversationsNeedingExtraction(limit) {
  // SCHEMA GUESS markers:
  //   cc.source_type = 'voice'  — replace 'voice' with the actual enum value
  //   cc.scored_at IS NOT NULL  — replace with whatever "complete" check matches
  //   cc.transcript             — replace if turns live in a separate table
  const { rows } = await db.query(
    `SELECT cc.id, cc.tenant_id, cc.source_type, cc.transcript,
            t.vertical_id
       FROM coaching_conversations cc
       JOIN tenants t ON t.id = cc.tenant_id
      WHERE cc.source_type = 'voice'
        AND cc.scored_at IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM conversation_linguistic_signals cls
           WHERE cls.conversation_id = cc.id
        )
      ORDER BY cc.scored_at ASC
      LIMIT $1`,
    [limit]
  );
  return rows;
}

// ─────────────────────────────────────────────────────────────────────
// Upsert one signal row. Uses ON CONFLICT (conversation_id) DO UPDATE so
// re-runs (e.g. after a code bump) overwrite cleanly without duplicating.
//
// `signals` is an object with any subset of the column names. Missing
// columns are stored as NULL. Step 1 leaves the 4 LLM columns out
// entirely — they stay NULL until step 2 backfills them.
// ─────────────────────────────────────────────────────────────────────
async function upsertSignals(conversationId, tenantId, channel, signals, skipReason) {
  await db.query(
    `INSERT INTO conversation_linguistic_signals (
       conversation_id, tenant_id, channel,
       customer_sentence_count, customer_avg_sentence_length,
       time_marker_count, price_marker_count, brand_mention_count,
       customer_open_question_count, customer_closed_question_count,
       customer_detail_question_count, customer_specificity_score,
       raw_features, skip_reason,
       extracted_at
     ) VALUES (
       $1, $2, $3,
       $4, $5,
       $6, $7, $8,
       NULL, NULL,
       NULL, NULL,
       NULL, $9,
       now()
     )
     ON CONFLICT (conversation_id) DO UPDATE SET
       channel                       = EXCLUDED.channel,
       customer_sentence_count       = EXCLUDED.customer_sentence_count,
       customer_avg_sentence_length  = EXCLUDED.customer_avg_sentence_length,
       time_marker_count             = EXCLUDED.time_marker_count,
       price_marker_count            = EXCLUDED.price_marker_count,
       brand_mention_count           = EXCLUDED.brand_mention_count,
       skip_reason                   = EXCLUDED.skip_reason,
       extracted_at                  = now()`,
    [
      conversationId,
      tenantId,
      channel,
      signals.customer_sentence_count ?? null,
      signals.customer_avg_sentence_length ?? null,
      signals.time_marker_count ?? null,
      signals.price_marker_count ?? null,
      signals.brand_mention_count ?? null,
      skipReason || null,
    ]
  );
}

// ─────────────────────────────────────────────────────────────────────
// Extract signals for a single conversation. Voice only in step 1.
// Returns { processed: bool, skipped: bool, skip_reason: string|null }.
// Never throws — errors are caught and logged, returning { processed: false }
// so one bad conversation doesn't poison the whole sweep.
// ─────────────────────────────────────────────────────────────────────
async function extractForConversation(conv) {
  try {
    // Step 1 is voice-only. If somehow a non-voice row sneaks past the
    // SELECT filter (e.g. enum value drift), skip it cleanly.
    if (conv.source_type !== "voice") {
      return { processed: false, skipped: true, skip_reason: "not_voice_step1" };
    }

    const customerTurns = parseCustomerTurnsFromFlatTranscript(conv.transcript);

    // Below-threshold: write a skip-marker row so 9C can distinguish
    // "thin conversation" from "real zero". This mirrors the
    // persona_skip_reason pattern called out in mig 073's comment.
    if (customerTurns.length < MIN_CUSTOMER_TURNS) {
      await upsertSignals(
        conv.id,
        conv.tenant_id,
        "voice",
        {}, // all signal columns null
        `too_few_customer_turns:${customerTurns.length}`
      );
      return { processed: true, skipped: true, skip_reason: "too_few_customer_turns" };
    }

    const brandList = getBrandListForVertical(conv.vertical_id);
    const signals = runDeterministicExtractors(customerTurns, brandList);

    await upsertSignals(conv.id, conv.tenant_id, "voice", signals, null);

    return { processed: true, skipped: false, skip_reason: null };
  } catch (err) {
    console.error(
      "[linguisticExtraction] conversationId=%s tenantId=%s err=%s",
      conv.id,
      conv.tenant_id,
      err.message
    );
    return { processed: false, skipped: false, skip_reason: null };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main sweep — called by the cron every 15 min.
//
// Idempotent and safely re-runnable: if a run is interrupted, the next
// tick picks up where it left off because each conversation is either
// (a) written to conversation_linguistic_signals (and thus excluded by
// the NOT EXISTS clause) or (b) untouched and still pending.
// ─────────────────────────────────────────────────────────────────────
async function runLinguisticExtractionSweep() {
  const startedAt = Date.now();
  const conversations = await findConversationsNeedingExtraction(BATCH_SIZE);

  if (conversations.length === 0) {
    return { processed: 0, skipped: 0, errors: 0, elapsedMs: Date.now() - startedAt };
  }

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const conv of conversations) {
    const result = await extractForConversation(conv);
    if (result.processed) {
      processed++;
      if (result.skipped) skipped++;
    } else {
      errors++;
    }
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(
    "[linguisticExtraction] sweep done batch=%d processed=%d skipped=%d errors=%d elapsedMs=%d",
    conversations.length,
    processed,
    skipped,
    errors,
    elapsedMs
  );

  return { processed, skipped, errors, elapsedMs };
}

module.exports = {
  runLinguisticExtractionSweep,
  // Exported for tests + future tooling.
  parseCustomerTurnsFromFlatTranscript,
  extractForConversation,
};

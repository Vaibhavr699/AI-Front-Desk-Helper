"use strict";

// ═══════════════════════════════════════════════════════════════════════
// Phase 9B step 1 — linguistic signal extraction (voice only)
// May 27, 2026 — schema-corrected build
//
// Reads completed voice coaching_conversations, runs deterministic
// extractors, upserts one row per conversation into
// conversation_linguistic_signals. SMS is held until the open SMS-capture
// diagnostic closes — see the source_type filter below.
//
// Step 1 populates 5 of the 9 signal columns (sentence count, avg sentence
// length, time/price/brand markers). The 4 question/specificity columns
// stay NULL until step 2 wires in the GPT-4o classifier.
//
// SCHEMA (verified May 27 2026):
//   - coaching_conversations.id           uuid                   ✓
//   - coaching_conversations.tenant_id    uuid                   ✓
//   - coaching_conversations.source_type  text                   ✓
//       Real values seen: ai_call_inbound, ai_sms, rep_recording.
//       9B step 1 voice family = ai_call_inbound + rep_recording.
//       Pattern-matched (LIKE 'ai_call_%' OR = 'rep_recording') so future
//       ai_call_outbound is picked up automatically.
//   - coaching_conversations.scored_at    tstz                   ✓ "complete" marker
//   - coaching_conversations.transcript   jsonb                  ✓
//       Shape: [{ "role": "customer"|"agent", "text": "..." }, ...]
//   - tenants.vertical_id                 int                    ✓
// ═══════════════════════════════════════════════════════════════════════

const db = require("../lib/db");
const { runDeterministicExtractors } = require("./linguisticExtractors/deterministic");
const { getBrandListForVertical } = require("./linguisticExtractors/brandLists");

// How many conversations to process per cron tick. Keeps each run short
// even after a backlog. The cron fires every 15 min so 100/tick = 9600/day
// throughput, far above any realistic conversation volume.
const BATCH_SIZE = 100;

// Minimum customer turns required to extract. Below this we write the row
// with skip_reason set, matching the persona_skip_reason pattern called
// out in mig 073's comment.
const MIN_CUSTOMER_TURNS = 2;

// ─────────────────────────────────────────────────────────────────────
// Parse a jsonb-array transcript into a list of customer-side utterances.
//
// Shape expected (verified against live data):
//   [
//     { "role": "customer", "text": "It's a 2 beds and 1 baths..." },
//     { "role": "agent",    "text": "Got it, let me check..." },
//     ...
//   ]
//
// Returns string[] — each element is one customer turn's text, in order.
// Defensive against:
//   - transcript being null (returns [])
//   - transcript not being an array (returns [])
//   - turns missing a role or text field (skipped, not crashed)
//   - role being any case ("Customer", "CUSTOMER" — lowercased)
//   - text being non-string (skipped)
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
// Find conversations that need linguistic signal extraction.
//
// Voice family = ai_call_inbound + rep_recording. ai_sms is deliberately
// excluded until the SMS-capture diagnostic closes; once it does, change
// the WHERE clause to broaden the filter and 9B picks up SMS rows on the
// next tick.
//
// We deliberately key off "no signal row exists" rather than a flag on
// coaching_conversations — keeps the conversation table read-only from
// this pipeline's perspective, and means a backfill is just "delete from
// conversation_linguistic_signals where ..." plus letting the cron catch up.
// ─────────────────────────────────────────────────────────────────────
async function findConversationsNeedingExtraction(limit) {
  const { rows } = await db.query(
    `SELECT cc.id, cc.tenant_id, cc.source_type, cc.transcript,
            t.vertical_id
       FROM coaching_conversations cc
       JOIN tenants t ON t.id = cc.tenant_id
      WHERE (cc.source_type LIKE 'ai_call_%' OR cc.source_type = 'rep_recording')
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
// Step 1 leaves the 4 LLM columns (open/closed/detail question counts,
// specificity score) as NULL — step 2 backfills them.
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
// Map source_type → channel column value.
// Voice-family conversations all get channel='voice'. When SMS gets
// turned on later, ai_sms maps to channel='sms'.
// ─────────────────────────────────────────────────────────────────────
function channelForSourceType(sourceType) {
  if (sourceType === "ai_sms") return "sms";
  // ai_call_inbound, ai_call_outbound, rep_recording — all voice family
  return "voice";
}

// ─────────────────────────────────────────────────────────────────────
// Extract signals for a single conversation.
// Returns { processed: bool, skipped: bool, skip_reason: string|null }.
// Never throws — errors are caught and logged, returning { processed: false }
// so one bad conversation doesn't poison the whole sweep.
// ─────────────────────────────────────────────────────────────────────
async function extractForConversation(conv) {
  try {
    const channel = channelForSourceType(conv.source_type);
    const customerTurns = parseCustomerTurns(conv.transcript);

    // Below-threshold: write a skip-marker row so 9C can distinguish
    // "thin conversation" from "real zero". Mirrors persona_skip_reason.
    if (customerTurns.length < MIN_CUSTOMER_TURNS) {
      await upsertSignals(
        conv.id,
        conv.tenant_id,
        channel,
        {}, // all signal columns null
        `too_few_customer_turns:${customerTurns.length}`
      );
      return { processed: true, skipped: true, skip_reason: "too_few_customer_turns" };
    }

    const brandList = getBrandListForVertical(conv.vertical_id);
    const signals = runDeterministicExtractors(customerTurns, brandList);

    await upsertSignals(conv.id, conv.tenant_id, channel, signals, null);

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
  parseCustomerTurns,
  channelForSourceType,
  extractForConversation,
};

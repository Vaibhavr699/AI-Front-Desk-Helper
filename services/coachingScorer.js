"use strict";

/**
 * services/coachingScorer.js
 *
 * Phase 6 A2 — Cron-driven worker that scores completed AI calls.
 * May 14, 2026.
 *
 * Every 5 minutes:
 *   1. Find AI calls completed in last 24h that aren't yet in coaching_conversations
 *   2. Parse the text transcript into the structured [{role, text}] format
 *   3. Insert into coaching_conversations linked by source_id = twilio_call_sid
 *   4. Fire analyzeConversation (scoring + persona detection) async
 *   5. Also retry any conversations in last 24h that failed to score (transient failures)
 *
 * Filtering — only scores calls meeting all of:
 *   - ended_at IS NOT NULL (completed)
 *   - duration_minutes >= 0.5 (skip hang-ups under 30 sec)
 *   - length(transcript) >= 50 (skip empty/minimal calls)
 *   - Not already in coaching_conversations (dedup by source_id)
 *
 * Concurrency: in-process lock prevents overlapping ticks. If you scale beyond
 * 1 Render instance, upgrade to a UNIQUE constraint on
 * coaching_conversations(source_type, source_id) + INSERT...ON CONFLICT.
 *
 * Rate limit: max 20 calls scored per tick. At ~$0.08/call × 20 = $1.60/tick.
 * Worst case backlog ramps at ~$19/hour, never one big spike.
 */

const db = require("../lib/db");
const { analyzeConversation } = require("../lib/coachingEngine");

const MIN_DURATION_MINUTES = 0.5;
const MIN_TRANSCRIPT_LEN = 50;
const DEFAULT_LOOKBACK_MINUTES = 60 * 24;
const DEFAULT_BATCH_LIMIT = 20;
const RETRY_BATCH_LIMIT = 10;

// In-process lock — prevents overlapping cron ticks on a single Render instance
let sweepInProgress = false;

// ── Transcript parser ──────────────────────────────────────────────────────
//
// Converts "Assistant: ...\nUser: ..." text into the JSONB array
// coaching_conversations.transcript expects: [{role, text}, ...].
//
// Tolerant of aliases. Multi-line turn continuations are folded into the
// previous turn so wrapped paragraphs don't get treated as separate turns.

const SPEAKER_PATTERN = /^(assistant|agent|ai|rep|user|customer|caller)\s*:\s*(.*)$/i;
const AGENT_LABELS = new Set(["assistant", "agent", "ai", "rep"]);

function parseTranscript(rawText) {
  if (!rawText || typeof rawText !== "string") return [];

  const lines = rawText.split(/\r?\n/);
  const turns = [];
  let currentTurn = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const match = trimmed.match(SPEAKER_PATTERN);
    if (match) {
      if (currentTurn) turns.push(currentTurn);
      const speaker = match[1].toLowerCase();
      const role = AGENT_LABELS.has(speaker) ? "agent" : "customer";
      currentTurn = { role, text: match[2].trim() };
    } else if (currentTurn) {
      // Continuation of previous turn (wrapped text without speaker label)
      currentTurn.text += " " + trimmed;
    }
    // Lines with no speaker label and no current turn are skipped silently
  }

  if (currentTurn) turns.push(currentTurn);
  return turns.filter((t) => t.text && t.text.length > 0);
}

// ── Main sweep ─────────────────────────────────────────────────────────────

async function runScoringSweep({
  lookbackMinutes = DEFAULT_LOOKBACK_MINUTES,
  batchLimit = DEFAULT_BATCH_LIMIT,
  dryRun = false,
} = {}) {
  if (sweepInProgress) {
    console.warn("[coachingScorer] Sweep already in progress, skipping tick");
    return { ok: false, reason: "already_running" };
  }
  sweepInProgress = true;

  const startedAt = Date.now();
  let candidatesFound = 0;
  let rowsCreated = 0;
  let analyzeOk = 0;
  let analyzeFail = 0;
  let skipped = 0;
  let retriedOk = 0;
  let retriedFail = 0;

  try {
    // ── PRIMARY: find completed AI calls not yet in coaching_conversations ──
    const candidates = await db.query(
      `SELECT c.id AS call_id, c.tenant_id, c.twilio_call_sid, c.direction,
              c.transcript, c.duration_minutes, c.lead_id, c.from_number,
              c.ended_at, t.industry
         FROM calls c
         JOIN tenants t ON t.id = c.tenant_id
         LEFT JOIN coaching_conversations cc
           ON cc.source_id = c.twilio_call_sid
          AND cc.source_type IN ('ai_call_inbound', 'ai_call_outbound')
        WHERE c.ended_at IS NOT NULL
          AND c.ended_at > now() - (interval '1 minute' * $1::int)
          AND c.transcript IS NOT NULL
          AND length(c.transcript) >= $2
          AND COALESCE(c.duration_minutes, 0) >= $3
          AND cc.id IS NULL
        ORDER BY c.ended_at DESC
        LIMIT $4`,
      [lookbackMinutes, MIN_TRANSCRIPT_LEN, MIN_DURATION_MINUTES, batchLimit]
    );

    candidatesFound = candidates.rows.length;

    if (candidatesFound > 0) {
      console.log("[coachingScorer] Found %d new call(s) to score (lookback=%dmin)", candidatesFound, lookbackMinutes);
    }

    for (const call of candidates.rows) {
      try {
        const turns = parseTranscript(call.transcript);
        if (turns.length === 0) {
          console.warn("[coachingScorer] Skipping call %s — transcript parsed to 0 turns", call.twilio_call_sid);
          skipped++;
          continue;
        }

        const sourceType = call.direction === "outbound" ? "ai_call_outbound" : "ai_call_inbound";

        if (dryRun) {
          console.log("[coachingScorer][DRY] Would create conv call=%s turns=%d source=%s", call.twilio_call_sid, turns.length, sourceType);
          continue;
        }

        const insertResult = await db.query(
          `INSERT INTO coaching_conversations
             (tenant_id, source_type, source_id, industry, transcript,
              duration_seconds, customer_phone, lead_id, metadata)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb)
           RETURNING id`,
          [
            call.tenant_id,
            sourceType,
            call.twilio_call_sid,
            call.industry || null,
            JSON.stringify(turns),
            Math.round((call.duration_minutes || 0) * 60),
            call.from_number || null,
            call.lead_id || null,
            JSON.stringify({
              ended_at: call.ended_at,
              source: "coachingScorer.runScoringSweep",
              call_id: call.call_id,
            }),
          ]
        );

        const conversationId = insertResult.rows[0].id;
        rowsCreated++;

        try {
          const result = await analyzeConversation({ conversationId });
          if (result.scoring?.ok && result.persona?.ok) {
            analyzeOk++;
          } else {
            analyzeFail++;
            console.warn("[coachingScorer] Partial analyze conv=%s scoring=%j persona=%j", conversationId, result.scoring, result.persona);
          }
        } catch (analyzeErr) {
          analyzeFail++;
          console.error("[coachingScorer] analyzeConversation threw conv=%s: %s", conversationId, analyzeErr.message);
        }
      } catch (rowErr) {
        console.error("[coachingScorer] Error processing call %s: %s", call.twilio_call_sid, rowErr.message);
        skipped++;
      }
    }

    // ── RETRY: re-analyze conversations that exist but never got scored ───
    // (transient OpenAI failures, malformed responses, etc.)
    if (!dryRun) {
      const retryRows = await db.query(
        `SELECT id FROM coaching_conversations
          WHERE created_at > now() - interval '24 hours'
            AND scored_at IS NULL
            AND source_type IN ('ai_call_inbound', 'ai_call_outbound')
          ORDER BY created_at DESC
          LIMIT $1`,
        [RETRY_BATCH_LIMIT]
      );

      for (const row of retryRows.rows) {
        try {
          const result = await analyzeConversation({ conversationId: row.id });
          if (result.scoring?.ok) {
            retriedOk++;
          } else {
            retriedFail++;
          }
        } catch (err) {
          retriedFail++;
          console.error("[coachingScorer] retry analyze threw conv=%s: %s", row.id, err.message);
        }
      }
    }

    const elapsedMs = Date.now() - startedAt;
    if (candidatesFound > 0 || retriedOk > 0 || retriedFail > 0) {
      console.log(
        "[coachingScorer] Sweep done candidates=%d created=%d analyzeOk=%d analyzeFail=%d skipped=%d retriedOk=%d retriedFail=%d elapsedMs=%d",
        candidatesFound, rowsCreated, analyzeOk, analyzeFail, skipped, retriedOk, retriedFail, elapsedMs
      );
    }

    return { ok: true, candidatesFound, rowsCreated, analyzeOk, analyzeFail, skipped, retriedOk, retriedFail, elapsedMs };
  } catch (err) {
    console.error("[coachingScorer] Sweep failed: %s", err.message);
    return { ok: false, error: err.message, elapsedMs: Date.now() - startedAt };
  } finally {
    sweepInProgress = false;
  }
}

module.exports = {
  runScoringSweep,
  parseTranscript, // exported for tests / introspection
};

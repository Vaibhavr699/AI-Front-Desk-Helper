"use strict";

/**
 * services/smsCoachingScorer.js
 *
 * Phase 6E — Cron-driven worker that scores completed AI SMS conversations.
 * May 21, 2026.
 *
 * The SMS analogue of services/coachingScorer.js. Where the voice scorer
 * scans the `calls` table (which has a natural "call ended" event and a
 * single transcript blob), SMS has neither — texting has no "ended" signal
 * and the conversation is scattered across individual `messages` rows.
 *
 * This scorer reconstructs SMS "conversations" from the messages table:
 *
 *   Every 15 minutes:
 *     1. Pull recent SMS messages (channel='sms') grouped by lead.
 *     2. Split each lead's message stream into conversation WINDOWS —
 *        any silence gap longer than QUIET_PERIOD_HOURS starts a new window.
 *     3. A window is "complete" when its last message is older than
 *        QUIET_PERIOD_HOURS (12h) — i.e. the conversation has gone quiet.
 *     4. For each complete window not already scored, build the
 *        [{role, text}] transcript and insert a coaching_conversations row
 *        with source_type='ai_sms'.
 *     5. Fire analyzeConversation (scoring + persona/DISC) async.
 *
 * Why 12 hours: long enough that we're not scoring a conversation that's
 * still actively going back-and-forth; short enough that coaching feedback
 * is same-day. A 12h silence is a real conversation boundary for a
 * home-services SMS thread.
 *
 * DEDUP: source_id = `${lead_id}:${firstMessageIsoOfWindow}`. The first
 * message timestamp of a window is stable across cron runs, so re-running
 * recomputes the same key and the existing-row check skips it. A genuinely
 * new conversation (new window after a >12h gap) has a different first
 * message, hence a different key, hence scores fresh. This is the SMS
 * equivalent of the voice scorer's source_id = twilio_call_sid.
 *
 * CHANNEL SCOPE: SMS only (channel='sms'). Website-chat and Facebook
 * conversations are intentionally NOT scored here — the
 * coaching_conversations.source_type CHECK constraint only sanctions
 * 'ai_sms', and folding other channels under that label would be
 * dishonest. Adding ai_website / ai_facebook is a separate, deliberate
 * future migration.
 *
 * MIN customer messages: a window needs at least MIN_CUSTOMER_MSGS (2)
 * inbound messages to be worth scoring — mirrors the >=2 customer-turn
 * threshold in coachingEngine. A one-text-one-reply exchange has nothing
 * meaningful to coach and would just clutter the dashboard with 5.0s.
 *
 * Concurrency: in-process lock, same pattern as coachingScorer.js. If you
 * scale beyond 1 Render instance, the source_id existing-row check is the
 * real dedup safety net anyway.
 *
 * Rate limit: max DEFAULT_BATCH_LIMIT (20) conversations scored per tick.
 */

const db = require("../lib/db");
const { analyzeConversation } = require("../lib/coachingEngine");

// A conversation window closes after this much silence. Also the age a
// window's last message must exceed before the window is "complete".
const QUIET_PERIOD_HOURS = 12;
const QUIET_PERIOD_MS = QUIET_PERIOD_HOURS * 60 * 60 * 1000;

// Only score windows with at least this many inbound (customer) messages.
const MIN_CUSTOMER_MSGS = 2;

// How far back to look for messages. A window can only be scored once its
// last message is >12h old, so we need a lookback comfortably larger than
// the quiet period. 7 days catches any window that recently went quiet
// while keeping the scan cheap.
const LOOKBACK_DAYS = 7;

// Max conversations scored per tick (cost control — same as voice scorer).
const DEFAULT_BATCH_LIMIT = 20;

// Retry conversations that exist but never got scored (transient failures).
const RETRY_BATCH_LIMIT = 10;

// ── High-signal exception patterns (PR 4, May 29, 2026) ────────────────
//
// When a customer message matches one of these regexes, the conversation
// gets scored even with only 1 customer message — bypassing the
// MIN_CUSTOMER_MSGS threshold. The point is to surface high-stakes short
// exchanges in AI Coaching so tenants can leave feedback that becomes a
// coaching rule.
//
// Patterns are deterministic (no GPT detection) because false negatives
// here just mean the conversation gets filtered like before — no harm
// done. False positives just mean a slightly-wider net for AI Coaching,
// which is acceptable.
//
// Categories:
//   1. Conversion / commitment signals — "just signed", "I'm in", "let's do it"
//   2. Frustration / repeat-info-ask — "you already have my info"
//   3. Soft cancellation / disengagement — "going with someone else"
//
// Each conversation that matches gets metadata.exception_flag=true so the
// AI Coaching UI can later badge them distinctly if desired.
const HIGH_SIGNAL_PATTERNS = [
  // Conversion / commitment signals
  /\b(just\s+signed|i\s+signed|we\s+signed|signed\s+(it|up|on)|signing\s+now|sign\s+me\s+up|where\s+do\s+i\s+sign|let'?s\s+do\s+(it|this)|i'?m\s+in|count\s+me\s+in|all\s+set|i'?ll\s+take\s+it|sounds\s+good\s+let'?s|let'?s\s+go\s+with\s+(it|you|that))\b/i,
  // Frustration / repeat-info-ask
  /\b(you\s+(already\s+)?(have|know)\s+(my|that|this)|i\s+(already\s+)?(told|gave|sent)\s+you|why\s+are\s+you\s+asking|i\s+just\s+told\s+you|you\s+should\s+know\s+(this|that)|stop\s+asking)\b/i,
  // Soft cancellation / disengagement
  /\b(not\s+interested|changed\s+my\s+mind|gonna\s+pass|going\s+with\s+(someone|another)|chose\s+(someone|another)|nevermind|never\s+mind|no\s+longer\s+(need|interested))\b/i,
];

// Helper: does any customer message in this window trip a signal pattern?
function hasHighSignal(windowMsgs) {
  for (const m of windowMsgs) {
    if (m.direction !== "inbound") continue;
    const body = String(m.body || "");
    for (const rx of HIGH_SIGNAL_PATTERNS) {
      if (rx.test(body)) return true;
    }
  }
  return false;
}

// In-process lock — prevents overlapping cron ticks on a single instance.
let sweepInProgress = false;

// ── Window splitter ─────────────────────────────────────────────────────────
//
// Given a lead's messages sorted oldest→newest, split into conversation
// windows. A gap longer than QUIET_PERIOD_MS between consecutive messages
// starts a new window. Returns an array of windows; each window is an array
// of message rows.
function splitIntoWindows(messages) {
  const windows = [];
  let current = [];

  for (const msg of messages) {
    if (current.length === 0) {
      current.push(msg);
      continue;
    }
    const prev = current[current.length - 1];
    const gapMs = new Date(msg.created_at).getTime() - new Date(prev.created_at).getTime();
    if (gapMs > QUIET_PERIOD_MS) {
      windows.push(current);
      current = [msg];
    } else {
      current.push(msg);
    }
  }
  if (current.length > 0) windows.push(current);

  return windows;
}

// ── Transcript builder ──────────────────────────────────────────────────────
//
// Convert a window of message rows into the [{role, text}] shape that
// coaching_conversations.transcript expects (same shape coachingScorer.js
// produces for voice). Inbound = the customer; outbound = the AI agent.
function buildTranscript(windowMsgs) {
  return windowMsgs
    .map((m) => ({
      role: m.direction === "inbound" ? "customer" : "agent",
      text: String(m.body || "").trim(),
    }))
    .filter((t) => t.text.length > 0);
}

function countCustomerMsgs(windowMsgs) {
  return windowMsgs.filter((m) => m.direction === "inbound").length;
}

// ── Main sweep ──────────────────────────────────────────────────────────────

async function runSmsCoachingSweep({
  quietPeriodMs = QUIET_PERIOD_MS,
  batchLimit = DEFAULT_BATCH_LIMIT,
  dryRun = false,
} = {}) {
  if (sweepInProgress) {
    console.warn("[smsCoachingScorer] Sweep already in progress, skipping tick");
    return { ok: false, reason: "already_running" };
  }
  sweepInProgress = true;

  const startedAt = Date.now();
  let leadsScanned = 0;
  let windowsFound = 0;
  let windowsComplete = 0;
  let rowsCreated = 0;
  let analyzeOk = 0;
  let analyzeFail = 0;
  let skippedTooShort = 0;
  let skippedAlreadyScored = 0;
  let retriedOk = 0;
  let retriedFail = 0;

  try {
    // ── Pull all SMS messages for leads active in the lookback window ──────
    //
    // We fetch every sms message (both directions) for any lead that has
    // at least one sms message in the last LOOKBACK_DAYS. Grouping +
    // window-splitting happens in JS — Postgres window functions could do
    // it, but the message volumes here are small (one tenant, ~100/day)
    // and the JS path is far easier to reason about and test.
    const msgRes = await db.query(
      `SELECT m.id, m.tenant_id, m.lead_id, m.direction, m.body, m.created_at
         FROM messages m
        WHERE m.channel = 'sms'
          AND m.lead_id IS NOT NULL
          AND m.created_at > now() - (interval '1 day' * $1::int)
        ORDER BY m.lead_id ASC, m.created_at ASC`,
      [LOOKBACK_DAYS]
    );

    // Group rows by lead_id (already sorted by lead_id, then created_at).
    const byLead = new Map();
    for (const row of msgRes.rows) {
      if (!byLead.has(row.lead_id)) byLead.set(row.lead_id, []);
      byLead.get(row.lead_id).push(row);
    }
    leadsScanned = byLead.size;

    const now = Date.now();

    for (const [leadId, leadMsgs] of byLead.entries()) {
      if (rowsCreated >= batchLimit) {
        console.log("[smsCoachingScorer] Batch limit %d reached — remaining windows next tick", batchLimit);
        break;
      }

      const windows = splitIntoWindows(leadMsgs);
      windowsFound += windows.length;

      for (const win of windows) {
        if (rowsCreated >= batchLimit) break;

        // A window is "complete" only once its LAST message is older than
        // the quiet period — i.e. the conversation has actually gone quiet.
        const lastMsg = win[win.length - 1];
        const lastAgeMs = now - new Date(lastMsg.created_at).getTime();
        if (lastAgeMs < quietPeriodMs) {
          // Still active (or recently active) — leave it for a later tick.
          continue;
        }
        windowsComplete++;

        // Skip windows without enough customer back-and-forth to coach,
        // UNLESS the conversation contains a high-signal pattern (PR 4,
        // May 29, 2026). High-signal short exchanges get through the
        // gate so tenants can coach the AI on critical missed moments
        // like "Just signed!" or "you already have my info".
        const customerMsgs = countCustomerMsgs(win);
        const isHighSignal = hasHighSignal(win);
        if (customerMsgs < MIN_CUSTOMER_MSGS && !isHighSignal) {
          skippedTooShort++;
          continue;
        }

        const firstMsg = win[0];
        const tenantId = firstMsg.tenant_id;
        // Stable dedup key: lead + window's first message timestamp.
        const sourceId = `${leadId}:${new Date(firstMsg.created_at).toISOString()}`;

        // Already scored? (idempotent across cron runs + restarts)
        const existing = await db.query(
          `SELECT id FROM coaching_conversations
            WHERE source_type = 'ai_sms' AND source_id = $1
            LIMIT 1`,
          [sourceId]
        );
        if (existing.rows.length > 0) {
          skippedAlreadyScored++;
          continue;
        }

        const transcript = buildTranscript(win);
        if (transcript.length === 0) {
          skippedTooShort++;
          continue;
        }

        if (dryRun) {
          console.log(
            "[smsCoachingScorer][DRY] Would create conv lead=%s window=%s msgs=%d customerMsgs=%d",
            leadId, sourceId, win.length, customerMsgs
          );
          continue;
        }

        // Industry tag — pull from the tenant so the scorer/persona prompts
        // get trade context, same as the voice path.
        let industry = null;
        try {
          const tRes = await db.query("SELECT industry FROM tenants WHERE id = $1", [tenantId]);
          industry = tRes.rows[0]?.industry || null;
        } catch (e) {
          console.warn("[smsCoachingScorer] industry lookup failed (non-fatal):", e.message);
        }

        // Conversation "duration" — span from first to last message, in
        // seconds. Not as meaningful as a call duration, but it's an honest
        // value and keeps the column populated.
        const durationSeconds = Math.round(
          (new Date(lastMsg.created_at).getTime() - new Date(firstMsg.created_at).getTime()) / 1000
        );

        let conversationId;
        try {
          const insertRes = await db.query(
            `INSERT INTO coaching_conversations
               (tenant_id, source_type, source_id, industry, transcript,
                duration_seconds, lead_id, metadata)
             VALUES ($1, 'ai_sms', $2, $3, $4::jsonb, $5, $6, $7::jsonb)
             RETURNING id`,
            [
              tenantId,
              sourceId,
              industry,
              JSON.stringify(transcript),
              durationSeconds,
              leadId,
             JSON.stringify({
                source: "smsCoachingScorer.runSmsCoachingSweep",
                channel: "sms",
                window_first_message_at: new Date(firstMsg.created_at).toISOString(),
                window_last_message_at: new Date(lastMsg.created_at).toISOString(),
                message_count: win.length,
                customer_message_count: customerMsgs,
                exception_flag: isHighSignal,
              }),
            ]
          );
          conversationId = insertRes.rows[0].id;
          rowsCreated++;
        } catch (insErr) {
          console.error(
            "[smsCoachingScorer] insert failed lead=%s window=%s: %s",
            leadId, sourceId, insErr.message
          );
          continue;
        }

        // Fire scoring + persona/DISC, same as the voice scorer.
        try {
          const result = await analyzeConversation({ conversationId });
          if (result.scoring?.ok && result.persona?.ok) {
            analyzeOk++;
          } else {
            analyzeFail++;
            console.warn(
              "[smsCoachingScorer] Partial analyze conv=%s scoring=%j persona=%j",
              conversationId, result.scoring, result.persona
            );
          }
        } catch (analyzeErr) {
          analyzeFail++;
          console.error(
            "[smsCoachingScorer] analyzeConversation threw conv=%s: %s",
            conversationId, analyzeErr.message
          );
        }
      }
    }

    // ── RETRY: re-analyze ai_sms conversations that never got scored ───────
    // (transient OpenAI failures, malformed responses, etc.) — mirrors the
    // retry pass in coachingScorer.js.
    if (!dryRun) {
      const retryRows = await db.query(
        `SELECT id FROM coaching_conversations
          WHERE created_at > now() - interval '24 hours'
            AND scored_at IS NULL
            AND source_type = 'ai_sms'
          ORDER BY created_at DESC
          LIMIT $1`,
        [RETRY_BATCH_LIMIT]
      );

      for (const row of retryRows.rows) {
        try {
          const result = await analyzeConversation({ conversationId: row.id });
          if (result.scoring?.ok) retriedOk++;
          else retriedFail++;
        } catch (err) {
          retriedFail++;
          console.error("[smsCoachingScorer] retry analyze threw conv=%s: %s", row.id, err.message);
        }
      }
    }

    const elapsedMs = Date.now() - startedAt;
    if (rowsCreated > 0 || retriedOk > 0 || retriedFail > 0) {
      console.log(
        "[smsCoachingScorer] Sweep done leads=%d windows=%d complete=%d created=%d analyzeOk=%d analyzeFail=%d tooShort=%d alreadyScored=%d retriedOk=%d retriedFail=%d elapsedMs=%d",
        leadsScanned, windowsFound, windowsComplete, rowsCreated, analyzeOk, analyzeFail,
        skippedTooShort, skippedAlreadyScored, retriedOk, retriedFail, elapsedMs
      );
    }

    return {
      ok: true,
      leadsScanned, windowsFound, windowsComplete, rowsCreated,
      analyzeOk, analyzeFail, skippedTooShort, skippedAlreadyScored,
      retriedOk, retriedFail, elapsedMs,
    };
  } catch (err) {
    console.error("[smsCoachingScorer] Sweep failed: %s", err.message);
    return { ok: false, error: err.message, elapsedMs: Date.now() - startedAt };
  } finally {
    sweepInProgress = false;
  }
}

module.exports = {
  runSmsCoachingSweep,
  // Exported for tests / introspection
  splitIntoWindows,
  buildTranscript,
};

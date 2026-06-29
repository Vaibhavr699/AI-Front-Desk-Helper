"use strict";

/**
 * services/audioSignalAnalyzer.js
 *
 * Phase 9A — Rich Signal Capture: audio signal analysis (voice only).
 * May 22, 2026.
 *
 * THE OFF-PATH HALF OF 9A.
 * ------------------------
 * 9A is split deliberately into two halves with very different risk:
 *
 *   server.js  (live voice WebSocket path)
 *     During a call, accumulates lightweight timing + frame data in an
 *     in-memory per-connection collector. On call-end, writes that raw
 *     blob to calls.audio_signals_raw (migration 074) in ONE update.
 *     No analysis, no decoding in the live path.
 *
 *   THIS FILE  (invoked by coachingScorer.js cron — off the voice path)
 *     coachingScorer.js, when it creates the coaching_conversations row
 *     for a call, reads calls.audio_signals_raw and calls:
 *         analyzeAudioSignals(raw)      -> computed signals object
 *         persistAudioSignals(convId, tenantId, signals)
 *     All the heavy / risky logic (mu-law decode, WPM math, variance)
 *     lives HERE. A bug here logs an error on a cron tick — it can never
 *     degrade a live call.
 *
 * WHY cron-side and not inline: call_audio_signals FKs
 * coaching_conversations(id), and that row does not exist at call-end —
 * coachingScorer.js creates it later. So analysis cannot run inline
 * regardless; doing it cron-side is both necessary and safer.
 *
 * INPUT — calls.audio_signals_raw shape (written by server.js, schema 1):
 *   {
 *     schema: 1,
 *     customer_turns: [ { start_ms, end_ms, word_count }, ... ],
 *     agent_turns:    [ { start_ms, end_ms, word_count }, ... ],
 *     customer_interruptions: <int>,
 *     agent_interruptions:    <int>,
 *     customer_frames: [ <int 0..255 mu-law sample bytes?> ]  -- see note,
 *     frames_captured: <int>,
 *     direction: "inbound" | "outbound"
 *   }
 *
 *   NOTE on customer_frames: server.js collects, per inbound media frame,
 *   a single pre-computed RMS energy integer for that frame (the live
 *   path does the cheap per-frame RMS; it does NOT ship raw audio here).
 *   That keeps the blob small and the decode cost out of the live path.
 *   decodeMulawSample() below is still exported because server.js imports
 *   it to compute those per-frame RMS values — the decode table lives
 *   here so there is one source of truth.
 *
 * OUTPUT — the 7 signal columns of call_audio_signals (migration 073):
 *   customer_words_per_minute, agent_words_per_minute,
 *   customer_pause_count, customer_avg_pause_seconds,
 *   customer_interruption_count, agent_interruption_count,
 *   customer_amplitude_variance,
 *   plus audio_frames_analyzed, raw_features (jsonb), skip_reason.
 *
 * Every signal is computed defensively: if the input cannot support a
 * given signal, that column is left null rather than guessed. skip_reason
 * is set when the whole row is not meaningfully analyzable, so 9C can
 * honestly discard it instead of treating nulls as real zeros.
 */

const db = require("../lib/db");

// ─────────────────────────────────────────────────────────────────────────────
// Tunables
// ─────────────────────────────────────────────────────────────────────────────

// A gap between two consecutive customer turns longer than this counts as a
// pause. 0.6s is long enough to exclude natural between-sentence breathing
// and short enough to catch a real hesitation.
const PAUSE_THRESHOLD_MS = 600;

// A call needs at least this many customer turns for turn-derived signals
// (WPM, pauses) to mean anything. One turn = no pauses possible, WPM from a
// single utterance is noise.
const MIN_CUSTOMER_TURNS = 2;

// A call needs at least this many customer audio frames for amplitude
// variance to be meaningful. Below this, leave customer_amplitude_variance
// null (the rest of the row can still be fine).
const MIN_FRAMES_FOR_AMPLITUDE = 50;

// Sanity ceiling on WPM. Human speech tops out well under this; anything
// above means the turn timing was bad (e.g. a near-zero duration). We null
// the WPM rather than emit a garbage 4000.
const MAX_PLAUSIBLE_WPM = 400;

// ─────────────────────────────────────────────────────────────────────────────
// mu-law decode
//
// Twilio Media Streams send G.711 mu-law (PCMU) audio: one byte per sample,
// 8 kHz. decodeMulawSample turns one mu-law byte (0..255) into a signed
// 16-bit linear PCM sample (-32124..32124). Standard ITU-T G.711 algorithm.
//
// server.js imports decodeMulawSample to compute a per-frame RMS energy
// integer for each inbound media frame; the analyzer here imports nothing
// of its own for that — it consumes the pre-computed RMS values. The decode
// is kept in this module so there is exactly one implementation.
// ─────────────────────────────────────────────────────────────────────────────

const MULAW_BIAS = 0x84; // 132
const MULAW_CLIP = 32635;

/**
 * Decode a single mu-law byte to a signed 16-bit PCM sample.
 * @param {number} muByte  integer 0..255
 * @returns {number} signed PCM sample
 */
function decodeMulawSample(muByte) {
  // mu-law is stored inverted (complemented) on the wire.
  let mu = (~muByte) & 0xff;
  const sign = mu & 0x80;
  const exponent = (mu >> 4) & 0x07;
  const mantissa = mu & 0x0f;
  let sample = ((mantissa << 3) + MULAW_BIAS) << exponent;
  sample -= MULAW_BIAS;
  return sign ? -sample : sample;
}

/**
 * Compute RMS energy of a buffer of mu-law bytes. Exported for server.js
 * to use per-frame in the live path (cheap: one pass, no allocation beyond
 * the loop). Returns an integer RMS in linear-PCM units, or 0 for empty.
 *
 * @param {Buffer|Uint8Array|number[]} muBytes
 * @returns {number} integer RMS energy
 */
function mulawFrameRms(muBytes) {
  if (!muBytes || muBytes.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < muBytes.length; i++) {
    const s = decodeMulawSample(muBytes[i]);
    sumSq += s * s;
  }
  return Math.round(Math.sqrt(sumSq / muBytes.length));
}

// ─────────────────────────────────────────────────────────────────────────────
// Small numeric helpers
// ─────────────────────────────────────────────────────────────────────────────

function mean(nums) {
  if (!nums || nums.length === 0) return null;
  let sum = 0;
  for (const n of nums) sum += n;
  return sum / nums.length;
}

/** Population variance. Returns null for fewer than 2 values. */
function variance(nums) {
  if (!nums || nums.length < 2) return null;
  const m = mean(nums);
  let sumSq = 0;
  for (const n of nums) {
    const d = n - m;
    sumSq += d * d;
  }
  return sumSq / nums.length;
}

/** Round to `dp` decimal places, passing null through untouched. */
function round(n, dp = 2) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = Math.pow(10, dp);
  return Math.round(n * f) / f;
}

// ─────────────────────────────────────────────────────────────────────────────
// WPM
//
// WPM = total words across a side's turns / total speaking time across that
// side's turns. Speaking time is the sum of (end_ms - start_ms) over the
// side's turns — VAD-measured speech only, so silence between turns is
// correctly excluded. This is the decode-free WPM definition Drew approved.
// ─────────────────────────────────────────────────────────────────────────────

function computeWpm(turns) {
  if (!Array.isArray(turns) || turns.length === 0) return null;

  let totalWords = 0;
  let totalSpeakingMs = 0;

  for (const t of turns) {
    const words = Number(t.word_count) || 0;
    const start = Number(t.start_ms);
    const end = Number(t.end_ms);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const durMs = end - start;
    if (durMs <= 0) continue; // skip zero/negative-duration turns
    totalWords += words;
    totalSpeakingMs += durMs;
  }

  if (totalWords === 0 || totalSpeakingMs === 0) return null;

  const minutes = totalSpeakingMs / 60000;
  const wpm = totalWords / minutes;

  // Implausible WPM means the timing was bad — null it rather than emit junk.
  if (wpm > MAX_PLAUSIBLE_WPM) return null;

  return wpm;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pauses
//
// A pause is a gap between the END of one customer turn and the START of the
// next customer turn that exceeds PAUSE_THRESHOLD_MS. Returns count + mean
// pause length in seconds. Turns are sorted by start_ms first so collector
// ordering quirks do not matter.
// ─────────────────────────────────────────────────────────────────────────────

function computePauses(customerTurns) {
  if (!Array.isArray(customerTurns) || customerTurns.length < MIN_CUSTOMER_TURNS) {
    return { count: null, avgSeconds: null };
  }

  const sorted = customerTurns
    .filter((t) => Number.isFinite(Number(t.start_ms)) && Number.isFinite(Number(t.end_ms)))
    .slice()
    .sort((a, b) => Number(a.start_ms) - Number(b.start_ms));

  if (sorted.length < MIN_CUSTOMER_TURNS) return { count: null, avgSeconds: null };

  const pauseLengthsMs = [];
  for (let i = 1; i < sorted.length; i++) {
    const gap = Number(sorted[i].start_ms) - Number(sorted[i - 1].end_ms);
    if (gap > PAUSE_THRESHOLD_MS) pauseLengthsMs.push(gap);
  }

  if (pauseLengthsMs.length === 0) {
    // Valid result: the customer had multiple turns with no long pause.
    return { count: 0, avgSeconds: 0 };
  }

  return {
    count: pauseLengthsMs.length,
    avgSeconds: mean(pauseLengthsMs) / 1000,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// analyzeAudioSignals
//
// Pure function: raw blob -> computed signals object. No DB, no I/O. The
// returned object's keys map 1:1 onto call_audio_signals columns, plus a
// `skip_reason` (string|null) and `raw_features` (jsonb-able object).
// ─────────────────────────────────────────────────────────────────────────────

function analyzeAudioSignals(raw) {
  // ── Guard: nothing usable at all ──────────────────────────────────────────
  if (!raw || typeof raw !== "object") {
    return emptyResult("no_raw_data");
  }
  if (raw.schema !== 1) {
    // Unknown shape — refuse to guess. Bumping the collector's schema
    // without teaching the analyzer the new shape lands here on purpose.
    return emptyResult("unsupported_schema_" + String(raw.schema));
  }

  const customerTurns = Array.isArray(raw.customer_turns) ? raw.customer_turns : [];
  const agentTurns = Array.isArray(raw.agent_turns) ? raw.agent_turns : [];
  const customerFrames = Array.isArray(raw.customer_frames) ? raw.customer_frames : [];

  // ── Guard: customer never really spoke ───────────────────────────────────
  // Mirrors coachingScorer's "0 turns" skip — a row with no customer audio
  // is not analyzable, and 9C must not read its nulls as zeros.
  if (customerTurns.length === 0) {
    return emptyResult("no_customer_audio");
  }

  // ── WPM ───────────────────────────────────────────────────────────────────
  const customerWpm = computeWpm(customerTurns);
  const agentWpm = computeWpm(agentTurns);

  // ── Pauses (customer side) ───────────────────────────────────────────────
  const pauses = computePauses(customerTurns);

  // ── Interruptions ────────────────────────────────────────────────────────
  // Counted live in server.js (it knows turn-taking state in real time);
  // the analyzer just carries the integers through, coercing safely.
  const customerInterruptions = coerceCount(raw.customer_interruptions);
  const agentInterruptions = coerceCount(raw.agent_interruptions);

  // ── Amplitude variance (customer side) ───────────────────────────────────
  // customer_frames holds one pre-computed RMS energy per inbound frame.
  // Variance of those RMS values = how much the customer's loudness moved.
  let amplitudeVariance = null;
  let framesAnalyzed = customerFrames.length;
  if (customerFrames.length >= MIN_FRAMES_FOR_AMPLITUDE) {
    const numericFrames = customerFrames
      .map((f) => Number(f))
      .filter((f) => Number.isFinite(f));
    framesAnalyzed = numericFrames.length;
    amplitudeVariance = variance(numericFrames);
  }

  // ── skip_reason for the row as a whole ───────────────────────────────────
  // The row is still worth writing if ANY core signal came through. It is
  // only "skipped" if turn-derived signals all failed — that means the
  // timing data was unusable, and the row would be all-nulls noise.
  let skipReason = null;
  if (customerWpm == null && pauses.count == null) {
    skipReason = "insufficient_turn_data";
  }

  return {
    customer_words_per_minute: round(customerWpm, 1),
    agent_words_per_minute: round(agentWpm, 1),
    customer_pause_count: pauses.count,
    customer_avg_pause_seconds: round(pauses.avgSeconds, 2),
    customer_interruption_count: customerInterruptions,
    agent_interruption_count: agentInterruptions,
    customer_amplitude_variance: round(amplitudeVariance, 2),
    audio_frames_analyzed: framesAnalyzed,
    skip_reason: skipReason,
    raw_features: {
      analyzer_version: "9A.1",
      direction: raw.direction || null,
      customer_turn_count: customerTurns.length,
      agent_turn_count: agentTurns.length,
      frames_captured: coerceCount(raw.frames_captured),
      pause_threshold_ms: PAUSE_THRESHOLD_MS,
      amplitude_analyzed: amplitudeVariance != null,
    },
  };
}

/** A result object for a row that could not be analyzed at all. */
function emptyResult(skipReason) {
  return {
    customer_words_per_minute: null,
    agent_words_per_minute: null,
    customer_pause_count: null,
    customer_avg_pause_seconds: null,
    customer_interruption_count: null,
    agent_interruption_count: null,
    customer_amplitude_variance: null,
    audio_frames_analyzed: 0,
    skip_reason: skipReason,
    raw_features: { analyzer_version: "9A.1" },
  };
}

/** Coerce a value to a non-negative integer, or null if it isn't one. */
function coerceCount(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

// ─────────────────────────────────────────────────────────────────────────────
// persistAudioSignals
//
// Idempotent upsert into call_audio_signals. The unique index on
// conversation_id (migration 073) makes ON CONFLICT safe — re-running the
// analyzer for the same conversation updates in place, never duplicates.
// ─────────────────────────────────────────────────────────────────────────────

async function persistAudioSignals(conversationId, tenantId, signals) {
  if (!conversationId || !tenantId) {
    throw new Error("persistAudioSignals: conversationId and tenantId are required");
  }
  if (!signals || typeof signals !== "object") {
    throw new Error("persistAudioSignals: signals object is required");
  }

  const result = await db.query(
    `INSERT INTO call_audio_signals
       (conversation_id, tenant_id,
        customer_words_per_minute, agent_words_per_minute,
        customer_pause_count, customer_avg_pause_seconds,
        customer_interruption_count, agent_interruption_count,
        customer_amplitude_variance,
        audio_frames_analyzed, raw_features, skip_reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)
     ON CONFLICT (conversation_id) DO UPDATE SET
        tenant_id                   = EXCLUDED.tenant_id,
        customer_words_per_minute   = EXCLUDED.customer_words_per_minute,
        agent_words_per_minute      = EXCLUDED.agent_words_per_minute,
        customer_pause_count        = EXCLUDED.customer_pause_count,
        customer_avg_pause_seconds  = EXCLUDED.customer_avg_pause_seconds,
        customer_interruption_count = EXCLUDED.customer_interruption_count,
        agent_interruption_count    = EXCLUDED.agent_interruption_count,
        customer_amplitude_variance = EXCLUDED.customer_amplitude_variance,
        audio_frames_analyzed       = EXCLUDED.audio_frames_analyzed,
        raw_features                = EXCLUDED.raw_features,
        skip_reason                 = EXCLUDED.skip_reason,
        extracted_at                = now()
     RETURNING id`,
    [
      conversationId,
      tenantId,
      signals.customer_words_per_minute,
      signals.agent_words_per_minute,
      signals.customer_pause_count,
      signals.customer_avg_pause_seconds,
      signals.customer_interruption_count,
      signals.agent_interruption_count,
      signals.customer_amplitude_variance,
      signals.audio_frames_analyzed,
      JSON.stringify(signals.raw_features || {}),
      signals.skip_reason,
    ]
  );

  return result.rows[0]?.id || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// analyzeAndPersist — convenience wrapper for the coachingScorer.js hook.
// Reads calls.audio_signals_raw for a call, analyzes, persists. Returns a
// small status object. NEVER throws — the caller is a cron loop and a bad
// audio blob must not abort scoring of the call or the rest of the batch.
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeAndPersistForCall({ callId, conversationId, tenantId }) {
  try {
    if (!callId || !conversationId || !tenantId) {
      return { ok: false, reason: "missing_args" };
    }

    const rawRes = await db.query(
      "SELECT audio_signals_raw FROM calls WHERE id = $1 LIMIT 1",
      [callId]
    );
    const raw = rawRes.rows[0]?.audio_signals_raw || null;

    if (!raw) {
      // No collector data — common for calls that predate 9A or hung up
      // before the collector wrote anything. Persist a skip row so 9C sees
      // an explicit "no data" rather than a missing row it can't explain.
      const signals = analyzeAudioSignals(null);
      await persistAudioSignals(conversationId, tenantId, signals);
      return { ok: true, skipped: true, reason: "no_raw_data" };
    }

    const signals = analyzeAudioSignals(raw);
    await persistAudioSignals(conversationId, tenantId, signals);
    return { ok: true, skipped: !!signals.skip_reason, reason: signals.skip_reason || null };
  } catch (err) {
    console.error(
      "[audioSignalAnalyzer] analyzeAndPersistForCall failed conv=%s: %s",
      conversationId, err.message
    );
    return { ok: false, reason: err.message };
  }
}

module.exports = {
  // Used by the coachingScorer.js cron hook:
  analyzeAndPersistForCall,
  // Lower-level pieces (exported for the server.js live path + for tests):
  decodeMulawSample,
  mulawFrameRms,
  analyzeAudioSignals,
  persistAudioSignals,
  // Tunables exported for tests:
  PAUSE_THRESHOLD_MS,
  MIN_CUSTOMER_TURNS,
  MIN_FRAMES_FOR_AMPLITUDE,
};

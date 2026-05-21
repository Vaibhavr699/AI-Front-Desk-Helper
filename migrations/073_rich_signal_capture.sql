-- ═══════════════════════════════════════════════════════════════════════
-- Migration 073 — Phase 9 Rich Signal Capture (schema only)
-- May 22, 2026
--
-- Creates the two capture tables Phase 9 writes into. This migration is the
-- CAPTURE-LAYER foundation only — it ships ahead of the chunks that populate
-- and consume it:
--
--   9A  audio signals      → writes call_audio_signals          (voice only)
--   9B  linguistic signals → writes conversation_linguistic_signals (voice + SMS)
--   9C  classifier upgrade → READS both tables                  (HELD — not built)
--   9D  TCPA consent       → ships with 9A launch
--
-- Why ship the schema now, ahead of 9A/9B/9C:
--   Empty tables cost nothing. Once 9A/9B start writing, signal data
--   accumulates from day one — so when 9C is eventually built (it needs
--   labeled outcome volume that does not exist yet), months of training
--   data are already banked. The schema is the one Phase 9 piece that
--   genuinely benefits from a head start; the classifier does not.
--
-- DESIGN DECISIONS
-- ----------------
-- FK target : both tables reference coaching_conversations(id). That is the
--             unit the DISC classifier scores, and it exists for BOTH voice
--             calls and SMS conversations — unlike the `calls` table, which
--             has no row for an SMS thread. id is uuid (confirmed against
--             the live schema), tenant_id is uuid.
--
-- Naming    : `call_audio_signals` — audio genuinely is voice-only; an SMS
--             conversation has no audio stream. `conversation_linguistic_
--             signals` — deliberately NOT `call_*`, because linguistic
--             features (sentence length, question type, specificity) apply
--             to SMS conversations too. The name follows the product:
--             SMS coaching shipped (Phase 6E) after the original Phase 9
--             plan was written, so the plan name is updated to match.
--
-- Grain     : one row per coaching_conversation. Signals are computed once
--             when the conversation is complete (whole-call WPM, total
--             interruption count, etc.) — not a time-series. One row per
--             conversation is the right v0: simpler, and it matches how 9C
--             will consume it (one feature vector per conversation).
--
-- tenant_id : denormalized onto both tables (copied from the parent
--             conversation) so tenant-scoped queries and the data-flywheel
--             anonymization layer never need a join back. Matches the
--             pattern used across the platform.
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + IF NOT EXISTS on every index,
--             so re-running the migration is safe.
-- ═══════════════════════════════════════════════════════════════════════

-- ─────────────────────────────────────────────────────────────────────
-- call_audio_signals  (Phase 9A — voice only)
--
-- Acoustic features extracted from the OpenAI Realtime audio frames of a
-- voice call. One row per voice coaching_conversation. SMS conversations
-- never get a row here — they have no audio.
--
-- Columns are nullable: a given call may fail partial extraction (e.g.
-- amplitude data missing) without the whole row being rejected. 9A decides
-- per-feature whether it could compute it.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS call_audio_signals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id         uuid NOT NULL
                            REFERENCES coaching_conversations(id) ON DELETE CASCADE,
  tenant_id               uuid NOT NULL
                            REFERENCES tenants(id) ON DELETE CASCADE,

  -- ── Speech rate ──────────────────────────────────────────────────────
  -- Words per minute, customer side. The single strongest audio DISC cue:
  -- fast = D-leaning, slow/measured = S-leaning.
  customer_words_per_minute   numeric,
  -- Words per minute, agent/rep side — lets 9C normalize (a customer who
  -- talks fast relative to a slow rep is a stronger signal than raw WPM).
  agent_words_per_minute      numeric,

  -- ── Pauses ───────────────────────────────────────────────────────────
  -- Count of silences longer than the pause threshold on the customer side.
  customer_pause_count        integer,
  -- Mean pause length, seconds, customer side.
  customer_avg_pause_seconds  numeric,

  -- ── Interruptions / turn-taking ──────────────────────────────────────
  -- Times the customer began speaking while the agent still was. High
  -- interruption rate is a strong D cue.
  customer_interruption_count integer,
  -- Times the agent interrupted the customer (rep-side signal — useful to
  -- the coaching engine, not just DISC).
  agent_interruption_count    integer,

  -- ── Amplitude / energy ───────────────────────────────────────────────
  -- Variance in customer loudness across the call. High variance =
  -- expressive/animated (I-leaning); flat = even-keeled (S/C-leaning).
  customer_amplitude_variance numeric,

  -- ── Provenance ───────────────────────────────────────────────────────
  -- How many audio frames the extractor actually processed — lets 9C
  -- weight or discard rows built from too little audio.
  audio_frames_analyzed       integer,
  -- Free-form extras (per-segment detail, model versions, etc.) so 9A can
  -- evolve what it captures without a new migration each time.
  raw_features                jsonb,
  -- Set when extraction could not run / produced nothing usable, so 9C can
  -- skip the row honestly instead of treating nulls as real zeros.
  skip_reason                 text,

  extracted_at                timestamptz NOT NULL DEFAULT now(),
  created_at                  timestamptz NOT NULL DEFAULT now()
);

-- One audio-signal row per conversation — re-running 9A must upsert, not
-- duplicate. Enforced with a unique index on conversation_id.
CREATE UNIQUE INDEX IF NOT EXISTS call_audio_signals_conversation_uniq
  ON call_audio_signals (conversation_id);

-- Tenant-scoped lookups (dashboards, the future cross-tenant cohort layer).
CREATE INDEX IF NOT EXISTS call_audio_signals_tenant_idx
  ON call_audio_signals (tenant_id);


-- ─────────────────────────────────────────────────────────────────────
-- conversation_linguistic_signals  (Phase 9B — voice + SMS)
--
-- Linguistic features derived from the transcript text. Applies to BOTH
-- voice calls and SMS conversations — sentence length, question type and
-- specificity are all text properties, present in either channel.
--
-- One row per coaching_conversation regardless of source_type. The
-- `channel` column records which kind it was so 9C can weight voice vs SMS
-- features differently if it needs to.
-- ─────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS conversation_linguistic_signals (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id         uuid NOT NULL
                            REFERENCES coaching_conversations(id) ON DELETE CASCADE,
  tenant_id               uuid NOT NULL
                            REFERENCES tenants(id) ON DELETE CASCADE,

  -- 'voice' or 'sms' — copied from the parent conversation's source_type
  -- family. Kept denormalized so 9C can branch without a join.
  channel                 text,

  -- ── Sentence structure (customer side) ───────────────────────────────
  -- Mean words per customer sentence/message. Short and clipped = D-leaning;
  -- long and elaborated = I- or C-leaning depending on other signals.
  customer_avg_sentence_length    numeric,
  -- Total customer sentences/messages analyzed — sample-size context.
  customer_sentence_count         integer,

  -- ── Question behavior (customer side) ────────────────────────────────
  -- Open-ended questions ("what are my options for...").
  customer_open_question_count    integer,
  -- Closed/yes-no questions ("can you do it by Friday?").
  customer_closed_question_count  integer,
  -- Detail/interrogating questions — the C cue. The Groovy Hues deck's
  -- example: "when do you start, how long, how do I prepare?".
  customer_detail_question_count  integer,

  -- ── Specificity / markers ────────────────────────────────────────────
  -- Specificity score: density of concrete nouns, numbers, named products.
  -- High = C-leaning (precision-seeking).
  customer_specificity_score      numeric,
  -- Mentions of brands / product names — a C precision marker.
  brand_mention_count             integer,
  -- Mentions of times / dates / deadlines — urgency or planning signal.
  time_marker_count               integer,
  -- Mentions of price / cost / budget — surfaces price-sensitivity early.
  price_marker_count              integer,

  -- ── Provenance ───────────────────────────────────────────────────────
  -- Free-form extras so 9B can evolve without a migration each time.
  raw_features            jsonb,
  -- Set when the transcript was too thin to analyze (0–1 customer turns),
  -- mirroring coaching_conversations.persona_skip_reason semantics.
  skip_reason             text,

  extracted_at            timestamptz NOT NULL DEFAULT now(),
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- One linguistic-signal row per conversation — 9B upserts, never duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS conversation_linguistic_signals_conversation_uniq
  ON conversation_linguistic_signals (conversation_id);

-- Tenant-scoped lookups.
CREATE INDEX IF NOT EXISTS conversation_linguistic_signals_tenant_idx
  ON conversation_linguistic_signals (tenant_id);

-- Channel filter — 9C (and any analytics) will frequently slice voice vs SMS.
CREATE INDEX IF NOT EXISTS conversation_linguistic_signals_channel_idx
  ON conversation_linguistic_signals (channel);

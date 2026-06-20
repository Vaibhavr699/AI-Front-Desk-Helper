-- 106_in_home_session_conversation_unique.sql
-- Enforces the 1:1 invariant the rep manager-comments lookup relies on: at most
-- one in_home_session may link to a given coaching_conversation. Without this,
-- two sessions sharing a conversation id would surface each other's coaching
-- comments to the rep (the lookup keys comments by conversation, then fans out
-- to sessions). Replaces the non-unique index from migration 096.
--
-- Partial (WHERE NOT NULL) so the many sessions with no conversation link yet
-- are unconstrained. If a duplicate already exists this will fail loudly — that
-- is correct: it means a real data problem to resolve before the constraint holds.

DROP INDEX IF EXISTS idx_in_home_sessions_conversation;

CREATE UNIQUE INDEX IF NOT EXISTS idx_in_home_sessions_conversation_unique
  ON in_home_sessions(coaching_conversation_id)
  WHERE coaching_conversation_id IS NOT NULL;

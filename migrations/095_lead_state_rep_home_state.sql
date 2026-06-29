-- 095_lead_state_rep_home_state.sql
-- Adds a US state to leads and a default "home state" to reps.
--   leads.state              — the customer's state (2-letter code), captured
--                              when a rep adds the customer; used for the first
--                              appointment and regional context.
--   dashboard_users.home_state — the rep's usual state, set once in Settings, so
--                              the New Customer form pre-fills it and the rep just
--                              verifies it (most reps stay in one state).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS state TEXT;

ALTER TABLE dashboard_users
  ADD COLUMN IF NOT EXISTS home_state TEXT;

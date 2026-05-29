-- 090_rep_seat_limit.sql
-- Per-tenant cap on the number of active AI Rep Coach seats.
-- NULL = unlimited (existing tenants are unaffected). Enforced at seat-grant
-- time (routes/team.js) and defensively at rep login (routes/rep/auth.js).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS rep_seat_limit INTEGER;

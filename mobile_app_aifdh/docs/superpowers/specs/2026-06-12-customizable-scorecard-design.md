# Customizable Scorecard / Cue Items per Tenant (Drew #8 + Product ask #3)

**Date:** 2026-06-12
**Parent:** [2026-06-12-rep-coach-audio-survival-design.md](./2026-06-12-rep-coach-audio-survival-design.md) — this is the promised sub-spec for the largest item.
**Origin:** A roofing company asked: can each owner define the cue items their team focuses on, instead of the fixed painting-oriented set (Rooms/Scope/Timeline/Budget/Close)? This is also Rilla-competitor positioning — owner-authored scorecards.

---

## The three hardcoded sites (grounded in code)

The "scorecard" is actually three coupled config surfaces, all currently hardcoded:

1. **Live walkthrough stages** — what the rep is reminded to cover during the visit.
   - Server: `services/liveCueEngine.js:146` `["rooms","scope","timeline","budget","close"]`, and the same list embedded in `SYSTEM_PROMPT` (lines 52-56) under "WALKTHROUGH COVERAGE".
   - Client: `INITIAL_WALKTHROUGH` in `live-session-screen.tsx` (Rooms/Scope/Timeline/Budget/Close).
2. **Post-call scoring dimensions** — the 8 dims the AI scores the recording on.
   - `lib/coachingEngine.js:62` `SCORING_DIMENSIONS` (8 keys) + `SCORING_SYSTEM_PROMPT` (the rubric text).
   - **Schema constraint:** `coaching_scores.dimension` is `TEXT NOT NULL CHECK (dimension IN (...8 fixed keys...))` (migration 069). Custom dimensions cannot persist without changing this.
   - The same 8 keys are referenced in `services/coachingRuleExtractor.js`, `lib/roleplayAi.js`, `lib/coachingPromptInjection.js`.
3. **Live cue types** — the real-time nudges fired during the visit.
   - `services/liveCueEngine.js:22` `CUE_TYPES` (8 types) + their descriptions in `SYSTEM_PROMPT`.

These are independent enough to ship separately. The walkthrough is the cheapest and the owner's literal ask ("the cue items they want their team to focus on"); the scoring dimensions are the deepest (schema + multiple consumers).

---

## Scope decision — v0 vs later

**v0 (build now): configurable live walkthrough stages per tenant.**
This is exactly the roofing ask, the lowest-risk surface, and touches no scoring schema. A roofer's stages might be `["roof_inspection","damage","scope","insurance","timeline","budget","close"]` instead of the painting default.

**v1 (fast-follow): configurable live cue emphasis.**
Reorder/enable-disable cue types per tenant (per-type disable already exists via `cue_preferences`); v1 adds tenant-authored cue *labels/emphasis* fed into the cue-engine prompt. Lower-risk than scoring because cue types are a closed enum on the watch side — so v1 is "which of the existing cues matter to you + custom wording," not arbitrary new cue types.

**v2 (later, own migration): configurable scoring dimensions.**
Requires relaxing the `coaching_scores.dimension` CHECK (to a per-tenant validated set, or drop the CHECK and validate in app code), plus templating `SCORING_DIMENSIONS` + `SCORING_SYSTEM_PROMPT` per tenant, plus updating the 3 downstream consumers and the dashboard score displays. Highest blast radius; explicitly deferred.

This spec covers **v0** in implementation detail and sketches v1/v2.

---

## v0 design — tenant walkthrough config

### Data model
New table (idempotent migration):
```
tenant_scorecards (
  tenant_id      UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  walkthrough    JSONB NOT NULL DEFAULT '[...painting default...]',  -- [{key,label}]
  updated_at     TIMESTAMPTZ DEFAULT now(),
  updated_by     UUID REFERENCES dashboard_users(id)
)
```
Default seed = the current 5 stages, so existing tenants are unchanged. One row per tenant, created lazily on first edit (read falls back to the default constant when no row).

### Backend
- `lib/scorecards.js` — `getWalkthrough(tenantId)`: returns the tenant's stages or the default constant. Single source of truth; both the live screen API and the cue engine read it.
- `liveCueEngine.js`: replace the hardcoded `["rooms",...]` valid-list (line 146) AND the prompt's WALKTHROUGH COVERAGE block with the tenant's stages (inject the keys/labels into the prompt at session start — the engine already takes per-session context).
- `routes/rep/in-home.js` `/start` (or the session bootstrap): include the tenant's walkthrough stages in the response so the client renders them instead of `INITIAL_WALKTHROUGH`.
- Owner editor endpoints: `GET/PUT /api/scorecards/walkthrough` (owner/admin only, in the dashboard API surface).

### Client (mobile)
- `live-session-screen.tsx`: seed `walkthrough` state from the session-start payload's stages (fallback to `INITIAL_WALKTHROUGH` if absent). The `checklist_update` WS handler already keys by stage `key`, so it works unchanged as long as keys match.

### Dashboard (web)
- Owner-facing editor under settings/coaching: add/remove/reorder/rename walkthrough stages, persisted via `PUT /api/scorecards/walkthrough`. Reuse existing settings-card patterns.

### Migration runner note
Per [[project_migration_runner_nonidempotent]], the new migration must be idempotent (`CREATE TABLE IF NOT EXISTS`, default-seeded). Next number after 096 = 097.

---

## Build sequence (v0)
1. Migration 097 `tenant_scorecards` + default seed.
2. `lib/scorecards.js` (`getWalkthrough`/`setWalkthrough`).
3. Wire `getWalkthrough` into `liveCueEngine` (valid-list + prompt injection) and the session-start payload.
4. Client: seed walkthrough from payload.
5. Dashboard: owner editor.

## Open questions for plan stage
- Where the owner editor lives in the dashboard IA (a Coaching settings tab vs. a dedicated Scorecard page).
- Whether v0 stage `key`s are owner-authored (slugified from label) or chosen from a fixed vocabulary the cue engine understands — leaning slugified-from-label, since the cue engine is told the stages dynamically in the prompt, so arbitrary keys are fine for walkthrough (unlike scoring's CHECK-constrained keys).
- v1/v2 sequencing relative to the rest of the audio-survival backlog (#12 migration, P2).
```

# Rep Coach — Two-Frontend Signup, Billing & Data-Routing Flow

**Status:** Approved plan for review (Rahul to wire end-to-end)
**Date:** 2026-06-18
**Source:** Drew's spec (the canonical requirements) + a code audit of what already exists, so the build scope is accurate.

---

## 0. POV / Recommendation (read first)

Drew's spec is sound and **~40% already scaffolded in the codebase**. The flows themselves are not the risk. The three things that actually need care:

1. **The moat (data routing) is already structurally correct.** Sessions write `in_home_sessions.tenant_id = req.rep.tenant_id` today. The whole moat reduces to one rule: **set `tenant_id` correctly at account creation.** No session-time branching needed.
2. **The capability gate must be server-enforced, not labeled.** A manager seat must be physically unable to record even with a tampered client. The label is the UI; the gate is the API.
3. **A pricing mismatch exists between spec and code** (4 volume brackets vs 3 named tiers). **Decision: remap the code to 4 quantity-based brackets** (confirmed). See §7.

Build order is Drew's: **account model → capability gate → Path A → Path B → data routing.** Everything keys off the account model, so it goes first.

---

## 1. Account Model (foundation — build first)

Reps are already `dashboard_users` rows (`rep_seat_active`, `rep_seat_tier` exist). Add to **`dashboard_users`**:

| Column | Values | Drives |
|---|---|---|
| `seat_type` | `'rep'` \| `'manager'` | in-app capability (record vs review-only) |
| `account_type` | `'standalone'` \| `'manager_provisioned'` | billing + trial |
| `trial_ends_at` | timestamptz, nullable | standalone trial only |

Add to **`tenants`**: `manager_seats_free` (default 3).

`tenant_id` (existing column) is the linchpin:
- `manager_provisioned` → set to the **owner's AIFDH tenant** at creation.
- `standalone` → their own new standalone tenant.

**The one rule that makes the moat automatic:** get `tenant_id` right at account creation. Then the existing session write-back routes everything correctly (see §6).

---

## 2. Capability Gate (server-enforced in 3 places)

`seat_type` drives capability. Enforce in **three** layers — UI alone is insufficient:

1. **`GET /rep/profile`** — already returns a `seat` block. Add `seat_type`, `account_type`, `trial_ends_at`. App reads on login.
2. **Server-side record block (load-bearing)** — in-home session-start endpoints (`POST /rep/in-home`, the WS handshake in `lib/repInHomeWs.js`) reject `seat_type = 'manager'` with 403. A manager seat cannot start a recording even if the client is patched.
3. **App routing** — `rep` → recording + live-coaching interface; `manager` → review interface (session list + anchored-comments UI, already built), recording path hidden.

> Principle: **the label is the UI; the gate is the API.** Drew flagged this as the easiest thing to miss.

---

## 3. Path A — Standalone Signup (self-serve, trial-first)

**Net-new — nothing exists today.** 14-day trial, card up-front, auto-convert.

1. Sign up **in-app** (airepcoach.com deep-links into the app). Email + self-chosen password. **No temp-password round-trip** (it kills mobile signups).
2. Card captured up-front via **`repCoachStripe`** (separate customer, independent from AIFDH's live key).
3. Account: `account_type='standalone'`, `seat_type='rep'`, `trial_ends_at = now()+14d`, `tenant_id =` a new standalone tenant.
4. Full-functionality 14-day trial — real sessions immediately. In-app countdown; reminders ~day 11 & 13.
5. Auto-convert day 14 on the card. Dunning on failure → retry + grace → **paywall lock, never delete data.**
6. Standalone = **1 rep seat** by default; add seats later.

No AIFDH link (they don't own it). No cross-join — correct and expected.

---

## 4. Path B — Existing AIFDH Manager Adds Seats

**Entry is only from inside the logged-in AIFDH dashboard** (aifrontdeskhelper.com). Therefore the AIFDH `tenant_id` is known by definition — **no detection, no email-matching, no mis-link risk.**

A new **Rep Coach section** (Team tab or its own tab) manages **two independent pools**:

| Pool | Pricing | Notes |
|---|---|---|
| **Manager (review) seats** | 3 free, then **$25 flat each** | Does NOT scale with tier. Review-only. |
| **Rep (recording) seats** | **volume brackets** (§7) − 30% bundle | Maps to existing `rep_seat_active`/`rep_seat_tier`. No free rep seats on this path. |

**Both bill on the existing AIFDH Stripe subscription (same customer)** — NOT `repCoachStripe`. Key-separation rule below.

**Invitee onboarding** (rep or manager seat):
1. Manager assigns a seat by email.
2. Invite email → app download link + **set-password / magic-link** (NOT a raw temp password).
3. Invitee installs, sets own password, lands attached to the **manager's AIFDH tenant**. `account_type='manager_provisioned'`, `seat_type` per assignment, **no trial, no card** on the invitee side.

---

## 5. What the Manager Sees in AIFDH (Rahul's direct question)

A Rep Coach control panel inside the AIFDH dashboard:

- **Two seat counters, side by side** — manager seats ("2 of 3 free, then $25/extra") and rep seats (count by bracket, bundle price shown).
- **Assign-by-email** per pool, with pending/active invite status.
- **Session review** — recorded session list, transcript + **anchored comments** (Finding 2, built), per-rep coaching, and **Team Analytics** (cross-rep comparison, built). This is the manager's payoff for buying seats.

Manager's mental model: *"I buy seats here, assign them by email, and review/coach my reps' real sessions here — and the data ties back into my AIFDH account."*

---

## 6. Data Routing — THE MOAT ★

The strategic core: Rep Coach in-appointment behavior must join AIFDH's call→book→revenue chain, per tenant.

| Account | `tenant_id` lands on | Cross-join to AIFDH revenue? |
|---|---|---|
| `manager_provisioned` | the owner's **AIFDH tenant** (inherited at creation) | ✅ The moat |
| `standalone` | own standalone tenant | ❌ No AIFDH data — fine |
| any rep session, known customer | **+ `lead_id`** via attach-customer flow | ✅ Links session → that lead's booking + revenue |

**Why it already works:** `in_home_sessions.tenant_id = req.rep.tenant_id` is the existing write. Set `tenant_id` right at creation → every session auto-routes. Only **rep** seats produce sessions; **manager** seats consume them.

**Failure mode to prevent (Drew named it):** a session writing to a fresh standalone account when the customer actually owns AIFDH — orphaning it from the revenue chain. With "Path B is inside the AIFDH dashboard," this **cannot happen structurally** — the provisioned account inherits the AIFDH `tenant_id` at birth. The `lead_id` attach is the same orphaned-session class already hardened on the session side.

---

## 7. Pricing — Spec vs Code (decision: REMAP)

**Spec (Drew):** rep seats priced in **4 volume brackets** by total seat count:

| Seats | Price/seat |
|---|---|
| 1–2 | $149 |
| 3–9 | $129 |
| 10–24 | $109 |
| 25+ | $89 |

AIFDH bundle: **30% off**. Manager seats: **3 free, then $25 flat** (independent of brackets).

**Code today:** `lib/repCoachBilling.js` has **3 named tiers** (`standard`/`pro`/`elite`) keyed to Stripe price envs. This is an awkward fit for what is actually volume pricing.

**Decision (confirmed): remap to 4 quantity-based brackets.**
- `rep_seat_tier` becomes **derived** from the team's total active rep-seat count (not a stored label).
- `repCoachBilling.js` `TIER_PRICE` → **4 bracket prices keyed by quantity bracket**.
- Touches existing billing code → **Drew to confirm before wiring**, but recommended (no translation layer to drift).

---

## 8. Stripe Structure (decision locked)

| Path | Billing surface |
|---|---|
| **Standalone (Path A)** | `repCoachStripe` — own customer, own trial + card. |
| **Manager-path (Path B)** | line items on the **existing AIFDH subscription** (same Stripe customer). |

**Do not cross the keys.** Standalone never touches the AIFDH key; manager-path never touches `repCoachStripe`. Both already have their key configured in `server.js`.

---

## 9. Already Built vs Net-New (scope accurately)

| Piece | Status |
|---|---|
| `repCoachStripe` (key/webhook/billing) | ✅ Exists |
| Rep-seat model (`rep_seat_active`, `rep_seat_tier`, `lib/repSeats.js`, `lib/repCoachBilling.js`) | ✅ Exists |
| `tenants.account_type`, `rep_coach_enabled`, `rep_seat_limit` | ✅ Exists |
| Session `tenant_id` write-back + attach-customer / `lead_id` | ✅ Exists (hardened) |
| Manager anchored-comments + Team Analytics (manager review payoff) | ✅ Built |
| `seat_type`, user-level `account_type`/`trial_ends_at`, `manager_seats_free` | ❌ Net-new |
| Manager-seat pool (3 free → $25 flat) | ❌ Net-new |
| Standalone in-app signup + 14-day trial + auto-convert | ❌ Net-new |
| Server-side record block for manager seats | ❌ Net-new (critical) |
| 4-bracket volume pricing remap | ❌ Net-new (replaces 3 named tiers) |
| Invite / set-password flow for provisioned seats | ⚠️ Partial — magic-link infra exists, not wired for seat invites |

---

## 10. Build Order (Drew's, refined)

1. **Account model** — `seat_type`, `account_type`, `trial_ends_at` on `dashboard_users`; `manager_seats_free` on `tenants`. Everything depends on this.
2. **Capability gate** — profile payload + **server-side record block** (403 for manager seats) + app routing.
3. **Path A standalone** — in-app signup + card + 14-day trial + auto-convert (`repCoachStripe`).
4. **Path B manager** — AIFDH Rep Coach section: two pools (manager 3-free→$25, rep by bracket−bundle) + invite/set-password.
5. **Data routing** — confirm `manager_provisioned` accounts inherit the AIFDH `tenant_id`; verify session write-back + `lead_id` attach for both paths.
6. **Pricing remap** (§7) — fold into step 4's billing work.

---

## 11. Locked Decisions

- Standalone trial: **14 days**, card up-front, auto-converts.
- Standalone default: **1 rep seat**.
- Invitee onboarding: **set-password / magic-link**, not temp password.
- Two seat types: **rep** (record + live coaching) vs **manager** (review-only, recording disabled) — **server-enforced**.
- Manager seats: **3 free, then $25 flat** (not tier-scaled).
- Rep seats: **4 volume brackets** ($149/$129/$109/$89), 30% bundle on manager path.
- Stripe: **standalone → repCoachStripe; manager-path → AIFDH subscription.** Don't cross keys.
- AIFDH detection: **structural** — Path B is inside the AIFDH dashboard, tenant known by definition.
- `seat_type`/`account_type`/`trial_ends_at` live **on `dashboard_users`**.
- Data routing: `manager_provisioned` sessions write `tenant_id` = owner's AIFDH tenant (+ `lead_id` when known).

## 12. Open Questions (do not block starting)

- **Pricing remap confirmation** (§7) — recommended; Drew to confirm since it edits existing billing.
- **Dunning grace window** — exact retry schedule + grace length before paywall lock (Path A).
- **Manager-seat downgrade** — what happens to a manager seat's anchored comments if the seat is removed (retain vs orphan)?
- **Standalone → AIFDH later** — if a standalone customer buys AIFDH afterward, is there a migration to re-tenant their history? (Out of scope now; flag for later — the email-match path we deliberately avoided would resurface here.)

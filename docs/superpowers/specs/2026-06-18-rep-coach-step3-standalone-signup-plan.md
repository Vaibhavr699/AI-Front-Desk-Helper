# Step 3 — Standalone Signup + 14-Day Trial + Billing (Implementation Plan)

**Status:** Plan for review — Drew to confirm open decisions before build. No live-Stripe code until then.
**Date:** 2026-06-18
**Depends on:** Step 1 (account model, shipped) + Step 2 (capability gate, shipped).
**Scope:** Path A only (self-serve standalone rep). Path B (manager dashboard) is Step 4.

---

## 0. Headline — this is SMALLER than expected, but has 1 conflict to resolve first

A code audit found **`services/repCoachProvisioning.js` already exists** and does most of the account+tenant creation. Step 3 is mostly *wiring + trial + field-setting*, not greenfield. **But the existing provisioning code violates two of Drew's locked decisions** and must be changed, not just wired:

| Existing code | Conflicts with locked decision | Action |
|---|---|---|
| Emails a **raw temp password** (`provisionFromCheckout` L63, L112) | Drew: "set-password / magic-link, **NOT** a raw temp password" | **Replace** temp-password with a set-password magic link |
| Uses **3 named tiers** (`standard/pro/elite`) | Drew: **4 volume brackets** (confirmed remap) | Fold into the §7 pricing remap (shared with Step 4) |
| Sets `subscription_status='active'` immediately, **no trial** (checkout has no `trial_period_days`) | Drew: **14-day trial**, card up-front, auto-convert | Add `trial_period_days: 14`; provisioning sets `trialing` + `trial_ends_at`; add lifecycle webhook events |
| Does **not** set `seat_type`/`account_type`/`trial_ends_at` | Step 1 account model | Set `seat_type='rep'`, `account_type='standalone'`, `trial_ends_at` |

**Correction (verified in code):** the webhook **IS** already wired for `checkout.session.completed` — `handleEvent` (repCoachStripe.js L45-49) resolves the tier and calls `provisionFromCheckout`. So that path works today. What's missing is the **trial** on the checkout and the **lifecycle events** (`subscription.updated/deleted`, `invoice.payment_failed`), not the initial provision wiring.

---

## 1. What already exists (verified)

| Piece | File | State |
|---|---|---|
| Separate Stripe key + webhook signature verify | `lib/repCoachStripe.js` | ✅ `isConfigured`, `constructEvent`, `handleEvent` |
| Subscription create/sync from seat counts | `lib/repCoachBilling.js` | ✅ `createSub`, `syncRepCoachSubscription`, `countActiveSeatsByTier` |
| Account+tenant provisioning from a checkout | `services/repCoachProvisioning.js` | ⚠️ Exists but temp-password + old tiers + no trial + unwired |
| Magic-link infra (`magic_links`, purpose `rep_coach_signup`) | `routes/magicLink.js` | ✅ Exists — provisioning already reads `rep_coach_signup` links |
| AIFDH checkout pattern to mirror (`trial_period_days`, customer create) | `lib/stripe.js` | ✅ Reference for the trial checkout call |

## 2. What's net-new

1. **In-app standalone signup entry** — email + self-chosen password screen; deep-link target from airepcoach.com. (Mobile)
2. **Trial checkout creation** — a `repCoachStripe` checkout session with `trial_period_days: 14`, card required up-front, 1 rep seat. (Backend)
3. **Webhook lifecycle handlers** — `checkout.session.completed` → `provisionFromCheckout` already works. `handleEvent` must ADD:
   - `customer.subscription.updated` → on `trialing`→`active`, flip the account live; keep `trial_ends_at` in sync.
   - `invoice.payment_failed` → dunning (see §Open Q).
   - `customer.subscription.deleted` → paywall lock (do NOT delete data).
4. **Trial countdown in-app** — read `seat.trial_ends_at` from `/rep/profile` (already surfaced in Step 1); show countdown + reminders ~day 11 & 13.
5. **Set-password magic link** — replace the temp-password email with a set-password link (reuse magic-link infra).
6. **Field-setting in provisioning** — `seat_type='rep'`, `account_type='standalone'`, `trial_ends_at`.

## 3. Build sequence (all against Stripe TEST keys first)

1. **Pricing remap** (`repCoachBilling.TIER_PRICE` → 4 quantity brackets) — shared with Step 4; do it here since provisioning depends on it. *Drew to confirm bracket→Stripe-price mapping.*
2. **Trial checkout endpoint** — `POST /rep/signup/checkout` (or reuse a checkout route): creates `repCoachStripe` checkout, `trial_period_days: 14`, 1 rep seat, `client_reference_id` = a `rep_coach_signup` magic-link token carrying the email + chosen password hash.
3. **Rewrite `provisionFromCheckout`**: set `seat_type='rep'`, `account_type='standalone'`, `trial_ends_at = subscription.trial_end`; use the chosen password (not temp); send a set-password/welcome email (no raw password).
4. **Wire the webhook**: `checkout.session.completed` → provision; `customer.subscription.updated/deleted` + `invoice.payment_failed` → lifecycle.
5. **In-app signup screen + trial countdown** (mobile).
6. **Auto-convert** is implicit (Stripe charges at trial end on the card on file). Handle the resulting `invoice.paid` / `subscription.updated` to confirm `active`.

## 4. Test checkpoints (Stripe test mode)

- Checkout completes with a test card → tenant + `dashboard_users` rep created, `seat_type='rep'`, `account_type='standalone'`, `trial_ends_at` ≈ now+14d, `subscription_status='trialing'`.
- App login → `/rep/profile` shows `trial_ends_at`; countdown renders.
- Force trial end (Stripe test clock) → `subscription.updated` to `active` → account stays live, `trial_ends_at` cleared.
- Force `invoice.payment_failed` → dunning path per Drew's answer; data NOT deleted.
- No raw password anywhere in the email.

## 5. Files touched

- `lib/repCoachStripe.js` — expand `handleEvent` (3 new event types).
- `lib/repCoachBilling.js` — 4-bracket remap.
- `services/repCoachProvisioning.js` — trial fields, seat_type/account_type, set-password (replace temp password).
- `routes/rep/` — new signup/checkout route.
- `routes/magicLink.js` — set-password link variant (if not already present).
- `mobile_app_aifdh/` — signup screen + trial-countdown UI.

## 6. Open decisions — DREW MUST CONFIRM before build

1. **Pricing remap mapping** — 4 brackets → Stripe price IDs. How many Stripe prices, keyed how? (Recommend: one price per bracket, quantity-based.)
2. **Dunning policy** — exact retry schedule + grace window before paywall lock on `invoice.payment_failed`. (Stripe Smart Retries default? Or custom?)
3. **Set-password mechanism** — confirm: magic link to a set-password screen (web or in-app deep link?), replacing the current temp-password email.
4. **Signup entry** — pure in-app (airepcoach.com deep-links into app signup), or a web checkout on airepcoach.com that then deep-links to install? Drew's spec leans in-app; confirm the airepcoach.com → app handoff.
5. **Standalone tenant shape** — provisioning creates a tenant with `plan='basic'`, `aifdh_enabled=false`. Confirm that's the right standalone shape (vs. a dedicated `plan='rep_coach_standalone'`).

## 7. Risks / notes

- **Live money:** build + verify entirely in Stripe **test mode**; do not touch live `REP_COACH_STRIPE_SECRET_KEY` until Drew signs off on a test-mode run.
- **The temp-password code is currently the only provisioning path** — if any standalone signup happens before this is shipped, it'll email a raw password. Treat the set-password replacement as the priority sub-task.
- **Idempotency:** webhook handlers must be idempotent (Stripe retries). `provisionFromCheckout` already guards on existing user; extend that discipline to the new handlers.

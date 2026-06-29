# Step 3 — Built in Stripe TEST mode. GUESSED decisions for Drew to confirm/override.

Step 3 (standalone signup + 14-day trial + billing) is **code-complete against Stripe TEST mode**.
Nothing touches live keys (this env has only `sk_test`; `REP_COACH_STRIPE_SECRET_KEY` is unset → test fallback).

Every decision the plan flagged as "Drew's" was given a **default and clearly marked in code**. Below is the exact list — confirm or override each. Nothing is locked.

---

## Money decisions (the important ones)

### 1. Pricing — 4 quantity brackets, one Stripe price each
- **Guessed:** `lib/repCoachBilling.js` `BRACKETS` — `t1`(1–2), `t2`(3–9), `t3`(10–24), `t4`(25+), each keyed to a new env: `REP_COACH_STRIPE_PRICE_T1..T4`. The team's **total active rep-seat count** picks ONE bracket; the subscription is a single line item (bracket price × total seats).
- **You must:** create the 4 Stripe **test** prices ($149/$129/$109/$89) and set `REP_COACH_STRIPE_PRICE_T1..T4`. Until then, `createTrialCheckout` falls back to `REP_COACH_STRIPE_PRICE_STANDARD` for T1.
- **Confirm:** is "whole team bills at one bracket" right, or do you want graduated/tiered pricing (first 2 at $149, next at $129, …)? I assumed flat-per-bracket.
- **30% bundle discount** (manager path) is NOT applied here — that's Step 4 (manager path). Standalone has no bundle.

### 2. Trial — 14 days, card required up-front
- **Guessed:** `lib/repCoachStripe.js` `createTrialCheckout` — `trial_period_days: 14`, `payment_method_collection: 'always'` (card required to start). 1 seat.
- **Confirm:** card-required-to-start (vs. card-optional during trial). I matched your spec ("card up-front").

### 3. Dunning — Stripe Smart Retries, lock only on terminal cancel
- **Guessed:** on `invoice.payment_failed` we record `subscription_status='past_due'` and **do nothing else** — relying on Stripe's Smart Retries. We paywall-lock (`rep_coach_enabled=false`) **only** on `customer.subscription.deleted` (Stripe exhausted retries). **Data is never deleted** (your locked decision).
- **You must:** set the retry schedule + grace window in the Stripe Dashboard (Settings → Billing → Smart Retries / failed payments), or tell me to implement a custom dunning timeline in code.
- **Confirm:** is "no early lock, only lock on terminal cancel" the grace behavior you want?

---

## Mechanism decisions

### 4. Set-password — magic link, NO temp password (fixes the violation)
- **Done:** removed the raw temp-password email from `repCoachProvisioning.js`. Accounts are created with an unusable placeholder hash; the welcome email carries a one-time **set-password link** (`/set-password?token=…`, 24h TTL, new `magic_links` purpose `rep_coach_set_password`).
- **NOT yet built:** the `/set-password` landing page + the endpoint that consumes the token and sets the password. **This is the one loose end** — the link is generated and emailed, but nothing yet handles the click. Needs: a `POST /rep/signup/set-password` (token + new password → bcrypt → update user, mark link used) + a web/app screen. Confirm where the set-password screen lives (airepcoach.com web page vs. in-app deep link).

### 5. Signup entry — in-app email → Stripe Checkout (hosted) → webhook provisions
- **Guessed:** the app's new Signup screen collects email, calls `POST /rep/signup/checkout`, opens the returned **Stripe-hosted checkout** URL in a web browser (`expo-web-browser`). On completion, the existing webhook provisions the account.
- **Confirm:** Stripe-hosted checkout (what I built) vs. a native in-app card form (Stripe PaymentSheet). Hosted is simpler + PCI-lighter; PaymentSheet is more native-feeling. I chose hosted.

### 6. Standalone tenant shape
- **Guessed:** provisioning creates the tenant with `plan='basic'`, `aifdh_enabled=false`, `rep_coach_enabled=true`, `subscription_status='trialing'`. User: `seat_type='rep'`, `rep_coach_account_type='standalone'`, `trial_ends_at` = Stripe `trial_end`.
- **Confirm:** `plan='basic'` for standalone, or a dedicated `plan='rep_coach_standalone'`?

---

## What was built (files)

| File | Change |
|---|---|
| `lib/repCoachBilling.js` | 4-bracket pricing, `bracketForCount`, `countActiveRepSeats`, single-line-item sync |
| `lib/repCoachStripe.js` | `createTrialCheckout` (14d trial); `handleEvent` now handles subscription.updated/deleted + invoice.payment_failed; `markSubscriptionStatus` |
| `services/repCoachProvisioning.js` | sets seat_type/account_type/trial_ends_at; **set-password link replaces temp password**; trialing status |
| `routes/rep/signup.js` (new) | public `POST /rep/signup/checkout` |
| `routes/rep/index.js` | mounts `/signup` |
| `mobile_app_aifdh/.../signup-screen.tsx` (new) + `app/(auth)/signup.tsx` | standalone signup screen + route |
| `mobile_app_aifdh/.../welcome-screen.tsx` | "Start 14-day free trial" entry |
| `mobile_app_aifdh/.../trial-banner.tsx` (new) + today-screen | trial countdown |
| `mobile_app_aifdh/.../auth/api.ts` | `startStandaloneSignup` |

## Verification done
- Backend syntax clean (5 files); set-password magic-link purpose inserts; bracket logic 9/9 boundary tests pass; Step-1 fields set correctly.
- Mobile `tsc --noEmit`: 0 errors.

## Verification NOT done (needs you / a running env)
- **No live Stripe round-trip** — built against test mode but not executed end-to-end with a Stripe test clock (no webhook tunnel in this env). The trial→active→past_due→canceled transitions are coded but not fired.
- **The 4 Stripe test prices don't exist yet** — set `REP_COACH_STRIPE_PRICE_T1..T4` and run a test checkout to validate.
- **`/set-password` handler is unbuilt** (#4) — the loop isn't closed until that lands.

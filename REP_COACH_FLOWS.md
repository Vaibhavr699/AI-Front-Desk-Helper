# AI Rep Coach — The Two Sign-Up Flows (Team Guide)

There is **one backend**, **one mobile app**, and **one database**. Reps reach them through
**two different front doors**:

- **Path A — Standalone**: a rep (or a small shop owner) buys a seat themselves at
  **airepcoach.com**. They become their own little company.
- **Path B — Manager-provisioned**: an existing **AI Front Desk Helper (AIFDH)** customer
  assigns a rep seat to their staff from the **dashboard**. The rep belongs to the
  manager's company, and all of that rep's coaching data flows back to the manager.

Everything below is what actually happens in the code, step by step.

---

## Key concepts (read this first)

| Term | What it means |
|---|---|
| **tenant** | A company/account. Every user belongs to exactly one tenant. |
| **dashboard_users** | The single user table for BOTH products (dashboard logins *and* app reps). |
| **seat_type** | `'rep'` = uses the coaching app · `'manager'` = dashboard-only, cannot record. |
| **rep_coach_account_type** | `'standalone'` (Path A) or `'manager_provisioned'` (Path B). |
| **rep_seat_active** | Whether this user currently has a paid coaching seat. |
| **trial_ends_at** | Standalone trials only — when the 14-day trial converts to paid. |
| **The "moat"** | A manager-provisioned rep's recordings carry `tenant_id = manager's tenant`, so the manager sees all their reps' coaching data. This is the whole reason Path B exists. |

> One person = one `dashboard_users` row. The same email + password logs into both the
> dashboard (web) and the app (mobile), depending on what that user is allowed to do.

---

## PATH A — Standalone signup (airepcoach.com → app)

A rep with no company behind them. They pay for themselves, get their own one-person
tenant, and use the app.

```
airepcoach.com (marketing site)
        │  rep enters email, clicks "Start free trial"
        ▼
POST /api/rep/signup/checkout            (routes/rep/signup.js)
        │  • creates a magic_link (purpose='rep_coach_signup') carrying the email
        │  • creates a Stripe Checkout session (14-day trial, CARD REQUIRED up front)
        ▼
Stripe Checkout (test card 4242 4242 4242 4242)
        │  rep enters card → Stripe starts the trial (no charge yet)
        ▼
Stripe fires webhook  →  checkout.session.completed
        │                (lib/repCoachStripe.js handleEvent)
        ▼
provisionFromCheckout()                  (services/repCoachProvisioning.js)
        │  • creates a NEW tenant (the rep's own one-person company)
        │  • creates the dashboard_users row:
        │        seat_type = 'rep'
        │        rep_coach_account_type = 'standalone'
        │        rep_seat_active = true
        │        trial_ends_at = <14 days out>
        │  • account has NO usable password yet
        │  • sends the WELCOME EMAIL with a one-time "Set your password" link
        ▼
Welcome email  →  link goes to airepcoach.com/set-password?token=...
        │          (Rep-Coach-branded page, NOT the AIFDH dashboard)
        ▼
Rep sets password  →  POST /api/auth/reset-password   (reuses the reset-token flow)
        ▼
Rep opens the MOBILE APP and logs in (see "App login" below)
        │  app resolves their seat → they can record in-home sessions
        ▼
Recordings + coaching scored under THEIR OWN tenant (they're the only member)
```

**Redirects after payment**
- Success → `airepcoach.com/signup/success`
- Cancel  → `airepcoach.com/`

**What the rep sees in the app:** just their email + role ("Account owner"). No company name,
because a standalone rep's "company" is auto-derived from their email domain and would look
silly (e.g. "Gmail"). The app intentionally hides it for standalone accounts.

---

## PATH B — Manager-provisioned (AIFDH dashboard → app)

An existing AIFDH customer (a manager/admin) already has a dashboard account and a company.
They assign a coaching seat to one of their reps. That rep's data flows back to the manager.

```
Manager logs into the DASHBOARD (web)  →  Team page
        │
        ├─ Step 0 (once): toggle "AI Rep Coach" ON for the company
        │        PATCH /api/team/rep-coach   → tenants.rep_coach_enabled = true
        │        (Reps can't use the app until this is on.)
        │
        ├─ Step 1: Invite the rep (if they're not already a team member)
        │        POST /api/team/invite       (routes/team.js)
        │        • creates a dashboard_users row under the MANAGER's tenant
        │        • sends an AIFDH-branded "set your password" email
        │        • NOTE: at this point the rep is NOT yet a coaching rep
        │          (seat_type / account_type still NULL, no seat)
        │
        └─ Step 2: Grant the rep seat
                 PATCH /api/team/:id/rep-seat   { active: true, tier }
                 • enforces the per-tenant SEAT CAP (rep_seat_limit)
                 • sets on the rep's row:
                       rep_seat_active = true
                       seat_type = 'rep'
                       rep_coach_account_type = 'manager_provisioned'
                 • syncs Stripe billing (volume pricing — see below)
        ▼
Rep gets the set-password email  →  sets password
        ▼
Rep opens the MOBILE APP and logs in (same app login as Path A)
        │  app resolves their seat → they can record
        ▼
Recordings + coaching scored under the MANAGER'S tenant   ← the moat
        │
        ▼
Manager sees every rep's coaching results in the dashboard
(Team Analytics / Call Coach), because the data lives in their tenant.
```

**What the rep sees in the app:** their email + role + **the company name** (e.g. "Sales rep ·
Drew AIFDH"), because for a manager-provisioned account the company name is real.

### Volume pricing (Path B billing)

The price **per seat drops as the team's total active seat count rises** — the whole team
bills at the single bracket its total count falls into:

| Active rep seats | Price / seat |
|---|---|
| 1–2   | $149 |
| 3–9   | $129 |
| 10–24 | $109 |
| 25+   | $89  |

The dashboard **Team page** shows a live **Seat Usage meter**:
`GET /api/team/rep-seat-summary` → active seats, cap, current $/seat, monthly total, and a
nudge like *"add 7 more seats to drop to $109/seat."*

---

## App login (the SAME for both paths)

Once a rep has an email + password, logging into the mobile app is identical regardless of
how they were provisioned:

```
1. POST /api/rep/auth/login        { email, password, device_fingerprint, trusted_device_token? }
        • if a valid trusted_device_token matches this device → logged in immediately
        • otherwise → emails a 6-digit code, returns a challenge_token
2. POST /api/rep/auth/verify-otp   { challenge_token, code, trust_this_device? }
        • correct code → session token
        • trust_this_device → issues a 30-day trusted_device_token (skip OTP next time)
3. (optional) biometric unlock (Face ID / fingerprint) on subsequent app opens
```

Rep login uses **email OTP** (6-digit code), not an authenticator app.

---

## How the backend decides what a rep can do

Every app request carries the rep through `lib/requireRep.js`, which loads their row and
attaches `req.rep` (with `seat_type`, `account_type`, `trial_ends_at`, `tenant_id`).

- **`requireRepSeat`** — blocks anyone whose `seat_type === 'manager'` from recording.
  (A manager seat is dashboard-only.) A normal `'rep'` — or a legacy NULL — can record.
- **`tenant_id`** on the rep is what routes their recordings:
  - Standalone → their own tenant (just them).
  - Manager-provisioned → the manager's tenant (the moat).

---

## Side-by-side summary

| | **Path A — Standalone** | **Path B — Manager-provisioned** |
|---|---|---|
| Entry point | airepcoach.com | AIFDH dashboard → Team page |
| Who pays | The rep | The manager's company |
| Card collected | Up front, 14-day trial | On the company's existing billing |
| Tenant | A new one-person tenant | The manager's existing tenant |
| `account_type` | `standalone` | `manager_provisioned` |
| `trial_ends_at` | Set (14 days) | Not used |
| Set-password email | Rep-Coach-branded (airepcoach.com) | AIFDH-branded (dashboard) |
| Data visibility | Only the rep | The whole company / manager |
| App login | Identical email-OTP flow | Identical email-OTP flow |

---

## One-line mental model

> **Path A** = the rep is their own company.
> **Path B** = the rep belongs to a company, and the company sees their coaching.
> Same app, same login, same backend — only the *front door* and *who owns the data* differ.

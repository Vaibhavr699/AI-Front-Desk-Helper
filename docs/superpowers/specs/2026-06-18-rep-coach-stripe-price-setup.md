# Rep Coach — Stripe price + env setup (config, not code)

The standalone signup flow is code-complete but needs 4 Stripe **prices** created and 4 envs set
before a real checkout can run. This is a one-time dashboard + env task.

## 1. Create 4 recurring prices in Stripe (TEST mode first)

In the Stripe Dashboard → Products → (create one product "AI Rep Coach — Rep Seat") → add 4 prices,
all **recurring / monthly / per-unit (quantity-based)**:

| Bracket | Seats | Price / seat / mo | Env var |
|---|---|---|---|
| T1 | 1–2 | $149 | `REP_COACH_STRIPE_PRICE_T1` |
| T2 | 3–9 | $129 | `REP_COACH_STRIPE_PRICE_T2` |
| T3 | 10–24 | $109 | `REP_COACH_STRIPE_PRICE_T3` |
| T4 | 25+ | $89 | `REP_COACH_STRIPE_PRICE_T4` |

Copy each price ID (`price_...`) into the matching env var.

## 2. Set the envs (Render / .env)

```
REP_COACH_STRIPE_SECRET_KEY=sk_test_...      # the Rep Coach Stripe key (test for now)
REP_COACH_STRIPE_WEBHOOK_SECRET=whsec_...    # from the webhook endpoint below
REP_COACH_STRIPE_PRICE_T1=price_...
REP_COACH_STRIPE_PRICE_T2=price_...
REP_COACH_STRIPE_PRICE_T3=price_...
REP_COACH_STRIPE_PRICE_T4=price_...
DASHBOARD_URL=https://<dashboard host>       # used for the /reset-password set-password link
REP_COACH_URL=https://airepcoach.com         # signup success/cancel return URLs
```

Note: today `REP_COACH_STRIPE_SECRET_KEY` is **unset**, so the code falls back to the main `STRIPE_SECRET_KEY`
(test). Setting the dedicated key keeps the two Stripe surfaces cleanly separated (Drew's rule).

## 3. Register the webhook

Stripe → Developers → Webhooks → add endpoint:
- **URL:** `https://<backend host>/api/public/stripe/rep-coach/webhook`
- **Events:** `checkout.session.completed`, `customer.subscription.updated`,
  `customer.subscription.deleted`, `invoice.payment_failed`
- Copy the signing secret → `REP_COACH_STRIPE_WEBHOOK_SECRET`.

## 4. Dunning (Stripe Dashboard, not code)

Settings → Billing → "Manage failed payments" → Smart Retries on. Set the retry schedule +
"what to do when all retries fail" = cancel subscription. The code reacts to `subscription.deleted`
(paywall-lock, no data delete). Confirm the retry window with Drew (open decision).

## 5. Verify end-to-end (test mode)

1. airepcoach.com → enter email → "Start trial" → redirects to Stripe checkout.
2. Pay with test card `4242 4242 4242 4242`, any future expiry/CVC.
3. Webhook fires → account provisioned (`seat_type=rep`, `account_type=standalone`, `trial_ends_at=+14d`).
4. Welcome email → `/reset-password?token=…` → set password → log in to the app.
5. (Optional) Use a Stripe **test clock** to fast-forward 14 days → confirm trial→active.

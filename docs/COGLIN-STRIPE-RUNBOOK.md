# Turning on checkout

Everything except Stripe itself is already live: the code is deployed, the
`purchases` table exists on `coglin-prod`, and `/pricing` is public. What is
missing is two secrets. **No code change, no migration, and no redeploy** —
`wrangler secret put` rolls the Worker on its own.

Until they are set, `POST /api/billing/checkout` answers 503 and the page tells
the visitor "Checkout isn't switched on yet", which is the correct state, just
not a useful one.

Work in **test mode** through §3, then repeat §1–§2 in live mode. Going straight
to live is possible and saves fifteen minutes, but the first real card is then
also the first time the webhook has ever fired.

> **Do not set `TURNSTILE_SECRET_KEY`.** It is paired with the build-time
> `VITE_TURNSTILE_SITE_KEY`, and setting one without the other makes the server
> reject every checkout with `challenge_failed` on a page that otherwise looks
> fine. Leave both unset; the server-side amount clamp does not depend on it.
> `worker/routes/billing.test.ts` has a test named after this exact failure.

---

## 1. Product

Same Stripe account as Inkubus. Toggle to **test mode** first (top right).

- [ ] Product catalog → **+ Add product**. Name: `Coglin — Season`. Save.
- [ ] **Do not add a price.** The buyer sets the amount and it is passed inline
      per Checkout Session. There is no price ID to copy anywhere, and creating
      one will only confuse the next person.
- [ ] Developers → API keys → copy the **Secret key** (`sk_test_…`). This is the
      same key Inkubus uses; you do not need a second one.

## 2. Webhook endpoint

Developers → **Webhooks** (newer Stripe dashboards call this **Event
destinations**) → **+ Add endpoint**. This is a *new* endpoint even though the
account is shared: Inkubus's points at a different hostname and its signing
secret will not verify anything sent here.

- [ ] Endpoint URL:

      https://coglin.lilithforge.com/api/billing/webhook

- [ ] Events — exactly these two, nothing else:

      checkout.session.completed
      charge.refunded

- [ ] Reveal the **Signing secret** (`whsec_…`).

## 3. Set the secrets

```bash
cd ~/lilithforge/coglin && nvm use
npx wrangler secret put STRIPE_SECRET_KEY --env production      # sk_test_…
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production  # whsec_…
```

Each prompts for the value and pastes are not echoed. Wrangler redeploys the
Worker itself, so there is nothing to run afterwards.

Confirm the endpoint stopped answering 503:

```bash
curl -s -X POST https://coglin.lilithforge.com/api/billing/checkout \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://coglin.lilithforge.com' \
  -d '{"amount_cents":500,"seat_count":1}'
```

A `checkout.stripe.com` URL means it is working. `billing_not_configured` means
the secret did not take.

## 4. Test it with a card

At <https://coglin.lilithforge.com/pricing>, signed out:

- [ ] Roster of 12 reads **$144**.
- [ ] Pay with `4242 4242 4242 4242`, any future expiry, any CVC and ZIP.
- [ ] Stripe → the endpoint's delivery log shows `checkout.session.completed`
      returning 200.
- [ ] The row landed and says `paid`:

```bash
npx wrangler d1 execute coglin-prod --remote --env production \
  --command "SELECT status, amount_cents, seat_count, team_number, team_name FROM purchases ORDER BY created_at DESC LIMIT 5;"
```

- [ ] Resend the same event from the Stripe dashboard. Still exactly one `paid`
      row — the handler is idempotent and this proves it end to end rather than
      in a test.

## 5. Go live

Live mode shares nothing with test mode: separate keys, products and webhooks.

- [ ] Stripe account is activated — business profile, bank account, statement
      descriptor. Inkubus may have done this already; check before assuming.
- [ ] Toggle to **live mode** and repeat §1 (product, `sk_live_…`) and §2 (a new
      endpoint at the same URL, giving a new `whsec_…`).
- [ ] Re-run the two `wrangler secret put` commands with the live values. They
      overwrite.
- [ ] **Buy it yourself for the minimum, then refund it from the dashboard.**
      The refund is the point: `charge.refunded` is the only handler branch a
      test-mode card flow never reaches naturally, and this is the one chance to
      exercise it before a real customer needs it.

## Afterwards

```bash
npx wrangler d1 execute coglin-prod --remote --env production \
  --command "SELECT season_label, seat_count, amount_cents, team_number, team_name, status, paid_at FROM purchases WHERE status='paid' ORDER BY paid_at DESC;"
```

- The webhook is the only writer of `status`. A purchase stuck `pending` with a
  real charge behind it means a delivery failed — check the endpoint's log. On a
  handler error the code releases its idempotency marker so Stripe's retry
  reprocesses cleanly.
- `purchases.team_number` is **self-reported and unverified**. Never join it to
  `teams`. See the header of `migrations/0007_purchases.sql`.
- Buyer email is not stored here. It is on the Stripe Session.
- Consider a **WAF rate-limiting rule** on `/api/billing/checkout` — 5 requests
  per minute per IP. It is a public, unauthenticated endpoint that creates
  Stripe sessions, and unlike Turnstile it cannot be half-configured.

# Turning on checkout

Everything except Stripe is already live. The code is deployed, the `purchases`
table exists on `coglin-prod`, `/pricing` is public, and `STRIPE_PRODUCT_ID` is
set. What is missing is **two secrets**.

No code change, no migration, no redeploy — `wrangler secret put` rolls the
Worker on its own. Until they are set, `POST /api/billing/checkout` answers 503
and the page tells the visitor "Checkout isn't switched on yet", which is the
correct state, just not a useful one.

Work in **test mode** through §4, then repeat §1–§2 in live mode. Going straight
to live saves fifteen minutes, but the first real card is then also the first
time the webhook has ever fired.

---

## What Coglin actually asks Stripe to do

Worth knowing before granting anything, because it is less than people assume.

The entire codebase makes **one** Stripe API call: `checkout.sessions.create`
(`worker/routes/billing.ts`). That is the whole surface.

- Webhook signature verification is local HMAC over the raw request body. It
  makes no API call.
- Both webhook handlers read `event.data.object` and write to D1. No API call.
- No customers are created, no subscriptions, no refunds issued, nothing read
  back.

So the key below is scoped to almost nothing, and that is not a compromise.

---

## 1. Restricted API key

Toggle Stripe to **test mode** (top right), then Developers → API keys →
**Create restricted key**. Name it `Coglin`.

| Resource | Permission |
|---|---|
| **Checkout Sessions** | Write |
| **Products** | Read |
| everything else | None |

Products **read** — not write — because `price_data.product` references
`STRIPE_PRODUCT_ID` and Stripe resolves it. (Write would be needed only on the
fallback path, where Stripe mints a product per sale.)

Copy the key. It starts `rk_test_…` and goes wherever an `sk_` would; the SDK
does not care and there is no code change.

> **Why restricted rather than the account secret key.**
> `/api/billing/checkout` is the app's only public, unauthenticated endpoint. A
> leaked account key reaches refunds, payouts, customer data and Inkubus's live
> subscriptions — the two products share a Stripe account. A leaked restricted
> key lets somebody create checkout sessions, which is what that endpoint does
> for anyone who asks anyway.

If a scope turns out to be missing, Stripe says so explicitly — *"This API key
does not have the required permissions"*, naming the resource. It does not fail
quietly. Add it and re-run the check in §3.

## 2. Webhook endpoint

Developers → **Webhooks** (newer dashboards call this **Event destinations**) →
**+ Add endpoint**.

This is a *new* endpoint even though the Stripe account is shared: Inkubus's
points at a different hostname, and its signing secret will not verify anything
sent here.

- [ ] Endpoint URL:

      https://coglin.lilithforge.com/api/billing/webhook

- [ ] Events — exactly these two, nothing else:

      checkout.session.completed
      charge.refunded

- [ ] Reveal the **Signing secret** (`whsec_…`).

The signing secret is not an API key and has nothing to do with §1. Restricting
the key does not restrict this.

## 3. Set the two secrets

Wrangler needs Node 22 and the shell here defaults to 20. These put Node 22 on
PATH for the one command rather than going through `nvm use`, which is easy to
mangle when pasted — a chain that breaks feeds the next word to nvm and it
answers `N/A: version "production" is not yet installed`. Same approach as
`.claude/launch.json`.

```bash
cd ~/lilithforge/coglin && PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH" npx wrangler secret put STRIPE_SECRET_KEY --env production
```

```bash
cd ~/lilithforge/coglin && PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH" npx wrangler secret put STRIPE_WEBHOOK_SECRET --env production
```

Each prompts for the value; pastes are not echoed. Wrangler redeploys the Worker
itself, so there is nothing to run afterwards.

The variable is still called `STRIPE_SECRET_KEY` because that is what the Stripe
SDK's constructor takes. A restricted key is what goes in it.

Confirm it stopped answering 503:

```bash
curl -s -X POST https://coglin.lilithforge.com/api/billing/checkout \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://coglin.lilithforge.com' \
  -d '{"amount_cents":500,"seat_count":1}'
```

- A `checkout.stripe.com` URL — working.
- `billing_not_configured` — the secret did not take.
- A permissions error — a scope is missing from §1.

## 4. Test with a card

At <https://coglin.lilithforge.com/pricing>, signed out:

- [ ] A roster of 12 reads **$144**.
- [ ] Pay with `4242 4242 4242 4242`, any future expiry, any CVC and ZIP.
- [ ] Stripe → the endpoint's delivery log shows `checkout.session.completed`
      returning 200.
- [ ] The row landed and says `paid`:

```bash
cd ~/lilithforge/coglin && PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH" npx wrangler d1 execute coglin-prod --remote --env production --command "SELECT status, amount_cents, seat_count, team_number, team_name FROM purchases ORDER BY created_at DESC LIMIT 5;"
```

- [ ] Resend that same event from the Stripe dashboard. Still exactly one `paid`
      row — the handler is idempotent, and this proves it end to end rather than
      in a test.

## 5. Go live

Live mode shares nothing with test mode. **Three things change, and one of them
behaves differently from the other two:**

| What | Where | Redeploy? |
|---|---|---|
| `rk_live_…` restricted key | `wrangler secret put` | No |
| `whsec_…` from a live-mode endpoint | `wrangler secret put` | No |
| `STRIPE_PRODUCT_ID` | `wrangler.jsonc` | **Yes** |

That third row is the one that gets missed. A `prod_` id created in test mode
does not exist in live mode, so a live key against the test product fails every
checkout with *"No such product"* — and unlike the secrets, changing it needs
`npm run deploy:production`.

- [ ] Stripe account is activated: business profile, bank account, statement
      descriptor. Inkubus may have done this already; check rather than assume.
- [ ] Toggle to **live mode**, then redo §1 (a live restricted key, same two
      scopes) and §2 (a new endpoint at the same URL, giving a new `whsec_`).
- [ ] Create the product in live mode and put its `prod_` id in `wrangler.jsonc`
      for both `staging` and `production`, then deploy.
- [ ] Re-run the two `wrangler secret put` commands with the live values. They
      overwrite.
- [ ] **Buy it yourself for the minimum, then refund it from the dashboard.**
      The refund is the point: `charge.refunded` is the only handler branch a
      test-mode card flow never reaches naturally, and this is the one chance to
      exercise it before a customer needs it.

---

## Do not set TURNSTILE_SECRET_KEY

It is paired with the build-time `VITE_TURNSTILE_SITE_KEY`. Setting one without
the other makes the server reject **every** checkout with `challenge_failed`, on
a page that otherwise looks completely fine. Leave both unset; the server-side
amount clamp does not depend on either. `worker/routes/billing.test.ts` has a
test named after this exact failure.

If you want a control that cannot be half-configured, add a **WAF rate-limiting
rule** on `/api/billing/checkout` — 5 requests per minute per IP.

## Afterwards

```bash
cd ~/lilithforge/coglin && PATH="$HOME/.nvm/versions/node/v22.12.0/bin:$PATH" npx wrangler d1 execute coglin-prod --remote --env production --command "SELECT season_label, seat_count, amount_cents, team_number, team_name, status, paid_at FROM purchases WHERE status='paid' ORDER BY paid_at DESC;"
```

- The webhook is the only writer of `status`. A purchase stuck `pending` with a
  real charge behind it means a delivery failed — check the endpoint's log. On a
  handler error the code releases its idempotency marker so Stripe's retry
  reprocesses cleanly.
- `purchases.team_number` is **self-reported and unverified**. Never join it to
  `teams`. See the header of `migrations/0007_purchases.sql`.
- Buyer email is not stored. It is on the Stripe Session. Reading it back would
  need Checkout Sessions **read** added to the key in §1.

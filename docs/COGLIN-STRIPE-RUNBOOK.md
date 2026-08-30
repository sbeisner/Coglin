# Alpha pricing — manual setup checklist

Everything that has to happen **outside this repo** to make `/pricing` take
money. The code is done and tested (`worker/routes/billing.ts`,
`worker/lib/billing.ts`, `src/routes/Pricing.tsx`); none of it does anything
until the steps below are complete.

Work top to bottom. Test mode all the way through §7, then §8 flips to live.

## What this is

A product sold at a price the customer sets — **not** a donation flow. The
recommendation is $12 per seat per season ($144 for a 12-seat roster, against
the $149 list that plan §7 sets for 2027-28). Language matters: these are
purchases, the rows live in `purchases`, and calling them contributions or gifts
in a dashboard, an email or a spreadsheet later undoes the point.

What it is *not* is a paywall. Access is not gated on payment during the alpha
(plan §8) and no code reads the `purchases` table. Real entitlement checking is
Phase 5 (COG-023). If you find yourself adding one because of something here,
stop — that is a decision, not a follow-up.

---

## 0. Before you start

- [ ] **Node 22.** `nvm use` in this repo (`.nvmrc` pins 22.12.0). Wrangler
      refuses to run on 20 and the error looks unrelated to what you were doing.
- [ ] **Wrangler is authenticated** for the LilithForge Cloudflare account:
      `npx wrangler whoami`. (Note: the stored OAuth token has previously
      lacked R2 scope. D1 and secrets are unaffected, but if a command fails
      with a permissions error, re-auth before debugging anything else.)
- [ ] **Stripe CLI** for the local test: `brew install stripe/stripe-cli/stripe`
      then `stripe login`.

Already done, nothing to do: DNS and the custom domains
(`coglin.lilithforge.com`, `coglin-staging.lilithforge.com`) are live and routed
in `wrangler.jsonc`.

---

## 1. Stripe — product (test mode)

Same Stripe account as Inkubus. Toggle to **test mode** first (top right).

- [ ] Product catalog → **+ Add product**. Name: `Coglin — Season`.
- [ ] **Do not add a Price.** The buyer sets the amount, which is passed inline
      as `price_data.unit_amount` on each Checkout Session. There is no price ID
      to copy anywhere, and creating one will just confuse the next person.
- [ ] Developers → API keys → copy the **Secret key** (`sk_test_...`).
      This is the same key Inkubus uses; you do not need a second one.

## 2. Cloudflare Turnstile

`/api/billing/checkout` is public and unauthenticated, which makes it a
card-testing target.

- [ ] Cloudflare dashboard → Turnstile → **Add widget**.
- [ ] Hostnames: `coglin.lilithforge.com`, `coglin-staging.lilithforge.com`,
      and `localhost`, all on the one widget.
- [ ] Copy the **Site key** → this becomes `VITE_TURNSTILE_SITE_KEY`.
- [ ] Copy the **Secret key** → this becomes `TURNSTILE_SECRET_KEY`.

> **These two are a pair, and getting it half-right breaks checkout silently.**
> The page only sends a token when the site key was built into the bundle, and
> the server rejects a missing token whenever the secret is set. Configure one
> without the other and every checkout fails with `challenge_failed`, on a page
> that otherwise looks completely fine. Set both or neither.
>
> The **site key is read by Vite at build time** — it is not a Worker secret and
> must be exported in the shell that runs `npm run build` / the deploy script.
> It ships in the client bundle, which is fine; site keys are public.

Skipping Turnstile entirely is supported (leave both unset). Do §3 regardless.

## 3. WAF rate limit

- [ ] Cloudflare dashboard → the `lilithforge.com` zone → Security → WAF →
      Rate limiting rules → **Create rule**.
- [ ] Match `http.request.uri.path eq "/api/billing/checkout"`, 5 requests per
      minute per IP, action Block.

This one does not depend on the app being configured correctly, which is why it
is worth having even if you skip Turnstile.

## 4. Local test

Two terminals.

```bash
nvm use && npm run dev
```

```bash
stripe listen --forward-to localhost:5174/api/billing/webhook
```

- [ ] Put `sk_test_...` in `.dev.vars` as `STRIPE_SECRET_KEY`.
- [ ] Put the `whsec_...` that `stripe listen` printed in `.dev.vars` as
      `STRIPE_WEBHOOK_SECRET`. **It is different every run.**
- [ ] Leave both Turnstile vars blank locally.
- [ ] Restart `npm run dev` so it picks up `.dev.vars`.
- [ ] Apply the migration locally: `npm run db:migrate:local`.

Then at `http://localhost:5174/pricing`, **signed out**:

- [ ] Roster 12 reads **$144**. Presets switch ($6/$12/$20).
- [ ] Pay with `4242 4242 4242 4242`, any future expiry, any CVC/ZIP.
- [ ] The `stripe listen` terminal shows `checkout.session.completed` → 200.
- [ ] The row landed:

```bash
npx wrangler d1 execute coglin-staging --local --command "SELECT status, amount_cents, seat_count, team_number FROM purchases ORDER BY created_at DESC LIMIT 5;"
```

- [ ] `stripe events resend <evt_id>` → still exactly one `paid` row.
      (The handler is idempotent; this proves it end to end rather than in a test.)

## 5. Staging

- [ ] Migrate the remote staging DB: `npm run db:migrate:staging`
- [ ] Set the secrets:

```bash
npx wrangler secret put STRIPE_SECRET_KEY     --env staging
npx wrangler secret put STRIPE_WEBHOOK_SECRET --env staging
npx wrangler secret put TURNSTILE_SECRET_KEY  --env staging
```

  For `STRIPE_WEBHOOK_SECRET` you need the value from the next step first, so
  either do that step now and come back, or set it twice.

- [ ] Stripe → Developers → Webhooks → **+ Add endpoint**:
      - URL `https://coglin-staging.lilithforge.com/api/billing/webhook`
      - Events: `checkout.session.completed` and `charge.refunded` — those two,
        nothing else
      - Reveal the **Signing secret** → that is staging's `STRIPE_WEBHOOK_SECRET`
- [ ] Deploy **with the site key exported**, or Turnstile will reject everything:

```bash
VITE_TURNSTILE_SITE_KEY=0x... npm run deploy:staging
```

- [ ] Repeat the §4 browser test against `https://coglin-staging.lilithforge.com/pricing`,
      still with the `4242` card.

## 6. Production (still test mode)

Same shape as §5. Doing production once on test keys before going live means the
only thing that changes in §8 is the keys.

- [ ] `npm run db:migrate:production`
- [ ] Three `npx wrangler secret put ... --env production`
- [ ] Stripe webhook endpoint for
      `https://coglin.lilithforge.com/api/billing/webhook` (its own signing
      secret — the staging one will not verify here)
- [ ] `VITE_TURNSTILE_SITE_KEY=0x... npm run deploy:production`
- [ ] Test with `4242` against `https://coglin.lilithforge.com/pricing`

## 7. The website link

The studio home page now links to `/pricing`. **Read this before deploying it:**

- [ ] `~/lilithforge/website` has **no git remote and ~49 uncommitted files**.
      Deploying `home/` ships all of that pending work, not just the one link.
      Review `git status` and `git diff home/index.html` there and decide
      whether you want it all to go out.
- [ ] `npm run deploy:home` passes `--branch=feature/marketing-site`, which on
      Cloudflare Pages produces a **preview** deployment unless that branch is
      the project's production branch. Check the Pages project's branch setting
      before assuming the link is live on `lilithforge.com`.
- [ ] No `?v=N` bump needed — the change is one `<a>` reusing the existing
      `.btn.btn-ghost`, and `styles.css` is untouched by it.

## 8. Go live

Live mode shares nothing with test mode — separate keys, products and webhooks.

- [ ] Stripe account is activated (business profile, bank account, statement
      descriptor). Inkubus may already have done this; check.
- [ ] Toggle to **live mode**, redo §1 (product, `sk_live_...`).
- [ ] Redo the webhook endpoints in live mode for **both** hostnames → two new
      `whsec_...` values.
- [ ] Overwrite all four secrets (`STRIPE_SECRET_KEY` and
      `STRIPE_WEBHOOK_SECRET`, staging and production) with the live values.
- [ ] Redeploy both environments, site key exported.
- [ ] **Buy it yourself, smallest amount, then refund it from the dashboard.**
      The refund is the point: `charge.refunded` is the only handler branch a
      test-mode card flow never reaches naturally, and this is the only time it
      gets exercised before a real customer needs it.

## 9. Afterwards

What sold:

```bash
npx wrangler d1 execute coglin-prod --remote --env production \
  --command "SELECT season_label, seat_count, amount_cents, team_number, team_name, status, paid_at FROM purchases WHERE status='paid' ORDER BY paid_at DESC;"
```

- The webhook is the only writer of `status`. A purchase stuck `pending` with a
  real charge behind it means a delivery failed — check Developers → Webhooks →
  that endpoint's log. On a handler error the code releases its idempotency
  marker so Stripe's automatic retry reprocesses cleanly.
- `purchases.team_number` is **self-reported and unverified**. Never join it to
  `teams`. See the header of `migrations/0007_purchases.sql`.
- Buyer email is not stored here. It is on the Stripe Session.
- With `STRIPE_SECRET_KEY` unset the endpoint answers 503 and the rest of the
  app is unaffected — that is the correct state for most local work.

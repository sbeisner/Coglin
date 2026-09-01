# Coglin

Season operations for _FIRST_® Tech Challenge teams — boards, award-evidence
tracking, outreach logging, and portfolio planning mapped to the actual
Competition Manual criteria.

Coglin is **unofficial by design**. It is not affiliated with, endorsed by, or
licensed by _FIRST_®. No _FIRST_/FTC logos are used anywhere, and team
verification is manual (the FTC Events API's terms bar commercial use).

Product plan: `~/lilithforge/coglin-plan.md` · Backlog: `~/lilithforge/coglin-tracker.xlsx`

## Stack

Cloudflare Workers with static assets — one Worker serves the compiled React
bundle and the `/api/*` routes. "Static assets" means the build output only;
all app data is fetched at runtime from D1 and R2.

| Layer    | Choice                                  |
| -------- | --------------------------------------- |
| Runtime  | Cloudflare Workers (`@cloudflare/vite-plugin`) |
| API      | Hono                                    |
| Frontend | React 19 + Vite + Tailwind v4 + React Router |
| Data     | D1 (SQLite), multi-tenant, keyed by `team_id` |
| Files    | R2 (`MEDIA` binding) — photos, CAD renders |
| Realtime | Polling for v1; Durable Object `TeamRoom` in Phase 4 |

Node **22** is required (wrangler's asset handler needs ≥22). Use `nvm use`.

## Environments

| Resource | Staging                              | Production                   |
| -------- | ------------------------------------ | ---------------------------- |
| Worker   | `coglin-app-staging`                 | `coglin-app`                 |
| Domain   | `coglin-staging.lilithforge.com`     | `coglin.lilithforge.com`     |
| D1       | `coglin-staging`                     | `coglin-prod`                |
| R2       | `coglin-media-staging`               | `coglin-media-prod`          |

The top-level `wrangler.jsonc` target is named `coglin-app-dev` on purpose, so
an accidental bare `wrangler deploy` creates a throwaway worker instead of
overwriting production.

Staging is `coglin-staging.lilithforge.com`, **not**
`staging.coglin.lilithforge.com`. Cloudflare Universal SSL covers
`*.lilithforge.com` but not two-level names; the nested form resolves in DNS and
then fails the TLS handshake unless you pay for Advanced Certificate Manager.

**Environments are selected at build time, not deploy time.** The Cloudflare
Vite plugin emits a "redirected deploy config" flattened to the active
environment, and `wrangler deploy` reads that instead of `wrangler.jsonc`. So
`CLOUDFLARE_ENV` must be set for the *build*; a bare `wrangler deploy --env foo`
silently deploys the top-level worker. The npm scripts below handle this.

## Local development

```bash
nvm use
npm install
cp .dev.vars.example .dev.vars   # then fill SESSION_PEPPER
npm run db:migrate:local
npm run dev                      # http://localhost:5174
```

Port 5174, not Vite's default 5173, which the Inkubus dev server uses on the
same machine.

## Deploying

Push to `main` deploys **staging** automatically. Production is a manual
`workflow_dispatch` gated behind a GitHub environment protection rule —
production holds a real team's season data and is never updated as a side
effect of a push.

```bash
npm run deploy:staging      # or let CI do it
npm run deploy:production   # prefer the gated workflow
```

## Migrations

Real `wrangler d1 migrations`, with its `d1_migrations` ledger — not replayed
`CREATE TABLE IF NOT EXISTS` files.

```bash
npm run db:migrate:local
npm run db:migrate:staging
npm run db:migrate:production
```

Those scripts pass `--env` even though they already name the database, because
wrangler resolves that name against **the config file, not your account**. Each
database is only declared inside its own `env` block, so a bare
`wrangler d1 migrations apply coglin-prod --remote` fails with *"couldn't find a
D1 DB with the name or binding 'coglin-prod' in your wrangler.jsonc file"* —
which looks like a credentials problem and is not one. Staging appears to work
without `--env` only because the top-level block points at `coglin-staging` for
local dev.

## Tenancy rule

Every application table carries `team_id`, and `team_id` is **never** read from
a request body — it is resolved from the authenticated session's membership row
in `worker/lib/tenancy.ts`. Every tenant-scoped query must hit an index on
`team_id`: D1 bills per row *read*, so an unindexed scan costs money as well as
leaking. A cross-team read is the one bug this codebase cannot ship.

## Data protection

Users are 12–18. Students are **coach-provisioned**: no self-signup, no email,
login is `team_number + handle + password`. Student PII is limited to a display
name and a handle. See the plan's §6 before touching auth.

Bug reports are the one place a student's free writing leaves the app by mail.
The header of `migrations/0008_bug_reports.sql` records what the reporter is
shown before they send and what is deliberately never captured.

## Information architecture

One Worker serves three things at `coglin.lilithforge.com`, split by path:

| Path | What | Gate |
|---|---|---|
| `/`, `/features`, `/awards`, `/pricing`, `/faq`, `/about` | Marketing site, in `MarketingShell` | public |
| `/login`, `/signup`, `/invite/:token` | Auth, no marketing chrome | public |
| `/app`, `/app/boards`, `/app/meetings/:id`, … | The application, in `AppShell` | session |

The root used to redirect anonymous visitors to `/login`, which made a login
form the public face of a URL that lilithforge.com already advertises. The app
moved under `/app` to free it.

Two consequences worth knowing:

- **Every pre-move bookmark is redirected.** `src/main.tsx` lists the old app
  paths and forwards them to `/app/...` with params and query intact. The alpha
  team was mid-season when this landed; breaking their links to tidy the URL
  space was not an option. `/awards` is deliberately NOT in that list — it is
  now the public award-breakdown page.
- **`/app` is a prefix, so nav links must opt out of prefix matching.** The
  dashboard sits at `/app` and would otherwise render as active on every screen.
  `AppShell.tsx` names this `APP_ROOT` and passes `end` in both the sidebar and
  the mobile tab bar. This did not bite at `/` because react-router only counts
  a prefix when the next character is a separator.

**Marketing lives in the SPA**, so a crawler gets an empty `#root` until JS runs
and `index.html`'s meta tags are global rather than per-route. That is an
accepted trade for an invite-only alpha; if organic search ever matters, the fix
is a Vite multi-page build or per-path `HTMLRewriter` in the Worker.

`src/marketing/capabilities.ts` is the single source for what ships and what
does not — the landing page, features, awards and the pricing comparison all
render from it, and `capabilities.test.ts` fails if anything claims to ship
while `nav.ts` still marks its screen a stub.

## Marketing screenshots

`npm run screens` seeds a local database with invented data and photographs the
real UI into `src/marketing/screens/`. Requires `npm run dev` in another
terminal, and python3 with Pillow for the WebP conversion.

Three rules it exists to keep:

- **Nothing from production.** That database is one team, six of them minors.
  The capture script refuses any base URL that is not localhost.
- **Nothing invented in the bundle.** `src/lib/api.ts` bans sample data from the
  client and was right to. The seed writes SQL, a human applies it to a local
  D1, and the only thing that ships is a picture. Verify with
  `npm run build && grep -r "Cog Goblins" dist/client/assets/*.js`.
- **Only screens that work.** A screenshot is the strongest claim the site
  makes, so photographing a stub would undo every "This season" label on it.

Images are WebP at 2x, ~525KB for all seven. As PNG they were 1.4MB. Regenerate
after any UI change that shows in them; there is no test that can notice they
have gone stale.

## Pricing during the alpha (`/pricing`)

A public pay-what-you-think-is-fair page (COG-047). Three things about it are
worth knowing before touching it.

**It is a product being sold, not a donation drive.** The customer names the
price; that does not make it a gift. "Gift", "donate", "support us" and "chip
in" do not belong in this feature — not in the copy, not in the table names, not
in how the rows get talked about later. A team that pays $80 for a season bought
a season for $80. Charity framing would also make the pricing evidence useless:
what someone donates says nothing about what they would pay.

**The price is theirs because the product is unfinished.** The recommendation is
**$12 per seat per season**, which puts a 12-seat roster at $144. Access is not
gated on payment during the alpha (plan §8); "not gated" is a separate decision
from "not sold".

**Post-alpha pricing is undecided, and the site must keep saying so.** Plan §7
carries a working figure for 2027-28. It is an internal planning number: it must
not appear in any user-facing copy, because printing it turns an assumption into
a commitment we then have to honour or publicly retract. The pricing page and
the FAQ both had to be walked back from exactly that. Say what it costs today,
say the rest is undecided.

**It is the only public part of the API.** `/api/billing/checkout` and
`/api/billing/webhook` take no session — a coach can buy before they have an
account, and Stripe posts the webhook with no session at all. Because neither
can resolve a tenant, neither touches a tenant table. `purchases.team_number` is
a self-reported string typed into a form and must never be joined to `teams`;
the header of `migrations/0007_purchases.sql` explains why at length.

The amount is clamped server-side to [$5, $2000] in `worker/lib/billing.ts`. The
browser sends a money amount, so the browser does not get to decide it.

**Turnstile is two settings, not one.** `TURNSTILE_SECRET_KEY` (Worker secret)
and `VITE_TURNSTILE_SITE_KEY` (build-time, ships in the bundle) are a pair:
the server rejects a missing token whenever the secret is set, and the page only
sends one when the site key was built in. Setting either alone takes checkout
down with `challenge_failed`. There is a test for exactly this.

Setup, secrets and the go-live checklist: `docs/COGLIN-STRIPE-RUNBOOK.md`. With
`STRIPE_SECRET_KEY` unset the endpoint answers 503 and the rest of the app is
unaffected, which is the correct state for most local work.

## Bug reports

A "Report a bug" button in the sidebar footer (`SidebarFoot` in
`src/components/AppShell.tsx`, which renders on both the desktop sidebar and the
mobile sheet). It exists because the alpha's testers are volunteer coaches: a
report that costs a context switch does not get filed.

**The row commits before the mail goes out**, the same order invites use. A mail
outage is a degraded result — `sent: false`, and the dialog says so — never a
lost report.

**Anyone on a team may file one.** No role gate, deliberately: a viewer is a
parent looking at a screen that just broke. Two tests in
`worker/routes/bugs.test.ts` exist only to fail if a `requireRole` appears.

**`BUG_ALERT_TO` is where they land**, comma-separated, set per environment in
`wrangler.jsonc` next to `SIGNUP_ALERT_TO`. Unset means no mail, not no report —
which is the correct local and test behaviour.

Reports the mail never carried, after a Resend key rotation (the key is shared
with Inkubus, so rotating it there stops Coglin mail here):

```
wrangler d1 execute coglin-prod --remote --env production --command \
  "SELECT id, created_at, role, substr(body,1,60) FROM bug_reports WHERE emailed = 0"
```

Triage. There is no UI for `status` and is not going to be one during the alpha:

```
wrangler d1 execute coglin-prod --remote --env production --command \
  "SELECT id, created_at, kind, role, route, app_build, substr(body,1,80) \
     FROM bug_reports WHERE status = 'new' ORDER BY created_at"
```

`app_build` is the short commit sha the bundle was built from, `-dirty` when the
tree had uncommitted changes. It is stamped by a `define` that must stay in
**both** `vite.config.ts` and `vite.ssr.config.ts` — the prerender step compiles
the same component graph, and defining it in only one fails the build a step
later than the file you edited.

Report bodies are free text written by minors and are included in the nightly R2
dump, because `worker/backup.ts` enumerates `sqlite_master`.

-- Alpha season purchases (COG-047).
--
-- Coglin is a product and this table records people buying it. The alpha's
-- pricing model is pay-what-you-think-is-fair — the customer names the number,
-- with a recommendation of $12 per seat per season — but a customer-set price is
-- still a price. Nothing here is a donation, and the word does not belong in
-- this file, in the UI, or in how these rows get talked about later. A team that
-- pays $80 for a season bought a season for $80.
--
-- Why the price is theirs to set: the product is unfinished. Plan §7 puts the
-- 2027-28 list at $149 with a $99 verified rate, and until the award tracker,
-- outreach rollups and budget actually ship, we do not have the standing to name
-- a number. The teams using it do. What they choose is the most useful pricing
-- research available and is worth more than the revenue.
--
-- Access is not contingent on a purchase during the alpha (plan §8), which is a
-- separate decision and not a charitable one: locking a team out of a season
-- mid-build would cost us the feedback the alpha exists to collect.
--
--
-- WHY THERE IS NO team_id, and this is the load-bearing one:
--
-- `purchases` is NOT a tenant table. Every other application table in this
-- schema carries team_id as the first column of a composite index, resolved from
-- the session's membership row and never from a request (see worker/lib/
-- tenancy.ts). This one cannot play that game, because the page that writes it is
-- PUBLIC — no session, no membership, nothing to resolve a tenant from. A coach
-- can buy before they have an account.
--
-- So `team_number` and `team_name` here are SELF-REPORTED STRINGS. Anyone can
-- type 607. Joining this table to `teams` on team_number — in a query, a report,
-- or a future "show my team's purchases" screen — would attribute a stranger's
-- row to a real team, and would do it silently. Do not write that join.
-- Reconciling a purchase to a team is a human read, which is fine at alpha
-- volume and is the same posture plan §6 takes toward FIRST team verification:
-- manual on purpose, and fraud-resistant because of it.
--
--
-- WHY THERE IS NO email COLUMN:
--
-- Stripe Checkout collects the buyer's address and it lives on the Session. We
-- keep `stripe_session_id` and look it up there when we need it. worker/lib/
-- email.ts opens with the rule this follows — "the recipient address is a
-- parameter and never becomes state" — written for invites that land in a
-- 14-year-old's inbox. A billing address is a softer case, but the reason to
-- hold an address is still "we could", and that has never been good enough in
-- this schema.
--
-- All timestamps are epoch SECONDS (INTEGER), as everywhere else.

CREATE TABLE purchases (
  id                    TEXT PRIMARY KEY,      -- uuid v4
  -- Set before the redirect, so a checkout that is never completed leaves a
  -- 'pending' row rather than nothing. Abandoned checkouts are signal too: they
  -- say someone got as far as choosing a price and then didn't.
  stripe_session_id     TEXT NOT NULL UNIQUE,  -- cs_...
  stripe_payment_intent TEXT,                  -- pi_..., set by the webhook
  team_number           INTEGER,               -- self-reported, see header
  team_name             TEXT,                  -- self-reported, see header
  seat_count            INTEGER,               -- what the roster field said
  amount_cents          INTEGER NOT NULL,      -- AFTER server-side clamping
  currency              TEXT NOT NULL DEFAULT 'usd',
  season_label          TEXT NOT NULL,         -- '2026-27', from currentSeason()
  status                TEXT NOT NULL,         -- pending | paid | refunded
  created_at            INTEGER NOT NULL,
  paid_at               INTEGER
);

-- The only query this table has: "what sold, newest first", for a human.
CREATE INDEX idx_purchases_status ON purchases(status, created_at);

-- Webhook idempotency. Stripe redelivers on any non-2xx and on its own schedule,
-- so the handler must be safe to run twice on the same event. Same shape as the
-- Inkubus table of this name (website/inkubus/migrations/0001_init.sql). `source`
-- is carried over so a second provider later needs no schema change.
CREATE TABLE webhook_events (
  id           TEXT PRIMARY KEY,               -- provider event id (evt_...)
  source       TEXT NOT NULL,                  -- 'stripe'
  processed_at INTEGER NOT NULL
);

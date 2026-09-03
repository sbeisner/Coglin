-- Funds: use-or-lose money versus money that carries over
-- (COG-0xx, finance phase 4).
--
-- The question this exists to answer, which the app currently cannot: in April,
-- how much of the money that DISAPPEARS is still unspent?
--
-- A team typically has two kinds of money and no way to tell them apart. A
-- school district or booster allocation is use-or-lose: spend it by the fiscal
-- year end or forfeit it. Sponsorship and donations are the team's own money
-- and sit there until spent. Both land in the same ledger as undifferentiated
-- income, so a coach in April has no way to see that $340 of district money is
-- about to evaporate while $1,200 of sponsorship money is not.
--
-- This is fund accounting, and it is close to universal for school-affiliated
-- teams. It is also invisible to a team that has one pot: no fund rows means no
-- strip, no warnings, and a ledger that reads exactly as it does today.
--
--
-- THE FUND IS THE SCOPE. This is the idea that makes the whole design work.
--
-- Next year's district allocation is a NEW FUND ROW -- "District allocation
-- FY27" -- not this row reset to zero. That is how fund accounting actually
-- works, and three awkward problems disappear with it:
--
--   * No reset logic. Nothing has to zero a balance at a year boundary.
--   * No cross-season query. A fund's balance is every transaction pointing at
--     it, full stop, because the fund itself delimits the period.
--   * No dependency on season rollover, which is just as well -- see below.
--
--
-- WHAT WORKS TODAY AND WHAT DOES NOT, stated plainly.
--
-- Coglin has no season rollover. Every team gets exactly one season at signup
-- with is_current = 1 (worker/routes/auth.ts), and nothing anywhere creates a
-- second one or flips that flag. So:
--
--   * USE-OR-LOSE works fully now. A June 30 deadline sits inside the working
--     life of a Sept-May season, so the deadline, the remaining balance and the
--     warning are all observable today.
--   * CARRYOVER is a label that becomes load-bearing later. Today it means
--     "this pot has no deadline, do not warn me about it", which is already
--     useful and already true. When rollover ships it will additionally mean
--     "do not reset this balance" -- and because the fund is the scope, that
--     needs no new code.
--
-- Getting the flag into the schema now is cheap and means rollover will not
-- have to migrate around its absence.
--
--
-- WHY `expires_at IS NULL` IS THE WHOLE DISCRIMINATOR:
--
-- One nullable column, not a boolean plus a date. Two columns could disagree
-- with each other -- a row claiming it carries over while also carrying a June
-- 30 deadline -- and then somebody has to decide which half was lying.
--
-- Note this is the OPPOSITE call from 0009, where `amount_cents` plus `kind`
-- deliberately are two columns. The difference is that a sign and a magnitude
-- are two independent facts about a transaction, whereas "has a deadline" and
-- "what the deadline is" are one fact wearing two hats. Splitting the second
-- kind invents a contradiction that cannot exist in the world.
--
--
-- REMAINING BALANCE IS LEDGER MATH. There is deliberately no
-- `allocated_cents` column.
--
-- A fund's remaining is SUM(income into it) - SUM(expense from it), read from
-- `transactions`. The team records the allocation itself as an income line in
-- that fund, which keeps the ledger the single source of truth and means the
-- summary needs no special case. An allocation column would be a second copy
-- of a number the ledger already holds, and it would make the ledger's own
-- income total incomplete -- a screen showing $1,500 available against a
-- ledger that never saw $1,500 arrive.
--
-- The same reasoning gives opening balances for free. A team adopting Coglin
-- in March, already holding money, records it as an income line with the
-- reserved category `opening_balance` (worker/lib/finance.ts) rather than
-- back-entering a season of history. `POST /api/finance/funds/initialize`
-- writes those rows for them in one batch. Nothing new in the schema: it is a
-- category, because an opening balance genuinely IS money arriving as far as
-- this ledger is concerned.
--
-- Note that INCOME and BALANCE deliberately treat it differently -- income
-- excludes `opening_balance` because "income" means what the team raised this
-- season, while balance includes it because the money is really there. See the
-- summary route.
--
--
-- `category` VERSUS `fund`, since both are on a transaction and they are not
-- the same axis:
--
--   category  what the money was FOR   -- parts, travel, registration
--   fund      which pot it came FROM   -- district allocation, sponsorship
--
-- A $312 parts order paid out of the district allocation is category 'parts',
-- fund "District allocation FY26". Neither substitutes for the other.
--
-- Money is INTEGER cents. Timestamps are epoch SECONDS. No triggers -- the
-- Worker writes updated_at, per 0003.

CREATE TABLE funds (
  id          TEXT PRIMARY KEY,            -- uuid v4
  -- TEAM-scoped, with no season_id, which is a departure worth naming. A fund
  -- outlives a season by definition -- that is what "carries over" means --
  -- and the precedent is `members` (0001), `invites` (0002) and `bug_reports`
  -- (0008), all of which are team-scoped for the same reason.
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,               -- "District allocation FY26", capped 120
  note        TEXT,                        -- capped 500
  -- NULL means it carries over. Set means use-or-lose, expiring on this date.
  -- See the argument above for why this is one column.
  expires_at  INTEGER,
  -- Where money lands when nobody said which pot it came from: a part order
  -- being marked ordered, a sponsor payment with no fund named. One per team,
  -- the same shape `seasons.is_current` uses, enforced by the route rather
  -- than by a constraint SQLite cannot express.
  is_default  INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_funds_team ON funds(team_id, is_default);

-- Which pot a ledger line came out of, when the team tracks pots at all.
--
-- Nullable, and every existing row keeps NULL: a team that never creates a
-- fund sees nothing change anywhere. NULL renders as "Unassigned" rather than
-- as an error, because it is a legitimate state and not a missing value.
--
-- SET NULL rather than CASCADE for the same reason 0010 gives for sponsor_id:
-- deleting a pot must never delete the record that money moved. The route
-- refuses that delete while lines still point here, and this is the second
-- line of defence.
ALTER TABLE transactions ADD COLUMN fund_id
  TEXT REFERENCES funds(id) ON DELETE SET NULL;
CREATE INDEX idx_transactions_team_fund
  ON transactions(team_id, fund_id);

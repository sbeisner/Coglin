-- Finance (COG-0xx): the ledger, receipts, and part order requests.
--
-- budget_lines was schema written before the feature was designed, and the
-- feature it guessed at turned out smaller than the one being built. It has
-- never had a reader or a writer -- no route references it, so it is empty in
-- every environment including production -- which means it can be dropped and
-- replaced rather than rebuilt with the 0006 rename dance. `sponsors` stays
-- untouched: sponsorship campaigns are the next phase, and until then a
-- sponsor's cheque is recorded as an income transaction with the
-- 'sponsorship' category, which is deliberately reserved for that promotion.
--
--
-- WHY `transactions` AND NOT `budget_lines` PLUS COLUMNS:
--
-- The ledger is the Sustain award's money story and also the team's actual
-- book-keeping. That needs a category axis ("how much did we spend on parts
-- vs travel"), a note, authorship, and edit times -- none of which the stub
-- had. amount_cents is ALWAYS POSITIVE and `kind` carries the sign, because a
-- signed amount plus a kind column can disagree with itself and somebody has
-- to decide which one was lying.
--
-- Category vocabularies live in worker/lib/finance.ts, values-first like every
-- other enum, and are validated per kind -- 'parts' is not an income category
-- and 'sponsorship' is not an expense.
--
--
-- PART ORDERS ARE A REQUEST QUEUE, NOT A CART:
--
-- A student in the pit says "we need two more servos" and the question is
-- whether that sentence gets written down. The row captures what, where from,
-- roughly how much -- and then walks a status ladder:
--
--   pending -> approved | denied      (an approver's decision, with a note)
--   approved -> ordered               (somebody actually placed the order)
--   ordered -> received               (the box arrived)
--   pending -> canceled               (the requester changed their mind)
--   approved -> canceled              (leadership pulled it before money moved)
--
-- Each transition stamps who and when in its own columns rather than an audit
-- table -- the row IS the paper trail, the same trade meetings made with
-- started_at / ended_at / cancel_reason.
--
-- `transaction_id` is the promote pointer, mirroring
-- meeting_action_items.task_id: marking an order `ordered` INSERTs the expense
-- line and sets the pointer in one batch, guarded by `AND transaction_id IS
-- NULL` so a double press is a 409 rather than two expense lines.
--
-- WHO APPROVES is not a role. Coaches and mentors always can, and any member
-- can be granted it besides -- the team treasurer is often a student, and that
-- is the point of the business sub-team. So it is a flag on `members`
-- (`is_purchase_approver`, added below), the same shape as photo_consent_at:
-- a per-member attribute a coach flips, not a fifth role for roles.ts to
-- carry everywhere.
--
--
-- RECEIPTS ARE MEDIA ROWS. media gains a nullable `transaction_id` and a new
-- `kind` value 'receipt' (the column was always free text -- the vocabulary
-- lives in worker/routes/media.ts). One transaction may hold several files,
-- because a purchase routinely produces an invoice plus a shipping receipt.
-- Receipts ride the existing ingest funnel -- sniff, strip, quota, R2 -- and
-- the library list keeps them out of the photo gallery by filtering to
-- kind = 'photo' instead of excluding roster photos by name.
--
--
-- VISIBILITY, decided and recorded here: the ledger, balances and receipts are
-- readable by EVERY role including viewers. A viewer is a parent or a sponsor,
-- and where the team's money went is exactly the thing a sponsor is owed.
-- Writers are narrower -- see worker/routes/finance.ts for the table.
--
-- Money is INTEGER cents. Timestamps are epoch SECONDS, as everywhere else.
-- updated_at is written by the Worker on every UPDATE -- no triggers here, by
-- the rule in 0003.

DROP INDEX idx_budget_team_season;
DROP TABLE budget_lines;

CREATE TABLE transactions (
  id           TEXT PRIMARY KEY,            -- uuid v4
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id    TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  kind         TEXT NOT NULL,               -- income | expense
  category     TEXT NOT NULL,               -- per-kind vocabulary, worker/lib/finance.ts
  label        TEXT NOT NULL,               -- "REV kit restock", "Acme Tool sponsorship"
  note         TEXT,
  amount_cents INTEGER NOT NULL,            -- always positive, kind carries the sign
  occurred_at  INTEGER NOT NULL,            -- when the money moved, not when recorded
  -- SET NULL, not CASCADE: the ledger outlives whoever typed the line into it.
  created_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
-- team_id first, per the tenancy rule. occurred_at because the ledger reads
-- newest-first and the summary sums a season.
CREATE INDEX idx_transactions_team_season
  ON transactions(team_id, season_id, occurred_at);

CREATE TABLE part_orders (
  id               TEXT PRIMARY KEY,        -- uuid v4
  team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id        TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  item             TEXT NOT NULL,           -- "goBILDA 5203 servo", capped at 200
  description      TEXT,                    -- why we need it
  url              TEXT,                    -- product link, http(s) only
  vendor           TEXT,
  qty              INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,        -- an estimate is required to decide anything
  status           TEXT NOT NULL DEFAULT 'pending',
  -- Every REFERENCES members below is SET NULL for the bug_reports reason: the
  -- order history stays meaningful after a student graduates off the roster.
  requested_by     TEXT REFERENCES members(id) ON DELETE SET NULL,
  decided_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
  decided_at       INTEGER,
  decision_note    TEXT,                    -- mostly the denial reason
  ordered_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
  ordered_at       INTEGER,
  received_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
  received_at      INTEGER,
  -- The promote pointer. SET NULL so deleting the ledger line reopens the
  -- question rather than deleting the order that asked it.
  transaction_id   TEXT REFERENCES transactions(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_part_orders_team_season
  ON part_orders(team_id, season_id, created_at);
-- The approval queue and the dashboard's pending count both read this.
CREATE INDEX idx_part_orders_team_status ON part_orders(team_id, status);

-- Receipts attach to the ledger line they evidence. Nullable -- every existing
-- media row is a photo -- and SET NULL is unreachable in practice because the
-- transaction DELETE removes its receipt rows in the same batch.
ALTER TABLE media ADD COLUMN transaction_id
  TEXT REFERENCES transactions(id) ON DELETE SET NULL;

-- See the part-orders note above. 0 or 1, read on every request as part of the
-- membership row, flipped by a coach or mentor from the roster screen.
ALTER TABLE members ADD COLUMN is_purchase_approver INTEGER NOT NULL DEFAULT 0;

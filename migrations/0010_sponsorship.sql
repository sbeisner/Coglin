-- Sponsorship campaigns (COG-0xx, finance phase 2).
--
-- Phase 1 gave the team a ledger. This gives them the side that fills it: a
-- campaign with a goal and tiers, pitch copy the students write themselves, a
-- pipeline of businesses to approach, and the sponsors that come out the other
-- end -- including whether anybody has thanked them, which is a thing FIRST
-- actually asks about and a thing teams actually forget.
--
--
-- COGLIN TRACKS MONEY, IT DOES NOT MOVE MONEY.
--
-- Worth stating in the schema because the shape below could be mistaken for a
-- donation platform. There is no payment processing here, no card, no
-- fiscal-sponsorship relationship. `sponsors.amount_cents` is a PROMISE
-- somebody made in a conversation, and a row in `transactions` is a record
-- that a cheque arrived. Both are bookkeeping. A competitor offers real
-- 501(c)(3) backing and that is a genuinely different product -- the copy on
-- the sponsors screen says so, and this comment exists so the next person to
-- extend these tables does not quietly drift toward implying otherwise.
--
--
-- WHY `sponsors` IS DROPPED AND REBUILT:
--
-- 0001 guessed at this table before the feature was designed -- name, free-text
-- tier, amount, thanked_at, no authorship, no timestamps -- and nothing has
-- ever read or written it. Same situation as `budget_lines` in 0009, same
-- resolution: an empty table with no callers can be replaced outright rather
-- than rebuilt through the 0006 rename dance. The replacement keeps the four
-- fields that were right and adds the ones the feature needs.
--
--
-- CONTACT DETAILS ON PROSPECTS: A DELIBERATE EXCEPTION, ARGUED HERE.
--
-- This codebase has a standing rule that email addresses are not stored --
-- 0002 says an invite recipient's address is used once and forgotten, and
-- worker/lib/email.ts refuses to log one. THAT RULE PROTECTS STUDENTS. Users
-- are 12-18, `users.email` is NULL for minors by design, and a student's
-- address existing in a second place is a second place it can leak from.
--
-- `sponsor_prospects.contact_name` / `contact_email` / `contact_phone` are a
-- different category and are stored on purpose. They describe an ADULT acting
-- for a BUSINESS -- the parts manager at a machine shop the team wants to
-- approach -- entered deliberately by the team as the answer to "who do we
-- call". A pipeline without that is half a pipeline: the team keeps it in a
-- spreadsheet instead, which is neither safer nor shared.
--
-- The rules that make it an exception rather than a hole:
--
--   * These columns NEVER join to `users` or `members`, and no FK invites it.
--     A sponsor contact is not a Coglin account and must not become one by
--     accident.
--   * No route logs them, the same discipline worker/lib/email.ts applies to
--     recipients. They cross the API boundary and land in D1, nowhere else.
--   * They ride the nightly R2 dump like every other table (worker/backup.ts
--     enumerates sqlite_master), which is worth knowing rather than
--     discovering.
--
-- Phase 3's newsletter recipients are the same category and will likely grow
-- from these rows. That is the reason to get the boundary stated now.
--
--
-- PLEDGED IS NOT PAID, and the schema refuses to conflate them.
--
-- `sponsors.amount_cents` is what was promised. What actually arrived is the
-- SUM of `transactions` rows pointing at that sponsor. So the money linkage is
-- a column on the ledger line (`transactions.sponsor_id`) and NOT a pointer on
-- the sponsor: a $1,500 sponsor paying in two cheques is ordinary, and the
-- guarded-pointer trick 0009 uses for mark-ordered is for actions that must
-- happen exactly once. Recording a payment is not one of those. Committing a
-- prospect is, and that one does get the pointer -- see `sponsor_id` below.
--
-- Money is INTEGER cents. Timestamps are epoch SECONDS. No triggers -- the
-- Worker writes `updated_at`, per the rule in 0003.

DROP INDEX idx_sponsors_team_season;
DROP TABLE sponsors;

-- A campaign is one fundraising push: "2026 season sponsorship drive". Most
-- teams will have exactly one per season, which is why creating one asks for
-- two fields and nothing else.
CREATE TABLE sponsorship_campaigns (
  id          TEXT PRIMARY KEY,             -- uuid v4
  team_id     TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id   TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  -- Required. A progress bar with no denominator is decoration, and "how close
  -- are we" is the question this screen exists to answer.
  goal_cents  INTEGER NOT NULL,
  -- The pitch, as ProseMirror JSON -- the same storage contract note_docs uses
  -- (0006), for the same reasons: stored inert, validated against a node
  -- allowlist server-side, never HTML. `pitch_text` is the server's plain-text
  -- projection and the client never writes it. See worker/lib/notes.ts
  -- parseContent, which this reuses verbatim.
  pitch       TEXT NOT NULL,
  pitch_text  TEXT NOT NULL DEFAULT '',
  -- Compare-and-swap counter, exactly as note_docs.rev. Two students editing
  -- the pitch the night before a deadline is the case that matters.
  rev         INTEGER NOT NULL DEFAULT 0,
  created_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
  updated_by  TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_sponsorship_campaigns_team
  ON sponsorship_campaigns(team_id, season_id);

-- What a sponsor gets for what they give. Per campaign, because the tiers are
-- part of the pitch rather than a property of the season.
CREATE TABLE sponsorship_tiers (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  campaign_id  TEXT NOT NULL REFERENCES sponsorship_campaigns(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,               -- "Gold", capped 100
  amount_cents INTEGER NOT NULL,
  benefits     TEXT,                        -- plain text, capped 500
  -- Sparse, POSITION_GAP apart, like tasks and note docs. Reordering three to
  -- six rows is a renumber rather than a midpoint calculation, but the sparse
  -- convention costs nothing and keeps one ordering idiom in the codebase.
  position     INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_sponsorship_tiers_campaign
  ON sponsorship_tiers(team_id, campaign_id, position);

-- A business the team means to approach, and how far that has got.
CREATE TABLE sponsor_prospects (
  id               TEXT PRIMARY KEY,
  team_id          TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id        TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  -- Required, and CASCADE. A prospect exists because a campaign is asking for
  -- money; an unattached one would have no pitch and no tiers to offer.
  campaign_id      TEXT NOT NULL REFERENCES sponsorship_campaigns(id) ON DELETE CASCADE,
  org_name         TEXT NOT NULL,           -- capped 200
  -- The argued exception. See the header. Never joined to users or members,
  -- never logged.
  contact_name     TEXT,                    -- capped 120
  contact_email    TEXT,                    -- capped 200
  contact_phone    TEXT,                    -- free text, capped 40
  url              TEXT,                    -- http(s) only, capped 500
  note             TEXT,                    -- capped 1000
  -- researching | contacted | pitched | committed | declined
  --
  -- 'pitched' rather than 'meeting': `meeting` is already a table, a route, a
  -- nav section and a CandidateSourceType in this codebase, and a fifth
  -- meaning would make every read of the word ambiguous.
  --
  -- 'committed' can be HELD by a row but is not settable through the ordinary
  -- stage edit -- it means a sponsor record exists, so only the commit route
  -- writes it. worker/routes/sponsorship.ts enforces that.
  stage            TEXT NOT NULL DEFAULT 'researching',
  pledged_cents    INTEGER,                 -- unknown until the conversation gets there
  tier_id          TEXT REFERENCES sponsorship_tiers(id) ON DELETE SET NULL,
  -- manual | ai. 'ai' is reserved for the prospect-research feature and is
  -- never accepted from a request body -- a client cannot claim a row was
  -- found by the model.
  source           TEXT NOT NULL DEFAULT 'manual',
  -- ONE pair, not a stamp per stage. The pipeline records where a conversation
  -- currently stands, not an approval trail -- only the latest move matters,
  -- and the provenance of the one transition that creates state (commit) lives
  -- on the sponsor row it creates.
  stage_changed_by TEXT REFERENCES members(id) ON DELETE SET NULL,
  stage_changed_at INTEGER,
  -- The promote pointer, same shape as meeting_action_items.task_id and
  -- part_orders.transaction_id: committing is exactly-once, and the guard
  -- `AND sponsor_id IS NULL` on the UPDATE is what makes a double press a 409
  -- instead of two sponsors. SET NULL so deleting the sponsor reopens the
  -- question rather than deleting the prospect that asked it.
  sponsor_id       TEXT REFERENCES sponsors(id) ON DELETE SET NULL,
  created_by       TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);
CREATE INDEX idx_sponsor_prospects_campaign
  ON sponsor_prospects(team_id, campaign_id, stage);

-- Somebody who said yes. The replacement for 0001's guess.
CREATE TABLE sponsors (
  id           TEXT PRIMARY KEY,
  team_id      TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id    TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  -- SET NULL rather than CASCADE: the cheque outlives the campaign that landed
  -- it, the same way the ledger outlives whoever typed the line.
  campaign_id  TEXT REFERENCES sponsorship_campaigns(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,               -- capped 200
  -- Two columns on purpose. `tier_id` is the live link, for "which tier
  -- actually sells". `tier_name` is a SNAPSHOT of what was promised at the
  -- moment they committed: renaming Gold to Platinum next season, or deleting
  -- the tier, must not rewrite what this sponsor was told they were buying.
  -- Same argument as part_orders copying its item into the transaction label.
  tier_id      TEXT REFERENCES sponsorship_tiers(id) ON DELETE SET NULL,
  tier_name    TEXT,
  -- The PLEDGE. What arrived is SUM(transactions.amount_cents) for this
  -- sponsor -- see the header on why payment is not a pointer here.
  amount_cents INTEGER NOT NULL,
  -- FIRST asks what the team does for its sponsors, and a team that cannot say
  -- who it has thanked has usually not thanked them. Nullable: unthanked is
  -- the honest default and the screen shows it as work outstanding.
  thanked_at   INTEGER,
  thanked_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX idx_sponsors_team_season ON sponsors(team_id, season_id);

-- Which sponsor a ledger line came from, when it came from one. Nullable
-- because most income has no sponsor, and SET NULL because deleting a sponsor
-- must not delete the record that money arrived -- the route refuses that
-- delete while payments exist, and this is the second line of defence.
ALTER TABLE transactions ADD COLUMN sponsor_id
  TEXT REFERENCES sponsors(id) ON DELETE SET NULL;
CREATE INDEX idx_transactions_team_sponsor
  ON transactions(team_id, sponsor_id);

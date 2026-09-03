-- Sponsor updates: a contact list and the newsletters sent to it
-- (COG-0xx, finance phase 3).
--
-- The thing this closes: a team lands a sponsor in September and the sponsor
-- hears nothing until next September's ask. Sustain asks what a team does for
-- the people who fund it, and "we send them a season update" is only a real
-- answer if somebody actually writes one.
--
--
-- COGLIN DOES NOT SEND THESE. Read this before adding a cron.
--
-- There is no delivery in this migration and no delivery in the routes. A team
-- writes an update here, copies it out, and sends it from their own mail.
-- `scheduled_for` is a DUE DATE the screen nudges about -- nothing anywhere
-- flips a row to 'sent' on its own, because a status that says a sponsor was
-- emailed when no mail left the building is worse than no status at all. Only
-- a person pressing "mark sent" writes `sent_at`.
--
-- Two real blockers stand between this and actual sending, and both want their
-- own commit:
--
--   1. Nothing renders ProseMirror JSON to HTML. `src/lib/docText.ts` has
--      toMarkdown and that is the whole of it, so the copy-out path is text.
--      An HTML mail needs a server-side serialiser with the same escaping
--      discipline worker/lib/email.ts already applies.
--   2. Images in a body resolve to `/media/:id`, which is auth-gated
--      (worker/routes/media.ts). A sponsor opening that mail is not a member,
--      so every image would 401. Signed public URLs or inlined bytes, neither
--      of which exists.
--
-- When delivery does land it follows the email.ts contracts -- return a
-- boolean, never throw, and never log a recipient address or a body.
--
--
-- THE CONTACT LIST IS AN OPT-IN STORE, and that is the whole of its design.
--
-- 0010 argued why a prospect may carry an adult business contact's email: it
-- is outreach data about an organisation, entered deliberately, and it never
-- joins to `users` or `members`. This table is the same category one step on --
-- the people a team means to actually mail -- so it carries the same rules
-- plus one more:
--
--   * `subscribed_at` gates everything. A row with NULL there is a contact the
--     team knows about and may not mail. The copy-out path only ever offers
--     subscribed addresses.
--   * `unsubscribed_at` is kept rather than cleared. Somebody who asked to be
--     taken off a list must not be silently put back on it by the next
--     one-click import, and the only way to know that is to remember they
--     left.
--   * STUDENTS CANNOT APPEAR HERE. Not by policy -- structurally. There is no
--     FK to users or members, nothing copies `users.email` in (it is NULL for
--     minors anyway), and the only writers are the routes below, which take an
--     address from a form. A student's address has no path into this table.
--
-- Season-scoped, like everything else in this app. Rolling into a new season
-- means importing the list again, which is the right friction: an opt-in from
-- two seasons ago is not consent anybody should be relying on.
--
-- Money is INTEGER cents (none here). Timestamps are epoch SECONDS. No
-- triggers -- the Worker writes updated_at, per 0003.

CREATE TABLE external_contacts (
  id              TEXT PRIMARY KEY,            -- uuid v4
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id       TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  -- Nullable: a contact may be a person rather than a business (a parent who
  -- runs the concession stand, a retired mentor who still reads the updates).
  org_name        TEXT,                        -- capped 200
  contact_name    TEXT,                        -- capped 120
  -- The point of the row. Adult, entered deliberately, never a student's.
  email           TEXT NOT NULL,               -- capped 200
  note            TEXT,                        -- capped 500
  -- Non-null means "may be mailed". See the header.
  subscribed_at   INTEGER,
  subscribed_by   TEXT REFERENCES members(id) ON DELETE SET NULL,
  -- Remembered on purpose, so an import cannot re-add somebody who left.
  unsubscribed_at INTEGER,
  -- Provenance when the row came from the sponsor list rather than a form.
  sponsor_id      TEXT REFERENCES sponsors(id) ON DELETE SET NULL,
  created_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
-- One row per address per season. The import relies on this to be idempotent,
-- and a list that mails somebody twice is a list nobody trusts.
CREATE UNIQUE INDEX idx_external_contacts_email
  ON external_contacts(team_id, season_id, email);
CREATE INDEX idx_external_contacts_team
  ON external_contacts(team_id, season_id);

CREATE TABLE newsletters (
  id              TEXT PRIMARY KEY,            -- uuid v4
  team_id         TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  season_id       TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,               -- capped 200
  -- Same storage contract as note_docs (0006) and campaign pitches (0010):
  -- ProseMirror JSON validated against a node allowlist server-side, never
  -- HTML, with a server-derived plain-text projection beside it. `body_text`
  -- is what the copy-out path reads and what a future search would index.
  body            TEXT NOT NULL,
  body_text       TEXT NOT NULL DEFAULT '',
  rev             INTEGER NOT NULL DEFAULT 0,  -- CAS counter
  -- draft | scheduled | sent
  --
  -- 'sent' is written ONLY by the mark-sent route, never by an ordinary edit
  -- and never by a background job -- same shape as 'committed' on
  -- sponsor_prospects, for the same reason: it asserts something happened in
  -- the world.
  status          TEXT NOT NULL DEFAULT 'draft',
  -- When the team INTENDS to send. A nudge, not an instruction.
  scheduled_for   INTEGER,
  sent_at         INTEGER,
  sent_by         TEXT REFERENCES members(id) ON DELETE SET NULL,
  -- How many subscribed contacts existed at the moment it was marked sent.
  -- A snapshot rather than a live count, because the list keeps changing and
  -- "it went to 14 people" is a fact about that day.
  recipient_count INTEGER,
  created_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
  updated_by      TEXT REFERENCES members(id) ON DELETE SET NULL,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL
);
CREATE INDEX idx_newsletters_team
  ON newsletters(team_id, season_id, created_at);

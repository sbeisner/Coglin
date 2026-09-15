-- Password recovery (COG-051).
--
-- Three flows share this one table: a coach resetting a student from the
-- roster, an adult asking for their own reset from the login screen, and the
-- link each of those mails out. The row is what makes that link redeemable
-- exactly once.
--
-- THERE IS NO EMAIL COLUMN, AND THAT IS DELIBERATE — the same refusal as
-- `invites`, for the same reason, and it matters more here. A student has no
-- address on file at all (users.email is NULL for everyone who arrived by
-- invite), so the coach types one into the reset dialog; it is passed straight
-- to the mailer and dropped. Never bound into a statement, never logged.
-- See the header of 0002_invites.sql for the full argument.
--
-- The cost is the same accepted one: no "sent to jane@..." in the UI, no
-- one-click resend. The dialog compensates by showing the coach a copyable
-- link, so a mail that never arrives is never a dead end.

CREATE TABLE password_resets (
  -- SHA-256 of the raw token (peppered), same trick as `sessions` and
  -- `invites`: the value in the emailed URL is never what is stored, so a D1
  -- leak yields no live links.
  id                   TEXT PRIMARY KEY,
  user_id              TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Both NULL for a self-serve request from the login screen: there is no
  -- acting member and no tenant context there, only somebody who proved they
  -- hold the address on a users row. Set for a coach-initiated reset, which is
  -- how that path is rate-limited per team.
  team_id              TEXT REFERENCES teams(id) ON DELETE CASCADE,
  created_by_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  -- 'coach' or 'self', frozen at creation. Needed precisely BECAUSE
  -- created_by_member_id is SET NULL-able: once a departed mentor's member row
  -- is gone, a coach-initiated row would otherwise be indistinguishable from a
  -- self-serve one, and "who reset this child's password" is the one question
  -- this table exists to answer.
  kind                 TEXT NOT NULL,
  created_at           INTEGER NOT NULL,
  expires_at           INTEGER NOT NULL,
  -- Burned on redemption, and also when a newer reset supersedes this one --
  -- which is the remedy for a coach sending the link to a mistyped address.
  -- NULL means still live; see routes/passwords.ts for why the burn is its own
  -- statement rather than part of the batch.
  used_at              INTEGER
);

-- Serves the per-user rate limit and the "is this link live" read.
CREATE INDEX idx_password_resets_user ON password_resets(user_id, created_at);
-- team_id first, per the tenancy rule: the per-team rate-limit count is a
-- tenant-scoped read and must not scan other teams' rows.
CREATE INDEX idx_password_resets_team ON password_resets(team_id, created_at);
-- The global bound on the public /forgot path, which has no tenant to scope to.
CREATE INDEX idx_password_resets_created ON password_resets(created_at);

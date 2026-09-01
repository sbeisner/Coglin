-- In-app bug reports for the alpha (COG-0xx).
--
-- The alpha ships to other FTC teams in September and every one of them is a
-- volunteer coach with a season to run. The gap this closes is not "we have no
-- bug tracker" -- it is that reporting currently costs a tester a context
-- switch. Find an address, describe where you were, guess what we need to know.
-- Nobody does that at 9pm in build season. They shrug, work around it, and we
-- never hear about the thing that would have taken ten minutes to fix. A button
-- that already knows the route, the build and the reporter is the difference
-- between hearing about a bug and not.
--
--
-- THIS IS A TENANT TABLE, and unlike `purchases` it gets to be one. Only a
-- signed-in member can file, so there is a membership row to resolve team_id
-- from and the rule in worker/lib/tenancy.ts applies unchanged. Nothing in the
-- request names a team, and no self-reported team string appears below.
--
--
-- WHAT THE CASCADE COSTS:
--
-- team_id cascades, so deleting a team takes its bug reports with it. That is
-- the wrong direction for us -- a report is about the PRODUCT and stays useful
-- long after the reporter is gone -- and it is accepted anyway, because the
-- durable copy of every report is the mail that leaves for the operator inbox
-- the moment the row commits. This table is the queryable copy, not the archive
-- of record. The alternative, a bare team_id with no FK the way purchases does
-- it, buys survival at the price of being the one application table that can
-- hold a dangling tenant. That is a worse thing to have in this schema than a
-- lost row.
--
--
-- WHY DIAGNOSTICS ARE PART COLUMN AND PART BLOB:
--
-- route, app_build, user_agent and the viewport are the four axes triage
-- actually sorts on -- "only on phones", "only since Tuesday's deploy", "only
-- on the notes screen" -- so they get columns. Everything else goes in
-- client_meta as JSON, because the honest forecast is that week two of the
-- alpha teaches us three more things worth capturing, and a blob makes that a
-- client change while a column makes it a migration. Migrations here are
-- append-only and ALTER TABLE has rules (see 0003), so the blob is the cheaper
-- end of a real trade rather than laziness.
--
-- THE BLOB IS SERVER-BUILT FROM A FIXED KEY LIST. worker/routes/bugs.ts never
-- writes the client's object through. A column that stores whatever the browser
-- sent is a free storage bucket for any signed-in student who opens devtools.
--
--
-- WHAT IS DELIBERATELY NOT CAPTURED:
--
-- No screenshot, no DOM capture, no page contents, no IP address. Users are
-- 12-18 and the notes screen holds a student's own writing. A screenshot
-- pipeline would ship that writing to an operator inbox because a button was in
-- reach, and the reporter would have no way to know what they had sent. The
-- dialog shows the reporter every field on this row before they press send,
-- which is only a meaningful promise while the list stays short enough to
-- read. Keep it short.
--
-- `body` IS FREE TEXT WRITTEN BY A MINOR and lands in the nightly R2 dump --
-- worker/backup.ts enumerates sqlite_master, so this table is included with no
-- code change. Same exposure the notes already carry, written down here so it
-- is not a surprise to whoever finds it later.
--
--
-- `status` has no UI and is not getting one during the alpha. It is here so
-- triage happens against a column rather than against a mailbox, and so the
-- second report of a bug can be pointed at the first. A screen for it later is
-- cheap. The column later is a migration.
--
-- All timestamps are epoch SECONDS (INTEGER), as everywhere else.

CREATE TABLE bug_reports (
  id                    TEXT PRIMARY KEY,      -- uuid v4
  team_id               TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  -- SET NULL, not CASCADE: a student leaving the team must not delete the
  -- report that got a bug fixed for everyone else.
  reported_by_member_id TEXT REFERENCES members(id) ON DELETE SET NULL,
  -- Frozen at file time. Roles change over a season, and the role at the moment
  -- of the report is the triage signal, not the role today.
  role                  TEXT NOT NULL,         -- coach | mentor | student | viewer
  kind                  TEXT NOT NULL DEFAULT 'bug', -- bug | confusing | idea
  body                  TEXT NOT NULL,         -- what they typed, capped at 4000
  route                 TEXT,                  -- '/app/notes/<id>', pathname + search
  app_build             TEXT,                  -- __BUILD_ID__ from the bundle
  environment           TEXT,                  -- server-side, never client-reported
  user_agent            TEXT,
  viewport_w            INTEGER,
  viewport_h            INTEGER,
  -- JSON object, built server-side from a fixed key list. See the header.
  client_meta           TEXT NOT NULL DEFAULT '{}',
  -- Set to 1 only after Resend accepts. `WHERE emailed = 0` is how you find the
  -- reports the mail never carried -- the API key is shared with Inkubus (see
  -- worker/lib/email.ts), so rotating it there stops Coglin mail here.
  emailed               INTEGER NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'new', -- new | triaged | fixed | wontfix
  created_at            INTEGER NOT NULL,
  triaged_at            INTEGER
);

-- team_id first, per the tenancy rule. This is also the index the per-hour rate
-- limit in routes/bugs.ts reads, which is the only query this table has in the
-- request path.
CREATE INDEX idx_bug_reports_team ON bug_reports(team_id, created_at);

-- The human query: "what is open, oldest first". Not tenant-scoped, because the
-- only reader is a person with a wrangler shell rather than a request.
CREATE INDEX idx_bug_reports_status ON bug_reports(status, created_at);

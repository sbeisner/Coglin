#!/usr/bin/env node
/**
 * Fabricated data for the marketing screenshots (COG-049).
 *
 * WHY THIS EXISTS AND WHY IT IS NOT IN THE APP BUNDLE
 *
 * `src/lib/api.ts` bans sample data from the client, and it is right to: the
 * first attempt hid fixtures behind a build-time flag, Rollup could not prove
 * the module side-effect free, and the sample season shipped anyway — one flag
 * away from a real team's dashboard. Nothing here is imported by the app. This
 * writes SQL, a human applies it to a LOCAL database, screenshots get taken of
 * the real UI, and the only thing that reaches production is a PNG.
 *
 * WHY THE DATA IS INVENTED
 *
 * The obvious shortcut is to screenshot the alpha team. Their season is nine
 * real people, six of them minors, and their names, attendance record and
 * meeting notes are not marketing assets. Everything below is made up: the team
 * does not exist, and the students are first-name-plus-initial the way the
 * roster screen is meant to be used.
 *
 * ONLY SCREENS THAT WORK
 *
 * Seeds boards, meetings, notes, roster and portfolio. It deliberately does NOT
 * seed outreach, award criteria or budget: those screens are stubs
 * (`src/lib/nav.ts` marks them `stub: true`) and a screenshot of one would be a
 * claim the rest of the site spends its time refusing to make.
 *
 * Usage:
 *   node scripts/seed-demo.mjs --out demo.sql
 *   npx wrangler d1 execute coglin-staging --local --file demo.sql
 *
 * Then sign in as demo@example.invalid with the password in DEMO_PASSWORD.
 *
 * LOCAL ONLY. It emits DELETEs for the demo team first so it is re-runnable,
 * and it scopes every one of them to the demo team id — but pointing this at
 * --remote would still write invented rows into a real database, so do not.
 */
import { writeFileSync } from 'node:fs';
import { pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * The same PBKDF2-HMAC-SHA256 shape `worker/lib/crypto.ts` writes:
 * `pbkdf2$<iters>$<salt_b64>$<hash_b64>`, 100k iterations, 32-byte key.
 * Generated here rather than hardcoded so nothing that looks like a real
 * credential sits in the repo — the account only ever exists in a local D1.
 */
function hashPassword(password) {
  const iterations = 100_000;
  const salt = randomBytes(16);
  const hash = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  return `pbkdf2$${iterations}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

/** Local-only, and the capture script signs in with it. */
const DEMO_PASSWORD = 'screenshot demo only';

const outIndex = process.argv.indexOf('--out');
const outFile = outIndex === -1 ? null : process.argv[outIndex + 1];

// Fixed ids so re-running replaces rather than accumulates, and fixed
// timestamps so a screenshot taken today matches one taken next month.
const TEAM = 'demo-team-0000';
const SEASON = 'demo-season-0000';
const USER = 'demo-user-0000';

/**
 * Anchored to the real clock, not a fixed date.
 *
 * The first version pinned everything to a Tuesday in November so screenshots
 * would be reproducible. That was wrong: the app renders "days until", "week N"
 * and the calendar's default month from the actual Date.now(), so pinned data
 * drifts out of sense the moment you look at it from a different week. Seeded
 * relative to now, the calendar always has meetings on it and the dashboard
 * always has a next one.
 */
const NOW = Math.floor(Date.now() / 1000);
const DAY = 86400;

/** The season the app itself would resolve for today — see routes/auth.ts. */
function currentSeason(now) {
  const d = new Date(now * 1000);
  const year = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 7 ? year : year - 1;
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    starts_at: Math.floor(Date.UTC(startYear, 8, 1) / 1000),
    ends_at: Math.floor(Date.UTC(startYear + 1, 4, 31, 23, 59, 59) / 1000),
  };
}
const SEASON_INFO = currentSeason(NOW);

const q = (v) =>
  v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`;
const n = (v) => (v === null || v === undefined ? 'NULL' : String(v));

const rows = [];
const out = (sql) => rows.push(sql);

// ---------------------------------------------------------------- teardown
// Scoped to the demo team, so running this against a database that also holds
// something real cannot reach it. Order respects the foreign keys.
for (const t of [
  'meeting_attendance', 'meeting_agenda_items', 'meeting_action_items',
  'portfolio_candidates', 'note_docs', 'meetings', 'meeting_series',
  'tasks', 'boards', 'portfolio_pages', 'media', 'members', 'seasons',
]) out(`DELETE FROM ${t} WHERE team_id = ${q(TEAM)};`);
out(`DELETE FROM teams WHERE id = ${q(TEAM)};`);
// LIKE, not equality: the roster's provisioned students are `${USER}-<n>`, and
// deleting only the coach left them behind, so a second run collided on
// users.id. The prefix is unique to this script.
out(`DELETE FROM users WHERE id LIKE ${q(USER + '%')};`);

// ------------------------------------------------------------------ tenant
// 99999 is outside the range FIRST actually issues, so nobody can mistake the
// screenshots for a real team's season. Local databases often already hold a
// 9999 "Test Team", and team_number is UNIQUE.
out(`INSERT INTO teams (id, team_number, name, region, timezone, created_at)
  VALUES (${q(TEAM)}, 99999, 'Cog Goblins', 'Maryland', 'America/New_York', ${n(NOW - 120 * DAY)});`);
out(`INSERT INTO seasons (id, team_id, label, starts_at, ends_at, is_current)
  VALUES (${q(SEASON)}, ${q(TEAM)}, ${q(SEASON_INFO.label)},
    ${n(SEASON_INFO.starts_at)}, ${n(SEASON_INFO.ends_at)}, 1);`);

// The coach account the capture script signs in as.
out(`INSERT INTO users (id, email, password_hash, is_minor, created_at, updated_at)
  VALUES (${q(USER)}, 'demo@example.invalid', ${q(hashPassword(DEMO_PASSWORD))}, 0, ${n(NOW - 120 * DAY)}, ${n(NOW - 120 * DAY)});`);

// ------------------------------------------------------------------ roster
// First name plus initial, which is how the roster screen is meant to be used
// and what the COPPA posture in plan §6 asks for.
const MEMBERS = [
  ['m-coach', 'coach',   'Dana W.',   null,      ['build']],
  ['m-men1',  'mentor',  'Raj P.',    null,      ['programming', 'cad']],
  ['m-men2',  'mentor',  'Elena S.',  null,      ['business']],
  ['m-stu1',  'student', 'Maya R.',   'mayar',   ['build', 'drive']],
  ['m-stu2',  'student', 'Devon K.',  'devonk',  ['programming']],
  ['m-stu3',  'student', 'Ari L.',    'aril',    ['cad']],
  ['m-stu4',  'student', 'Nia T.',    'niat',    ['outreach', 'business']],
  ['m-stu5',  'student', 'Jonah B.',  'jonahb',  ['build']],
  ['m-stu6',  'student', 'Priya N.',  'priyan',  ['portfolio', 'outreach']],
  ['m-stu7',  'student', 'Sam O.',    'samo',    ['programming', 'drive']],
];
MEMBERS.forEach(([id, role, name, handle, subs], i) => {
  // Only the coach is attached to the login user; students exist as roster rows
  // with their own provisioned users, which is what the app really does.
  const uid = role === 'coach' ? USER : `${USER}-${i}`;
  if (role !== 'coach') {
    out(`INSERT INTO users (id, email, password_hash, is_minor, created_at, updated_at)
      VALUES (${q(uid)}, NULL, 'x', ${role === 'student' ? 1 : 0}, ${n(NOW - 110 * DAY)}, ${n(NOW - 110 * DAY)});`);
  }
  out(`INSERT INTO members (id, team_id, user_id, role, sub_teams, display_name, handle, status, created_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(uid)}, ${q(role)}, ${q(JSON.stringify(subs))}, ${q(name)}, ${q(handle)}, 'active', ${n(NOW - (110 - i) * DAY)});`);
});

// ------------------------------------------------------------------ boards
// Named for the work rather than the sub-team, because the board tab renders
// the sub-team as a badge beside the name -- identical values photograph as
// "Build Build". Real teams name boards this way anyway.
const BOARDS = [
  ['b-build', 'Chassis & intake', 'build', 0],
  ['b-prog', 'Autonomous', 'programming', 1],
  ['b-cad', 'CAD & renders', 'cad', 2],
  ['b-out', 'Outreach & sponsors', 'business', 3],
];
BOARDS.forEach(([id, name, sub, pos]) =>
  out(`INSERT INTO boards (id, team_id, season_id, name, sub_team, position)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(name)}, ${q(sub)}, ${n(pos)});`));

// The decision log on the intake task is the one the whole site argues for, so
// it is the task the Boards screenshot opens.
const TASKS = [
  ['t-1', 'b-build', 'Rebuild the intake for two samples', 'Current version jams when two samples arrive together.', 'm-stu1', 'doing', NOW + 3 * DAY,
   'Tried compliant wheels first and they slipped on the second sample every time. Switched to a wider roller with softer durometer, which cleared both but ate 40mm of width we needed for the arm. Third pass moved the roller back 15mm and narrowed the plate. Holding for now.'],
  ['t-2', 'b-build', 'Cut and mount the new side plates', null, 'm-stu5', 'todo', NOW + 5 * DAY, null],
  ['t-3', 'b-build', 'Replace the worn odometry pod bearing', null, 'm-stu1', 'done', NOW - 4 * DAY, null],
  ['t-12', 'b-build', 'Re-tension the drive belts', null, 'm-stu5', 'todo', NOW + 8 * DAY, null],
  ['t-13', 'b-build', 'Source 35A rollers (backordered)', 'Supplier says three weeks.', 'm-coach', 'blocked', NOW + 14 * DAY, null],
  ['t-14', 'b-build', 'Print the new intake side brackets', null, 'm-stu3', 'doing', NOW + 2 * DAY, null],
  ['t-15', 'b-build', 'Weigh the robot with the new plates', null, 'm-stu1', 'todo', NOW + 10 * DAY, null],
  ['t-16', 'b-build', 'Swap to the 20:1 gearboxes', null, 'm-stu5', 'done', NOW - 11 * DAY, null],
  ['t-4', 'b-prog', 'Autonomous: park after the high basket cycle', 'Currently overruns by about 200ms.', 'm-stu2', 'doing', NOW + 2 * DAY,
   'Timed loop was drifting under load. Moved to encoder targets rather than sleep, which fixed the overrun but made the first cycle jerky. Adding a ramp.'],
  ['t-5', 'b-prog', 'Log match telemetry to a file', null, 'm-stu7', 'todo', NOW + 9 * DAY, null],
  ['t-6', 'b-prog', 'Tune the arm PID after the gearbox swap', null, 'm-stu2', 'todo', null, null],
  ['t-7', 'b-cad', 'Model the revised intake in OnShape', null, 'm-stu3', 'doing', NOW + 4 * DAY, null],
  ['t-8', 'b-cad', 'Render the drivetrain for portfolio page 6', null, 'm-stu3', 'todo', NOW + 12 * DAY, null],
  ['t-9', 'b-out', 'Write up the library STEM night', 'About 60 people, mostly K-5.', 'm-stu4', 'done', NOW - 9 * DAY, null],
  ['t-10', 'b-out', 'Send thank-you letters to sponsors', null, 'm-stu6', 'todo', NOW + 7 * DAY, null],
  ['t-11', 'b-out', 'Draft the sustainability plan section', null, 'm-men2', 'doing', NOW + 6 * DAY, null],
];
TASKS.forEach(([id, board, title, body, assignee, status, due, log], i) =>
  out(`INSERT INTO tasks (id, team_id, board_id, title, body, assignee_member_id, status, due_at, position, decision_log, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(board)}, ${q(title)}, ${q(body)}, ${q(assignee)}, ${q(status)}, ${n(due)}, ${n((i + 1) * 1024)}, ${q(log)}, ${n(NOW - 20 * DAY)}, ${n(NOW - 2 * DAY)});`));

// ---------------------------------------------------------------- meetings
// Tuesdays and Thursdays through the season, which is what the calendar grid
// is for. Past ones are 'done' so the month view shows both states.
const meetingIds = [];
let slot = 0;
for (let d = -35; d <= 56; d += 1) {
  const ts = NOW + d * DAY;
  const dow = new Date(ts * 1000).getUTCDay();
  if (dow !== 2 && dow !== 4) continue;
  const id = `mtg-${slot}`;
  meetingIds.push([id, ts, d]);
  const status = d < 0 ? 'done' : 'planned';
  out(`INSERT INTO meetings (id, team_id, season_id, starts_at, ends_at, title, location, kind, status, attendees, series_slot, created_by, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${n(ts)}, ${n(ts + 7200)}, 'Build night', 'Room 114', 'build', ${q(status)}, '[]', ${n(slot)}, ${q('m-coach')}, ${n(NOW - 100 * DAY)}, ${n(ts)});`);
  slot += 1;
}

// Agenda + attendance on the most recent completed meeting only. Seeding all
// ninety would be slower and no more convincing in a screenshot.
const recent = [...meetingIds].reverse().find(([, , d]) => d < 0);
if (recent) {
  const [mid] = recent;
  [['Intake redesign: where we landed', 'm-stu1', 15],
   ['Auton park timing', 'm-stu2', 10],
   ['Portfolio pages 4-6 owners', 'm-stu6', 10],
   ['Qualifier logistics', 'm-coach', 5]].forEach(([title, owner, mins], i) =>
    out(`INSERT INTO meeting_agenda_items (id, team_id, meeting_id, position, title, owner_member_id, minutes_planned, done, created_by, created_at, updated_at)
      VALUES (${q(`ag-${i}`)}, ${q(TEAM)}, ${q(mid)}, ${n(i * 1024)}, ${q(title)}, ${q(owner)}, ${n(mins)}, ${n(i < 3 ? 1 : 0)}, ${q('m-coach')}, ${n(NOW)}, ${n(NOW)});`));

  MEMBERS.forEach(([mid2], i) => {
    const state = i === 4 ? 'absent' : i === 7 ? 'other' : 'present';
    out(`INSERT INTO meeting_attendance (id, team_id, meeting_id, member_id, state, note, recorded_by, recorded_at)
      VALUES (${q(`att-${i}`)}, ${q(TEAM)}, ${q(mid)}, ${q(mid2)}, ${q(state)}, ${q(state === 'other' ? 'Arrived after robotics club' : null)}, ${q('m-coach')}, ${n(NOW)});`);
  });
}

// ------------------------------------------------------------------- notes
const doc = (id, title, parent, meeting, pos, paras) => {
  const content = JSON.stringify({
    type: 'doc',
    content: paras.map((p) =>
      typeof p === 'string'
        ? { type: 'paragraph', content: [{ type: 'text', text: p }] }
        : { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: p.h }] }),
  });
  const text = paras.map((p) => (typeof p === 'string' ? p : p.h)).join('\n');
  out(`INSERT INTO note_docs (id, team_id, season_id, parent_doc_id, meeting_id, position, title, content, content_text, created_by, updated_by, created_at, updated_at, rev)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(parent)}, ${q(meeting)}, ${n(pos)}, ${q(title)}, ${q(content)}, ${q(text)}, ${q('m-stu1')}, ${q('m-stu1')}, ${n(NOW - 6 * DAY)}, ${n(NOW - 2 * DAY)}, 4);`);
};
const recentId = recent ? recent[0] : null;
doc('d-1', 'Intake redesign', null, recentId, 1024, [
  { h: 'What we tried' },
  'Compliant wheels, 45A. Cleared one sample reliably and jammed on the second about half the time.',
  'Wider roller at 35A cleared both, but it cost us 40mm across the front and the arm no longer fit.',
  { h: 'Where we landed' },
  'Roller moved back 15mm and the plate narrowed. Both samples clear and the arm fits with 6mm to spare. Jonah is cutting the new plates Thursday.',
]);
doc('d-2', 'Bearing failure, 3 Nov', 'd-1', recentId, 2048, [
  'Odometry pod bearing seized after roughly nine hours of drive practice. Replaced and added a check to the pre-match list.',
]);
doc('d-3', 'Auton: park timing', null, recentId, 3072, [
  'Overran the park by about 200ms under a loaded basket. Encoder targets instead of a timed loop fixed it.',
]);
doc('d-4', 'Sustainability plan draft', null, null, 4096, [
  { h: 'Where the money comes from' },
  'Two returning sponsors, the school activity fund, and the spring parts sale.',
]);

// ------------------------------------------------------- portfolio inbox
// What /app/portfolio actually shows today: things flagged during the season,
// waiting to be sorted into awards. Without these the screen is an honest but
// unphotogenic row of zeroes.
const CANDIDATES = [
  ['pc-1', 'note_doc', 'd-1', 'think', 'The whole intake trade-off, written up the week it happened.', 'shortlisted'],
  ['pc-2', 'note_doc', 'd-3', 'control', 'Encoder targets vs a timed loop. Good autonomous detail.', 'candidate'],
  ['pc-3', 'task', 't-1', 'innovate', 'Three iterations on the roller, with why each one lost.', 'candidate'],
  ['pc-4', 'task', 't-9', 'reach', 'Library STEM night, about 60 people.', 'candidate'],
  ['pc-5', 'note_doc', 'd-4', 'sustain', 'Funding sources for the sustainability section.', 'candidate'],
];
CANDIDATES.forEach(([id, type, src, award, why, state], i) =>
  out(`INSERT INTO portfolio_candidates (id, team_id, season_id, source_type, source_id, suggested_award, why, state, flagged_by, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(type)}, ${q(src)}, ${q(award)}, ${q(why)}, ${q(state)}, ${q('m-stu6')}, ${n(NOW - (9 - i) * DAY)}, ${n(NOW - (9 - i) * DAY)});`));

// --------------------------------------------------------------- portfolio
const PAGES = [
  [1, 'Cover', null, 'done'], [2, 'Team introduction', 'm-stu6', 'done'],
  [3, 'Season plan', 'm-coach', 'done'], [4, 'Engineering process', 'm-stu1', 'drafting'],
  [5, 'Intake mechanism', 'm-stu1', 'drafting'], [6, 'Drivetrain', 'm-stu3', 'drafting'],
  [7, 'Autonomous', 'm-stu2', 'empty'], [8, 'Software architecture', 'm-stu7', 'empty'],
  [9, 'Testing and iteration', 'm-stu5', 'empty'], [10, 'Outreach', 'm-stu4', 'drafting'],
  [11, 'Connections', 'm-stu4', 'empty'], [12, 'Sustainability', 'm-men2', 'drafting'],
  [13, 'Budget', 'm-men2', 'empty'], [14, 'Team growth', 'm-stu6', 'empty'],
  [15, 'Looking ahead', 'm-coach', 'empty'],
];
PAGES.forEach(([no, title, owner, state]) =>
  out(`INSERT INTO portfolio_pages (id, team_id, season_id, page_no, title, owner_member_id, state)
    VALUES (${q(`pp-${no}`)}, ${q(TEAM)}, ${q(SEASON)}, ${n(no)}, ${q(title)}, ${q(owner)}, ${q(state)});`));

const sql = [
  '-- GENERATED by scripts/seed-demo.mjs. Invented data for marketing',
  '-- screenshots. LOCAL DATABASES ONLY. See the script header.',
  'PRAGMA foreign_keys = OFF;',
  ...rows,
  'PRAGMA foreign_keys = ON;',
  '',
].join('\n');

if (outFile) {
  writeFileSync(outFile, sql);
  console.error(`wrote ${outFile} (${rows.length} statements)`);
} else {
  process.stdout.write(sql);
}

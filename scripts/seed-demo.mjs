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
 * Seeds boards, meetings, notes, roster, portfolio and finance. It deliberately
 * does NOT seed outreach or award criteria: those screens are stubs
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
  'tasks', 'boards', 'portfolio_pages', 'media', 'part_orders',
  // Prospects point at sponsors, sponsors point at campaigns, and ledger
  // lines point at sponsors — so these come before `transactions`, which
  // comes before the tenant rows below.
  'newsletters', 'external_contacts', 'funds',
  'sponsor_prospects', 'sponsors', 'sponsorship_tiers', 'sponsorship_campaigns',
  'transactions', 'members', 'seasons',
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

// ------------------------------------------------------------------- funds
// Two pots, shaped exactly as the setup form leaves them: a carryover reserve
// (the default) and a district allocation that expires inside the warning
// window with money still in it — so a screenshot carries the alert. Each gets
// an opening-balance line, which is how remaining stays pure ledger math.
const FUND_RESERVE = 'fund-reserve';
const FUND_DISTRICT = 'fund-district';
const DISTRICT_EXPIRES = NOW + 45 * DAY;
out(`INSERT INTO funds (id, team_id, name, note, expires_at, is_default, created_by, created_at, updated_at)
  VALUES (${q(FUND_RESERVE)}, ${q(TEAM)}, 'Sponsorship & donations', ${q('Carries over — this is the team\'s own money.')}, NULL, 1, 'm-coach', ${n(NOW - 100 * DAY)}, ${n(NOW - 100 * DAY)});`);
out(`INSERT INTO funds (id, team_id, name, note, expires_at, is_default, created_by, created_at, updated_at)
  VALUES (${q(FUND_DISTRICT)}, ${q(TEAM)}, 'District allocation FY26', ${q('Use or lose — the district takes back whatever is unspent.')}, ${n(DISTRICT_EXPIRES)}, 0, 'm-coach', ${n(NOW - 100 * DAY)}, ${n(NOW - 100 * DAY)});`);

// ----------------------------------------------------------------- finance
// A season a Sustain judge would call accounted for: income up front,
// expenses through the build, and a part-order queue with a row in every
// state the screen can render. Amounts are plausible FTC numbers, not
// round ones — round numbers photograph as fake.
const TRANSACTIONS = [
  // [id, kind, category, label, note, cents, daysAgo, by]
  ['tx-1', 'income', 'sponsorship', 'Harbor Machine Works sponsorship', 'Gold tier, second season', 75000, 95, 'm-men2'],
  ['tx-2', 'income', 'grant', 'STEM booster grant', null, 50000, 88, 'm-coach'],
  ['tx-3', 'expense', 'registration', 'FTC season registration', null, 29500, 82, 'm-coach'],
  ['tx-4', 'income', 'fundraising', 'Car wash fundraiser', '11 cars, 4 students', 41500, 60, 'm-men2'],
  ['tx-5', 'expense', 'parts', 'REV starter kit restock', 'Order 48117', 31240, 52, 'm-coach'],
  ['tx-6', 'expense', 'tools', 'Metric hex driver set', null, 4599, 47, 'm-men2'],
  ['tx-7', 'income', 'sponsorship', 'Riverside Dental sponsorship', 'Silver tier', 25000, 33, 'm-men2'],
  ['tx-8', 'expense', 'outreach', 'Library demo table supplies', null, 6320, 21, 'm-coach'],
  ['tx-9', 'expense', 'food', 'Scrimmage day pizza', 'Team + volunteers', 9850, 12, 'm-coach'],
];
// Which pot each line came out of. Sponsorship income and the fundraiser go to
// the carryover reserve; registration and the parts spend come out of the
// district allocation. One expense is left unassigned on purpose, so the strip
// shows that state too.
const TX_FUND = {
  'tx-1': FUND_RESERVE, 'tx-2': FUND_DISTRICT, 'tx-3': FUND_DISTRICT,
  'tx-4': FUND_RESERVE, 'tx-5': FUND_DISTRICT, 'tx-6': null,
  'tx-7': FUND_RESERVE, 'tx-8': FUND_RESERVE, 'tx-9': FUND_RESERVE,
};
for (const [id, kind, category, label, note, cents, daysAgo, by] of TRANSACTIONS) {
  out(`INSERT INTO transactions (id, team_id, season_id, kind, category, label, note, amount_cents, occurred_at, fund_id, created_by, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(kind)}, ${q(category)}, ${q(label)}, ${q(note)}, ${n(cents)}, ${n(NOW - daysAgo * DAY)}, ${q(TX_FUND[id] ?? null)}, ${q(by)}, ${n(NOW - daysAgo * DAY)}, ${n(NOW - daysAgo * DAY)});`);
}

// The opening balances, as the setup form would have written them. Sized so
// the district pot still has money in it against its 45-day deadline — which
// is what puts the warning on the screen.
out(`INSERT INTO transactions (id, team_id, season_id, kind, category, label, note, amount_cents, occurred_at, fund_id, created_by, created_at, updated_at)
  VALUES ('tx-open-1', ${q(TEAM)}, ${q(SEASON)}, 'income', 'opening_balance', ${q('Sponsorship & donations — opening balance')}, ${q('What was in this fund when the team started using Coglin.')}, 84000, ${n(NOW - 100 * DAY)}, ${q(FUND_RESERVE)}, 'm-coach', ${n(NOW - 100 * DAY)}, ${n(NOW - 100 * DAY)});`);
out(`INSERT INTO transactions (id, team_id, season_id, kind, category, label, note, amount_cents, occurred_at, fund_id, created_by, created_at, updated_at)
  VALUES ('tx-open-2', ${q(TEAM)}, ${q(SEASON)}, 'income', 'opening_balance', ${q('District allocation FY26 — opening balance')}, ${q('What was in this fund when the team started using Coglin.')}, 95000, ${n(NOW - 100 * DAY)}, ${q(FUND_DISTRICT)}, 'm-coach', ${n(NOW - 100 * DAY)}, ${n(NOW - 100 * DAY)});`);

// The expense line the 'ordered' request below points at — the promote
// pattern, visible in a screenshot as "from a part order".
out(`INSERT INTO transactions (id, team_id, season_id, kind, category, label, note, amount_cents, occurred_at, fund_id, created_by, created_at, updated_at)
  VALUES ('tx-order', ${q(TEAM)}, ${q(SEASON)}, 'expense', 'parts', ${q('2× goBILDA 5203 servo')}, ${q('Ordered from goBILDA')}, 7998, ${n(NOW - 5 * DAY)}, ${q(FUND_DISTRICT)}, 'm-stu4', ${n(NOW - 5 * DAY)}, ${n(NOW - 5 * DAY)});`);

// Nia (business sub-team) holds the approver flag — the student-treasurer
// case the flag exists for.
out(`UPDATE members SET is_purchase_approver = 1 WHERE id = 'm-stu4' AND team_id = ${q(TEAM)};`);

const ORDERS = [
  // [id, item, desc, url, vendor, qty, cents, status, requester, extras]
  ['po-1', 'Odometry pod bearings', 'Left pod is grinding after the scrimmage', 'https://www.revrobotics.com/', 'REV Robotics', 4, 649, 'pending', 'm-stu2', {}],
  ['po-2', '18650 battery holder', null, null, 'Amazon', 1, 1299, 'pending', 'm-stu5', {}],
  ['po-3', 'goBILDA 5203 servo', 'Intake wrist — current one stripped', 'https://www.gobilda.com/', 'goBILDA', 2, 3999, 'ordered', 'm-stu1',
    { decided: 8, decidedBy: 'm-stu4', ordered: 5, orderedBy: 'm-stu4', transaction: 'tx-order' }],
  ['po-4', 'Polycarb sheet 1/8"', 'Full side panels instead of patching', null, 'McMaster-Carr', 1, 5825, 'denied', 'm-stu5',
    { decided: 15, decidedBy: 'm-coach', note: 'We have half a sheet left in the shop closet.' }],
];
for (const [id, item, desc, url, vendor, qty, cents, status, requester, x] of ORDERS) {
  out(`INSERT INTO part_orders (id, team_id, season_id, item, description, url, vendor, qty, unit_price_cents, status, requested_by, decided_by, decided_at, decision_note, ordered_by, ordered_at, transaction_id, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(item)}, ${q(desc)}, ${q(url)}, ${q(vendor)}, ${n(qty)}, ${n(cents)}, ${q(status)}, ${q(requester)},
      ${q(x.decidedBy ?? null)}, ${x.decided ? n(NOW - x.decided * DAY) : 'NULL'}, ${q(x.note ?? null)},
      ${q(x.orderedBy ?? null)}, ${x.ordered ? n(NOW - x.ordered * DAY) : 'NULL'}, ${q(x.transaction ?? null)},
      ${n(NOW - 16 * DAY)}, ${n(NOW - 5 * DAY)});`);
}

// ------------------------------------------------------------- sponsorship
// One campaign mid-season: two sponsors already in (the two 'sponsorship'
// income lines above are their payments), one prospect at each interesting
// stage, and one sponsor deliberately NOT thanked — the state the screen
// exists to make visible.
const CAMPAIGN = 'sc-1';
out(`INSERT INTO sponsorship_campaigns (id, team_id, season_id, name, goal_cents, pitch, pitch_text, rev, created_by, updated_by, created_at, updated_at)
  VALUES (${q(CAMPAIGN)}, ${q(TEAM)}, ${q(SEASON)}, ${q('2026 season sponsorship drive')}, 250000,
    ${q(JSON.stringify({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'The Cog Goblins are fifteen students from Chesapeake High building a competition robot from September to April. Last season we reached 340 people at seven community events and took a rookie team through their first qualifier.',
            },
          ],
        },
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'Sponsorship pays for parts, registration and travel — and it puts your name in front of every family at every event we attend. We will send you a season report in May showing exactly what your support built.',
            },
          ],
        },
      ],
    }))},
    ${q('The Cog Goblins are fifteen students from Chesapeake High building a competition robot from September to April. Last season we reached 340 people at seven community events and took a rookie team through their first qualifier. Sponsorship pays for parts, registration and travel — and it puts your name in front of every family at every event we attend. We will send you a season report in May showing exactly what your support built.')},
    3, 'm-stu4', 'm-stu4', ${n(NOW - 100 * DAY)}, ${n(NOW - 40 * DAY)});`);

const TIERS = [
  // [id, name, cents, benefits, position]
  ['st-1', 'Bronze', 10000, 'Name on the team banner and the season report.', 1024],
  ['st-2', 'Silver', 25000, 'Banner, season report, and your logo on the robot cart.', 2048],
  ['st-3', 'Gold', 75000, 'All of the above, your logo on the robot itself, and a visit from the team to your business.', 3072],
];
for (const [id, name, cents, benefits, position] of TIERS) {
  out(`INSERT INTO sponsorship_tiers (id, team_id, campaign_id, name, amount_cents, benefits, position, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(CAMPAIGN)}, ${q(name)}, ${n(cents)}, ${q(benefits)}, ${n(position)}, ${n(NOW - 99 * DAY)}, ${n(NOW - 99 * DAY)});`);
}

// The two who said yes. Harbor Machine paid in full and has been thanked;
// Riverside paid in full and has NOT — that is the row a coach should notice.
const SPONSORS = [
  // [id, name, tierId, tierName, cents, thankedDaysAgo, thankedBy]
  ['sp-1', 'Harbor Machine Works', 'st-3', 'Gold', 75000, 90, 'm-stu4'],
  ['sp-2', 'Riverside Dental', 'st-2', 'Silver', 25000, null, null],
];
for (const [id, name, tierId, tierName, cents, thanked, thankedBy] of SPONSORS) {
  out(`INSERT INTO sponsors (id, team_id, season_id, campaign_id, name, tier_id, tier_name, amount_cents, thanked_at, thanked_by, created_by, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(CAMPAIGN)}, ${q(name)}, ${q(tierId)}, ${q(tierName)}, ${n(cents)},
      ${thanked ? n(NOW - thanked * DAY) : 'NULL'}, ${q(thankedBy)}, 'm-stu4', ${n(NOW - 96 * DAY)}, ${n(NOW - 96 * DAY)});`);
}

// Point the two sponsorship income lines at them, so pledged and paid agree
// and the ledger rows read as "from sponsor X".
out(`UPDATE transactions SET sponsor_id = 'sp-1' WHERE id = 'tx-1' AND team_id = ${q(TEAM)};`);
out(`UPDATE transactions SET sponsor_id = 'sp-2' WHERE id = 'tx-7' AND team_id = ${q(TEAM)};`);

const PROSPECTS = [
  // [id, org, contact, email, phone, url, note, stage, pledged, tierId, sponsorId, daysAgo]
  ['pr-1', 'Harbor Machine Works', 'Dana Reyes', 'dana@harbormachine.example', '410-555-0134',
    'https://harbormachine.example', 'Second season backing us. Ask about the mill donation too.',
    'committed', 75000, 'st-3', 'sp-1', 96],
  ['pr-2', 'Riverside Dental', 'Dr. Amara Osei', 'front.desk@riversidedental.example', null,
    null, 'Mia’s orthodontist. Said yes on the phone in ten minutes.',
    'committed', 25000, 'st-2', 'sp-2', 60],
  ['pr-3', 'Bayside Hardware', 'Tom Feldman', null, '410-555-0199', 'https://baysidehardware.example',
    'Sponsors the football team already. Wants to see the robot first — bring it to the store.',
    'pitched', 25000, 'st-2', null, 24],
  ['pr-4', 'Kettle & Cup', 'Priya Raman', 'hello@kettleandcup.example', null, null,
    'Emailed the pitch on Tuesday. Follow up next week if nothing.',
    'contacted', 10000, 'st-1', null, 11],
  ['pr-5', 'Delmarva Auto Body', null, null, null, 'https://delmarvaauto.example',
    'Parent works there. Nobody has called yet.',
    'researching', null, null, null, 6],
  ['pr-6', 'Chesapeake Credit Union', 'Marcus Webb', 'community@chesbank.example', null, null,
    'Grant cycle closed for this year. Try again in August.',
    'declined', null, null, null, 30],
];
for (const [id, org, contact, email, phone, url, note, stage, pledged, tierId, sponsorId, daysAgo] of PROSPECTS) {
  out(`INSERT INTO sponsor_prospects (id, team_id, season_id, campaign_id, org_name, contact_name, contact_email, contact_phone, url, note, stage, pledged_cents, tier_id, source, stage_changed_by, stage_changed_at, sponsor_id, created_by, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(CAMPAIGN)}, ${q(org)}, ${q(contact)}, ${q(email)}, ${q(phone)}, ${q(url)}, ${q(note)},
      ${q(stage)}, ${pledged ? n(pledged) : 'NULL'}, ${q(tierId)}, 'manual', 'm-stu4', ${n(NOW - daysAgo * DAY)}, ${q(sponsorId)},
      'm-stu4', ${n(NOW - (daysAgo + 8) * DAY)}, ${n(NOW - daysAgo * DAY)});`);
}

// ---------------------------------------------------- updates and contacts
// The list is the two sponsors who gave an address plus one community
// contact, and one of them has opted out — the state the toggle exists to
// show. Two updates: one actually sent in the autumn, one being written now
// and aimed at a date, so a screenshot carries both halves of the story.
const CONTACTS = [
  // [id, org, contact, email, sponsorId, subscribedDaysAgo, unsubDaysAgo]
  ['ec-1', 'Harbor Machine Works', 'Dana Reyes', 'dana@harbormachine.example', 'sp-1', 94, null],
  ['ec-2', 'Riverside Dental', 'Dr. Amara Osei', 'front.desk@riversidedental.example', 'sp-2', 58, null],
  ['ec-3', 'Chesapeake High Boosters', 'Val Whitfield', 'boosters@cheshigh.example', null, 80, null],
  ['ec-4', 'Kettle & Cup', 'Priya Raman', 'hello@kettleandcup.example', null, 40, 12],
];
for (const [id, org, contact, email, sponsorId, sub, unsub] of CONTACTS) {
  out(`INSERT INTO external_contacts (id, team_id, season_id, org_name, contact_name, email, subscribed_at, subscribed_by, unsubscribed_at, sponsor_id, created_by, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(org)}, ${q(contact)}, ${q(email)},
      ${n(NOW - sub * DAY)}, 'm-stu4', ${unsub ? n(NOW - unsub * DAY) : 'NULL'},
      ${q(sponsorId)}, 'm-stu4', ${n(NOW - sub * DAY)}, ${n(NOW - (unsub ?? sub) * DAY)});`);
}

const UPDATES = [
  // [id, title, paragraphs, status, scheduledDaysAgo, sentDaysAgo, recipients]
  ['nl-1', 'What your sponsorship built this autumn',
    [
      'Thank you for backing the Cog Goblins this season. Since September we have built a complete drivetrain, taught two rookie teams to wire a control hub, and run a robotics table at the Dundalk library that reached about ninety kids and their parents.',
      'Your money went to a REV starter kit restock, this season FIRST registration, and the polycarbonate for our intake. We have receipts for all of it in our books, and we are on track against the season budget.',
    ],
    'sent', null, 42, 3],
  ['nl-2', 'Heading into qualifiers',
    [
      'The robot has a name now. It is Grendel, it weighs 39 pounds, and it can hang from the rung for the whole endgame.',
    ],
    'scheduled', -14, null, null],
];
for (const [id, title, paragraphs, status, sched, sent, recipients] of UPDATES) {
  const doc = JSON.stringify({
    type: 'doc',
    content: paragraphs.map((text) => ({
      type: 'paragraph',
      content: [{ type: 'text', text }],
    })),
  });
  out(`INSERT INTO newsletters (id, team_id, season_id, title, body, body_text, rev, status, scheduled_for, sent_at, sent_by, recipient_count, created_by, updated_by, created_at, updated_at)
    VALUES (${q(id)}, ${q(TEAM)}, ${q(SEASON)}, ${q(title)}, ${q(doc)}, ${q(paragraphs.join(' '))},
      ${n(paragraphs.length + 1)}, ${q(status)},
      ${sched === null ? 'NULL' : n(NOW - sched * DAY)},
      ${sent === null ? 'NULL' : n(NOW - sent * DAY)},
      ${sent === null ? 'NULL' : "'m-stu4'"},
      ${recipients === null ? 'NULL' : n(recipients)},
      'm-stu4', 'm-stu4', ${n(NOW - (sent ?? 20) * DAY)}, ${n(NOW - (sent ?? 2) * DAY)});`);
}

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

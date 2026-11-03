/**
 * Team points: a season leaderboard every member of the team can read.
 *
 * THIS PUBLISHES SOMETHING THE REST OF THE SCHEMA KEEPS PRIVATE, deliberately,
 * and the reasoning is worth reading before anybody "fixes" it as a leak.
 * GET /attendance/summary in routes/records.ts is coach-and-mentor only because
 * a grid of which named minors missed which named evenings is an adult-private
 * record. This route shows every student a number for every classmate, and
 * attendance is the biggest part of that number. The students asked for exactly
 * that, and the coach chose an always-on board over a personal-only view.
 *
 * What bounds the trade:
 * - It is an AGGREGATE. No dates, no meeting ids, no states, and never the
 *   attendance `note`, which stays the only free text about a person in the
 *   schema and stays staff-only. A classmate can learn that Ada has more
 *   attendance points than Grace, not that Grace was absent on Nov 11 or why.
 * - It is DERIVED, not stored. There is no points table, so this adds no row
 *   about a minor to the nightly dump, and erasing a member erases their score
 *   with the attendance it was computed from. 0003's refusal of "a richer log of
 *   individual students" still holds at the storage layer.
 * - Viewers are excluded. A viewer is a parent or a sponsor, and a ranking of
 *   other people's children is not theirs to read.
 * - Only students are ranked. Coaches and mentors are the ones recording the
 *   marks, and a board they top by taking the roll is a board nobody trusts.
 *
 * Attendance only scores once a coach or mentor has recorded it. A self
 * check-in is a claim, and points for claims would make "check in from the
 * couch" the best play on the board. The attendance panel's "confirm
 * check-ins" button is how a coach turns claims into marks.
 *
 * Current season only, and computed on every read. A team is fifteen to forty
 * students, a season is perhaps a hundred meetings, and six indexed SELECTs in
 * one batch read a few thousand rows at most, which is cheaper than keeping a
 * cache honest across every write path that can move a score.
 */
import { Hono } from 'hono';
import { scoreBoard, type ScoringInput } from '../lib/points';
import { auth as authOf, denyRole, requireMember, type AppEnv } from '../lib/tenancy';

export const points = new Hono<AppEnv>();

points.get('/points', requireMember, denyRole('viewer'), async (c) => {
  const { teamId } = authOf(c);

  const season = await c.env.DB.prepare(
    'SELECT id, label FROM seasons WHERE team_id = ? AND is_current = 1',
  )
    .bind(teamId)
    .first<{ id: string; label: string }>();
  if (!season) return c.json({ season: null, team_total: 0, members: [] });

  const [members, meetings, marks, docs, candidates, outreach] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT id, display_name FROM members
        WHERE team_id = ? AND status = 'active' AND role = 'student'`,
    ).bind(teamId),
    c.env.DB.prepare(
      `SELECT id, starts_at FROM meetings
        WHERE team_id = ? AND season_id = ? AND status = 'held'`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      // `confirmed` is "somebody other than the student recorded this", not a
      // join on the recorder's role. Only two paths write this table: the PUT,
      // which is coach-and-mentor only, and the self check-in, which always
      // records the student themselves. So the two tests agree today, and this
      // one does not change its answer when a mentor is later re-roled or a
      // recorder's member row is erased (recorded_by SET NULL).
      `SELECT a.meeting_id, a.member_id, a.state,
              CASE WHEN a.recorded_by IS NULL OR a.recorded_by <> a.member_id
                   THEN 1 ELSE 0 END AS confirmed
         FROM meeting_attendance a
         JOIN meetings mt ON mt.id = a.meeting_id AND mt.team_id = a.team_id
        WHERE a.team_id = ? AND mt.season_id = ? AND mt.status = 'held'`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      // created_by, never updated_by: the last editor is whoever fixed the last
      // typo, and crediting them would let one keystroke take somebody else's
      // writeup.
      `SELECT created_by, length(content_text) AS chars FROM note_docs
        WHERE team_id = ? AND season_id = ? AND deleted_at IS NULL
          AND created_by IS NOT NULL`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      `SELECT flagged_by, state FROM portfolio_candidates
        WHERE team_id = ? AND season_id = ? AND flagged_by IS NOT NULL
          AND state IN ('shortlisted', 'placed')`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      `SELECT created_by, hours FROM outreach_events
        WHERE team_id = ? AND season_id = ? AND created_by IS NOT NULL`,
    ).bind(teamId, season.id),
  ]);

  const board = scoreBoard({
    members: members.results,
    meetings: meetings.results,
    marks: marks.results,
    docs: docs.results,
    candidates: candidates.results,
    outreach: outreach.results,
  } as unknown as ScoringInput);

  return c.json({ season, ...board });
});

/**
 * Attendance and action items — the two records a meeting leaves behind.
 *
 * Attendance is the Sustain award's "documented progress tracking" and it is
 * also, plainly, a log of where named minors were on named evenings. The
 * migration says what that trade is and why it is accepted; the shape here is
 * the other half of it. Coaches record for the team, and a student may only
 * ever record themselves — `POST /attendance/self` structurally cannot name
 * somebody else, which is the tenancy rule applied to identity.
 *
 * Action items are separate from `tasks` because a task needs a board, and
 * choosing a board mid-sentence while somebody is still talking is exactly the
 * friction that stops anything being written down. Promotion is a later,
 * deliberate act.
 *
 * ACTION ITEMS ARE COACH-PRIVATE, and every action-item route below says so with
 * `requireRole('coach', 'mentor')` rather than `denyRole('viewer')`. That is
 * deliberately the opposite of the argument in lib/tenancy.ts:111-125, so here
 * is why that argument does not reach this case.
 *
 * It is about a COLLABORATION surface — notes, flags, board tasks — where the
 * cost of a positive list is that a fifth role added next season is silently
 * denied everywhere with no error and no failing test, and where being wrong
 * toward "included" is cheap. This is the inverse. The contents are "follow up
 * with John about his behaviour at meetings": one adult's private note about a
 * named minor. Being wrong toward "included" is a silent leak, with no error and
 * no failing test either. Default deny is correct exactly when the wrong answer
 * is a leak rather than an inconvenience.
 *
 * Attendance keeps `denyRole('viewer')` on the self check-in, because that one
 * is a collaboration surface and the argument above does apply to it.
 *
 * This is a DATA boundary, not a UI one. The GETs are gated too, which is also
 * why `action_items` left the GET /api/meetings/:id payload — a student could
 * simply read the whole list there while every route in this file answered 403.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import { boundedInt, optionalString, readJson } from '../lib/http';
import { isActionStatus, isAttendanceState } from '../lib/meetings';
import {
  auth as authOf,
  denyRole,
  requireMember,
  requireRole,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const records = new Hono<AppEnv>();

const ACTION_COLUMNS = `id, meeting_id, doc_id, text, assignee_member_id, due_at,
        status, task_id, created_by, created_at, updated_at`;

// --------------------------------------------------------------- attendance

records.get('/meetings/:id/attendance', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const { results } = await c.env.DB.prepare(
    `SELECT a.id AS id, a.member_id AS member_id, a.state AS state,
            a.note AS note, a.recorded_by AS recorded_by,
            a.recorded_at AS recorded_at, m.display_name AS display_name
       FROM meeting_attendance a
       JOIN members m ON m.id = a.member_id AND m.team_id = a.team_id
      WHERE a.team_id = ? AND a.meeting_id = ?`,
  )
    .bind(teamId, c.req.param('id'))
    .all();
  return c.json({ attendance: results });
});

/**
 * Record the roll in one upsert batch.
 *
 * Members not named in the body are left alone, so two coaches marking
 * different halves of the room do not erase each other. Every member_id is
 * checked against the caller's own team first — the cross-tenant write a naive
 * upsert would happily accept.
 */
records.put(
  '/meetings/:id/attendance',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body || !Array.isArray(body.entries)) {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const entries = body.entries as Record<string, unknown>[];

    const { teamId, member } = authOf(c);
    const meetingId = c.req.param('id');
    const meeting = await c.env.DB.prepare(
      'SELECT id FROM meetings WHERE id = ? AND team_id = ?',
    )
      .bind(meetingId, teamId)
      .first();
    if (!meeting) return c.json({ error: 'not_found' }, 404);

    const { results: roster } = await c.env.DB.prepare(
      "SELECT id FROM members WHERE team_id = ? AND status = 'active'",
    )
      .bind(teamId)
      .all<{ id: string }>();
    const known = new Set(roster.map((r) => r.id));

    const now = nowSeconds();
    const statements: D1PreparedStatement[] = [];

    for (const entry of entries) {
      const memberId = optionalString(entry.member_id, 64);
      if (!memberId || !known.has(memberId)) {
        return c.json({ error: 'unknown_member' }, 400);
      }
      // An explicit null clears the entry rather than recording an absence.
      if (entry.state === null) {
        statements.push(
          c.env.DB.prepare(
            'DELETE FROM meeting_attendance WHERE team_id = ? AND meeting_id = ? AND member_id = ?',
          ).bind(teamId, meetingId, memberId),
        );
        continue;
      }
      if (!isAttendanceState(entry.state)) {
        return c.json({ error: 'invalid_state' }, 400);
      }
      const note = optionalString(entry.note, 500);
      // `other` without a detail is the one shape the enum cannot police. It
      // reads as more information than `absent` and carries less, and the note
      // is the entire reason `other` exists — so it is required here rather
      // than merely encouraged in the panel, where a stale bundle can skip it.
      //
      // This rejects the WHOLE roll, not the rows before it: statements are
      // accumulated and batched only after every entry validates. That is the
      // behaviour you want — a half-written roll that a coach then retries
      // double-writes the half that worked — and it means the client has to be
      // told which row is at fault, hence member_id riding along. Still a code
      // and not a sentence: the panel owns the copy.
      if (entry.state === 'other' && note === null) {
        return c.json({ error: 'missing_detail', member_id: memberId }, 400);
      }
      statements.push(
        c.env.DB.prepare(
          // arrived_late, left_early and minutes still exist as columns and are
          // deliberately not written — 0005 explains why they were kept. A body
          // that still carries them is IGNORED rather than rejected, the same
          // call normaliseSubTeams makes in lib/roles.ts: a coach on yesterday's
          // JS bundle must still be able to take the roll.
          `INSERT INTO meeting_attendance
             (id, team_id, meeting_id, member_id, state, note, recorded_by,
              recorded_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (team_id, meeting_id, member_id) DO UPDATE SET
             state = excluded.state, note = excluded.note,
             recorded_by = excluded.recorded_by,
             recorded_at = excluded.recorded_at`,
        ).bind(
          uuid(),
          teamId,
          meetingId,
          memberId,
          entry.state,
          note,
          member.id,
          now,
        ),
      );
    }

    if (statements.length > 0) await c.env.DB.batch(statements);

    const { results } = await c.env.DB.prepare(
      `SELECT id, member_id, state, note, recorded_by, recorded_at
         FROM meeting_attendance WHERE team_id = ? AND meeting_id = ?`,
    )
      .bind(teamId, meetingId)
      .all();
    return c.json({ attendance: results });
  },
);

/**
 * Check yourself in.
 *
 * Ignores any member_id in the body and uses the session's own membership. A
 * student marking a friend present is the exact failure mode that would make
 * the whole attendance record worthless as a Sustain artifact.
 */
records.post(
  '/meetings/:id/attendance/self',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    // The body is ignored in full, not just its member_id. A student checking
    // in is always plain `present`: `other` needs free text about a person, and
    // a student typing prose onto their own attendance record is a new PII
    // surface rather than a convenience. If somebody left early, the coach
    // records it.
    const { teamId, member } = authOf(c);
    const meetingId = c.req.param('id');
    const meeting = await c.env.DB.prepare(
      'SELECT id FROM meetings WHERE id = ? AND team_id = ?',
    )
      .bind(meetingId, teamId)
      .first();
    if (!meeting) return c.json({ error: 'not_found' }, 404);

    // A self check-in never clears a coach's note: DO UPDATE touches `state`
    // and the recorder only. If a coach wrote "leaving early for dentist" and
    // the student then taps "I'm here", the sentence survives — losing it would
    // make the button a way to quietly overwrite the coach.
    await c.env.DB.prepare(
      `INSERT INTO meeting_attendance
         (id, team_id, meeting_id, member_id, state, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, 'present', ?, ?)
       ON CONFLICT (team_id, meeting_id, member_id) DO UPDATE SET
         state = 'present', recorded_by = excluded.recorded_by,
         recorded_at = excluded.recorded_at`,
    )
      .bind(uuid(), teamId, meetingId, member.id, member.id, nowSeconds())
      .run();

    return c.json({ ok: true, member_id: member.id, state: 'present' });
  },
);

/**
 * The roster's attendance grid: every held meeting this season, and every mark
 * on it.
 *
 * This used to be a per-member count rollup that nothing in the client called.
 * It was not scoped to a season, it counted marks on planned and cancelled
 * meetings, and any member could read it, students included. It is now the
 * grid behind Roster's Attendance view:
 *
 * - Held meetings of the CURRENT season only. Preseason meetings belong to the
 *   season through `season_id` (see routes/meetings.ts), so this filters on
 *   that rather than on dates.
 * - Coach and mentor only. A grid of which named minors were missing on which
 *   named evenings is the same kind of adult-private record as an action item,
 *   and the default-deny argument at the top of this file applies to it. Staff
 *   can already see every one of these marks, notes included, meeting by
 *   meeting; this puts them side by side.
 *
 * Counts are left to the client. It needs the cells anyway, and a second copy
 * of the same numbers is a second thing that can disagree.
 */
records.get(
  '/attendance/summary',
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);

    const season = await c.env.DB.prepare(
      'SELECT id, label FROM seasons WHERE team_id = ? AND is_current = 1',
    )
      .bind(teamId)
      .first<{ id: string; label: string }>();
    if (!season) return c.json({ season: null, meetings: [], records: [] });

    const [meetings, marks] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT id, title, starts_at, kind FROM meetings
          WHERE team_id = ? AND season_id = ? AND status = 'held'
          ORDER BY starts_at ASC`,
      ).bind(teamId, season.id),
      c.env.DB.prepare(
        `SELECT a.meeting_id, a.member_id, a.state, a.note
           FROM meeting_attendance a
           JOIN meetings mt ON mt.id = a.meeting_id AND mt.team_id = a.team_id
          WHERE a.team_id = ? AND mt.season_id = ? AND mt.status = 'held'`,
      ).bind(teamId, season.id),
    ]);

    return c.json({
      season,
      meetings: meetings.results,
      records: marks.results,
    });
  },
);

// ------------------------------------------------------------- action items

/**
 * Every item across the season, for the coach's own dashboard.
 *
 * The meeting is joined rather than fetched per row, for the same reason
 * meetings.ts counts attendance in a subquery: the caller wants one list with
 * enough context to act on, and N+1 on a dashboard is N+1 on every page load.
 */
records.get(
  '/action-items',
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status');
    if (status !== null && !isActionStatus(status)) {
      return c.json({ error: 'invalid_status' }, 400);
    }
    const { results } = await c.env.DB.prepare(
      `SELECT ai.id AS id, ai.meeting_id AS meeting_id, ai.text AS text,
              ai.assignee_member_id AS assignee_member_id, ai.due_at AS due_at,
              ai.status AS status, ai.task_id AS task_id,
              ai.created_by AS created_by, ai.created_at AS created_at,
              ai.updated_at AS updated_at,
              m.title AS meeting_title, m.starts_at AS meeting_starts_at
         FROM meeting_action_items ai
         JOIN meetings m ON m.id = ai.meeting_id AND m.team_id = ai.team_id
        WHERE ai.team_id = ? AND (? IS NULL OR ai.status = ?)
        -- Undated last, not first. COALESCE to the far future is what "no
        -- deadline" means to somebody scanning a list for what is overdue.
        ORDER BY COALESCE(ai.due_at, 4102444800) ASC, ai.created_at DESC
        LIMIT 300`,
    )
      .bind(teamId, status, status)
      .all();
    return c.json({ action_items: results });
  },
);

/**
 * One meeting's action items.
 *
 * Its own route rather than a field on GET /meetings/:id — see the header. The
 * rejected alternative was returning an empty array to non-coaches from that
 * payload, which hides the privacy rule from the call site: the next person to
 * add a column to that batch would not know the rule exists, and no test would
 * catch the regression, because an empty array and a leaked array are both
 * perfectly valid JSON.
 *
 * Done items sort last so the list reads as what is left to do.
 */
records.get(
  '/meetings/:id/action-items',
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);
    const { results } = await c.env.DB.prepare(
      `SELECT ${ACTION_COLUMNS} FROM meeting_action_items
        WHERE team_id = ? AND meeting_id = ?
        ORDER BY status = 'done', COALESCE(due_at, 4102444800) ASC, created_at ASC`,
    )
      .bind(teamId, c.req.param('id'))
      .all();
    return c.json({ action_items: results });
  },
);

records.post(
  '/meetings/:id/action-items',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const { teamId, member } = authOf(c);
    const meetingId = c.req.param('id');
    const meeting = await c.env.DB.prepare(
      'SELECT id FROM meetings WHERE id = ? AND team_id = ?',
    )
      .bind(meetingId, teamId)
      .first();
    if (!meeting) return c.json({ error: 'not_found' }, 404);

    const text = optionalString(body.text, 500);
    if (!text) return c.json({ error: 'missing_text' }, 400);

    const id = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO meeting_action_items
         (id, team_id, meeting_id, doc_id, text, assignee_member_id, due_at,
          status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)`,
    )
      .bind(
        id,
        teamId,
        meetingId,
        optionalString(body.doc_id, 64),
        text,
        optionalString(body.assignee_member_id, 64),
        boundedInt(body.due_at, 0, 4_102_444_800),
        member.id,
        now,
        now,
      )
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${ACTION_COLUMNS} FROM meeting_action_items WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ action_item: row }, 201);
  },
);

records.patch(
  '/meetings/:id/action-items/:aid',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId } = authOf(c);

    const sets: string[] = [];
    const values: unknown[] = [];
    if (body.text !== undefined) {
      const text = optionalString(body.text, 500);
      if (!text) return c.json({ error: 'missing_text' }, 400);
      sets.push('text = ?');
      values.push(text);
    }
    if (body.status !== undefined) {
      if (!isActionStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
      sets.push('status = ?');
      values.push(body.status);
    }
    if (body.assignee_member_id !== undefined) {
      sets.push('assignee_member_id = ?');
      values.push(optionalString(body.assignee_member_id, 64));
    }
    if (body.due_at !== undefined) {
      sets.push('due_at = ?');
      values.push(body.due_at === null ? null : boundedInt(body.due_at, 0, 4_102_444_800));
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_at = ?');
    values.push(nowSeconds());

    const result = await c.env.DB.prepare(
      `UPDATE meeting_action_items SET ${sets.join(', ')}
        WHERE id = ? AND team_id = ? AND meeting_id = ?`,
    )
      .bind(...values, c.req.param('aid'), teamId, c.req.param('id'))
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    const row = await c.env.DB.prepare(
      `SELECT ${ACTION_COLUMNS} FROM meeting_action_items WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('aid'), teamId)
      .first();
    return c.json({ action_item: row });
  },
);

records.delete(
  '/meetings/:id/action-items/:aid',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);
    const result = await c.env.DB.prepare(
      'DELETE FROM meeting_action_items WHERE id = ? AND team_id = ? AND meeting_id = ?',
    )
      .bind(c.req.param('aid'), teamId, c.req.param('id'))
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  },
);

/**
 * Turn an action item into a board task.
 *
 * Picks a board rather than demanding one, and creates "Action items" if the
 * team has none — removing the "which board?" question is the entire point of
 * keeping capture and planning separate in the first place.
 *
 * `decision_log` used to be seeded from the nearest preceding `decision` note
 * block, which was free Think-award material. That table is gone (0006) and so is
 * the seam it depended on — an action item being a line in a note stream. The
 * field stays on `tasks`, where TaskDialog still renders it, and is now written by
 * hand or not at all.
 *
 * Restoring it is real work rather than a rename: it needs a typed decision node
 * in the editor plus a Worker-side extractor. Flagged rather than quietly dropped,
 * because it is award material and somebody should choose to lose it.
 */
records.post(
  '/meetings/:id/action-items/:aid/promote',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = (await readJson(c)) ?? {};
    const { teamId } = authOf(c);
    const meetingId = c.req.param('id');

    const item = await c.env.DB.prepare(
      `SELECT id, text, assignee_member_id, due_at, task_id
         FROM meeting_action_items
        WHERE id = ? AND team_id = ? AND meeting_id = ?`,
    )
      .bind(c.req.param('aid'), teamId, meetingId)
      .first<{
        id: string;
        text: string;
        assignee_member_id: string | null;
        due_at: number | null;
        task_id: string | null;
      }>();
    if (!item) return c.json({ error: 'not_found' }, 404);
    if (item.task_id) return c.json({ error: 'already_promoted', task_id: item.task_id }, 409);

    const season = await c.env.DB.prepare(
      'SELECT id FROM seasons WHERE team_id = ? AND is_current = 1',
    )
      .bind(teamId)
      .first<{ id: string }>();
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    let boardId = optionalString(body.board_id, 64);
    if (boardId) {
      const board = await c.env.DB.prepare(
        'SELECT id FROM boards WHERE id = ? AND team_id = ?',
      )
        .bind(boardId, teamId)
        .first();
      if (!board) return c.json({ error: 'not_found' }, 404);
    } else {
      // Season-scoped: an unscoped pick would promote this season's action
      // item onto a board from a season that has already ended, where nobody
      // is looking.
      const fallback = await c.env.DB.prepare(
        'SELECT id FROM boards WHERE team_id = ? AND season_id = ? ORDER BY position ASC LIMIT 1',
      )
        .bind(teamId, season.id)
        .first<{ id: string }>();
      boardId = fallback?.id ?? null;
    }

    const now = nowSeconds();
    const statements: D1PreparedStatement[] = [];

    if (!boardId) {
      boardId = uuid();
      statements.push(
        c.env.DB.prepare(
          'INSERT INTO boards (id, team_id, season_id, name, sub_team, position) VALUES (?, ?, ?, ?, NULL, 0)',
        ).bind(boardId, teamId, season.id, 'Action items'),
      );
    }

    // No decision_log seed any more — see the note on this route. Left as an
    // explicit null rather than dropped from the INSERT, so the column and the
    // gap are both visible to whoever restores this.
    const decisionLog: string | null = null;

    const meeting = await c.env.DB.prepare(
      'SELECT title, starts_at FROM meetings WHERE id = ? AND team_id = ?',
    )
      .bind(meetingId, teamId)
      .first<{ title: string; starts_at: number }>();

    const max = await c.env.DB.prepare(
      'SELECT COALESCE(MAX(position), 0) AS max FROM tasks WHERE team_id = ? AND board_id = ?',
    )
      .bind(teamId, boardId)
      .first<{ max: number }>();

    const taskId = uuid();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO tasks
           (id, team_id, board_id, title, body, assignee_member_id, status, due_at,
            position, decision_log, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?)`,
      ).bind(
        taskId,
        teamId,
        boardId,
        item.text.slice(0, 200),
        `From ${meeting?.title ?? 'a meeting'}`,
        item.assignee_member_id,
        item.due_at,
        (max?.max ?? 0) + 1024,
        decisionLog,
        now,
        now,
      ),
      // The guard makes a double promote a 409 rather than two tasks.
      c.env.DB.prepare(
        `UPDATE meeting_action_items SET task_id = ?, updated_at = ?
          WHERE id = ? AND team_id = ? AND task_id IS NULL`,
      ).bind(taskId, now, item.id, teamId),
    );

    await c.env.DB.batch(statements);

    const [task, action] = await c.env.DB.batch([
      c.env.DB.prepare(
        `SELECT id, board_id, title, body, assignee_member_id, status, due_at, decision_log
           FROM tasks WHERE id = ? AND team_id = ?`,
      ).bind(taskId, teamId),
      c.env.DB.prepare(
        `SELECT ${ACTION_COLUMNS} FROM meeting_action_items WHERE id = ? AND team_id = ?`,
      ).bind(item.id, teamId),
    ]);

    return c.json({ task: task.results[0], action_item: action.results[0] }, 201);
  },
);

export { records };

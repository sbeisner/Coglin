import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { call, callJson, inviteAndAccept, signUpCoach, stubResend, whoami } from './_helpers';

beforeAll(() => {
  stubResend();
});

async function makeMeeting(cookie: string, dayOffset = 7): Promise<string> {
  const season = await callJson<{ starts_at: number }>('/api/season/current', { cookie });
  const created = await callJson<{ meeting: { id: string } }>('/api/meetings', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ starts_at: season.body.starts_at + dayOffset * 86400 }),
  });
  return created.body.meeting.id;
}

describe('attendance', () => {
  it('records the roll and leaves unnamed members alone', async () => {
    const coach = await signUpCoach(8100);
    const meetingId = await makeMeeting(coach);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const grace = await inviteAndAccept(coach, { role: 'student', handle: 'grace' });
    const adaId = (await whoami(ada.cookie)).member_id;
    const graceId = (await whoami(grace.cookie)).member_id;

    await callJson(`/api/meetings/${meetingId}/attendance`, {
      method: 'PUT',
      cookie: coach,
      body: JSON.stringify({
        entries: [
          { member_id: adaId, state: 'present' },
          { member_id: graceId, state: 'other', note: 'Away at a league meet' },
        ],
      }),
    });

    // A second coach marking only one person must not erase the other.
    const second = await callJson<{
      attendance: { member_id: string; state: string; note: string | null }[];
    }>(`/api/meetings/${meetingId}/attendance`, {
      method: 'PUT',
      cookie: coach,
      body: JSON.stringify({
        entries: [{ member_id: adaId, state: 'present' }],
      }),
    });

    const byMember = new Map(second.body.attendance.map((a) => [a.member_id, a]));
    expect(byMember.get(adaId)?.state).toBe('present');
    // Grace was not named in the second write and keeps her explanation.
    expect(byMember.get(graceId)?.state).toBe('other');
    expect(byMember.get(graceId)?.note).toBe('Away at a league meet');
  });

  it('no longer accepts late or excused as a state', async () => {
    // Both values are retired. 'late' left ATTENDANCE_STATES when the timing
    // marks were introduced, and 'excused' left when they were withdrawn again
    // in favour of `other` plus a sentence — see migrations/0005_attendance.sql.
    // Looping is the assertion that proves a retirement actually took, rather
    // than the enum and the query drifting apart the way 'late' silently did.
    const coach = await signUpCoach(8105);
    const meetingId = await makeMeeting(coach);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'notastate' });
    const adaId = (await whoami(ada.cookie)).member_id;

    for (const state of ['late', 'excused']) {
      const { status, body } = await callJson<{ error: string }>(
        `/api/meetings/${meetingId}/attendance`,
        {
          method: 'PUT',
          cookie: coach,
          body: JSON.stringify({ entries: [{ member_id: adaId, state }] }),
        },
      );
      expect(status, state).toBe(400);
      expect(body.error, state).toBe('invalid_state');
    }
  });

  it('lets a student check in only themselves', async () => {
    const coach = await signUpCoach(8101);
    const meetingId = await makeMeeting(coach);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'ada2' });
    const grace = await inviteAndAccept(coach, { role: 'student', handle: 'grace2' });
    const adaId = (await whoami(ada.cookie)).member_id;
    const graceId = (await whoami(grace.cookie)).member_id;

    // The body names Grace; the route uses the session's own membership. A
    // student marking a friend present would make the whole record worthless.
    const response = await callJson<{ member_id: string }>(
      `/api/meetings/${meetingId}/attendance/self`,
      {
        method: 'POST',
        cookie: ada.cookie,
        body: JSON.stringify({ member_id: graceId }),
      },
    );
    expect(response.status).toBe(200);
    expect(response.body.member_id).toBe(adaId);

    const rows = await env.DB.prepare(
      'SELECT member_id FROM meeting_attendance WHERE meeting_id = ?',
    )
      .bind(meetingId)
      .all<{ member_id: string }>();
    expect(rows.results.map((r) => r.member_id)).toEqual([adaId]);
  });

  it('refuses a student taking the roll for the team', async () => {
    const coach = await signUpCoach(8102);
    const meetingId = await makeMeeting(coach);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'roll' });
    const response = await call(`/api/meetings/${meetingId}/attendance`, {
      method: 'PUT',
      cookie: student.cookie,
      body: JSON.stringify({ entries: [] }),
    });
    expect(response.status).toBe(403);
  });

  it('lays out the season grid for the roster: held meetings and their marks', async () => {
    const coach = await signUpCoach(8103);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'ada3' });
    const adaId = (await whoami(ada.cookie)).member_id;

    const held: string[] = [];
    for (let i = 0; i < 3; i++) {
      // Created newest-first, so the ordering assertion below is proving the
      // ORDER BY and not insertion order.
      const meetingId = await makeMeeting(coach, 30 - i * 7);
      await call(`/api/meetings/${meetingId}/attendance`, {
        method: 'PUT',
        cookie: coach,
        body: JSON.stringify({
          entries: [
            i === 2
              ? { member_id: adaId, state: 'other', note: 'Arrived late' }
              : { member_id: adaId, state: i === 0 ? 'present' : 'absent' },
          ],
        }),
      });
      held.push(meetingId);
    }

    // Marks on a meeting that is still planned or was cancelled are not the
    // season's attendance: only a held meeting is a column in the grid.
    const planned = await makeMeeting(coach);
    const cancelled = await makeMeeting(coach);
    for (const id of [planned, cancelled]) {
      await call(`/api/meetings/${id}/attendance`, {
        method: 'PUT',
        cookie: coach,
        body: JSON.stringify({ entries: [{ member_id: adaId, state: 'present' }] }),
      });
    }

    // Last season's meeting, reached the way a season rollover would leave it:
    // same team, a season that is no longer current.
    const { team_id: teamId } = await whoami(coach);
    const oldSeason = crypto.randomUUID();
    const oldMeeting = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO seasons (id, team_id, label, starts_at, ends_at, is_current)
         VALUES (?, ?, '2025-26', 1756684800, 1780271999, 0)`,
      ).bind(oldSeason, teamId),
      env.DB.prepare(
        `INSERT INTO meetings (id, team_id, season_id, starts_at, status, created_at)
         VALUES (?, ?, ?, 1760000000, 'held', 1760000000)`,
      ).bind(oldMeeting, teamId, oldSeason),
      env.DB.prepare(
        `INSERT INTO meeting_attendance
           (id, team_id, meeting_id, member_id, state, recorded_at)
         VALUES (?, ?, ?, ?, 'present', 1760000000)`,
      ).bind(crypto.randomUUID(), teamId, oldMeeting, adaId),
    ]);

    // Starting a meeting is what marks it held; the column is set directly so
    // this test does not also exercise the notes seeding behind /start.
    await env.DB.batch([
      ...held.map((id) =>
        env.DB.prepare(`UPDATE meetings SET status = 'held' WHERE id = ?`).bind(id),
      ),
      env.DB.prepare(`UPDATE meetings SET status = 'cancelled' WHERE id = ?`).bind(
        cancelled,
      ),
    ]);

    const { status, body } = await callJson<{
      season: { label: string } | null;
      meetings: { id: string; starts_at: number }[];
      records: { meeting_id: string; member_id: string; state: string; note: string | null }[];
    }>('/api/attendance/summary', { cookie: coach });
    expect(status).toBe(200);
    expect(body.season?.label).toBeTruthy();
    expect(body.meetings.map((m) => m.id)).toEqual([...held].reverse());

    const ada3 = body.records.filter((r) => r.member_id === adaId);
    expect(ada3.map((r) => [r.meeting_id, r.state, r.note])).toEqual(
      expect.arrayContaining([
        [held[0], 'present', null],
        [held[1], 'absent', null],
        [held[2], 'other', 'Arrived late'],
      ]),
    );
    expect(ada3).toHaveLength(3);
  });

  it('keeps the attendance grid to coaches and mentors', async () => {
    const coach = await signUpCoach(8112);
    const mentor = await inviteAndAccept(coach, { role: 'mentor', handle: 'grid-mentor' });
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'grid-student' });
    const viewer = await inviteAndAccept(coach, { role: 'viewer', handle: 'grid-viewer' });

    expect((await call('/api/attendance/summary', { cookie: mentor.cookie })).status).toBe(200);
    expect((await call('/api/attendance/summary', { cookie: student.cookie })).status).toBe(403);
    expect((await call('/api/attendance/summary', { cookie: viewer.cookie })).status).toBe(403);
  });

  it('requires a detail when the state is other', async () => {
    // `other` with nothing after it says less about a student than `absent` does
    // while looking like it says more. There is no CHECK constraint to stop one,
    // so this assertion is the only thing that does.
    const coach = await signUpCoach(8106);
    const meetingId = await makeMeeting(coach);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'nodetail' });
    const adaId = (await whoami(ada.cookie)).member_id;

    const { status, body } = await callJson<{ error: string; member_id: string }>(
      `/api/meetings/${meetingId}/attendance`,
      {
        method: 'PUT',
        cookie: coach,
        body: JSON.stringify({ entries: [{ member_id: adaId, state: 'other' }] }),
      },
    );
    expect(status).toBe(400);
    expect(body.error).toBe('missing_detail');
    // The offending row rides along so the panel can point at it.
    expect(body.member_id).toBe(adaId);

    // Whitespace is not a detail.
    const blank = await callJson<{ error: string }>(
      `/api/meetings/${meetingId}/attendance`,
      {
        method: 'PUT',
        cookie: coach,
        body: JSON.stringify({
          entries: [{ member_id: adaId, state: 'other', note: '   ' }],
        }),
      },
    );
    expect(blank.status).toBe(400);
    expect(blank.body.error).toBe('missing_detail');
  });

  it('rejects the whole roll rather than half of it', async () => {
    // Statements are accumulated and batched only after every entry validates,
    // so a bad entry in second position must leave the first one unwritten too.
    // Otherwise a coach retries and double-writes the half that worked.
    const coach = await signUpCoach(8107);
    const meetingId = await makeMeeting(coach);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'firsthalf' });
    const grace = await inviteAndAccept(coach, { role: 'student', handle: 'secondhalf' });
    const adaId = (await whoami(ada.cookie)).member_id;
    const graceId = (await whoami(grace.cookie)).member_id;

    const response = await call(`/api/meetings/${meetingId}/attendance`, {
      method: 'PUT',
      cookie: coach,
      body: JSON.stringify({
        entries: [
          { member_id: adaId, state: 'present' },
          { member_id: graceId, state: 'other' },
        ],
      }),
    });
    expect(response.status).toBe(400);

    const written = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM meeting_attendance WHERE meeting_id = ?',
    )
      .bind(meetingId)
      .first<{ n: number }>();
    expect(written?.n).toBe(0);
  });

  it('ignores the retired timing marks rather than rejecting them', async () => {
    // A coach on yesterday's JS bundle must still be able to take the roll. Same
    // call normaliseSubTeams makes in lib/roles.ts: drop what you no longer
    // understand, do not fail the write over it.
    const coach = await signUpCoach(8108);
    const meetingId = await makeMeeting(coach);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'staleclient' });
    const adaId = (await whoami(ada.cookie)).member_id;

    const { status } = await callJson(`/api/meetings/${meetingId}/attendance`, {
      method: 'PUT',
      cookie: coach,
      body: JSON.stringify({
        entries: [
          { member_id: adaId, state: 'present', arrived_late: true, left_early: true, minutes: 70 },
        ],
      }),
    });
    expect(status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT arrived_late, left_early, minutes FROM meeting_attendance WHERE meeting_id = ? AND member_id = ?',
    )
      .bind(meetingId, adaId)
      .first<{ arrived_late: number; left_early: number; minutes: number | null }>();
    expect(row?.arrived_late).toBe(0);
    expect(row?.left_early).toBe(0);
    expect(row?.minutes).toBe(null);
  });

  it('does not count other toward the meeting attendance count', async () => {
    // "12 there" on the index has to mean twelve people in the room. `other`
    // means there is a sentence about the evening, which is not the same claim.
    const coach = await signUpCoach(8109);
    const meetingId = await makeMeeting(coach);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'inroom' });
    const grace = await inviteAndAccept(coach, { role: 'student', handle: 'dentist' });
    const adaId = (await whoami(ada.cookie)).member_id;
    const graceId = (await whoami(grace.cookie)).member_id;

    await call(`/api/meetings/${meetingId}/attendance`, {
      method: 'PUT',
      cookie: coach,
      body: JSON.stringify({
        entries: [
          { member_id: adaId, state: 'present' },
          { member_id: graceId, state: 'other', note: 'Leaving early for dentist' },
        ],
      }),
    });

    const { body } = await callJson<{
      meetings: { id: string; attendance_count: number }[];
    }>('/api/meetings', { cookie: coach });
    const listed = body.meetings.find((m) => m.id === meetingId);
    expect(listed?.attendance_count).toBe(1);
  });
});

describe('action items and promotion', () => {
  it('promotes an action item onto a board, carrying assignee and due date', async () => {
    const coach = await signUpCoach(8200);
    const meetingId = await makeMeeting(coach);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'ada4' });
    const adaId = (await whoami(ada.cookie)).member_id;
    const due = 1_800_000_000;

    const item = await callJson<{ action_item: { id: string } }>(
      `/api/meetings/${meetingId}/action-items`,
      {
        method: 'POST',
        cookie: coach,
        body: JSON.stringify({
          text: 'Reprint the intake bracket',
          assignee_member_id: adaId,
          due_at: due,
        }),
      },
    );
    expect(item.status).toBe(201);

    const promoted = await callJson<{
      task: { id: string; title: string; assignee_member_id: string; due_at: number };
    }>(`/api/meetings/${meetingId}/action-items/${item.body.action_item.id}/promote`, {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({}),
    });

    expect(promoted.status).toBe(201);
    expect(promoted.body.task.title).toBe('Reprint the intake bracket');
    expect(promoted.body.task.assignee_member_id).toBe(adaId);
    expect(promoted.body.task.due_at).toBe(due);

    // The team had no boards, so one was created rather than asking.
    const boards = await callJson<{ boards: { name: string }[] }>('/api/boards', {
      cookie: coach,
    });
    expect(boards.body.boards.map((b) => b.name)).toContain('Action items');
  });

  it('refuses to promote the same item twice', async () => {
    const coach = await signUpCoach(8201);
    const meetingId = await makeMeeting(coach);
    const item = await callJson<{ action_item: { id: string } }>(
      `/api/meetings/${meetingId}/action-items`,
      { method: 'POST', cookie: coach, body: JSON.stringify({ text: 'Once only' }) },
    );

    const path = `/api/meetings/${meetingId}/action-items/${item.body.action_item.id}/promote`;
    expect((await call(path, { method: 'POST', cookie: coach, body: '{}' })).status).toBe(201);
    const second = await callJson<{ error: string }>(path, {
      method: 'POST',
      cookie: coach,
      body: '{}',
    });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('already_promoted');

    // Scoped to this team: storage is isolated per test FILE, so a global count
    // would be measuring every fixture above as well.
    const tasks = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM tasks
        WHERE team_id = (SELECT id FROM teams WHERE team_number = 8201)`,
    ).first<{ n: number }>();
    expect(tasks?.n).toBe(1);
  });

  it('no longer carries a decision forward, which is a deliberate loss', async () => {
    // This test used to assert that promoting an action item seeded
    // tasks.decision_log from the nearest preceding `decision` note block — free
    // Think-award material, because the reasoning was typed at the moment it
    // happened rather than reconstructed in March.
    //
    // Blocks are gone (0006) and so is the seam it relied on: an action item being
    // a line in a note stream. Inverted rather than deleted, so the gap is
    // recorded as a decision somebody made instead of a feature that quietly
    // stopped working. Restoring it needs a typed decision node in the editor plus
    // a Worker-side extractor.
    const coach = await signUpCoach(8202);
    const meetingId = await makeMeeting(coach);

    const item = await callJson<{ action_item: { id: string } }>(
      `/api/meetings/${meetingId}/action-items`,
      {
        method: 'POST',
        cookie: coach,
        body: JSON.stringify({ text: 'Order the bearings' }),
      },
    );

    const promoted = await callJson<{ task: { decision_log: string | null } }>(
      `/api/meetings/${meetingId}/action-items/${item.body.action_item.id}/promote`,
      { method: 'POST', cookie: coach, body: '{}' },
    );
    expect(promoted.status).toBe(201);
    expect(promoted.body.task.decision_log).toBeNull();
  });

  it('keeps action items away from students, on read as well as write', async () => {
    // The headline test for this feature. The list holds a coach's private notes
    // about named minors — "follow up with John about his behaviour" — so the
    // boundary is the routes, not the UI. Every verb, including the GETs.
    const coach = await signUpCoach(8204);
    const meetingId = await makeMeeting(coach);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'nosy' });

    const item = await callJson<{ action_item: { id: string } }>(
      `/api/meetings/${meetingId}/action-items`,
      {
        method: 'POST',
        cookie: coach,
        body: JSON.stringify({ text: 'COACH-PRIVATE-MARKER' }),
      },
    );
    expect(item.status).toBe(201);
    const aid = item.body.action_item.id;

    const paths: [string, string][] = [
      ['GET', '/api/action-items'],
      ['GET', `/api/meetings/${meetingId}/action-items`],
      ['POST', `/api/meetings/${meetingId}/action-items`],
      ['PATCH', `/api/meetings/${meetingId}/action-items/${aid}`],
      ['DELETE', `/api/meetings/${meetingId}/action-items/${aid}`],
      ['POST', `/api/meetings/${meetingId}/action-items/${aid}/promote`],
    ];
    for (const [method, path] of paths) {
      const response = await call(path, {
        method,
        cookie: student.cookie,
        body: method === 'GET' ? undefined : '{}',
      });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.text(), `${method} ${path}`).not.toContain(
        'COACH-PRIVATE-MARKER',
      );
    }

    // The leak a route-by-route audit misses. The meeting detail used to include
    // action_items behind requireMember alone, so a student could read the whole
    // list from the meeting screen while every route above answered 403.
    const detail = await call(`/api/meetings/${meetingId}`, { cookie: student.cookie });
    expect(detail.status).toBe(200);
    expect(await detail.text()).not.toContain('COACH-PRIVATE-MARKER');

    // And the row survives: 403 must never be a silent delete.
    const still = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM meeting_action_items WHERE id = ?',
    )
      .bind(aid)
      .first<{ n: number }>();
    expect(still?.n).toBe(1);
  });

  it('lets a mentor use the list, because in FIRST that is the same job', async () => {
    // requireRole('coach', 'mentor') and not requireRole('coach'): a mentor is a
    // second adult on the team, not a supervised student.
    const coach = await signUpCoach(8205);
    const meetingId = await makeMeeting(coach);
    const mentor = await inviteAndAccept(coach, { role: 'mentor', handle: 'secondadult' });

    const created = await callJson<{ action_item: { id: string } }>(
      `/api/meetings/${meetingId}/action-items`,
      {
        method: 'POST',
        cookie: mentor.cookie,
        body: JSON.stringify({ text: 'Pay registration' }),
      },
    );
    expect(created.status).toBe(201);

    const listed = await callJson<{ action_items: { text: string }[] }>(
      `/api/meetings/${meetingId}/action-items`,
      { cookie: mentor.cookie },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.action_items.map((a) => a.text)).toContain('Pay registration');
  });

  it('still answers 401 before it answers 403', async () => {
    // requireMember runs ahead of requireRole in every chain, so an anonymous
    // caller is told to sign in rather than told they are the wrong role — which
    // would confirm the endpoint exists to somebody who should not know.
    const coach = await signUpCoach(8206);
    const meetingId = await makeMeeting(coach);

    for (const path of ['/api/action-items', `/api/meetings/${meetingId}/action-items`]) {
      const response = await call(path, {});
      expect(response.status, path).toBe(401);
    }
  });
});

describe('board mutate', () => {
  it('applies the op stream the client already speaks', async () => {
    const coach = await signUpCoach(8300);
    const board = await callJson<{ board: { id: string } }>('/api/boards', {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({ name: 'Build' }),
    });
    const boardId = board.body.board.id;

    const task = await callJson<{ task: { id: string } }>('/api/tasks', {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({ board_id: boardId, title: 'Cut the plate' }),
    });

    const mutated = await callJson<{ tasks: { id: string; status: string }[] }>(
      `/api/boards/${boardId}/mutate`,
      {
        method: 'POST',
        cookie: coach,
        body: JSON.stringify({
          ops: [
            {
              op: 'move_task',
              task_id: task.body.task.id,
              status: 'doing',
              position: 2048,
            },
          ],
        }),
      },
    );
    expect(mutated.status).toBe(200);
    expect(mutated.body.tasks[0].status).toBe('doing');
  });

  it('rejects an unknown op rather than applying the rest', async () => {
    const coach = await signUpCoach(8301);
    const board = await callJson<{ board: { id: string } }>('/api/boards', {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({ name: 'Build' }),
    });

    const response = await callJson<{ error: string }>(
      `/api/boards/${board.body.board.id}/mutate`,
      {
        method: 'POST',
        cookie: coach,
        body: JSON.stringify({ ops: [{ op: 'drop_database' }] }),
      },
    );
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('invalid_op');
  });
});

describe('tenancy isolation', () => {
  it('never lets one team touch another\'s attendance, actions or boards', async () => {
    const alpha = await signUpCoach(8400);
    const beta = await signUpCoach(8401);

    const betaMeeting = await makeMeeting(beta);
    const alphaMember = await whoami(alpha);

    const betaItem = await callJson<{ action_item: { id: string } }>(
      `/api/meetings/${betaMeeting}/action-items`,
      {
        method: 'POST',
        cookie: beta,
        body: JSON.stringify({ text: 'BETA-ACTION-MARKER' }),
      },
    );
    const betaBoard = await callJson<{ board: { id: string } }>('/api/boards', {
      method: 'POST',
      cookie: beta,
      body: JSON.stringify({ name: 'BETA-BOARD-MARKER' }),
    });

    // The cross-tenant write a naive upsert would happily accept: alpha marking
    // their OWN member present at beta's meeting.
    const attendance = await callJson<{ error: string }>(
      `/api/meetings/${betaMeeting}/attendance`,
      {
        method: 'PUT',
        cookie: alpha,
        body: JSON.stringify({
          entries: [
            { member_id: alphaMember.member_id, state: 'other', note: 'Dropping by' },
          ],
        }),
      },
    );
    expect(attendance.status).toBe(404);
    const written = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM meeting_attendance WHERE meeting_id = ?',
    )
      .bind(betaMeeting)
      .first<{ n: number }>();
    expect(written?.n).toBe(0);

    // Promoting another team's action item onto your own board.
    expect(
      (
        await call(
          `/api/meetings/${betaMeeting}/action-items/${betaItem.body.action_item.id}/promote`,
          { method: 'POST', cookie: alpha, body: '{}' },
        )
      ).status,
    ).toBe(404);

    // Lists never leak.
    const actions = await call('/api/action-items', { cookie: alpha });
    expect(await actions.text()).not.toContain('BETA-ACTION-MARKER');

    // The per-meeting list, aimed at beta's meeting id. DELIBERATE ASYMMETRY:
    // this answers 200 with an empty array, not the 404 that routes/meetings.ts
    // promises for a foreign id. requireRole passes — alpha really is a coach on
    // their own team — and then the `team_id = ?` predicate simply matches
    // nothing. That is the honest outcome and it still proves non-leakage, but it
    // reads as a bug unless you know why, hence this comment.
    const scoped = await call(`/api/meetings/${betaMeeting}/action-items`, {
      cookie: alpha,
    });
    expect(scoped.status).toBe(200);
    expect(await scoped.text()).not.toContain('BETA-ACTION-MARKER');
    const boardList = await call('/api/boards', { cookie: alpha });
    expect(await boardList.text()).not.toContain('BETA-BOARD-MARKER');

    // Mutating another team's board.
    expect(
      (
        await call(`/api/boards/${betaBoard.body.board.id}/mutate`, {
          method: 'POST',
          cookie: alpha,
          body: JSON.stringify({ ops: [] }),
        })
      ).status,
    ).toBe(404);

    const stillThere = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM meeting_action_items WHERE meeting_id = ?',
    )
      .bind(betaMeeting)
      .first<{ n: number }>();
    expect(stillThere?.n).toBe(1);
  });

  it('requires a session', async () => {
    for (const path of ['/api/boards', '/api/tasks', '/api/action-items', '/api/attendance/summary']) {
      expect((await call(path)).status, path).toBe(401);
    }
  });
});

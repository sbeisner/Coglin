import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { POINT_RULES } from '../lib/points';
import { call, callJson, inviteAndAccept, signUpCoach, stubResend, whoami } from './_helpers';

/**
 * Which rows reach the scoring rules. lib/points.test.ts covers what the rules
 * make of them; this covers the boundaries — season, meeting status, who
 * recorded a mark, soft delete, role and tenant — that a SELECT can get wrong
 * without any arithmetic test noticing.
 */

beforeAll(() => {
  stubResend();
});

interface Board {
  season: { label: string } | null;
  team_total: number;
  members: {
    member_id: string;
    display_name: string;
    total: number;
    breakdown: Record<string, number>;
  }[];
}

async function makeMeeting(cookie: string, dayOffset = 7): Promise<string> {
  const season = await callJson<{ starts_at: number }>('/api/season/current', { cookie });
  const created = await callJson<{ meeting: { id: string } }>('/api/meetings', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ starts_at: season.body.starts_at + dayOffset * 86400 }),
  });
  return created.body.meeting.id;
}

async function setStatus(meetingId: string, status: string): Promise<void> {
  // Starting a meeting is what marks it held; set directly so these tests do
  // not also exercise the notes seeding behind /start.
  await env.DB.prepare('UPDATE meetings SET status = ? WHERE id = ?')
    .bind(status, meetingId)
    .run();
}

async function board(cookie: string): Promise<Board> {
  const { status, body } = await callJson<Board>('/api/points', { cookie });
  expect(status).toBe(200);
  return body;
}

function pointsOf(b: Board, memberId: string) {
  return b.members.find((m) => m.member_id === memberId);
}

describe('GET /api/points', () => {
  it('scores a coach-taken roll, and a self check-in only once confirmed', async () => {
    const coach = await signUpCoach(8601);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'pts-ada' });
    const adaId = (await whoami(ada.cookie)).member_id;

    const meetingId = await makeMeeting(coach);
    await setStatus(meetingId, 'held');

    await call(`/api/meetings/${meetingId}/attendance/self`, {
      method: 'POST',
      cookie: ada.cookie,
    });
    expect(pointsOf(await board(ada.cookie), adaId)?.breakdown.attendance).toBe(0);

    // What the panel's "confirm check-ins" button sends.
    await call(`/api/meetings/${meetingId}/attendance`, {
      method: 'PUT',
      cookie: coach,
      body: JSON.stringify({ entries: [{ member_id: adaId, state: 'present' }] }),
    });
    expect(pointsOf(await board(ada.cookie), adaId)?.breakdown.attendance).toBe(
      POINT_RULES.attendance,
    );

    // Tapping "I'm here" again must not hand the mark back to the student and
    // cost them the points.
    await call(`/api/meetings/${meetingId}/attendance/self`, {
      method: 'POST',
      cookie: ada.cookie,
    });
    expect(pointsOf(await board(ada.cookie), adaId)?.breakdown.attendance).toBe(
      POINT_RULES.attendance,
    );
  });

  it('counts only held meetings of the current season', async () => {
    const coach = await signUpCoach(8602);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'pts-season' });
    const adaId = (await whoami(ada.cookie)).member_id;

    const held = await makeMeeting(coach, 7);
    const planned = await makeMeeting(coach, 14);
    const cancelled = await makeMeeting(coach, 21);
    for (const id of [held, planned, cancelled]) {
      await call(`/api/meetings/${id}/attendance`, {
        method: 'PUT',
        cookie: coach,
        body: JSON.stringify({ entries: [{ member_id: adaId, state: 'present' }] }),
      });
    }
    await setStatus(held, 'held');
    await setStatus(cancelled, 'cancelled');

    const { team_id: teamId, member_id: coachId } = await whoami(coach);
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
           (id, team_id, meeting_id, member_id, state, recorded_by, recorded_at)
         VALUES (?, ?, ?, ?, 'present', ?, 1760000000)`,
      ).bind(crypto.randomUUID(), teamId, oldMeeting, adaId, coachId),
    ]);

    expect(pointsOf(await board(coach), adaId)?.breakdown.attendance).toBe(
      POINT_RULES.attendance,
    );
  });

  it('credits the document author, and drops the points when it is deleted', async () => {
    const coach = await signUpCoach(8603);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'pts-doc' });
    const grace = await inviteAndAccept(coach, { role: 'student', handle: 'pts-editor' });
    const adaId = (await whoami(ada.cookie)).member_id;
    const graceId = (await whoami(grace.cookie)).member_id;

    const created = await callJson<{ doc: { id: string; rev: number } }>('/api/notes', {
      method: 'POST',
      cookie: ada.cookie,
      body: JSON.stringify({}),
    });
    const docId = created.body.doc.id;
    const text = 'Swapped the drivetrain to 2in wheels after the weight test. '.repeat(5);
    // Grace writes the content, so she is updated_by. Ada created it.
    await call(`/api/notes/${docId}/content`, {
      method: 'PUT',
      cookie: grace.cookie,
      body: JSON.stringify({
        content: JSON.stringify({
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        }),
      }),
    });

    let b = await board(coach);
    expect(pointsOf(b, adaId)?.breakdown.docs).toBe(POINT_RULES.doc);
    expect(pointsOf(b, graceId)?.breakdown.docs).toBe(0);

    await call(`/api/notes/${docId}`, { method: 'DELETE', cookie: ada.cookie });
    b = await board(coach);
    expect(pointsOf(b, adaId)?.breakdown.docs).toBe(0);
  });

  it('ranks students only, and lets students but not viewers read it', async () => {
    const coach = await signUpCoach(8604);
    await inviteAndAccept(coach, { role: 'student', handle: 'pts-a' });
    const bea = await inviteAndAccept(coach, { role: 'student', handle: 'pts-b' });
    await inviteAndAccept(coach, { role: 'mentor', handle: 'pts-mentor' });
    const viewer = await inviteAndAccept(coach, { role: 'viewer', handle: 'pts-viewer' });

    const b = await board(bea.cookie);
    expect(b.members.map((m) => m.display_name).sort()).toEqual(['pts-a', 'pts-b']);
    expect(b.season?.label).toBeTruthy();

    const denied = await call('/api/points', { cookie: viewer.cookie });
    expect(denied.status).toBe(403);
  });

  it('never shows another team', async () => {
    const coachA = await signUpCoach(8605);
    const coachB = await signUpCoach(8606);
    await inviteAndAccept(coachA, { role: 'student', handle: 'pts-team-a' });
    await inviteAndAccept(coachB, { role: 'student', handle: 'pts-team-b' });

    const b = await board(coachA);
    expect(b.members.map((m) => m.display_name)).toEqual(['pts-team-a']);
  });

  it('never returns dates, meeting ids or attendance notes', async () => {
    const coach = await signUpCoach(8607);
    const ada = await inviteAndAccept(coach, { role: 'student', handle: 'pts-private' });
    const adaId = (await whoami(ada.cookie)).member_id;
    const meetingId = await makeMeeting(coach);
    await call(`/api/meetings/${meetingId}/attendance`, {
      method: 'PUT',
      cookie: coach,
      body: JSON.stringify({
        entries: [{ member_id: adaId, state: 'other', note: 'Family emergency' }],
      }),
    });
    await setStatus(meetingId, 'held');

    const raw = await (await call('/api/points', { cookie: ada.cookie })).text();
    expect(raw).not.toContain(meetingId);
    expect(raw).not.toContain('Family emergency');
  });
});

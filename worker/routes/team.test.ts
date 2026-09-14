import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  callJson,
  inviteAndAccept,
  signUpCoach,
  stubResend,
  whoami,
} from './_helpers';

beforeAll(() => {
  stubResend();
});

/**
 * PATCH /api/members/:id.
 *
 * Until this route grew, sub-teams were write-once at invite time — the whole
 * reason a coach could strand a student in no sub-team at all and never fix it.
 * The guards below are the interesting half: a team that demotes its last coach
 * has no path back that does not involve database access, so the route has to
 * refuse rather than trust the client to hide the button.
 */

function patchMember(
  cookie: string,
  memberId: string,
  body: unknown,
): Promise<{ status: number; body: { error?: string } }> {
  return callJson(`/api/members/${memberId}`, {
    method: 'PATCH',
    cookie,
    body: JSON.stringify(body),
  });
}

async function subTeamsOf(memberId: string): Promise<string> {
  const row = await env.DB.prepare('SELECT sub_teams FROM members WHERE id = ?')
    .bind(memberId)
    .first<{ sub_teams: string }>();
  return row?.sub_teams ?? '';
}

describe('changing sub-teams', () => {
  it('sets them on a member who joined with none', async () => {
    const coach = await signUpCoach(9200);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const adaId = (await whoami(student.cookie)).member_id;

    // The state the roster could not render and no route could fix.
    expect(await subTeamsOf(adaId)).toBe('[]');

    const patched = await patchMember(coach, adaId, {
      sub_teams: ['cad', 'build'],
    });
    expect(patched.status).toBe(200);

    // Stored in the canonical order the validator imposes, not the order sent.
    expect(await subTeamsOf(adaId)).toBe('["build","cad"]');
  });

  it('drops entries it does not recognise rather than failing the write', async () => {
    const coach = await signUpCoach(9201);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'grace' });
    const id = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(coach, id, {
      sub_teams: ['build', 'nonsense'],
    });
    expect(patched.status).toBe(200);
    expect(await subTeamsOf(id)).toBe('["build"]');
  });

  it('refuses a sub_teams value that is not a list', async () => {
    const coach = await signUpCoach(9202);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'lin' });
    const id = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(coach, id, { sub_teams: 'build' });
    expect(patched.status).toBe(400);
    expect(patched.body.error).toBe('invalid_sub_teams');
  });

  it('lets a coach fix their own sub-teams, which signup hardcodes to empty', async () => {
    const coach = await signUpCoach(9203);
    const meId = (await whoami(coach)).member_id;

    const patched = await patchMember(coach, meId, { sub_teams: ['drive'] });
    expect(patched.status).toBe(200);
    expect(await subTeamsOf(meId)).toBe('["drive"]');
  });

  it('lets a mentor edit sub-teams', async () => {
    const coach = await signUpCoach(9204);
    const mentor = await inviteAndAccept(coach, { role: 'mentor', handle: 'reed' });
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'kim' });
    const kimId = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(mentor.cookie, kimId, {
      sub_teams: ['outreach'],
    });
    expect(patched.status).toBe(200);
  });

  it('refuses a student entirely', async () => {
    const coach = await signUpCoach(9205);
    const a = await inviteAndAccept(coach, { role: 'student', handle: 'rey' });
    const b = await inviteAndAccept(coach, { role: 'student', handle: 'sol' });
    const solId = (await whoami(b.cookie)).member_id;

    const patched = await patchMember(a.cookie, solId, { sub_teams: ['build'] });
    expect(patched.status).toBe(403);
  });
});

describe('changing a role', () => {
  it('promotes a student, coach only', async () => {
    const coach = await signUpCoach(9210);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const adaId = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(coach, adaId, { role: 'mentor' });
    expect(patched.status).toBe(200);

    const row = await env.DB.prepare('SELECT role FROM members WHERE id = ?')
      .bind(adaId)
      .first<{ role: string }>();
    expect(row?.role).toBe('mentor');
  });

  it('refuses a mentor, who may edit sub-teams but not rank', async () => {
    const coach = await signUpCoach(9211);
    const mentor = await inviteAndAccept(coach, { role: 'mentor', handle: 'reed' });
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'kim' });
    const kimId = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(mentor.cookie, kimId, { role: 'coach' });
    expect(patched.status).toBe(403);
    expect(patched.body.error).toBe('forbidden');
  });

  it('refuses an unknown role', async () => {
    const coach = await signUpCoach(9212);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const id = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(coach, id, { role: 'admin' });
    expect(patched.status).toBe(400);
    expect(patched.body.error).toBe('invalid_role');
  });

  it('refuses the only coach demoting themselves', async () => {
    const coach = await signUpCoach(9213);
    const meId = (await whoami(coach)).member_id;

    // Not because it is self-directed — because it would leave zero coaches.
    const patched = await patchMember(coach, meId, { role: 'student' });
    expect(patched.status).toBe(409);
    expect(patched.body.error).toBe('last_coach');
  });

  it('lets a coach step down once somebody else holds the role', async () => {
    const coach = await signUpCoach(9214);
    const successor = await inviteAndAccept(coach, { role: 'mentor', handle: 'reed' });
    const reedId = (await whoami(successor.cookie)).member_id;
    const meId = (await whoami(coach)).member_id;

    // Hand over, then stand down. This is the whole reason the self-guard was
    // dropped: it is the normal end of a coach's season, not an accident.
    expect((await patchMember(coach, reedId, { role: 'coach' })).status).toBe(200);
    expect((await patchMember(coach, meId, { role: 'mentor' })).status).toBe(200);

    const row = await env.DB.prepare('SELECT role FROM members WHERE id = ?')
      .bind(meId)
      .first<{ role: string }>();
    expect(row?.role).toBe('mentor');
  });
});

describe('the last coach', () => {
  it('cannot be demoted, because nobody could promote anyone back', async () => {
    const coach = await signUpCoach(9220);
    const meId = (await whoami(coach)).member_id;

    const blocked = await patchMember(coach, meId, { role: 'mentor' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('last_coach');

    const row = await env.DB.prepare('SELECT role FROM members WHERE id = ?')
      .bind(meId)
      .first<{ role: string }>();
    expect(row?.role).toBe('coach');
  });

  it('cannot be removed either', async () => {
    const coach = await signUpCoach(9221);
    const meId = (await whoami(coach)).member_id;

    const blocked = await patchMember(coach, meId, { status: 'removed' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('last_coach');

    const row = await env.DB.prepare('SELECT status FROM members WHERE id = ?')
      .bind(meId)
      .first<{ status: string }>();
    expect(row?.status).toBe('active');
  });

  it('counts only ACTIVE coaches, so a removed one does not prop the door open', async () => {
    const coach = await signUpCoach(9222);
    const other = await inviteAndAccept(coach, { role: 'mentor', handle: 'reed' });
    const reedId = (await whoami(other.cookie)).member_id;
    const meId = (await whoami(coach)).member_id;

    // Two coaches, so the founder may now be removed by Reed.
    await patchMember(coach, reedId, { role: 'coach' });
    expect(
      (await patchMember(other.cookie, meId, { status: 'removed' })).status,
    ).toBe(200);

    // The founder's row still says role='coach' — it is only status that
    // changed. If the guard counted roles without checking status, Reed would
    // now be allowed to leave the team with nobody in charge.
    const ghost = await env.DB.prepare('SELECT role, status FROM members WHERE id = ?')
      .bind(meId)
      .first<{ role: string; status: string }>();
    expect(ghost).toMatchObject({ role: 'coach', status: 'removed' });

    const blocked = await patchMember(other.cookie, reedId, { status: 'removed' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('last_coach');
  });

  it('does not block demoting a non-coach when only one coach exists', async () => {
    const coach = await signUpCoach(9223);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const adaId = (await whoami(student.cookie)).member_id;

    // The guard is about losing coaches, not about how many there are.
    expect((await patchMember(coach, adaId, { role: 'viewer' })).status).toBe(200);
  });
});

describe('removing somebody', () => {
  it('takes them off the roster without deleting the row', async () => {
    const coach = await signUpCoach(9230);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const adaId = (await whoami(student.cookie)).member_id;

    const removed = await patchMember(coach, adaId, { status: 'removed' });
    expect(removed.status).toBe(200);

    // Soft, so the nightly roster-photo sweep can find them and so their name
    // still resolves on last season's meetings.
    const row = await env.DB.prepare('SELECT status FROM members WHERE id = ?')
      .bind(adaId)
      .first<{ status: string }>();
    expect(row?.status).toBe('removed');

    const roster = await callJson<{ id: string }[]>('/api/members', { cookie: coach });
    expect(roster.body.map((m) => m.id)).not.toContain(adaId);
  });

  it('ends the removed member’s access', async () => {
    const coach = await signUpCoach(9231);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const adaId = (await whoami(student.cookie)).member_id;

    expect((await call('/api/members', { cookie: student.cookie })).status).toBe(200);
    await patchMember(coach, adaId, { status: 'removed' });

    // requireMember resolves the session to an ACTIVE membership, so the flip is
    // the whole logout.
    expect((await call('/api/members', { cookie: student.cookie })).status).toBe(401);
  });

  it('refuses a status it does not know', async () => {
    const coach = await signUpCoach(9233);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const id = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(coach, id, { status: 'banished' });
    expect(patched.status).toBe(400);
    expect(patched.body.error).toBe('invalid_status');
  });
});

describe('the shape of the request', () => {
  it('refuses a body with nothing writable in it', async () => {
    const coach = await signUpCoach(9240);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const id = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(coach, id, { display_name: 'Nope' });
    expect(patched.status).toBe(400);
    expect(patched.body.error).toBe('nothing_to_update');
  });

  it('keeps the purchase-approver flag working alongside the new fields', async () => {
    const coach = await signUpCoach(9241);
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });
    const id = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(coach, id, {
      is_purchase_approver: true,
      sub_teams: ['business'],
    });
    expect(patched.status).toBe(200);

    const row = await env.DB.prepare(
      'SELECT is_purchase_approver, sub_teams FROM members WHERE id = ?',
    )
      .bind(id)
      .first<{ is_purchase_approver: number; sub_teams: string }>();
    expect(row?.is_purchase_approver).toBe(1);
    expect(row?.sub_teams).toBe('["business"]');
  });

  it('cannot reach a member on another team', async () => {
    const coachA = await signUpCoach(9250);
    const coachB = await signUpCoach(9251);
    const student = await inviteAndAccept(coachB, { role: 'student', handle: 'ada' });
    const adaId = (await whoami(student.cookie)).member_id;

    const patched = await patchMember(coachA, adaId, { sub_teams: ['build'] });
    expect(patched.status).toBe(404);

    // And nothing was written on the way to refusing.
    expect(await subTeamsOf(adaId)).toBe('[]');
  });
});

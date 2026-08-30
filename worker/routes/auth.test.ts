import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import worker from '../index';
import { currentSeason } from './auth';
import { ORIGIN, call, sessionCookie, signUpCoach } from './_helpers';

// The Resend seam stays local to this file rather than moving to _helpers: the
// invite tests assert on all three outcomes (accepted, rejected, transport
// failure), and the shared stub only needs to keep other suites off the
// network.

/**
 * Invite mail goes to Resend over plain fetch, so the seam these tests hold is
 * `globalThis.fetch` rather than a binding. Nothing here may touch the network:
 * a test suite that emails real people when it runs is a trap waiting for
 * whoever runs it next.
 *
 * `resendMode` covers the three outcomes that actually differ in behaviour —
 * accepted, rejected with an HTTP error, and a transport failure.
 */
type ResendMode = 'ok' | 'http-error' | 'network-error';
let resendMode: ResendMode = 'ok';
let resendCalls: { url: string; body: Record<string, unknown> }[] = [];

beforeAll(() => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.startsWith('https://api.resend.com')) {
      return realFetch(input as RequestInfo, init);
    }
    resendCalls.push({
      url,
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    if (resendMode === 'network-error') throw new Error('simulated socket failure');
    if (resendMode === 'http-error') {
      // Shaped like a real Resend rejection, which echoes the address back —
      // the reason the failure path must never log a response body.
      return new Response(
        JSON.stringify({ statusCode: 422, message: 'Invalid `to` field' }),
        { status: 422 },
      );
    }
    return new Response(JSON.stringify({ id: 'test-message-id' }), { status: 200 });
  }) as typeof fetch;
});

beforeEach(() => {
  resendMode = 'ok';
  resendCalls = [];
});

describe('coach signup', () => {
  it('creates the team, season and coach membership, and signs the coach in', async () => {
    const cookie = await signUpCoach(607);

    const me = await call('/api/auth/me', { cookie });
    const body = (await me.json()) as {
      authenticated: boolean;
      member: { role: string; display_name: string };
      team: { team_number: number };
    };

    expect(body.authenticated).toBe(true);
    expect(body.member.role).toBe('coach');
    expect(body.team.team_number).toBe(607);

    // The season must exist and be current, or every season-scoped feature
    // that lands later has nothing to attach to.
    const season = await call('/api/season/current', { cookie });
    expect(season.status).toBe(200);
    expect(((await season.json()) as { is_current: number }).is_current).toBe(1);
  });

  it('lets anyone sign up, with no code', async () => {
    // Signup was gated on ALPHA_SIGNUP_CODE until the pricing page made that
    // incoherent: the site asked for money and then refused the buyer an
    // account. This asserts the gate is really gone rather than defaulting shut
    // on a missing binding, which is how it used to fail.
    const response = await call('/api/auth/coach-signup', {
      method: 'POST',
      body: JSON.stringify({
        email: 'open@example.com',
        password: 'correct horse battery',
        display_name: 'Open Signup',
        team_number: 999,
        team_name: 'Open Signup',
      }),
    });
    expect(response.status).toBe(201);
  });

  /**
   * The other side of opening it up. `teams.team_number` is UNIQUE and nothing
   * checks that you are on the team you claim, so the first person to type a
   * number owns it. Documented here because the 409 is the ONLY thing standing
   * between two teams and a silently shared season.
   */
  it('refuses a team number somebody already registered', async () => {
    await signUpCoach(4242);
    const response = await call('/api/auth/coach-signup', {
      method: 'POST',
      body: JSON.stringify({
        email: 'squatter@example.com',
        password: 'correct horse battery',
        display_name: 'Squatter',
        team_number: 4242,
        team_name: 'Also 4242',
      }),
    });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: 'already_exists' });
  });

  it('rejects a cross-site POST even with a valid body', async () => {
    const request = new Request(`${ORIGIN}/api/auth/coach-signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
      body: JSON.stringify({ email: 'x@example.com', team_number: 5150 }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
  });
});

describe('login', () => {
  it('accepts email + password for an adult', async () => {
    await signUpCoach(1001);
    const response = await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        email: 'coach1001@example.com',
        password: 'correct horse battery',
      }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('coglin_session=');
  });

  it('rejects a wrong password and an unknown account identically', async () => {
    await signUpCoach(1002);
    const wrongPassword = await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'coach1002@example.com', password: 'nope' }),
    });
    const unknownAccount = await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'ghost@example.com', password: 'nope' }),
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownAccount.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownAccount.json());
  });

  it('logs out', async () => {
    const cookie = await signUpCoach(1003);
    const out = await call('/api/auth/logout', { method: 'POST', cookie });
    expect(out.status).toBe(200);

    const me = await call('/api/auth/me', { cookie });
    expect(((await me.json()) as { authenticated: boolean }).authenticated).toBe(
      false,
    );
  });

  it('reports unauthenticated as a 200, not a 401', async () => {
    // The client calls /me on every boot to choose between the shell and the
    // login screen; a 401 would put an error in the console on first visit.
    const me = await call('/api/auth/me');
    expect(me.status).toBe(200);
  });
});

describe('season boundary', () => {
  it('puts an August signup in the season about to start', () => {
    // Kickoff is Sept 5; a coach setting up in mid-August belongs to 2026-27,
    // not the season that ended in May.
    const august = Math.floor(Date.UTC(2026, 7, 15) / 1000);
    expect(currentSeason(august).label).toBe('2026-27');
  });

  it('keeps a February signup in the season already running', () => {
    const february = Math.floor(Date.UTC(2027, 1, 10) / 1000);
    expect(currentSeason(february).label).toBe('2026-27');
  });
});

describe('invites', () => {
  it('mails a link, stores no address, and lets the invitee set their own credentials', async () => {
    const cookie = await signUpCoach(2001);

    const created = await call('/api/invites', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        email: 'student@example.com',
        display_name: 'Ada L.',
        role: 'student',
        sub_teams: ['programming', 'cad'],
      }),
    });
    expect(created.status).toBe(201);
    const { url, sent } = (await created.json()) as { url: string; sent: boolean };
    expect(sent).toBe(true);

    // The whole COPPA posture in one assertion: the address the coach typed is
    // nowhere in the database.
    const dump = await env.DB.prepare('SELECT * FROM invites').all();
    expect(JSON.stringify(dump.results)).not.toContain('student@example.com');

    const token = url.split('/invite/')[1];
    const preview = await call(`/api/invites/${token}`);
    expect(preview.status).toBe(200);
    expect((await preview.json()) as { display_name: string }).toMatchObject({
      display_name: 'Ada L.',
      team: { team_number: 2001 },
    });

    const accepted = await call(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ handle: 'ada', password: 'a good passphrase' }),
    });
    expect(accepted.status).toBe(201);

    // The student's user row must carry no email at all.
    const user = await env.DB.prepare(
      `SELECT u.email AS email, u.is_minor AS is_minor
         FROM users u JOIN members m ON m.user_id = u.id
        WHERE m.handle = 'ada'`,
    ).first<{ email: string | null; is_minor: number }>();
    expect(user?.email).toBeNull();
    expect(user?.is_minor).toBe(1);

    // And they can log in with team number + handle + password.
    const login = await call('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        team_number: 2001,
        handle: 'ada',
        password: 'a good passphrase',
      }),
    });
    expect(login.status).toBe(200);
  });

  it('burns the invite so the link cannot be reused', async () => {
    const cookie = await signUpCoach(2002);
    const created = await call('/api/invites', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        email: 'one@example.com',
        display_name: 'One Time',
        role: 'student',
      }),
    });
    const token = ((await created.json()) as { url: string }).url.split('/invite/')[1];

    const first = await call(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ handle: 'first', password: 'a good passphrase' }),
    });
    expect(first.status).toBe(201);

    const second = await call(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ handle: 'second', password: 'a good passphrase' }),
    });
    expect(second.status).toBe(404);
  });

  it('sends through Resend as admin@lilithforge.com', async () => {
    const cookie = await signUpCoach(2006);
    await call('/api/invites', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        email: 'parent@example.com',
        display_name: 'Grace H.',
        role: 'student',
      }),
    });

    expect(resendCalls).toHaveLength(1);
    const { url, body } = resendCalls[0];
    expect(url).toBe('https://api.resend.com/emails');
    expect(body.from).toBe('Coglin <admin@lilithforge.com>');
    expect(body.to).toEqual(['parent@example.com']);
    expect(String(body.subject)).toBe(
      'Coach 2006 has invited you to join 2006 Team 2006',
    );
    // Both parts, so the invite is readable in a plain-text client — plenty of
    // school mail setups strip HTML.
    expect(body.html).toContain('/invite/');
    expect(body.text).toContain('/invite/');
  });

  it('reports sent:false when Resend rejects the request', async () => {
    // The specific way a fetch-based sender goes wrong: fetch resolves happily
    // on a 422, so without an explicit response.ok check the coach would be
    // told the mail is on its way when Resend refused it.
    const cookie = await signUpCoach(2007);
    resendMode = 'http-error';

    const created = await call('/api/invites', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        email: 'rejected@example.com',
        display_name: 'Rejected',
        role: 'student',
      }),
    });

    expect(created.status).toBe(201);
    expect(((await created.json()) as { sent: boolean }).sent).toBe(false);
  });

  it('still returns a usable link when the mail fails to send', async () => {
    const cookie = await signUpCoach(2003);
    resendMode = 'network-error';

    const created = await call('/api/invites', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        email: 'bounces@example.com',
        display_name: 'Bounce',
        role: 'student',
      }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { sent: boolean; url: string };
    expect(body.sent).toBe(false);

    // The coach's copyable link is the fallback for a bounced invite, so it
    // has to work even on the failure path.
    const preview = await call(`/api/invites/${body.url.split('/invite/')[1]}`);
    expect(preview.status).toBe(200);
  });

  it('refuses to mint a coach via an invite link', async () => {
    const cookie = await signUpCoach(2004);
    const response = await call('/api/invites', {
      method: 'POST',
      cookie,
      body: JSON.stringify({
        email: 'x@example.com',
        display_name: 'Sneaky',
        role: 'coach',
      }),
    });
    expect(response.status).toBe(400);
  });

  it('does not let a student invite anyone', async () => {
    const coach = await signUpCoach(2005);
    const created = await call('/api/invites', {
      method: 'POST',
      cookie: coach,
      body: JSON.stringify({
        email: 's@example.com',
        display_name: 'Student',
        role: 'student',
      }),
    });
    const token = ((await created.json()) as { url: string }).url.split('/invite/')[1];
    const accepted = await call(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ handle: 'kid', password: 'a good passphrase' }),
    });

    const response = await call('/api/invites', {
      method: 'POST',
      cookie: sessionCookie(accepted),
      body: JSON.stringify({
        email: 'friend@example.com',
        display_name: 'Friend',
        role: 'student',
      }),
    });
    expect(response.status).toBe(403);
  });
});

/**
 * The one bug this codebase cannot ship. Every one of these asserts that a
 * signed-in member of team A sees only team A, with no request able to name a
 * different team.
 */
describe('tenancy isolation', () => {
  it('never returns another team’s roster, team or season', async () => {
    const alpha = await signUpCoach(3001);
    const beta = await signUpCoach(3002);

    // Put a distinctive member on team beta.
    const invite = await call('/api/invites', {
      method: 'POST',
      cookie: beta,
      body: JSON.stringify({
        email: 'beta@example.com',
        display_name: 'BETA ONLY MEMBER',
        role: 'student',
      }),
    });
    const token = ((await invite.json()) as { url: string }).url.split('/invite/')[1];
    await call(`/api/invites/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify({ handle: 'betakid', password: 'a good passphrase' }),
    });

    const members = await call('/api/members', { cookie: alpha });
    expect(JSON.stringify(await members.json())).not.toContain('BETA ONLY MEMBER');

    const teamBody = (await (await call('/api/team', { cookie: alpha })).json()) as {
      team_number: number;
    };
    expect(teamBody.team_number).toBe(3001);

    // Beta's pending invites must not appear in alpha's list either.
    const invites = await call('/api/invites', { cookie: alpha });
    expect(JSON.stringify(await invites.json())).not.toContain('BETA ONLY MEMBER');
  });

  it('ignores a team_id supplied in the request body', async () => {
    const alpha = await signUpCoach(3003);
    const beta = await signUpCoach(3004);

    const betaTeam = (await (await call('/api/team', { cookie: beta })).json()) as {
      id: string;
    };

    // Naming beta's team id explicitly changes nothing: the handler reads the
    // tenant from the session, and there is no code path that reads it here.
    const response = await call('/api/members', {
      cookie: alpha,
      method: 'GET',
      headers: { 'X-Team-Id': betaTeam.id },
    });
    const roster = (await response.json()) as { team_id: string }[];
    expect(roster.every((m) => m.team_id !== betaTeam.id)).toBe(true);
  });

  it('rejects tenant reads with no session at all', async () => {
    for (const path of ['/api/team', '/api/members', '/api/season/current']) {
      expect((await call(path)).status).toBe(401);
    }
  });
});

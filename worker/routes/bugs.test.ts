import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import worker from '../index';
import {
  ORIGIN,
  callJson,
  inviteAndAccept,
  signUpCoach,
  stubResend,
} from './_helpers';

/**
 * In-app bug reports (COG-0xx).
 *
 * Three properties carry the weight here, and none of them is the happy path:
 *
 *   ANYONE ON A TEAM MAY FILE. There is no role gate, on purpose — a viewer is
 *   a parent looking at a screen that just broke. Two of the tests below exist
 *   solely to fail if someone adds `requireRole` or `denyRole` later.
 *
 *   THE REPORT SURVIVES A MAIL FAILURE. The row commits before the send, so a
 *   rejected Resend call must still answer 201 and leave `emailed = 0`.
 *
 *   THE CLIENT CANNOT WRITE WHATEVER IT LIKES. `client_meta` is built from a
 *   server-side whitelist and `environment` comes from the binding, so the
 *   assertions check what LANDED IN D1, never what the route echoed back.
 */

const CONTENT = 'The board lost my card when I dragged it to Done.';

let coach = '';
let restore: (() => void) | null = null;

beforeAll(async () => {
  coach = await signUpCoach(9501);
});

afterEach(async () => {
  restore?.();
  restore = null;
  // Each test starts from an empty table: the rate-limit tests write six rows
  // and would otherwise poison whatever runs after them.
  await env.DB.prepare('DELETE FROM bug_reports').run();
});

function report(body: Record<string, unknown>, cookie = coach) {
  return callJson<{ ok?: boolean; id?: string; sent?: boolean; error?: string }>(
    '/api/bug-reports',
    { method: 'POST', cookie, body: JSON.stringify(body) },
  );
}

function row(id: string) {
  return env.DB.prepare('SELECT * FROM bug_reports WHERE id = ?')
    .bind(id)
    .first<Record<string, unknown>>();
}

describe('POST /api/bug-reports', () => {
  it('files the report and mails it', async () => {
    const resend = stubResend();
    restore = resend.restore;

    const { status, body } = await report({
      body: CONTENT,
      kind: 'bug',
      route: '/app/boards?season=2026-27',
      app_build: 'abc1234',
      user_agent: 'Mozilla/5.0 (iPhone)',
      viewport_w: 390,
      viewport_h: 844,
    });

    expect(status).toBe(201);
    expect(body.ok).toBe(true);
    expect(body.sent).toBe(true);

    const stored = await row(body.id!);
    expect(stored?.body).toBe(CONTENT);
    expect(stored?.kind).toBe('bug');
    expect(stored?.role).toBe('coach');
    expect(stored?.route).toBe('/app/boards?season=2026-27');
    expect(stored?.app_build).toBe('abc1234');
    expect(stored?.viewport_w).toBe(390);
    expect(stored?.status).toBe('new');
    expect(stored?.emailed).toBe(1);
    expect(stored?.reported_by_member_id).toBeTruthy();
    // From the binding, never the request. See the next test but one.
    expect(stored?.environment).toBe('local');

    // What crossed the wire, not what we echoed back.
    expect(resend.requests).toHaveLength(1);
    const mail = resend.requests[0] as { to: string[]; subject: string; text: string };
    expect(mail.to).toEqual(['bugs@coglin.test']);
    expect(mail.subject).toContain('9501');
    expect(mail.subject).toContain('[Coglin bug]');
    expect(mail.text).toContain(CONTENT);
  });

  it('lets a student file — there is no role gate', async () => {
    restore = stubResend().restore;
    const student = await inviteAndAccept(coach, { role: 'student', handle: 'ada' });

    const { status, body } = await report({ body: CONTENT }, student.cookie);
    expect(status).toBe(201);
    expect((await row(body.id!))?.role).toBe('student');
  });

  it('lets a viewer file too', async () => {
    restore = stubResend().restore;
    const viewer = await inviteAndAccept(coach, { role: 'viewer', handle: 'parent' });

    const { status, body } = await report({ body: CONTENT }, viewer.cookie);
    expect(status).toBe(201);
    expect((await row(body.id!))?.role).toBe('viewer');
  });

  it('rejects a blank body without writing a row', async () => {
    restore = stubResend().restore;

    const { status, body } = await report({ body: '   ' });
    expect(status).toBe(400);
    expect(body.error).toBe('missing_description');

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM bug_reports').first<{
      n: number;
    }>();
    expect(count?.n).toBe(0);
  });

  it('truncates an overlong body rather than rejecting it', async () => {
    restore = stubResend().restore;

    const { status, body } = await report({ body: 'x'.repeat(10_000) });
    expect(status).toBe(201);
    expect(String((await row(body.id!))?.body)).toHaveLength(4000);
  });

  it('falls back to kind=bug on an unknown kind', async () => {
    restore = stubResend().restore;

    const { status, body } = await report({ body: CONTENT, kind: 'catastrophe' });
    expect(status).toBe(201);
    expect((await row(body.id!))?.kind).toBe('bug');
  });

  it('builds client_meta from a whitelist and bounds it', async () => {
    restore = stubResend().restore;

    const { status, body } = await report({
      body: CONTENT,
      timezone: 'America/New_York',
      dpr: 3,
      online: true,
      // Neither of these may reach the column.
      environment: 'production',
      evil: 'x'.repeat(50_000),
    });
    expect(status).toBe(201);

    const stored = await row(body.id!);
    const meta = JSON.parse(String(stored?.client_meta)) as Record<string, string>;
    expect(meta).toEqual({ timezone: 'America/New_York', dpr: '3', online: 'true' });
    expect(String(stored?.client_meta).length).toBeLessThan(1000);
    // The client asked to be production. It is not.
    expect(stored?.environment).toBe('local');
  });

  it('answers 401 without a session, not 404', async () => {
    // A 404 here would mean the route landed after the /api/* catch-all in
    // worker/index.ts, which is a mount-order bug and not an auth one.
    const { status } = await callJson('/api/bug-reports', {
      method: 'POST',
      body: JSON.stringify({ body: CONTENT }),
    });
    expect(status).toBe(401);
  });

  it('rejects a cross-origin post', async () => {
    // Built by hand: call() always sets Origin to ours.
    const request = new Request(`${ORIGIN}/api/bug-reports`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
        Cookie: coach,
      },
      body: JSON.stringify({ body: CONTENT }),
    });
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);
    expect(response.status).toBe(403);
  });

  it('still answers 201 when the mail is rejected, and leaves emailed = 0', async () => {
    const resend = stubResend({ status: 500 });
    restore = resend.restore;

    const { status, body } = await report({ body: CONTENT });
    expect(status).toBe(201);
    expect(body.sent).toBe(false);

    const stored = await row(body.id!);
    expect(stored?.body).toBe(CONTENT);
    expect(stored?.emailed).toBe(0);
  });

  it('rate-limits one member after six reports in an hour', async () => {
    restore = stubResend().restore;

    for (let i = 0; i < 6; i += 1) {
      expect((await report({ body: `${CONTENT} ${i}` })).status).toBe(201);
    }
    const { status, body } = await report({ body: 'one too many' });
    expect(status).toBe(429);
    expect(body.error).toBe('too_many_bug_reports');
  });

  it('applies the limit per team, not globally', async () => {
    restore = stubResend().restore;
    const other = await signUpCoach(9502);

    for (let i = 0; i < 6; i += 1) {
      expect((await report({ body: `${CONTENT} ${i}` })).status).toBe(201);
    }
    expect((await report({ body: 'blocked' })).status).toBe(429);

    // A different team is untouched by the first team's spending.
    expect((await report({ body: CONTENT }, other)).status).toBe(201);
  });
});

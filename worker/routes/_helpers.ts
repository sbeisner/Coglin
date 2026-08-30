/**
 * Shared test helpers.
 *
 * These began life private to `auth.test.ts`. Meetings adds four more test
 * files that all need to sign a coach up, hold a session cookie and post JSON,
 * and copying the trio into each of them would mean four places to fix when the
 * signup contract changes.
 *
 * Fixtures are built through the real API rather than raw D1 inserts, which is
 * the existing convention and worth keeping: a test that seeds `members`
 * directly proves the handler works against a row shape no signup flow actually
 * produces. Distinct `team_number` per suite is the isolation key.
 *
 * Not a `.test.ts` file, so vitest does not try to run it as a suite.
 */
import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { expect } from 'vitest';
import worker from '../index';

export const ORIGIN = 'http://coglin.test';

/**
 * One request through the real Worker.
 *
 * The Origin header is always set because `sameOriginOnly` guards every write
 * route; without it, every mutation test would fail as a 403 and the suite
 * would be testing the CSRF guard instead of the handler.
 */
export async function call(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Origin', ORIGIN);
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (init.cookie) headers.set('Cookie', init.cookie);

  const request = new Request(`${ORIGIN}${path}`, { ...init, headers });
  const ctx = createExecutionContext();
  const response = await worker.fetch(request, env, ctx);
  await waitOnExecutionContext(ctx);
  return response;
}

/** POST/PATCH JSON and parse the response, which is most of what tests do. */
export async function callJson<T = Record<string, unknown>>(
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<{ status: number; body: T }> {
  const response = await call(path, init);
  const body = (await response.json().catch(() => ({}))) as T;
  return { status: response.status, body };
}

/** The `coglin_session=...` pair from a Set-Cookie header, ready to send back. */
export function sessionCookie(response: Response): string {
  const raw = response.headers.get('Set-Cookie');
  if (!raw) throw new Error('expected a Set-Cookie header');
  return raw.split(';')[0];
}

export async function signUpCoach(
  teamNumber: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const response = await call('/api/auth/coach-signup', {
    method: 'POST',
    body: JSON.stringify({
      email: `coach${teamNumber}@example.com`,
      password: 'correct horse battery',
      display_name: `Coach ${teamNumber}`,
      team_number: teamNumber,
      team_name: `Team ${teamNumber}`,
      ...overrides,
    }),
  });
  expect(response.status).toBe(201);
  return sessionCookie(response);
}

/**
 * Add a member by walking the real invite flow.
 *
 * Roles matter to almost every permissions assertion in the meetings suite, and
 * the only way to get a student session is to invite and accept one — students
 * are coach-provisioned by design (there is no student signup route to call).
 * Returns their cookie and member id.
 */
export async function inviteAndAccept(
  coachCookie: string,
  options: {
    role: 'mentor' | 'student' | 'viewer';
    handle: string;
    displayName?: string;
    subTeams?: string[];
  },
): Promise<{ cookie: string; handle: string }> {
  const invite = await callJson<{ url: string }>('/api/invites', {
    method: 'POST',
    cookie: coachCookie,
    body: JSON.stringify({
      email: `${options.handle}@example.com`,
      display_name: options.displayName ?? options.handle,
      role: options.role,
      sub_teams: options.subTeams ?? [],
    }),
  });
  expect(invite.status).toBe(201);

  const token = invite.body.url.split('/invite/')[1];
  const accepted = await call(`/api/invites/${token}/accept`, {
    method: 'POST',
    body: JSON.stringify({ handle: options.handle, password: 'correct horse battery' }),
  });
  expect(accepted.status).toBe(201);

  return { cookie: sessionCookie(accepted), handle: options.handle };
}

/** The signed-in member's own row, which tests need for assignee ids. */
export async function whoami(
  cookie: string,
): Promise<{ member_id: string; team_id: string; role: string }> {
  const { body } = await callJson<{
    member: { id: string; role: string };
    team: { id: string };
  }>('/api/auth/me', { cookie });
  return {
    member_id: body.member.id,
    team_id: body.team.id,
    role: body.member.role,
  };
}

/**
 * Keep invite mail off the network.
 *
 * `inviteAndAccept` goes through the real invite route, which posts to Resend
 * whenever RESEND_API_KEY is set — and vitest.config.ts sets it, deliberately,
 * so the invite tests have something to assert on. Any suite that creates an
 * invite therefore has to hold this seam too, or running the tests emails real
 * people. Call from `beforeAll`.
 *
 * Returns a restore function, though suites generally do not need it: each test
 * file gets its own isolate.
 */
export function stubResend(): () => void {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.startsWith('https://api.resend.com')) {
      return realFetch(input as RequestInfo, init);
    }
    return new Response(JSON.stringify({ id: 'test-message-id' }), { status: 200 });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

/**
 * Intercept every api.stripe.com request and answer with a fixed Checkout
 * Session. Same shape as stubResend above.
 *
 * Returns the list of request bodies seen, so a test can assert on what we
 * actually asked Stripe for — the amount clamp is only meaningful if you check
 * the number that crossed the wire, not the one we echoed back to the client.
 */
export function stubStripe(sessionId = 'cs_test_1'): {
  restore: () => void;
  requests: URLSearchParams[];
} {
  const realFetch = globalThis.fetch;
  const requests: URLSearchParams[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (!url.startsWith('https://api.stripe.com')) {
      return realFetch(input as RequestInfo, init);
    }
    // The Stripe SDK posts form-encoded bodies.
    requests.push(new URLSearchParams(String(init?.body ?? '')));
    return new Response(
      JSON.stringify({
        id: sessionId,
        object: 'checkout.session',
        url: `https://checkout.stripe.com/c/pay/${sessionId}`,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }) as typeof fetch;

  return {
    restore: () => {
      globalThis.fetch = realFetch;
    },
    requests,
  };
}

/**
 * Sign a webhook payload the way Stripe does: HMAC-SHA256 over
 * `<timestamp>.<payload>` keyed by the whsec, rendered as `t=...,v1=...`.
 *
 * Written out rather than reached for from the SDK because the point of the
 * webhook tests is that OUR verification accepts a genuine signature and
 * rejects a forged one. A helper that shares code with the verifier would prove
 * only that the two agree.
 */
export async function stripeSignature(
  payload: string,
  secret: string,
  timestamp = Math.floor(Date.now() / 1000),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${timestamp}.${payload}`),
  );
  const hex = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `t=${timestamp},v1=${hex}`;
}

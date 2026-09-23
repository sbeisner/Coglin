import { env, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import worker from './index';

describe('/api/health', () => {
  it('reports ok and reaches D1', async () => {
    const request = new Request('http://example.com/api/health');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; db: string };
    expect(body.status).toBe('ok');
    expect(body.db).toBe('ok');
  });
});

/**
 * Regression guard. A cached `/api/auth/me` is uniquely nasty: the login POST
 * still succeeds and writes a real session row, so the server looks healthy
 * from every angle, while the user is bounced back to the login screen forever
 * by a stale "not signed in" answer. It cannot be reproduced with curl.
 */
describe('API cache headers', () => {
  it('marks every /api response no-store and varying on Cookie', async () => {
    for (const path of ['/api/health', '/api/auth/me', '/api/members']) {
      const ctx = createExecutionContext();
      const response = await worker.fetch(
        new Request(`http://example.com${path}`),
        env,
        ctx,
      );
      await waitOnExecutionContext(ctx);

      expect(response.headers.get('Cache-Control')).toContain('no-store');
      // Without Vary, a shared cache may hand one signed-in user's response to
      // somebody else — a tenancy leak via HTTP rather than SQL.
      expect(response.headers.get('Vary')).toContain('Cookie');
    }
  });
});

describe('unknown API routes', () => {
  it('404s rather than falling through to the SPA shell', async () => {
    const request = new Request('http://example.com/api/nope');
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
  });
});

/**
 * The login bug, as a test.
 *
 * `not_found_handling: "single-page-application"` covers /assets/* too, so a
 * hashed bundle that no longer exists used to answer 200 text/html — the SPA
 * shell — which the /assets/* rule in public/_headers then cached immutable for
 * a year. A browser holding stale HTML after a deploy asked for the previous
 * bundle, was handed HTML under nosniff, refused to execute it, and sat there
 * as a dead page whose Sign in button did nothing.
 *
 * The ASSETS binding is not available under @cloudflare/vitest-pool-workers
 * (`env.ASSETS` is undefined), so these stub it to stand in for the two answers
 * the assets service can give. That makes this a test of the handler's rule
 * rather than of Cloudflare's fallback; the end-to-end check is the curl in the
 * PR description, against a real deployment.
 */
describe('missing hashed assets', () => {
  const withAssets = (response: Response) => ({
    ...env,
    ASSETS: { fetch: async () => response } as unknown as Fetcher,
  });

  it('404s instead of answering with the SPA shell', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('http://example.com/assets/index-DEADBEEF.js'),
      withAssets(
        new Response('<!doctype html><html></html>', {
          headers: { 'content-type': 'text/html' },
        }),
      ),
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type') ?? '').not.toContain('text/html');
    // The year-long immutable cache on a wrong answer is what turned one missed
    // asset into a page that stayed broken.
    expect(response.headers.get('Cache-Control')).toContain('no-store');
  });

  it('passes a real asset through untouched', async () => {
    const ctx = createExecutionContext();
    const response = await worker.fetch(
      new Request('http://example.com/assets/index-BKbMwxaA.js'),
      withAssets(
        new Response('export const a = 1;', {
          headers: {
            'content-type': 'text/javascript',
            'cache-control': 'public, max-age=31536000, immutable',
          },
        }),
      ),
      ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('export const a = 1;');
    // public/_headers still gets to do its job on the assets that do exist.
    expect(response.headers.get('Cache-Control')).toContain('immutable');
  });
});

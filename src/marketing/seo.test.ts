import { describe, expect, it } from 'vitest';
import { PAGES, PRERENDER, SHELL_PAGES } from './seo';

/**
 * Drift guards, in the spirit of capabilities.test.ts.
 *
 * One list now feeds three consumers — scripts/prerender.mjs, the sitemap, and
 * the hydrate-vs-mount decision in src/main.tsx — and the failure mode when they
 * disagree is silent in every local check. A page missing from PRERENDER is
 * served the LANDING page by Cloudflare's SPA fallback and looks fine until
 * someone loads it directly; a noindex page leaking into the sitemap is an
 * invitation to index a sign-in form.
 */
describe('page lists', () => {
  it('has no duplicate paths', () => {
    const paths = PRERENDER.map((p) => p.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('prerenders everything the sitemap advertises', () => {
    for (const page of PAGES) {
      expect(PRERENDER).toContain(page);
      // A sitemap entry is a request to index it, so it cannot be noindex.
      expect(page.noindex).toBeUndefined();
    }
  });

  it('keeps everything outside PAGES out of the index', () => {
    for (const page of PRERENDER) {
      if (PAGES.includes(page as (typeof PAGES)[number])) continue;
      expect(page.noindex).toBe(true);
    }
  });

  /**
   * The direct regression guard for the login bug.
   *
   * Remove these and /login goes back to being served dist/client/index.html —
   * the landing page — which paints, mismatches hydration, and blanks.
   */
  it('prerenders the sign-in and sign-up shells', () => {
    const paths = SHELL_PAGES.map((p) => p.path);
    expect(paths).toContain('/login');
    expect(paths).toContain('/signup');
    for (const page of SHELL_PAGES) expect(PRERENDER).toContain(page);
  });

  /**
   * Every prerendered path must be a real route, or the build writes an HTML
   * file containing the marketing 404. App.tsx does not export its route list,
   * so this is a literal copy — weaker than reading the router, still worth
   * having, and the prerender step's own assertRendered catches the rest.
   */
  it('only lists paths the router actually serves', () => {
    const ROUTES = [
      '/',
      '/features',
      '/awards',
      '/pricing',
      '/faq',
      '/about',
      '/privacy',
      '/terms',
      '/login',
      '/signup',
    ];
    for (const page of PRERENDER) expect(ROUTES).toContain(page.path);
  });
});

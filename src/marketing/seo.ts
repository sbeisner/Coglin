/**
 * Per-route page metadata (COG-050).
 *
 * The site shipped with one <title>, one description and — worse — one
 * canonical URL pointing at "/" on every page. A canonical is an instruction,
 * not a hint: every marketing page was telling Google that the homepage was its
 * canonical version, which is a request to drop /features, /awards, /pricing,
 * /faq and /about from the index entirely. That is strictly worse than having
 * no canonical at all, and it is the reason this module exists.
 *
 * Consumed in three places, which is why it is plain data with no imports:
 *   - scripts/prerender.mjs, to write real <head> tags into static HTML
 *   - the sitemap, generated from PAGES so the two cannot disagree
 *   - src/main.tsx, to decide whether the markup it was served can be hydrated
 *
 * Anything added here must also be added to the router in App.tsx, and the
 * prerender build will fail loudly if a path here does not render.
 */
/**
 * What the prerenderer needs to write a <head>. Split from PageMeta because
 * /login and /signup are prerendered but must never reach the sitemap, and the
 * type is the cheapest place to enforce that: a HeadMeta has no changefreq and
 * no priority to give one.
 */
export interface HeadMeta {
  path: string;
  title: string;
  description: string;
  /**
   * Prerendered for first paint, kept out of the index. Suppresses the
   * canonical and the og/twitter block as well — a sign-in form is not
   * something to preview in Slack.
   */
  noindex?: true;
}

export interface PageMeta extends HeadMeta {
  /** Sitemap hint. The marketing pages genuinely do change at these rates. */
  changefreq: 'weekly' | 'monthly';
  priority: string;
}

export const ORIGIN = 'https://coglin.lilithforge.com';

export const PAGES: PageMeta[] = [
  {
    path: '/',
    title: 'Coglin — run a whole FIRST Tech Challenge season in one place',
    description:
      'One place for a whole FIRST Tech Challenge season: build, programming and CAD boards, meeting notes and attendance, outreach, sponsors, award evidence and portfolio planning.',
    changefreq: 'weekly',
    priority: '1.0',
  },
  {
    path: '/features',
    title: 'Features — Coglin for FTC teams',
    description:
      'Task boards per sub-team, meeting agendas and attendance, a decision log on every task, a tagged media library, and portfolio evidence captured as the season happens.',
    changefreq: 'weekly',
    priority: '0.9',
  },
  {
    path: '/awards',
    title: 'FTC award criteria, and where the evidence comes from — Coglin',
    description:
      'Inspire, Think, Connect, Reach, Sustain, Control, Innovate and Design: what the Competition Manual asks each team to document, and which part of Coglin keeps it.',
    changefreq: 'monthly',
    priority: '0.9',
  },
  {
    path: '/pricing',
    title: 'Pricing — pay what you think is fair — Coglin',
    description:
      'Coglin is still being built and you set the price. We recommend $12 per seat for the season. One payment, not a subscription, and nothing is gated behind it.',
    changefreq: 'monthly',
    priority: '0.8',
  },
  {
    path: '/faq',
    title: 'FAQ — Coglin for FTC teams',
    description:
      'Is it official, how do accounts work for students under 13, what happens to your data after the season, and how a school pays by purchase order.',
    changefreq: 'monthly',
    priority: '0.7',
  },
  {
    path: '/about',
    title: 'About — Coglin, built by an FTC coach',
    description:
      'Coglin comes from Lilith Forge and is written during a live season by a coach for the team he coaches. Unofficial, and permanently so.',
    changefreq: 'monthly',
    priority: '0.6',
  },
  {
    path: '/privacy',
    title: 'Privacy — what Coglin knows about your team — Coglin',
    description:
      'What Coglin stores about coaches and students, who processes it, and how to get it out or deleted. No student emails, no analytics, no ads.',
    changefreq: 'monthly',
    priority: '0.3',
  },
  {
    path: '/terms',
    title: 'Terms of service — Coglin',
    description:
      'The agreement in plain language: who can use Coglin, what a purchase buys, whose content it is, and what the alpha does and does not promise.',
    changefreq: 'monthly',
    priority: '0.3',
  },
];

/**
 * Prerendered, but not marketing.
 *
 * /login and /signup used to be served by the SPA fallback, which hands out
 * dist/client/index.html — the prerendered LANDING page. A full page load of
 * the sign-in screen therefore painted the landing page, hydrated React against
 * markup for a route the router was not on, mismatched the whole root and threw
 * it away, and then showed nothing at all while the session resolved. Clicking
 * "Sign in" looked like it had done something and then failed.
 *
 * Prerendering them costs two files and removes that entire sequence.
 */
export const SHELL_PAGES: HeadMeta[] = [
  {
    path: '/login',
    title: 'Sign in — Coglin',
    description: 'Sign in to your team on Coglin.',
    noindex: true,
  },
  {
    path: '/signup',
    title: 'Create your team — Coglin',
    description: 'Start a new team on Coglin.',
    noindex: true,
  },
];

/**
 * Every path written to static HTML at build time.
 *
 * One list with three consumers, so they cannot drift: scripts/prerender.mjs
 * walks it, src/main.tsx decides hydrate-vs-mount by it, and the sitemap
 * deliberately does NOT use it — that stays on PAGES, so nothing noindexed can
 * be advertised to a crawler.
 */
export const PRERENDER: HeadMeta[] = [...PAGES, ...SHELL_PAGES];

/** Shared across every page; only title and description vary per route. */
export const SITE_NAME = 'Coglin';
export const OG_IMAGE = `${ORIGIN}/og-card.png`;

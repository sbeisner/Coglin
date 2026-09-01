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
 * Consumed in two places, which is why it is plain data with no imports:
 *   - scripts/prerender.mjs, to write real <head> tags into static HTML
 *   - the sitemap, generated from the same list so the two cannot disagree
 *
 * Anything added here must also be added to the router in main.tsx, and the
 * prerender build will fail loudly if a path here does not render.
 */
export interface PageMeta {
  path: string;
  title: string;
  description: string;
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

/** Shared across every page; only title and description vary per route. */
export const SITE_NAME = 'Coglin';
export const OG_IMAGE = `${ORIGIN}/og-card.png`;

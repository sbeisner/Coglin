#!/usr/bin/env node
/**
 * Render the marketing pages to real HTML at build time (COG-050).
 *
 * WHY
 *
 * The whole site is one SPA shell, so what a crawler received was
 * `<div id="root"></div>` and nothing else. Google will run the JavaScript on a
 * second, slower pass; Bing is less reliable about it; and the link-preview
 * scrapers behind Slack, Discord, iMessage and LinkedIn do not run it at all.
 * Every shared link fell back to one generic card.
 *
 * It also fixes the metadata problem underneath that. Every route was served
 * the same <title>, the same description, and — the actively harmful one — the
 * same `<link rel="canonical" href="/">`, which instructs Google that the
 * homepage is the canonical version of /features, /awards, /pricing, /faq and
 * /about. That is a request to deindex all five.
 *
 * HOW
 *
 * `vite build --config vite.ssr.config.ts` compiles src/entry-server.tsx to a
 * Node-loadable bundle,
 * this renders each route in PRERENDER, and the markup plus per-route <head>
 * tags are written into dist/client/<route>.html. Cloudflare's static assets
 * serve those directly; anything not prerendered still falls through to the SPA
 * shell, which is what /app/* and /invite/:token rely on.
 *
 * PRERENDER is PAGES plus the noindex SHELL_PAGES (/login, /signup). Those are
 * here for a different reason than SEO: the SPA fallback serves index.html —
 * the LANDING page — for anything unprerendered, so a full page load of /login
 * painted the landing page, hydrated against the wrong markup, and went blank.
 *
 * The client hydrates rather than remounts — see the note in src/main.tsx.
 *
 * Run as part of `npm run build`. It is not optional: shipping a build without
 * it silently reverts the site to one title and a deindexing canonical.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

const CLIENT = 'dist/client';
const SSR_OUT = 'dist/ssr';

if (!existsSync(join(CLIENT, 'index.html'))) {
  console.error('No dist/client/index.html — run `vite build` first.');
  process.exit(1);
}

// Built here rather than as a second vite.config entry so the client build is
// untouched and this stays a build STEP, not a build mode.
execFileSync('npx', ['vite', 'build', '--config', 'vite.ssr.config.ts', '--logLevel', 'warn'], {
  stdio: 'inherit',
});

const bundle = pathToFileURL(join(process.cwd(), SSR_OUT, 'entry-server.js')).href;
const { render, PAGES, PRERENDER, ORIGIN, SITE_NAME } = await import(bundle);

const template = readFileSync(join(CLIENT, 'index.html'), 'utf8');

function escapeAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function headFor(page) {
  const url = `${ORIGIN}${page.path}`;
  // A noindex page gets a title and a description so a human sees the right tab
  // and nothing else. No canonical (there is no indexable version to point at)
  // and no og/twitter block (a sign-in form is not a link preview worth having).
  if (page.noindex) {
    return [
      `<title>${escapeAttr(page.title)}</title>`,
      `<meta name="description" content="${escapeAttr(page.description)}" />`,
      `<meta name="robots" content="noindex" />`,
    ].join('\n    ');
  }
  return [
    `<title>${escapeAttr(page.title)}</title>`,
    `<meta name="description" content="${escapeAttr(page.description)}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:site_name" content="${SITE_NAME}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:title" content="${escapeAttr(page.title)}" />`,
    `<meta property="og:description" content="${escapeAttr(page.description)}" />`,
    `<meta name="twitter:card" content="summary" />`,
    `<meta name="twitter:title" content="${escapeAttr(page.title)}" />`,
    `<meta name="twitter:description" content="${escapeAttr(page.description)}" />`,
  ].join('\n    ');
}

/**
 * Fail the build rather than ship a page that renders to nothing useful.
 *
 * In the spirit of this file's own "it is not optional" note above: a prerender
 * regression is silent at runtime and expensive in the wild, and this is the one
 * moment it is cheap to catch. The two named checks are the specific regressions
 * this step was extended to prevent — restoring `return null` in
 * RedirectIfSignedIn would empty /login, and restoring the `signedIn ? … : …`
 * ternary in MarketingShell would drop one of the two header CTAs that the
 * pre-hydration CSS in index.css chooses between.
 */
const MUST_CONTAIN = {
  '/login': ['<form'],
  '/signup': ['<form'],
  '/': ['Open Coglin', 'Sign in'],
};

function assertRendered(page, html) {
  if (html.trim().length < 500) {
    console.error(`\n${page.path} rendered ${html.trim().length} chars — that is not a page.`);
    process.exit(1);
  }
  for (const needle of MUST_CONTAIN[page.path] ?? []) {
    if (!html.includes(needle)) {
      console.error(`\n${page.path} is missing ${JSON.stringify(needle)}.`);
      process.exit(1);
    }
  }
}

let written = 0;
for (const page of PRERENDER) {
  const html = render(page.path);
  assertRendered(page, html);
  const out = template
    // The template's <head> carries the placeholder tags from index.html; strip
    // them so a page never ships two titles or two canonicals.
    //
    // `<meta\s+`, not `<meta `: prettier wraps the long tags in index.html onto
    // their own lines, so the attribute is preceded by a newline and two spaces,
    // and a literal space matched none of them. Every prerendered page has been
    // shipping two <meta name="description"> and two og:title tags since COG-050
    // because of it — visible in production with
    // `curl -s .../features | grep -c 'name="description"'` returning 2. The
    // stripping is also global now: there is more than one of each to remove.
    .replace(/<title>[\s\S]*?<\/title>/, '<!--head-->')
    .replace(/\s*<meta\s+name="description"[\s\S]*?\/>/g, '')
    .replace(/\s*<link\s+rel="canonical"[^>]*>/g, '')
    .replace(/\s*<meta\s+property="og:[\s\S]*?\/>/g, '')
    .replace(/\s*<meta\s+name="twitter:[\s\S]*?\/>/g, '')
    .replace('<!--head-->', headFor(page))
    .replace('<div id="root"></div>', `<div id="root">${html}</div>`);

  // Flat `<route>.html`, not `<route>/index.html`. With directory-style files
  // Cloudflare Assets 307s /features to /features/, which is an extra hop on
  // every marketing page and disagrees with the canonical URLs, which carry no
  // trailing slash. `html_handling: drop-trailing-slash` did not change it.
  const file = page.path === '/' ? join(CLIENT, 'index.html') : join(CLIENT, `${page.path.slice(1)}.html`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, out);
  written += 1;
  console.error(`  prerendered ${page.path}`);
}

// The sitemap is generated from PAGES, not PRERENDER, so it cannot list a page
// that does not exist, miss one that does, or advertise a noindex page like
// /login to a crawler.
const now = new Date().toISOString().slice(0, 10);
writeFileSync(
  join(CLIENT, 'sitemap.xml'),
  `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    PAGES.map(
      (p) =>
        `  <url>\n    <loc>${ORIGIN}${p.path}</loc>\n    <lastmod>${now}</lastmod>\n` +
        `    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`,
    ).join('\n') +
    `\n</urlset>\n`,
);

rmSync(SSR_OUT, { recursive: true, force: true });
console.error(`\nPrerendered ${written} pages and wrote sitemap.xml`);

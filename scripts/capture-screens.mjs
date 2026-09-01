#!/usr/bin/env node
/**
 * Marketing screenshots, taken of the real application (COG-049).
 *
 * WHY A SCRIPT AND NOT A FOLDER OF PNGS SOMEBODY MADE ONCE
 *
 * Screenshots rot. The UI moves, the shots stay, and eighteen months later the
 * marketing site is advertising a product that no longer looks like that. This
 * regenerates all of them from a seeded database in one command, so refreshing
 * them is cheap enough to actually do.
 *
 * WHAT IT IS ALLOWED TO PHOTOGRAPH
 *
 * A LOCAL dev server against a LOCAL database seeded by scripts/seed-demo.mjs.
 * Never staging, never production. Production is one real team, six of whom are
 * minors, and their attendance record and meeting notes are not marketing
 * assets. The BASE default is localhost and the script refuses anything else
 * unless you go out of your way, which is the point.
 *
 * Only screens that genuinely work get captured — see the SHOTS list. A
 * screenshot is the strongest claim this site makes, so photographing a stub
 * would undo every careful "This season" label on the rest of the pages.
 *
 * Usage:
 *   node scripts/seed-demo.mjs --out /tmp/demo.sql
 *   npx wrangler d1 execute coglin-staging --local --file /tmp/demo.sql
 *   npm run dev                       # in another terminal
 *   node scripts/capture-screens.mjs
 *
 * Chromium comes from the Playwright browser cache. playwright-core is a
 * devDependency and downloads nothing; if the cache is missing, install it with
 * `npx playwright install chromium`.
 *
 * Output is WebP, converted through python3 + Pillow. Playwright only writes PNG
 * or JPEG, and a 2x PNG of a text-heavy UI is enormous: the decision-log frame
 * was 423KB as a PNG and is 88KB as WebP at the same quality to the eye. Seven
 * of those is the difference between a 1.4MB landing page and a 250KB one. JPEG
 * was the other option and loses: it rings around small text, which is most of
 * what these images are.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const BASE = process.env.CAPTURE_BASE ?? 'http://localhost:5174';
const OUT = 'src/marketing/screens';
const TMP = join(tmpdir(), 'coglin-screens');
/** High enough that UI text stays clean; below this, edges start to fringe. */
const WEBP_QUALITY = 88;

/** Convert a PNG to WebP in place and drop the PNG. */
function toWebp(pngPath, webpPath) {
  execFileSync('python3', ['-c', `
import sys
from PIL import Image
src, dst, q = sys.argv[1], sys.argv[2], int(sys.argv[3])
Image.open(src).convert('RGB').save(dst, 'WEBP', quality=q, method=6)
`, pngPath, webpPath, String(WEBP_QUALITY)], { stdio: ['ignore', 'ignore', 'pipe'] });
}

try {
  execFileSync('python3', ['-c', 'import PIL'], { stdio: 'ignore' });
} catch {
  console.error(
    'This needs python3 with Pillow to write WebP (pip3 install Pillow).\n' +
      'Playwright itself only emits PNG and JPEG.',
  );
  process.exit(1);
}
const EMAIL = 'demo@example.invalid';
const PASSWORD = 'screenshot demo only';

if (!/^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(BASE)) {
  console.error(
    `Refusing to capture from ${BASE}.\n` +
      'These screenshots go on a public website and the only database that may ' +
      'appear in them is a local one seeded with invented data.',
  );
  process.exit(1);
}

/** Find the Playwright-managed Chromium without pulling in the full package. */
function findChromium() {
  const root = join(homedir(), 'Library/Caches/ms-playwright');
  if (!existsSync(root)) return null;
  const dir = readdirSync(root).filter((d) => d.startsWith('chromium-')).sort().pop();
  if (!dir) return null;
  const exe = join(root, dir, 'chrome-mac-arm64',
    'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  return existsSync(exe) ? exe : null;
}

/**
 * Each shot names the screen, the path, and how tall the frame should be.
 *
 * `wait` is a selector that must exist before the shutter, because a screenshot
 * of a loading state is worse than no screenshot: the app draws skeletons and
 * they photograph as broken layout.
 */
const SHOTS = [
  { name: 'boards', path: '/app/boards', h: 620,
    wait: 'text=Rebuild the intake', label: 'Boards, one per sub-team' },
  // Same route, but with the task dialog open. Split from the shot above
  // because the dialog blurs its backdrop, so one frame cannot show both the
  // board and the decision log -- and the decision log is the single strongest
  // thing in the product.
  { name: 'decision-log', path: '/app/boards', h: 900,
    wait: 'text=Rebuild the intake', openTask: true,
    label: 'The decision log on a task' },
  { name: 'meetings', path: '/app/meetings?view=calendar', h: 820,
    wait: 'text=Calendar', label: 'The season on one calendar' },
  { name: 'notes', path: '/app/notes', h: 680,
    wait: 'text=Intake redesign', label: 'Meeting notes as nested documents' },
  { name: 'roster', path: '/app/roster', h: 720,
    wait: 'text=Roster', label: 'Coach-provisioned roster' },
  { name: 'portfolio', path: '/app/portfolio', h: 720,
    wait: 'text=Candidates', label: 'Portfolio evidence inbox' },
  { name: 'dashboard', path: '/app', h: 700,
    wait: 'text=Dashboard', label: 'Dashboard' },
];

const exe = findChromium();
if (!exe) {
  console.error('No Playwright Chromium found. Run: npx playwright install chromium');
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });

const browser = await chromium.launch({ executablePath: exe });
// 2x so the images stay crisp on the displays these get looked at on. Light
// only: Coglin is light-first (plan §4) and that is what a visitor sees on
// signing in.
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
});
const page = await context.newPage();

// Sign in through the real form path rather than injecting a cookie, so a
// broken login fails here loudly instead of producing six screenshots of the
// login screen.
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
// The login screen opens on the Student tab (team number + handle), because
// that is who signs in most often. The coach fields are behind the second tab
// and do not exist in the DOM until it is selected.
await page.click('button[role=tab]:has-text("Coach or mentor")');
await page.waitForSelector('#email', { timeout: 10000 });
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type=submit]');
await page.waitForURL(/\/app/, { timeout: 15000 });

// The theme is stored per browser profile; force light so a stale preference in
// a reused profile cannot silently produce dark screenshots.
await page.evaluate(() => {
  try { localStorage.setItem('coglin.theme', 'light'); } catch {}
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = 'light';
});

for (const shot of SHOTS) {
  await page.setViewportSize({ width: 1280, height: shot.h });
  await page.goto(`${BASE}${shot.path}`, { waitUntil: 'networkidle' });
  if (shot.wait) {
    await page.waitForSelector(shot.wait, { timeout: 15000 }).catch(() => {
      console.error(`  ! ${shot.name}: never saw ${shot.wait}`);
    });
  }
  if (shot.openTask) {
    await page.click('text=Rebuild the intake').catch(() => {});
    await page.waitForTimeout(700);
    // The dialog autofocuses its title input, which photographs as a selected
    // blue block across the heading. Drop focus and clear the selection.
    await page.evaluate(() => {
      const el = document.activeElement;
      if (el instanceof HTMLElement) el.blur();
      window.getSelection()?.removeAllRanges();
    });
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(400); // let fonts settle
  const png = join(TMP, `${shot.name}.png`);
  const webp = join(OUT, `${shot.name}.webp`);
  await page.screenshot({ path: png });
  toWebp(png, webp);
  console.error(`  captured ${shot.name}.webp`);
}

await browser.close();
rmSync(TMP, { recursive: true, force: true });
console.error(`\nWrote ${SHOTS.length} screenshots to ${OUT}/`);

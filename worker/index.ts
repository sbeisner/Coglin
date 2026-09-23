import { Hono } from 'hono';
import { auth } from './routes/auth';
import { invites } from './routes/invites';
import { passwords } from './routes/passwords';
import { bugs } from './routes/bugs';
import { team } from './routes/team';
import { boards } from './routes/boards';
import { candidates } from './routes/candidates';
import { finance } from './routes/finance';
import { funds } from './routes/funds';
import { media, mediaFiles } from './routes/media';
import { meetings } from './routes/meetings';
import { meetingNotes } from './routes/notes';
import { docs } from './routes/docs';
import { newsletters } from './routes/newsletters';
import { records } from './routes/records';
import { series } from './routes/series';
import { sponsorship } from './routes/sponsorship';
import { billing } from './routes/billing';
import { scheduled } from './backup';
import type { AppEnv } from './lib/tenancy';

const app = new Hono<AppEnv>();

/**
 * Nothing under /api may ever be cached.
 *
 * Every response here is scoped to one session, and `GET /api/auth/me` is the
 * dangerous one: the client asks it on every boot to decide between the app and
 * the login screen. If anything between the Worker and the browser holds on to
 * an `{"authenticated":false}` answer, a user who has just signed in gets sent
 * straight back to the login screen — and because the POST that created their
 * session was never cached, the session row exists and looks perfectly healthy
 * from the server side. That failure is invisible in logs and impossible to
 * reproduce from a shell.
 *
 * `Vary: Cookie` is the second half: without it, a shared cache is entitled to
 * serve one signed-in user's response to a different user. That is a tenancy
 * leak by way of HTTP semantics rather than SQL.
 *
 * The Inkubus website sets no-store on every /api response for the same reason
 * (`website/inkubus/functions/_lib/json.js`); this port dropped it, which is
 * the bug this middleware fixes.
 */
app.use('/api/*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.header('Pragma', 'no-cache');
  c.header('Vary', 'Cookie');
});

// Health check. Touches D1 on purpose — a 200 here means the binding resolved,
// not just that the Worker booted. Phase 0 verification depends on that.
app.get('/api/health', async (c) => {
  const started = Date.now();
  let db: 'ok' | 'error' = 'ok';
  let dbError: string | undefined;

  try {
    await c.env.DB.prepare('SELECT 1').first();
  } catch (err) {
    db = 'error';
    dbError = err instanceof Error ? err.message : String(err);
  }

  return c.json(
    {
      status: db === 'ok' ? 'ok' : 'degraded',
      environment: c.env.ENVIRONMENT ?? 'local',
      db,
      dbError,
      ms: Date.now() - started,
    },
    db === 'ok' ? 200 : 503,
  );
});

app.route('/api/auth', auth);
// Second router on the same prefix, the way `meetingNotes` and `meetings` share
// /api/meetings. The paths are disjoint from auth's (login, logout, me,
// coach-signup), and mounting here keeps the whole feature above the bare-path
// routers further down.
app.route('/api/auth', passwords);
app.route('/api/invites', invites);
app.route('/api/bug-reports', bugs);
// `meetingNotes` is mounted first because it claims the deeper paths under a
// meeting (/:id/agenda, /:id/start); `meetings` owns /:id itself.
app.route('/api/meetings', meetingNotes);
app.route('/api/meetings', meetings);
app.route('/api/series', series);
// Note DOCUMENTS are their own top-level resource, not a meeting sub-resource: a
// document may belong to no meeting, and its id must not change when it is
// dragged to another one. See the header of routes/docs.ts.
app.route('/api/notes', docs);
app.route('/api/portfolio', candidates);
app.route('/api/finance', finance);
// The sponsor half of the finance section, sharing the prefix so the client
// keeps one /api/finance surface. Mounted after `finance` — the two declare
// disjoint paths, and Hono tries them in mount order.
app.route('/api/finance', sponsorship);
// The third file on the finance prefix: which pot money came out of, and which
// pots expire. Disjoint paths from the two above.
app.route('/api/finance', funds);
app.route('/api/media', media);
// Both declare full paths ('/boards', '/meetings/:id/attendance') rather than a
// prefix, so they mount at /api alongside `team`.
app.route('/api', boards);
app.route('/api', records);
// Declares full paths ('/newsletters', '/contacts') like boards and records,
// so it mounts at /api alongside them — and before `team`, whose bare paths
// would otherwise shadow siblings.
app.route('/api', newsletters);
// Mounted last of the /api routes because `team` declares bare paths ('/team',
// '/members') rather than a prefix, so it would otherwise shadow siblings.
app.route('/api', team);

// Public and unauthenticated, unlike everything above it — a coach can pay
// before they have an account, and Stripe posts the webhook with no session at
// all. Neither route touches a tenant table; see routes/billing.ts.
app.route('/api/billing', billing);

app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));

// Image bytes, mounted OUTSIDE /api on purpose: the no-store middleware above
// would otherwise make every photo a fresh round trip forever. wrangler.jsonc
// already reserves /media/* in run_worker_first on all three environments.
app.route('/media', mediaFiles);

/**
 * A hashed asset that no longer exists must 404 — it must NOT fall back to HTML.
 *
 * `not_found_handling: "single-page-application"` applies to /assets/* as well,
 * so before this handler a stale bundle URL answered:
 *
 *     $ curl -sSI https://coglin.lilithforge.com/assets/index-DEADBEEF.js
 *     HTTP/2 200
 *     content-type: text/html
 *     cache-control: public, max-age=31536000, immutable
 *     x-content-type-options: nosniff
 *
 * which is the login bug in full. After a deploy, a browser holding stale HTML
 * asks for the previous index-<hash>.js, is handed the landing page as
 * text/html under nosniff, and refuses to execute it. React never boots, so the
 * header keeps the "Sign in" baked into the prerendered markup, and clicking it
 * is a full page load onto equally inert HTML. Nothing on the page works, no
 * error reaches the server, and it clears up by itself once the HTML
 * revalidates — which is exactly why it got reported as random and
 * cache-dependent rather than as "the site is down".
 *
 * The `immutable` above is what made it stick: the browser cached the wrong
 * answer for a year against a URL it would otherwise have retried.
 *
 * Nothing Vite emits under /assets/ is HTML, so text/html here always means the
 * fallback fired. The cost is a Worker invocation per asset request — bounded,
 * because these are immutable and cached at both the edge and the browser, and
 * cheap set against a failure mode that is invisible in logs.
 */
app.all('/assets/*', async (c) => {
  const response = await c.env.ASSETS.fetch(c.req.raw);
  if (!(response.headers.get('content-type') ?? '').includes('text/html')) {
    return response;
  }
  return c.text('not_found', 404, { 'Cache-Control': 'no-store' });
});

// Exported as an object rather than the Hono app itself, because the Worker now
// has a second entry point: the nightly backup cron (COG-040).
export default {
  fetch: app.fetch,
  scheduled,
};

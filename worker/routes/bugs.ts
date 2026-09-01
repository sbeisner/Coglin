/**
 * In-app bug reports (COG-0xx, alpha).
 *
 * One route, one verb. A tester presses a button in the sidebar, types a
 * sentence, and this commits a row and then mails the operator inbox — in that
 * order, the same way invites do. A mail outage degrades the result
 * (`sent: false`) rather than failing the operation, because the report is
 * already safe in D1 and telling a tester their report vanished is how you
 * teach them to stop sending them.
 *
 * NO ROLE GATE, deliberately. Every other write route in this app asks who you
 * are; this one only asks that you are on a team. A viewer is a parent looking
 * at a screen that just broke, and their report is worth exactly as much as the
 * coach's. If you are here to add `requireRole`, the tests below will tell you
 * the same thing.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import { boundedInt, optionalString, readJson } from '../lib/http';
import { sendBugReport } from '../lib/email';
import {
  auth as authOf,
  requireMember,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const bugs = new Hono<AppEnv>();

const KINDS = ['bug', 'confusing', 'idea'] as const;
type Kind = (typeof KINDS)[number];

function isKind(value: unknown): value is Kind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value);
}

/** Long enough for a pasted stack trace, short enough to read in an email. */
const MAX_BODY = 4000;
/** Below this it is a mis-click, not a report. */
const MIN_BODY = 4;

const RATE_WINDOW = 60 * 60;
/** A tester on a genuinely broken build files three or four in an hour. Six
 *  leaves headroom and still bounds a bored student with a fetch loop. */
const MAX_PER_MEMBER = 6;
/** A 15-student roster all hitting problems at one meeting is the legitimate
 *  worst case. Thirty is above it and far below anything that costs money. */
const MAX_PER_TEAM = 30;

/**
 * The client fields allowed into `client_meta`, with a per-value cap.
 *
 * A whitelist rather than a passthrough: the alternative is a signed-in student
 * with devtools writing arbitrary bytes into our database. Adding a key here is
 * a one-line change, which is the entire argument for the blob (see the header
 * of migrations/0008_bug_reports.sql).
 */
const META_KEYS: [key: string, cap: number][] = [
  ['dpr', 8],
  ['timezone', 60],
  ['language', 20],
  ['theme', 12],
  ['online', 8],
];
const MAX_META = 1000;

bugs.post('/', sameOriginOnly, requireMember, async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  // optionalString TRUNCATES at the cap rather than rejecting, which is the
  // right behaviour here: a tester who pastes a stack trace should get their
  // report filed, not a validation error about length.
  const description = optionalString(body.body, MAX_BODY);
  if (!description || description.length < MIN_BODY)
    return c.json({ error: 'missing_description' }, 400);

  // An unknown kind falls back rather than 400 — a client running a stale
  // bundle should still be able to report the bug that made it stale.
  const kind: Kind = isKind(body.kind) ? body.kind : 'bug';

  const { member, teamId } = authOf(c);
  const now = nowSeconds();

  // Both bounds in one read, hitting idx_bug_reports_team. Same shape as
  // MAX_PENDING in routes/invites.ts. Note the bind order: the SUM's parameter
  // appears first in the SQL text.
  const counts = await c.env.DB.prepare(
    `SELECT COUNT(*) AS team_n,
            SUM(CASE WHEN reported_by_member_id = ? THEN 1 ELSE 0 END) AS mine
       FROM bug_reports
      WHERE team_id = ? AND created_at > ?`,
  )
    .bind(member.id, teamId, now - RATE_WINDOW)
    .first<{ team_n: number; mine: number | null }>();

  // One code for both bounds. The reporter's remedy is identical either way,
  // and saying which limit was hit only helps someone probing.
  if ((counts?.mine ?? 0) >= MAX_PER_MEMBER || (counts?.team_n ?? 0) >= MAX_PER_TEAM)
    return c.json({ error: 'too_many_bug_reports' }, 429);

  const team = await c.env.DB.prepare(
    'SELECT team_number, name FROM teams WHERE id = ?',
  )
    .bind(teamId)
    .first<{ team_number: number; name: string }>();
  if (!team) return c.json({ error: 'not_found' }, 404);

  const route = optionalString(body.route, 300);
  const appBuild = optionalString(body.app_build, 60);
  const userAgent = optionalString(body.user_agent, 400);
  const viewportW = boundedInt(body.viewport_w, 0, 20_000);
  const viewportH = boundedInt(body.viewport_h, 0, 20_000);

  // Built here from META_KEYS, never from the client's own object. Numbers and
  // booleans are stringified so the blob is uniformly Record<string, string>
  // and the mail can render it without type checks.
  const meta: Record<string, string> = {};
  for (const [key, cap] of META_KEYS) {
    const raw = body[key];
    const value =
      typeof raw === 'number' && Number.isFinite(raw)
        ? String(raw)
        : typeof raw === 'boolean'
          ? String(raw)
          : optionalString(raw, cap);
    if (value) meta[key] = value.slice(0, cap);
  }
  // Belt and braces on top of the per-value caps: whatever META_KEYS grows to,
  // the column stays bounded.
  const clientMeta = JSON.stringify(meta).slice(0, MAX_META);

  const id = uuid();
  const environment = c.env.ENVIRONMENT ?? 'local';

  await c.env.DB.prepare(
    `INSERT INTO bug_reports
       (id, team_id, reported_by_member_id, role, kind, body, route, app_build,
        environment, user_agent, viewport_w, viewport_h, client_meta, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      teamId,
      member.id,
      member.role,
      kind,
      description,
      route,
      appBuild,
      // Ours, not the client's word for it. A report claiming to be from
      // production would otherwise be one fetch away.
      environment,
      userAgent,
      viewportW,
      viewportH,
      clientMeta,
      now,
    )
    .run();

  // Mail after the row is committed, exactly as invites do.
  const sent = await sendBugReport(c.env, {
    id,
    kind,
    body: description,
    reporterName: member.display_name,
    role: member.role,
    teamNumber: team.team_number,
    teamName: team.name,
    route,
    appBuild,
    environment,
    userAgent,
    viewport: viewportW && viewportH ? `${viewportW}x${viewportH}` : null,
    meta,
    at: now,
  });

  if (sent) {
    await c.env.DB.prepare('UPDATE bug_reports SET emailed = 1 WHERE id = ?')
      .bind(id)
      .run();
  }

  // `id` is returned so a tester can quote it in the alpha channel. `sent` so
  // the dialog can be honest about what did and did not happen.
  return c.json({ ok: true, id, sent }, 201);
});

export { bugs };

/**
 * Authentication (COG-006).
 *
 * Two login shapes, one session mechanism:
 *
 *   adults    email + password
 *   students  team_number + handle + password
 *
 * Students have no email by design (COPPA, plan §6), so their credential has to
 * carry the tenant in it. A handle is only unique within a team, which is why
 * the team number is part of the credential rather than a convenience.
 */
import { Hono } from 'hono';
import {
  DUMMY_HASH,
  hashPassword,
  nowSeconds,
  uuid,
  verifyPassword,
} from '../lib/crypto';
import {
  clearSessionCookie,
  createSession,
  destroySession,
  getSessionUser,
} from '../lib/session';
import { sameOriginOnly, type AppEnv } from '../lib/tenancy';

const auth = new Hono<AppEnv>();

const MIN_PASSWORD = 8;
const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;

/**
 * The FTC season runs Sept 1 - May 31. Signing up in August lands you in the
 * season about to start, not the one that just ended — which is the whole
 * point, since that is exactly when teams set up for kickoff.
 */
export function currentSeason(now: number): {
  label: string;
  starts_at: number;
  ends_at: number;
} {
  const d = new Date(now * 1000);
  const year = d.getUTCFullYear();
  const startYear = d.getUTCMonth() >= 7 ? year : year - 1; // Aug or later
  return {
    label: `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`,
    starts_at: Math.floor(Date.UTC(startYear, 8, 1) / 1000),
    ends_at: Math.floor(Date.UTC(startYear + 1, 4, 31, 23, 59, 59) / 1000),
  };
}

async function readJson(c: {
  req: { json: () => Promise<unknown> };
}): Promise<Record<string, unknown> | null> {
  try {
    const body = await c.req.json();
    return body && typeof body === 'object'
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * Bootstrap a team and its first coach. Open to anyone.
 *
 * This used to require ALPHA_SIGNUP_CODE, on the reasoning that production sits
 * at a guessable URL and nobody should be able to mint a team by finding it.
 * That became incoherent the moment the pricing page went live: the site asked
 * for money and then refused the buyer an account, because the code was
 * something you had to email and ask for. Charging for a door you have to be
 * let through is not a funnel.
 *
 * WHAT OPENING IT COSTS, and it is worth knowing rather than discovering:
 * `teams.team_number` is UNIQUE and nothing verifies that you belong to the
 * team you claim. Numbers are public, so a stranger or a typo can take one and
 * the real team then gets `already_exists` and cannot register. It is
 * recoverable — delete the row — but somebody has to notice. A rate-limit rule
 * on this path is the cheap mitigation; real verification is manual by design
 * (plan §6) and does not exist yet.
 */
auth.post('/coach-signup', sameOriginOnly, async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  const password = String(body.password ?? '');
  const displayName = String(body.display_name ?? '').trim();
  const teamNumber = Number(body.team_number);
  const teamName = String(body.team_name ?? '').trim();
  const region = body.region ? String(body.region).trim() : null;

  if (!email.includes('@')) return c.json({ error: 'invalid_email' }, 400);
  if (password.length < MIN_PASSWORD)
    return c.json({ error: 'weak_password', min: MIN_PASSWORD }, 400);
  if (!displayName) return c.json({ error: 'missing_display_name' }, 400);
  if (!Number.isInteger(teamNumber) || teamNumber <= 0)
    return c.json({ error: 'invalid_team_number' }, 400);
  if (!teamName) return c.json({ error: 'missing_team_name' }, 400);

  const now = nowSeconds();
  const userId = uuid();
  const teamId = uuid();
  const seasonId = uuid();
  const memberId = uuid();
  const season = currentSeason(now);
  const passwordHash = await hashPassword(password);

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, is_minor, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)`,
      ).bind(userId, email, passwordHash, now, now),
      c.env.DB.prepare(
        `INSERT INTO teams (id, team_number, name, region, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).bind(teamId, teamNumber, teamName, region, now),
      c.env.DB.prepare(
        `INSERT INTO seasons (id, team_id, label, starts_at, ends_at, is_current)
         VALUES (?, ?, ?, ?, ?, 1)`,
      ).bind(seasonId, teamId, season.label, season.starts_at, season.ends_at),
      c.env.DB.prepare(
        `INSERT INTO members (id, team_id, user_id, role, sub_teams, display_name, handle, status, created_at)
         VALUES (?, ?, ?, 'coach', '[]', ?, NULL, 'active', ?)`,
      ).bind(memberId, teamId, userId, displayName, now),
    ]);
  } catch (err) {
    // The two unique indexes reachable here are users.email and
    // teams.team_number. Both mean "already exists", and neither should leak
    // which one to an unauthenticated caller beyond that.
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE')) return c.json({ error: 'already_exists' }, 409);
    throw err;
  }

  const cookie = await createSession(c.env, userId);
  return c.json(
    { ok: true, team: { id: teamId, team_number: teamNumber, name: teamName } },
    201,
    { 'Set-Cookie': cookie },
  );
});

auth.post('/login', sameOriginOnly, async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const password = String(body.password ?? '');
  const hasHandle = body.handle != null && body.handle !== '';

  let row: { id: string; password_hash: string } | null = null;

  if (hasHandle) {
    const handle = String(body.handle).trim().toLowerCase();
    const teamNumber = Number(body.team_number);
    if (Number.isInteger(teamNumber)) {
      row = await c.env.DB.prepare(
        `SELECT u.id AS id, u.password_hash AS password_hash
           FROM members m
           JOIN teams t ON t.id = m.team_id
           JOIN users u ON u.id = m.user_id
          WHERE t.team_number = ? AND m.handle = ? AND m.status = 'active'`,
      )
        .bind(teamNumber, handle)
        .first<{ id: string; password_hash: string }>();
    }
  } else {
    const email = String(body.email ?? '')
      .trim()
      .toLowerCase();
    if (email) {
      row = await c.env.DB.prepare(
        'SELECT id, password_hash FROM users WHERE email = ?',
      )
        .bind(email)
        .first<{ id: string; password_hash: string }>();
    }
  }

  // Always run the KDF, even with no matching row, so "no such account" and
  // "wrong password" cost the same wall-clock. Team numbers are public and
  // student handles are guessable, so this is not a theoretical concern here.
  const ok = await verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
  if (!row || !ok) return c.json({ error: 'invalid_credentials' }, 401);

  const cookie = await createSession(c.env, row.id);
  return c.json({ ok: true }, 200, { 'Set-Cookie': cookie });
});

auth.post('/logout', sameOriginOnly, async (c) => {
  await destroySession(c.req.raw, c.env);
  return c.json({ ok: true }, 200, { 'Set-Cookie': clearSessionCookie() });
});

/**
 * Who am I, and on which team. The client calls this on boot to decide between
 * the app shell and the login screen, so an unauthenticated answer is a normal
 * 200 with `authenticated: false` rather than a 401 — a 401 here would be an
 * error in the console on every first visit.
 */
auth.get('/me', async (c) => {
  const user = await getSessionUser(c.req.raw, c.env);
  if (!user) return c.json({ authenticated: false });

  const row = await c.env.DB.prepare(
    `SELECT m.id AS member_id, m.role AS role, m.display_name AS display_name,
            m.handle AS handle, m.sub_teams AS sub_teams,
            t.id AS team_id, t.team_number AS team_number, t.name AS team_name
       FROM members m
       JOIN teams t ON t.id = m.team_id
      WHERE m.user_id = ? AND m.status = 'active'
      ORDER BY m.created_at ASC
      LIMIT 1`,
  )
    .bind(user.id)
    .first<{
      member_id: string;
      role: string;
      display_name: string;
      handle: string | null;
      sub_teams: string;
      team_id: string;
      team_number: number;
      team_name: string;
    }>();
  if (!row) return c.json({ authenticated: false });

  return c.json({
    authenticated: true,
    user: { id: user.id, email: user.email },
    member: {
      id: row.member_id,
      role: row.role,
      display_name: row.display_name,
      handle: row.handle,
      sub_teams: JSON.parse(row.sub_teams) as string[],
    },
    team: {
      id: row.team_id,
      team_number: row.team_number,
      name: row.team_name,
    },
  });
});

export { auth, HANDLE_RE, MIN_PASSWORD };

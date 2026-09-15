/**
 * Invites (COG-006 / COG-041).
 *
 * The coach creates an invite with a recipient address; Coglin mails the link
 * and forgets the address. The invitee opens the link, picks a handle and a
 * password, and lands on the roster as a real member.
 *
 * Note which routes are authenticated: creating and listing invites require a
 * coach session, but preview and accept are necessarily public — the person
 * opening the link has no account yet. Their protection is the token itself,
 * which is 32 random bytes, single-use, and expires.
 */
import { Hono } from 'hono';
import { hashPassword, nowSeconds, randomToken, tokenId, uuid } from '../lib/crypto';
import { appBaseUrl } from '../lib/http';
import { createSession } from '../lib/session';
import { sendInvite } from '../lib/email';
import {
  auth as authOf,
  requireMember,
  requireRole,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';
import { INVITABLE_ROLES, isRole, normaliseSubTeams } from '../lib/roles';
import { HANDLE_RE, MIN_PASSWORD } from './auth';

const invites = new Hono<AppEnv>();

const INVITE_TTL_DAYS = 14;
const INVITE_TTL = 60 * 60 * 24 * INVITE_TTL_DAYS;
/** Pending invites a team may hold at once. FTC caps rosters at 15 students,
 *  so this is generous for a real team and still bounds a runaway loop. */
const MAX_PENDING = 40;

/**
 * Create and send an invite. Coach or mentor only — this route can add people
 * to a team, so it is gated harder than anything else in the app.
 */
invites.post('/', sameOriginOnly, requireMember, requireRole('coach', 'mentor'), async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  // Bound to this scope on purpose: `email` is never put on the invite row,
  // never returned in the response, and never logged.
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  const displayName = String(body.display_name ?? '').trim();
  const role = body.role;

  if (!email.includes('@') || email.length < 3)
    return c.json({ error: 'invalid_email' }, 400);
  if (!displayName) return c.json({ error: 'missing_display_name' }, 400);
  if (!isRole(role) || !INVITABLE_ROLES.includes(role))
    return c.json({ error: 'invalid_role', allowed: INVITABLE_ROLES }, 400);

  const { member, teamId } = authOf(c);
  const now = nowSeconds();

  const pending = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM invites
      WHERE team_id = ? AND accepted_at IS NULL AND expires_at > ?`,
  )
    .bind(teamId, now)
    .first<{ n: number }>();
  if ((pending?.n ?? 0) >= MAX_PENDING)
    return c.json({ error: 'too_many_pending_invites', max: MAX_PENDING }, 429);

  const team = await c.env.DB.prepare(
    'SELECT team_number, name FROM teams WHERE id = ?',
  )
    .bind(teamId)
    .first<{ team_number: number; name: string }>();
  if (!team) return c.json({ error: 'not_found' }, 404);

  const token = randomToken(32);
  const id = await tokenId(token, c.env.SESSION_PEPPER);

  await c.env.DB.prepare(
    `INSERT INTO invites
       (id, team_id, role, display_name, sub_teams, created_by_member_id, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      teamId,
      role,
      displayName,
      normaliseSubTeams(body.sub_teams),
      member.id,
      now,
      now + INVITE_TTL,
    )
    .run();

  const url = `${appBaseUrl(c)}/invite/${token}`;

  // Mail after the row is committed, so a mail outage still leaves the coach a
  // working link to share by hand.
  const sent = await sendInvite(c.env, {
    to: email,
    inviterName: member.display_name,
    teamNumber: team.team_number,
    teamName: team.name,
    displayName,
    url,
    expiresInDays: INVITE_TTL_DAYS,
  });

  // `url` is returned so the dialog can show a copyable link. `email` is not.
  return c.json({ ok: true, sent, url, expires_at: now + INVITE_TTL }, 201);
});

/** Pending invites for the coach's own team. Tenant-scoped by requireMember. */
invites.get('/', requireMember, requireRole('coach', 'mentor'), async (c) => {
  const { teamId } = authOf(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, role, display_name, sub_teams, created_at, expires_at
       FROM invites
      WHERE team_id = ? AND accepted_at IS NULL AND expires_at > ?
      ORDER BY created_at DESC`,
  )
    .bind(teamId, nowSeconds())
    .all();
  return c.json({ invites: results });
});

/**
 * Preview, for the accept screen. Public by necessity — the visitor has no
 * session yet. Returns only what the page must render to be trustworthy (which
 * team, invited as what), never anything about who else is on the team.
 */
invites.get('/:token', async (c) => {
  const id = await tokenId(c.req.param('token'), c.env.SESSION_PEPPER);
  const row = await c.env.DB.prepare(
    `SELECT i.role AS role, i.display_name AS display_name,
            i.expires_at AS expires_at, i.accepted_at AS accepted_at,
            t.team_number AS team_number, t.name AS team_name
       FROM invites i JOIN teams t ON t.id = i.team_id
      WHERE i.id = ?`,
  )
    .bind(id)
    .first<{
      role: string;
      display_name: string;
      expires_at: number;
      accepted_at: number | null;
      team_number: number;
      team_name: string;
    }>();

  // One response for missing, used, and expired. A visitor with a bad link
  // learns only that it does not work, which keeps the endpoint useless for
  // probing whether a guessed token ever existed.
  if (!row || row.accepted_at !== null || row.expires_at <= nowSeconds())
    return c.json({ error: 'invalid_invite' }, 404);

  return c.json({
    role: row.role,
    display_name: row.display_name,
    team: { team_number: row.team_number, name: row.team_name },
    expires_at: row.expires_at,
  });
});

/**
 * Redeem. Creates the user and the membership, burns the invite, and signs the
 * new member in — a student should never have to log in immediately after
 * choosing their password.
 */
invites.post('/:token/accept', sameOriginOnly, async (c) => {
  let body: Record<string, unknown>;
  try {
    body = (await c.req.json()) as Record<string, unknown>;
  } catch {
    return c.json({ error: 'invalid_body' }, 400);
  }

  const handle = String(body.handle ?? '')
    .trim()
    .toLowerCase();
  const password = String(body.password ?? '');

  if (!HANDLE_RE.test(handle)) return c.json({ error: 'invalid_handle' }, 400);
  if (password.length < MIN_PASSWORD)
    return c.json({ error: 'weak_password', min: MIN_PASSWORD }, 400);

  const id = await tokenId(c.req.param('token'), c.env.SESSION_PEPPER);
  const now = nowSeconds();

  const invite = await c.env.DB.prepare(
    `SELECT team_id, role, display_name, sub_teams, expires_at, accepted_at
       FROM invites WHERE id = ?`,
  )
    .bind(id)
    .first<{
      team_id: string;
      role: string;
      display_name: string;
      sub_teams: string;
      expires_at: number;
      accepted_at: number | null;
    }>();
  if (!invite || invite.accepted_at !== null || invite.expires_at <= now)
    return c.json({ error: 'invalid_invite' }, 404);

  const userId = uuid();
  const memberId = uuid();
  const passwordHash = await hashPassword(password);
  // Students are the minors this product is designed around; mentors and
  // viewers arriving by invite are adults. Email stays NULL either way — the
  // address the coach typed was never persisted, so there is nothing to write.
  const isMinor = invite.role === 'student' ? 1 : 0;

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT INTO users (id, email, password_hash, is_minor, created_at, updated_at)
         VALUES (?, NULL, ?, ?, ?, ?)`,
      ).bind(userId, passwordHash, isMinor, now, now),
      c.env.DB.prepare(
        `INSERT INTO members (id, team_id, user_id, role, sub_teams, display_name, handle, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      ).bind(
        memberId,
        invite.team_id,
        userId,
        invite.role,
        invite.sub_teams,
        invite.display_name,
        handle,
        now,
      ),
      // Conditional on still being unaccepted, so two people racing the same
      // link cannot both end up with a membership.
      c.env.DB.prepare(
        `UPDATE invites SET accepted_at = ?, accepted_member_id = ?
          WHERE id = ? AND accepted_at IS NULL`,
      ).bind(now, memberId, id),
    ]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // idx_members_team_handle: someone on this team already took the handle.
    if (message.includes('UNIQUE')) return c.json({ error: 'handle_taken' }, 409);
    throw err;
  }

  const cookie = await createSession(c.env, userId);
  return c.json({ ok: true }, 201, { 'Set-Cookie': cookie });
});

export { invites };

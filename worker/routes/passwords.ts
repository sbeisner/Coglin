/**
 * Password recovery, public and self-serve halves (COG-051).
 *
 * The coach-initiated route lives in `routes/team.ts`, beside the other things
 * a coach does to somebody else's roster row. What is here is everything that
 * does not need a roster: redeeming a mailed link, asking for one, and changing
 * the password you already know.
 *
 *   GET  /api/auth/reset/:token   preview, public
 *   POST /api/auth/reset/:token   redeem, public
 *   POST /api/auth/forgot         ask for a link, public
 *   PATCH /api/auth/password      change your own, authenticated
 *
 * The first three are public by necessity — somebody who cannot log in cannot
 * present a session. Their protection is the token: 32 random bytes, stored
 * only as a peppered hash, single-use, and alive for an hour.
 */
import { Hono } from 'hono';
import {
  DUMMY_HASH,
  hashPassword,
  nowSeconds,
  randomToken,
  tokenId,
  verifyPassword,
} from '../lib/crypto';
import { appBaseUrl, readJson } from '../lib/http';
import { sendPasswordReset } from '../lib/email';
import {
  createSession,
  destroyAllSessions,
  destroyOtherSessions,
} from '../lib/session';
import { requireMember, sameOriginOnly, auth as authOf, type AppEnv } from '../lib/tenancy';
import { MIN_PASSWORD } from './auth';

const passwords = new Hono<AppEnv>();

const RESET_TTL_HOURS = 1;
const RESET_TTL = 60 * 60 * RESET_TTL_HOURS;
const RATE_WINDOW = 60 * 60;
/** Resets one account may be sent in a window, on the public path. Silent when
 *  hit — see the comment in /forgot for why it must not be an error. */
const MAX_SELF_PER_USER = 3;
/**
 * Ceiling on self-serve resets across every team in a window. This is a spend
 * limit on an unauthenticated endpoint that costs money per call, not a
 * functional gate: set high enough that reaching it means something is wrong,
 * because a global cap is itself a denial-of-service lever.
 */
const MAX_SELF_GLOBAL = 200;
/**
 * Upper bound on an accepted password. There is no cryptographic reason for it
 * — PBKDF2 takes any length — but nothing should be able to hand the KDF a
 * megabyte and bill us for the CPU.
 */
const MAX_PASSWORD = 200;

interface ResetRow {
  reset_user_id: string;
  expires_at: number;
  used_at: number | null;
  display_name: string | null;
  handle: string | null;
  team_number: number | null;
  team_name: string | null;
}

/** Load a live reset by its raw token, or null for missing, used or expired. */
async function liveReset(
  env: AppEnv['Bindings'],
  rawToken: string,
  now: number,
): Promise<ResetRow | null> {
  const id = await tokenId(rawToken, env.SESSION_PEPPER);
  const row = await env.DB.prepare(
    `SELECT r.user_id AS reset_user_id, r.expires_at AS expires_at,
            r.used_at AS used_at,
            m.display_name AS display_name, m.handle AS handle,
            t.team_number AS team_number, t.name AS team_name
       FROM password_resets r
       LEFT JOIN members m
         ON m.user_id = r.user_id AND m.status = 'active'
       LEFT JOIN teams t ON t.id = m.team_id
      WHERE r.id = ?
      ORDER BY m.created_at ASC
      LIMIT 1`,
  )
    .bind(id)
    .first<ResetRow>();

  if (!row || row.used_at !== null || row.expires_at <= now) return null;
  return row;
}

/**
 * Preview, for the reset screen. Public by necessity — the visitor cannot log
 * in, which is why they are here.
 *
 * One response for missing, used and expired, matching `GET /api/invites/:token`:
 * a visitor with a bad link learns only that it does not work, which keeps the
 * endpoint useless for probing whether a guessed token ever existed.
 *
 * `handle` IS returned here and is deliberately absent from the email. Somebody
 * holding a live token can set this password regardless, so telling them the
 * username grants them nothing — and a student who forgot their password has
 * usually forgotten their username too, and has to type it to log in
 * afterwards. In the mail it would be a different thing entirely: the address
 * there is unverified, so a typo would post a working half of a credential to a
 * stranger.
 */
passwords.get('/reset/:token', async (c) => {
  const row = await liveReset(c.env, c.req.param('token'), nowSeconds());
  if (!row) return c.json({ error: 'invalid_reset' }, 404);

  return c.json({
    display_name: row.display_name,
    handle: row.handle,
    team:
      row.team_number === null
        ? null
        : { team_number: row.team_number, name: row.team_name },
  });
});

/**
 * Redeem. Sets the password, evicts every session, and signs the redeemer in —
 * the same courtesy `POST /api/invites/:token/accept` extends, for the same
 * reason: nobody should have to log in immediately after choosing a password.
 */
passwords.post('/reset/:token', sameOriginOnly, async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const password = String(body.password ?? '');
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD)
    return c.json({ error: 'weak_password', min: MIN_PASSWORD }, 400);

  const now = nowSeconds();
  const rawToken = c.req.param('token');
  const row = await liveReset(c.env, rawToken, now);
  if (!row) return c.json({ error: 'invalid_reset' }, 404);

  const id = await tokenId(rawToken, c.env.SESSION_PEPPER);

  /**
   * Burn FIRST, as its own statement, and only continue if this request is the
   * one that burned it.
   *
   * `invites.ts` puts its equivalent conditional UPDATE inside the batch and
   * never reads `meta.changes`. A zero-row conditional update does not abort a
   * D1 batch, so that code tolerates a race it happens to survive for other
   * reasons. Here the same shape would let two concurrent redeems each set a
   * DIFFERENT password, with the loser's silently live. Losing the race now
   * costs a spent token and an unchanged password, which is the safe direction.
   */
  const burn = await c.env.DB.prepare(
    'UPDATE password_resets SET used_at = ? WHERE id = ? AND used_at IS NULL',
  )
    .bind(now, id)
    .run();
  if (burn.meta.changes !== 1) return c.json({ error: 'invalid_reset' }, 404);

  const passwordHash = await hashPassword(password);
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
  )
    .bind(passwordHash, now, row.reset_user_id)
    .run();

  // Every session dies, including any the person redeeming already had. A
  // forgotten password is indistinguishable from one somebody else changed, so
  // this is the moment to throw everyone out. The fresh cookie is minted after
  // the purge so it survives it.
  await destroyAllSessions(c.env, row.reset_user_id);
  const cookie = await createSession(c.env, row.reset_user_id);
  return c.json({ ok: true }, 200, { 'Set-Cookie': cookie });
});

/**
 * Ask for a reset link (public).
 *
 * ALWAYS answers `200 {ok: true}` — for a known address, an unknown one, an
 * account with no active membership, and an account over its per-account cap.
 * Any variation here is an oracle for "does this person have a Coglin account",
 * and the login route already takes the same care with `DUMMY_HASH`. The copy
 * on the client hedges to match ("if there's an account for that address"); if
 * this endpoint ever starts distinguishing, that copy becomes a lie.
 *
 * Only students are unreachable this way, and that is structural rather than a
 * limitation of this route: `users.email` is NULL for everyone who joined by
 * invite, so there is nothing to match. They go through their coach.
 */
passwords.post('/forgot', sameOriginOnly, async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  // A syntactically bad address is a client-checkable property and leaks
  // nothing about who has an account, so this one may be an error.
  if (!email.includes('@') || email.length < 3)
    return c.json({ error: 'invalid_email' }, 400);

  const now = nowSeconds();

  // The global spend ceiling is the one bound that may answer loudly: it is
  // account-independent, so a 429 here says nothing about the address typed.
  const global = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM password_resets WHERE created_at > ?',
  )
    .bind(now - RATE_WINDOW)
    .first<{ n: number }>();
  if ((global?.n ?? 0) >= MAX_SELF_GLOBAL)
    return c.json({ error: 'too_many_requests' }, 429);

  const user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string }>();

  if (user) {
    const mine = await c.env.DB.prepare(
      'SELECT COUNT(*) AS n FROM password_resets WHERE user_id = ? AND created_at > ?',
    )
      .bind(user.id, now - RATE_WINDOW)
      .first<{ n: number }>();

    if ((mine?.n ?? 0) < MAX_SELF_PER_USER) {
      const member = await c.env.DB.prepare(
        `SELECT m.display_name AS display_name, t.team_number AS team_number,
                t.name AS team_name
           FROM members m JOIN teams t ON t.id = m.team_id
          WHERE m.user_id = ? AND m.status = 'active'
          ORDER BY m.created_at ASC
          LIMIT 1`,
      )
        .bind(user.id)
        .first<{ display_name: string; team_number: number; team_name: string }>();

      if (member) {
        const token = randomToken(32);
        const id = await tokenId(token, c.env.SESSION_PEPPER);

        await c.env.DB.batch([
          c.env.DB.prepare(
            'UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
          ).bind(now, user.id),
          c.env.DB.prepare(
            `INSERT INTO password_resets
               (id, user_id, team_id, created_by_member_id, kind, created_at, expires_at)
             VALUES (?, ?, NULL, NULL, 'self', ?, ?)`,
          ).bind(id, user.id, now, now + RESET_TTL),
        ]);

        // `waitUntil` rather than `await`, the way coach-signup mails its alert:
        // the response must not take longer for an address that has an account
        // than for one that does not, or the timing answers the question the
        // body refuses to.
        c.executionCtx.waitUntil(
          sendPasswordReset(c.env, {
            to: email,
            displayName: member.display_name,
            teamNumber: member.team_number,
            teamName: member.team_name,
            url: `${appBaseUrl(c)}/reset/${token}`,
            expiresInHours: RESET_TTL_HOURS,
          }),
        );
      }
    }
  }

  return c.json({ ok: true });
});

/**
 * Change the password you already know.
 *
 * Note the 403 on a wrong current password, which is not a slip. `src/lib/api.ts`
 * treats EVERY 401 as a dead session: it fires SESSION_EXPIRED and the shell
 * bounces to the login screen. A 401 here would sign somebody out for mistyping
 * their own password, which is both alarming and the opposite of what they
 * asked for.
 */
passwords.patch('/password', sameOriginOnly, requireMember, async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const current = String(body.current_password ?? '');
  const next = String(body.new_password ?? '');

  if (next.length < MIN_PASSWORD || next.length > MAX_PASSWORD)
    return c.json({ error: 'weak_password', min: MIN_PASSWORD }, 400);

  const { user } = authOf(c);
  const row = await c.env.DB.prepare(
    'SELECT password_hash FROM users WHERE id = ?',
  )
    .bind(user.id)
    .first<{ password_hash: string }>();

  const ok = await verifyPassword(current, row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok) return c.json({ error: 'invalid_password' }, 403);

  if (current === next) return c.json({ error: 'password_unchanged' }, 400);

  const now = nowSeconds();
  await c.env.DB.prepare(
    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
  )
    .bind(await hashPassword(next), now, user.id)
    .run();

  // Every OTHER session dies. The point of changing a password deliberately is
  // to evict the school computer you forgot to sign out of; evicting the tab
  // you are typing in reads as the change having failed.
  await destroyOtherSessions(c.req.raw, c.env, user.id);

  return c.json({ ok: true });
});

export { passwords };

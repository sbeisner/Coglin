/**
 * Opaque-token sessions, stored hashed at rest in D1.
 *
 * Ported from `website/inkubus/functions/_lib/session.js` with two deliberate
 * changes:
 *
 *  1. The row id is `tokenId(token, SESSION_PEPPER)` rather than a bare
 *     SHA-256, so a D1 leak on its own cannot be replayed as credentials.
 *  2. The `Authorization: Bearer` branch is gone. Inkubus needed it because the
 *     desktop app has no cookie jar; Coglin is browser-only, and accepting a
 *     header would just be a second way in to keep secure for no benefit.
 */
import { randomToken, tokenId, nowSeconds } from './crypto';
import type { Bindings } from '../types';

const COOKIE_NAME = 'coglin_session';
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days, seconds
/**
 * Sliding expiry: a request inside this window of expiry re-extends to the full
 * TTL. A student who opens Coglin at every Tuesday meeting should never be
 * logged out mid-season, and a coach should never spend meeting time resetting
 * passwords for a room of teenagers.
 */
const SESSION_RENEW_WINDOW = 60 * 60 * 24 * 15; // 15 days, seconds
const COOKIE_FLAGS = 'HttpOnly; Secure; SameSite=Lax; Path=/';

export interface SessionUser {
  id: string;
  email: string | null;
  is_minor: number;
}

export async function createSession(
  env: Bindings,
  userId: string,
): Promise<string> {
  const token = randomToken(32);
  const id = await tokenId(token, env.SESSION_PEPPER);
  const now = nowSeconds();
  await env.DB.prepare(
    'INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  )
    .bind(id, userId, now, now + SESSION_TTL)
    .run();
  return `${COOKIE_NAME}=${token}; ${COOKIE_FLAGS}; Max-Age=${SESSION_TTL}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; ${COOKIE_FLAGS}; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

/**
 * Resolve the signed-in user, or null. Expired sessions are deleted on sight;
 * sessions nearing expiry are silently extended.
 */
export async function getSessionUser(
  request: Request,
  env: Bindings,
): Promise<SessionUser | null> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return null;

  const id = await tokenId(token, env.SESSION_PEPPER);
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, u.is_minor AS is_minor, s.expires_at AS expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id = ?`,
  )
    .bind(id)
    .first<{
      id: string;
      email: string | null;
      is_minor: number;
      expires_at: number;
    }>();
  if (!row) return null;

  const now = nowSeconds();
  if (row.expires_at <= now) {
    await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
    return null;
  }
  if (row.expires_at - now < SESSION_RENEW_WINDOW) {
    await env.DB.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?')
      .bind(now + SESSION_TTL, id)
      .run();
  }

  return { id: row.id, email: row.email, is_minor: row.is_minor };
}

export async function destroySession(
  request: Request,
  env: Bindings,
): Promise<void> {
  const token = readCookie(request, COOKIE_NAME);
  if (!token) return;
  const id = await tokenId(token, env.SESSION_PEPPER);
  await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(id).run();
}

/**
 * Evict every session an account has (COG-051).
 *
 * Used when a password is reset through a mailed link. A forgotten password is
 * indistinguishable from a shared one — the student who cannot get in may be
 * locked out because somebody else changed it — so the reset is exactly the
 * moment to throw everyone out, including whoever is redeeming. They get a
 * fresh cookie from `createSession` a line later.
 */
export async function destroyAllSessions(
  env: Bindings,
  userId: string,
): Promise<void> {
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ?')
    .bind(userId)
    .run();
}

/**
 * Evict every session EXCEPT the caller's own.
 *
 * The change-password case. Somebody who deliberately changes their password in
 * Settings wants the school computer they forgot to sign out of to go away; they
 * do not want the tab they are typing in to go away, which reads as the change
 * having failed. A caller with no cookie clears nothing.
 */
export async function destroyOtherSessions(
  request: Request,
  env: Bindings,
  userId: string,
): Promise<void> {
  const token = readCookie(request, COOKIE_NAME);
  const keep = token ? await tokenId(token, env.SESSION_PEPPER) : '';
  await env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?')
    .bind(userId, keep)
    .run();
}

/**
 * Team, season and roster reads (COG-010, first slice).
 *
 * Every query here filters on `teamId` taken from `authOf(c)` — the session's
 * membership row — and none of them accept a team identifier from the request.
 * That is the whole tenancy rule in practice; see `worker/lib/tenancy.ts`.
 */
import { Hono } from 'hono';
import { nowSeconds } from '../lib/crypto';
import { readJson, optionalString } from '../lib/http';
import { isValidTimeZone } from '../lib/tz';
import { deleteRosterPhoto, ingestImage, MAX_BYTES } from './media';
import {
  auth as authOf,
  requireMember,
  requireRole,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const team = new Hono<AppEnv>();

team.get('/team', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const row = await c.env.DB.prepare(
    'SELECT id, team_number, name, region, timezone, created_at FROM teams WHERE id = ?',
  )
    .bind(teamId)
    .first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

/**
 * Coach-only, and the timezone is why this route exists at all.
 *
 * A recurring meeting is stored as a wall-clock rule, so the team's zone is
 * what every occurrence is resolved against. Getting it wrong does not fail —
 * it materialises a whole season an hour off — so it is a coach's decision and
 * it is validated against the runtime's own tz database rather than a list we
 * would have to maintain.
 *
 * Changing it deliberately does NOT re-resolve series that already exist: each
 * series snapshots the zone it was created with, so a correction here applies
 * to what gets scheduled next rather than silently moving meetings already on
 * the calendar.
 */
team.patch(
  '/team',
  sameOriginOnly,
  requireMember,
  requireRole('coach'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const { teamId } = authOf(c);
    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.name !== undefined) {
      const name = optionalString(body.name, 120);
      if (!name) return c.json({ error: 'invalid_name' }, 400);
      sets.push('name = ?');
      values.push(name);
    }
    if (body.region !== undefined) {
      sets.push('region = ?');
      values.push(optionalString(body.region, 120));
    }
    if (body.timezone !== undefined) {
      if (!isValidTimeZone(body.timezone)) {
        return c.json({ error: 'invalid_timezone' }, 400);
      }
      sets.push('timezone = ?');
      values.push(body.timezone);
    }

    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    await c.env.DB.prepare(`UPDATE teams SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...values, teamId)
      .run();

    const row = await c.env.DB.prepare(
      'SELECT id, team_number, name, region, timezone, created_at FROM teams WHERE id = ?',
    )
      .bind(teamId)
      .first();
    return c.json(row);
  },
);

team.get('/season/current', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const row = await c.env.DB.prepare(
    `SELECT id, team_id, label, starts_at, ends_at, is_current
       FROM seasons WHERE team_id = ? AND is_current = 1`,
  )
    .bind(teamId)
    .first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json(row);
});

/**
 * The roster. `sub_teams` is stored as a json string and parsed here so the
 * client receives the array shape `src/types.ts` declares — the mock fixtures
 * already return arrays, so parsing server-side is what lets the swap in
 * `src/lib/api.ts` happen without touching Roster.tsx.
 *
 * Note there is no password, no email and no user id in the projection. The
 * roster screen needs none of them, and a student's row should carry as little
 * as possible past the API boundary.
 */
team.get('/members', requireMember, async (c) => {
  const { teamId, member: me } = authOf(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, team_id, user_id, role, sub_teams, display_name, handle, status,
            photo_media_id, photo_consent_at, is_purchase_approver, created_at
       FROM members
      WHERE team_id = ? AND status = 'active'
      ORDER BY created_at ASC`,
  )
    .bind(teamId)
    .all<{
      sub_teams: string;
      user_id: string;
      photo_media_id: string | null;
      photo_consent_at: number | null;
      is_purchase_approver: number;
    }>();

  // Viewers are not offered the photo at all. The read route refuses it too —
  // this only keeps the URL out of a response a sponsor can see.
  const hidePhotos = me.role === 'viewer';

  return c.json(
    results.map(({ user_id: _userId, ...m }) => ({
      ...m,
      sub_teams: JSON.parse(m.sub_teams) as string[],
      photo_media_id: hidePhotos ? null : m.photo_media_id,
      // A boolean, not the timestamp: the roster needs to know whether a photo
      // may be attached, not to publish when a consent form was signed.
      photo_consent: m.photo_consent_at !== null,
      is_purchase_approver: m.is_purchase_approver === 1,
    })),
  );
});

/**
 * Flip the part-order approver flag (0009). Coach or mentor only — granting
 * approval reach is a leadership act, even though holding it is not a role.
 * The only writable field on a member so far; if this route grows more, keep
 * each field's own validation the way PATCH /team does.
 */
team.patch(
  '/members/:id',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId } = authOf(c);

    if (typeof body.is_purchase_approver !== 'boolean') {
      return c.json({ error: 'nothing_to_update' }, 400);
    }

    const result = await c.env.DB.prepare(
      `UPDATE members SET is_purchase_approver = ?
        WHERE id = ? AND team_id = ? AND status = 'active'`,
    )
      .bind(body.is_purchase_approver ? 1 : 0, c.req.param('id'), teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    return c.json({ ok: true, is_purchase_approver: body.is_purchase_approver });
  },
);

// -------------------------------------------------------- roster photos

/**
 * Record that the signed Consent and Release is on file for this student.
 *
 * Coglin cannot obtain verifiable parental consent — a checkbox in a web app is
 * not that, and a coach's permission is not a parent's. What it can do is refuse
 * to hold a child's photograph until a named adult has attested, at a known
 * time, that the real paper form exists. That attestation is what this writes.
 *
 * See 0004_roster_photos.sql for why this gate is not optional.
 */
team.post(
  '/members/:id/photo-consent',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId, member } = authOf(c);
    const now = nowSeconds();

    const result = await c.env.DB.prepare(
      `UPDATE members SET photo_consent_at = ?, photo_consent_by = ?
        WHERE id = ? AND team_id = ?`,
    )
      .bind(now, member.id, c.req.param('id'), teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    return c.json({ ok: true, photo_consent: true, recorded_by: member.id });
  },
);

/**
 * Withdraw consent, which also removes the photo.
 *
 * A parent asking for the picture to come down and the record saying consent is
 * on file cannot both be true, so this does both in one batch rather than
 * leaving the photo attached to a revoked attestation.
 */
team.delete(
  '/members/:id/photo-consent',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);
    const memberId = c.req.param('id');

    const row = await c.env.DB.prepare(
      'SELECT photo_media_id FROM members WHERE id = ? AND team_id = ?',
    )
      .bind(memberId, teamId)
      .first<{ photo_media_id: string | null }>();
    if (!row) return c.json({ error: 'not_found' }, 404);

    await deleteRosterPhoto(c.env, teamId, memberId, row.photo_media_id);
    await c.env.DB.prepare(
      `UPDATE members SET photo_consent_at = NULL, photo_consent_by = NULL
        WHERE id = ? AND team_id = ?`,
    )
      .bind(memberId, teamId)
      .run();

    return c.json({ ok: true, photo_consent: false });
  },
);

/**
 * Attach a photo. Coach or mentor only — a student does not upload their own
 * face, and certainly not anybody else's.
 */
team.post(
  '/members/:id/photo',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId, member } = authOf(c);
    const memberId = c.req.param('id');

    const target = await c.env.DB.prepare(
      `SELECT photo_media_id, photo_consent_at FROM members
        WHERE id = ? AND team_id = ? AND status = 'active'`,
    )
      .bind(memberId, teamId)
      .first<{ photo_media_id: string | null; photo_consent_at: number | null }>();
    if (!target) return c.json({ error: 'not_found' }, 404);

    // The gate. Refused rather than warned about, because a warning is a thing
    // somebody clicks past at 9pm before a qualifier.
    if (target.photo_consent_at === null) {
      return c.json({ error: 'photo_consent_required' }, 409);
    }

    const season = await c.env.DB.prepare(
      'SELECT id FROM seasons WHERE team_id = ? AND is_current = 1',
    )
      .bind(teamId)
      .first<{ id: string }>();
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    const raw = new Uint8Array(await c.req.arrayBuffer());
    const result = await ingestImage(
      c.env,
      {
        teamId,
        seasonId: season.id,
        uploaderMemberId: member.id,
        kind: 'roster_photo',
      },
      raw,
    );
    if ('error' in result) {
      return c.json({ error: result.error, max_bytes: MAX_BYTES }, result.status);
    }

    // Replacing a photo removes the old one rather than orphaning it in R2.
    await deleteRosterPhoto(c.env, teamId, memberId, target.photo_media_id);

    await c.env.DB.prepare(
      'UPDATE members SET photo_media_id = ? WHERE id = ? AND team_id = ?',
    )
      .bind(result.id, memberId, teamId)
      .run();

    return c.json({ ...result, url: `/media/${result.id}` }, 201);
  },
);

team.delete(
  '/members/:id/photo',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const { teamId } = authOf(c);
    const memberId = c.req.param('id');

    const row = await c.env.DB.prepare(
      'SELECT photo_media_id FROM members WHERE id = ? AND team_id = ?',
    )
      .bind(memberId, teamId)
      .first<{ photo_media_id: string | null }>();
    if (!row) return c.json({ error: 'not_found' }, 404);

    await deleteRosterPhoto(c.env, teamId, memberId, row.photo_media_id);
    return c.json({ ok: true });
  },
);

export { team };

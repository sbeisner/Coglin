/**
 * Team, season and roster reads (COG-010, first slice).
 *
 * Every query here filters on `teamId` taken from `authOf(c)` — the session's
 * membership row — and none of them accept a team identifier from the request.
 * That is the whole tenancy rule in practice; see `worker/lib/tenancy.ts`.
 */
import { Hono } from 'hono';
import { nowSeconds, randomToken, tokenId } from '../lib/crypto';
import { appBaseUrl, readJson, optionalString } from '../lib/http';
import { isValidTimeZone } from '../lib/tz';
import { isRole, normaliseSubTeams } from '../lib/roles';
import { sendPasswordReset } from '../lib/email';
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
 * Note there is no password, no email address and no user id in the projection.
 * The roster screen needs none of them, and a student's row should carry as
 * little as possible past the API boundary. `has_email` is a boolean about
 * whether an address exists, not the address — the reset dialog cannot render
 * correctly without knowing which shape the account is, and a teammate learning
 * that the coach has an email on file learns nothing they could not guess.
 */
team.get('/members', requireMember, async (c) => {
  const { teamId, member: me } = authOf(c);
  const { results } = await c.env.DB.prepare(
    `SELECT m.id AS id, m.team_id AS team_id, m.user_id AS user_id, m.role AS role,
            m.sub_teams AS sub_teams, m.display_name AS display_name,
            m.handle AS handle, m.status AS status,
            m.photo_media_id AS photo_media_id,
            m.photo_consent_at AS photo_consent_at,
            m.is_purchase_approver AS is_purchase_approver,
            m.created_at AS created_at,
            -- Whether an address exists, never the address itself. The reset
            -- dialog has to know which of two things to render: "type where to
            -- send this" for an account with none, or "we'll mail the address
            -- on file" for one that has. Publishing the boolean is what lets
            -- the server refuse a typed address for the second case — see the
            -- password-reset route below for why that refusal matters.
            CASE WHEN u.email IS NULL THEN 0 ELSE 1 END AS has_email
       FROM members m
       JOIN users u ON u.id = m.user_id
      WHERE m.team_id = ? AND m.status = 'active'
      ORDER BY m.created_at ASC`,
  )
    .bind(teamId)
    .all<{
      sub_teams: string;
      user_id: string;
      photo_media_id: string | null;
      photo_consent_at: number | null;
      is_purchase_approver: number;
      has_email: number;
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
      has_email: m.has_email === 1,
    })),
  );
});

/**
 * Edit a member: sub-teams, role, the part-order approver flag, or removal.
 *
 * Until now this accepted only `is_purchase_approver`, which meant sub-teams
 * were write-once at invite time and could never be corrected — a coach who
 * forgot to tick them had no way back, and the founding coach is inserted with
 * `'[]'` hardcoded (routes/auth.ts) so their own were permanently empty.
 *
 * Each field validates separately, the way PATCH /team does, and the SET list is
 * built from whichever arrived. Coach or mentor may edit sub-teams and the
 * approver flag; only a coach may change a role or remove somebody, because both
 * of those can take the team away from the people who run it.
 */
team.patch(
  '/members/:id',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member: me } = authOf(c);
    const memberId = c.req.param('id');

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.sub_teams !== undefined) {
      if (!Array.isArray(body.sub_teams)) {
        return c.json({ error: 'invalid_sub_teams' }, 400);
      }
      sets.push('sub_teams = ?');
      values.push(normaliseSubTeams(body.sub_teams));
    }

    if (body.is_purchase_approver !== undefined) {
      if (typeof body.is_purchase_approver !== 'boolean') {
        return c.json({ error: 'invalid_purchase_approver' }, 400);
      }
      sets.push('is_purchase_approver = ?');
      values.push(body.is_purchase_approver ? 1 : 0);
    }

    const changingRole = body.role !== undefined;
    const removing = body.status !== undefined;

    if (changingRole || removing) {
      if (me.role !== 'coach') return c.json({ error: 'forbidden' }, 403);
    }

    if (changingRole) {
      if (!isRole(body.role)) return c.json({ error: 'invalid_role' }, 400);
      sets.push('role = ?');
      values.push(body.role);
    }

    if (removing) {
      if (body.status !== 'active' && body.status !== 'removed') {
        return c.json({ error: 'invalid_status' }, 400);
      }
      sets.push('status = ?');
      values.push(body.status);
    }

    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    /**
     * The last coach may not be demoted or removed — including by themselves.
     *
     * This is the ONLY guard on the two dangerous fields, and deliberately so.
     * An earlier version also refused any coach changing their own row, which
     * read as prudence and was not: it made this check unreachable (if the
     * target is a coach and is not you, there are by definition two coaches) and
     * it blocked the one legitimate thing a departing coach needs to do — hand
     * over, then take themselves off.
     *
     * What actually has to be prevented is a team with zero coaches. Coach is
     * the only role that can hand out coach, so that team has no path back which
     * does not involve someone with database access. Checked against the
     * target's CURRENT row, so it fires whether the request demotes them or
     * deactivates them.
     */
    if (changingRole || removing) {
      const target = await c.env.DB.prepare(
        "SELECT role FROM members WHERE id = ? AND team_id = ? AND status = 'active'",
      )
        .bind(memberId, teamId)
        .first<{ role: string }>();
      if (!target) return c.json({ error: 'not_found' }, 404);

      const losingACoach =
        target.role === 'coach' &&
        ((changingRole && body.role !== 'coach') || body.status === 'removed');
      if (losingACoach) {
        const coaches = await c.env.DB.prepare(
          "SELECT COUNT(*) AS n FROM members WHERE team_id = ? AND role = 'coach' AND status = 'active'",
        )
          .bind(teamId)
          .first<{ n: number }>();
        if ((coaches?.n ?? 0) <= 1) {
          return c.json({ error: 'last_coach' }, 409);
        }
      }
    }

    const result = await c.env.DB.prepare(
      `UPDATE members SET ${sets.join(', ')}
        WHERE id = ? AND team_id = ? AND status = 'active'`,
    )
      .bind(...values, memberId, teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    return c.json({ ok: true });
  },
);

// ------------------------------------------------------ password recovery

/**
 * Mail somebody on the roster a link to choose a new password (COG-051).
 *
 * This exists because a locked-out student previously had no route back in at
 * all. `users.email` is NULL for everyone who joined by invite, so there is
 * nothing to run a normal "forgot password" against; the coach supplies a
 * destination at the moment they press the button and Coglin forgets it again,
 * the same trade `POST /api/invites` makes. The alternative people reach for —
 * remove and re-invite — mints a NEW member row and orphans every task
 * assignment, attendance mark and note the student ever touched.
 *
 * WHO MAY RESET WHOM. A mentor may reset a student or a viewer; only a coach
 * may reset another coach or a mentor. A mentor cannot change roles today
 * (see the guard in PATCH /members/:id), so letting one mail themselves a
 * coach's reset link would be a straight path to owning the team.
 *
 * WHERE IT IS SENT is not a free choice, and this is the subtle part. If the
 * target HAS an address on file, the mail goes there and any address in the
 * body is ignored — otherwise a coach could redirect a peer coach's reset to
 * themselves, and the endpoint would double as an oracle for "does this person
 * use that address". A typed address is accepted only when there is no stored
 * one, because then it is the only way to reach them at all.
 */
const RESET_TTL_HOURS = 1;
const RESET_TTL = 60 * 60 * RESET_TTL_HOURS;
/** Per-target and per-team bounds, same shape as MAX_PENDING in invites.ts and
 *  the bug-report limits. A coach helping one forgetful student needs one or
 *  two; a roster melting down at one meeting needs a handful. */
const MAX_RESETS_PER_USER = 3;
const MAX_RESETS_PER_TEAM = 10;

team.post(
  '/members/:id/password-reset',
  sameOriginOnly,
  requireMember,
  requireRole('coach', 'mentor'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);

    const { teamId, member: me, user } = authOf(c);
    const memberId = c.req.param('id');
    const now = nowSeconds();

    const target = await c.env.DB.prepare(
      `SELECT m.user_id AS user_id, m.role AS role, m.display_name AS display_name,
              u.email AS email
         FROM members m
         JOIN users u ON u.id = m.user_id
        WHERE m.id = ? AND m.team_id = ? AND m.status = 'active'`,
    )
      .bind(memberId, teamId)
      .first<{
        user_id: string;
        role: string;
        display_name: string;
        email: string | null;
      }>();
    if (!target) return c.json({ error: 'not_found' }, 404);

    // Signed in and asking for a mailed link to your own account is never the
    // shortest path — Settings changes it directly, and /forgot covers the case
    // where you cannot get in at all.
    if (target.user_id === user.id)
      return c.json({ error: 'cannot_reset_self' }, 400);

    if (me.role !== 'coach' && (target.role === 'coach' || target.role === 'mentor'))
      return c.json({ error: 'forbidden' }, 403);

    // Stored address wins; a typed one is only consulted when there is none.
    // `caller_chose_destination` drives whether the link comes back in the
    // response — see the comment on the return.
    let to: string;
    const callerChoseDestination = target.email === null;
    if (target.email) {
      to = target.email;
    } else {
      to = String(body.email ?? '')
        .trim()
        .toLowerCase();
      if (!to.includes('@') || to.length < 3)
        return c.json({ error: 'invalid_email' }, 400);
    }

    // Both bounds in one read, hitting idx_password_resets_team. One shared 429
    // code: the coach's remedy is to wait either way, and saying which limit
    // they hit only helps somebody probing.
    const counts = await c.env.DB.prepare(
      `SELECT COUNT(*) AS team_n,
              SUM(CASE WHEN user_id = ? THEN 1 ELSE 0 END) AS theirs
         FROM password_resets
        WHERE team_id = ? AND created_at > ?`,
    )
      .bind(target.user_id, teamId, now - RESET_TTL)
      .first<{ team_n: number; theirs: number | null }>();
    if (
      (counts?.theirs ?? 0) >= MAX_RESETS_PER_USER ||
      (counts?.team_n ?? 0) >= MAX_RESETS_PER_TEAM
    )
      return c.json({ error: 'too_many_resets' }, 429);

    const teamRow = await c.env.DB.prepare(
      'SELECT team_number, name FROM teams WHERE id = ?',
    )
      .bind(teamId)
      .first<{ team_number: number; name: string }>();
    if (!teamRow) return c.json({ error: 'not_found' }, 404);

    const token = randomToken(32);
    const id = await tokenId(token, c.env.SESSION_PEPPER);

    // Issuing supersedes every outstanding reset for this account. That is the
    // remedy for the failure this design invites: a coach who types the address
    // wrong re-sends to the right one, and the link sitting in a stranger's
    // inbox dies now rather than in an hour.
    await c.env.DB.batch([
      c.env.DB.prepare(
        'UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL',
      ).bind(now, target.user_id),
      c.env.DB.prepare(
        `INSERT INTO password_resets
           (id, user_id, team_id, created_by_member_id, kind, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'coach', ?, ?)`,
      ).bind(id, target.user_id, teamId, me.id, now, now + RESET_TTL),
    ]);

    const url = `${appBaseUrl(c)}/reset/${token}`;

    // After the row is committed, so a mail outage still leaves the coach a
    // working link to read out loud.
    const sent = await sendPasswordReset(c.env, {
      to,
      displayName: target.display_name,
      teamNumber: teamRow.team_number,
      teamName: teamRow.name,
      requestedBy: me.display_name,
      url,
      expiresInHours: RESET_TTL_HOURS,
    });

    /**
     * The link comes back ONLY when the caller supplied the destination.
     *
     * For a student that is the whole point: the coach typed where it goes, so
     * handing them a copyable link grants them nothing they could not get by
     * typing their own address, and it is what stops a Resend outage from being
     * a dead end. It is the same fallback `InviteDialog` relies on.
     *
     * For an account WITH an address on file the mail went somewhere the caller
     * did not choose, and returning the link would undo exactly the protection
     * the stored-address rule above provides — a coach could pull a peer coach's
     * reset link straight out of the response. So they get `sent` and nothing
     * else, and if the mail fails that person uses "Forgot password" themselves.
     */
    return c.json(
      {
        ok: true,
        sent,
        expires_at: now + RESET_TTL,
        ...(callerChoseDestination ? { url } : {}),
      },
      201,
    );
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

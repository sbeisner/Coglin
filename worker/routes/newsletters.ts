/**
 * Sponsor updates: the contact list, and the newsletters written for it
 * (COG-0xx, finance phase 3).
 *
 * NOTHING HERE SENDS MAIL. There is no Resend call in this file and no cron
 * touching these tables. A team writes an update, copies it out, sends it from
 * their own mail, and presses "mark sent" — which is the only thing that ever
 * writes `sent_at`. `scheduled_for` is a due date the screen nudges about.
 * migrations/0011_newsletters.sql carries the argument and lists the two real
 * blockers between this and actual delivery; read it before adding a job.
 *
 * WHO SEES: reads are plain `requireMember`, viewers included — the same call
 * the ledger and the sponsor list make. What the team tells its sponsors is
 * not a secret from a parent.
 *
 * WHO WRITES: `denyRole('viewer')` throughout. Students write the updates,
 * which is the point — a season report in a student's own voice is worth more
 * to a sponsor than one in a coach's, and it is the business sub-team's job.
 * Unlike a sponsor PAYMENT (coach-only, because it writes the ledger), nothing
 * in this file touches money.
 *
 * CONTACT ADDRESSES ARE NEVER LOGGED. Same discipline worker/lib/email.ts
 * applies to recipients: they cross the API boundary and land in D1, and
 * nowhere else. If you add a console.error here, check what is in scope.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import { boundedInt, optionalString, readJson } from '../lib/http';
import { emptyDoc, parseContent } from '../lib/notes';
import {
  isSettableStatus,
  looksLikeEmail,
  MAX_EPOCH,
  normaliseEmail,
} from '../lib/newsletters';
import {
  auth as authOf,
  denyRole,
  requireMember,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const newsletters = new Hono<AppEnv>();

const CONTACT_COLUMNS = `id, org_name, contact_name, email, note, subscribed_at,
        subscribed_by, unsubscribed_at, sponsor_id, created_by, created_at,
        updated_at`;

/** Without `body`, for the list — the pitch route makes the same split. */
const NEWSLETTER_SUMMARY = `id, title, body_text, rev, status, scheduled_for,
        sent_at, sent_by, recipient_count, created_by, updated_by, created_at,
        updated_at`;
const NEWSLETTER_FULL = `${NEWSLETTER_SUMMARY}, body`;

/**
 * "May be mailed", as SQL. Mirrors isSubscribed in lib/newsletters.ts — an
 * opt-in that is newer than the most recent opt-out.
 */
const SUBSCRIBED_SQL = `subscribed_at IS NOT NULL
        AND (unsubscribed_at IS NULL OR subscribed_at > unsubscribed_at)`;

async function currentSeason(
  c: { env: { DB: D1Database } },
  teamId: string,
): Promise<{ id: string } | null> {
  return c.env.DB.prepare(
    'SELECT id FROM seasons WHERE team_id = ? AND is_current = 1',
  )
    .bind(teamId)
    .first<{ id: string }>();
}

// ------------------------------------------------------------------- contacts

newsletters.get('/contacts', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const season = await currentSeason(c, teamId);
  if (!season) return c.json({ contacts: [] });

  const { results } = await c.env.DB.prepare(
    `SELECT ${CONTACT_COLUMNS} FROM external_contacts
      WHERE team_id = ? AND season_id = ?
      ORDER BY COALESCE(org_name, contact_name, email) ASC
      LIMIT 500`,
  )
    .bind(teamId, season.id)
    .all();
  return c.json({ contacts: results });
});

newsletters.post(
  '/contacts',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const raw = optionalString(body.email, 200);
    if (!raw) return c.json({ error: 'missing_email' }, 400);
    const email = normaliseEmail(raw);
    if (!looksLikeEmail(email)) return c.json({ error: 'invalid_email' }, 400);

    const season = await currentSeason(c, teamId);
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    // A new contact is subscribed unless told otherwise: somebody typing an
    // address into a "who gets our updates" form is expressing exactly that
    // intent, and `subscribed_by` records who asserted it.
    const subscribe = body.subscribed === undefined ? true : body.subscribed === true;
    const id = uuid();
    const now = nowSeconds();

    try {
      await c.env.DB.prepare(
        `INSERT INTO external_contacts
           (id, team_id, season_id, org_name, contact_name, email, note,
            subscribed_at, subscribed_by, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          teamId,
          season.id,
          optionalString(body.org_name, 200),
          optionalString(body.contact_name, 120),
          email,
          optionalString(body.note, 500),
          subscribe ? now : null,
          subscribe ? member.id : null,
          member.id,
          now,
          now,
        )
        .run();
    } catch (err) {
      // The unique index on (team, season, email) is the only one reachable
      // here, and it means the address is already on the list.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE')) return c.json({ error: 'duplicate_email' }, 409);
      throw err;
    }

    const row = await c.env.DB.prepare(
      `SELECT ${CONTACT_COLUMNS} FROM external_contacts WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ contact: row }, 201);
  },
);

/**
 * Pull the sponsors' own contacts onto the list, once.
 *
 * Declared before the `:id` routes so "import-sponsors" is not read as an id.
 *
 * Idempotent by address: a sponsor already on the list is skipped, which also
 * means somebody who UNSUBSCRIBED is never quietly put back — their row still
 * exists, so it is skipped like any other. That is the whole reason 0011 keeps
 * `unsubscribed_at` instead of clearing it.
 */
newsletters.post(
  '/contacts/import-sponsors',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId, member } = authOf(c);
    const season = await currentSeason(c, teamId);
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    // A sponsor's address lives on the prospect that produced it — the sponsor
    // row itself deliberately carries no contact details.
    const { results: candidates } = await c.env.DB.prepare(
      `SELECT s.id AS sponsor_id, s.name AS org_name,
              p.contact_name AS contact_name, p.contact_email AS email
         FROM sponsors s
         JOIN sponsor_prospects p
           ON p.sponsor_id = s.id AND p.team_id = s.team_id
        WHERE s.team_id = ? AND s.season_id = ?
          AND p.contact_email IS NOT NULL AND TRIM(p.contact_email) <> ''`,
    )
      .bind(teamId, season.id)
      .all<{
        sponsor_id: string;
        org_name: string;
        contact_name: string | null;
        email: string;
      }>();

    const { results: existing } = await c.env.DB.prepare(
      'SELECT email FROM external_contacts WHERE team_id = ? AND season_id = ?',
    )
      .bind(teamId, season.id)
      .all<{ email: string }>();
    const known = new Set(existing.map((r) => normaliseEmail(r.email)));

    const now = nowSeconds();
    const inserts = [];
    for (const candidate of candidates) {
      const email = normaliseEmail(candidate.email);
      if (!looksLikeEmail(email) || known.has(email)) continue;
      // Dedupe within the batch too: two sponsors can share a contact.
      known.add(email);
      inserts.push(
        c.env.DB.prepare(
          `INSERT INTO external_contacts
             (id, team_id, season_id, org_name, contact_name, email,
              subscribed_at, subscribed_by, sponsor_id, created_by, created_at,
              updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          uuid(),
          teamId,
          season.id,
          candidate.org_name,
          candidate.contact_name,
          email,
          now,
          member.id,
          candidate.sponsor_id,
          member.id,
          now,
          now,
        ),
      );
    }

    if (inserts.length > 0) await c.env.DB.batch(inserts);

    return c.json({
      imported: inserts.length,
      skipped: candidates.length - inserts.length,
    });
  },
);

newsletters.patch(
  '/contacts/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId } = authOf(c);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.email !== undefined) {
      const raw = optionalString(body.email, 200);
      if (!raw) return c.json({ error: 'missing_email' }, 400);
      const email = normaliseEmail(raw);
      if (!looksLikeEmail(email)) return c.json({ error: 'invalid_email' }, 400);
      sets.push('email = ?');
      values.push(email);
    }
    for (const [key, max] of [
      ['org_name', 200],
      ['contact_name', 120],
      ['note', 500],
    ] as const) {
      if (body[key] !== undefined) {
        sets.push(`${key} = ?`);
        values.push(optionalString(body[key], max));
      }
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_at = ?');
    values.push(nowSeconds());

    try {
      const result = await c.env.DB.prepare(
        `UPDATE external_contacts SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`,
      )
        .bind(...values, c.req.param('id'), teamId)
        .run();
      if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('UNIQUE')) return c.json({ error: 'duplicate_email' }, 409);
      throw err;
    }

    const row = await c.env.DB.prepare(
      `SELECT ${CONTACT_COLUMNS} FROM external_contacts WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('id'), teamId)
      .first();
    return c.json({ contact: row });
  },
);

/**
 * Opt a contact in or out.
 *
 * Opting out records WHEN rather than clearing the opt-in, so a later import
 * can tell "never asked" from "asked to be left alone". Opting back in stamps
 * a fresh `subscribed_at`, which is newer than the opt-out and therefore wins
 * — see isSubscribed in lib/newsletters.ts.
 */
newsletters.post(
  '/contacts/:id/subscription',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = (await readJson(c)) ?? {};
    if (typeof body.subscribed !== 'boolean') {
      return c.json({ error: 'invalid_body' }, 400);
    }
    const { teamId, member } = authOf(c);
    const now = nowSeconds();

    const result = await c.env.DB.prepare(
      body.subscribed
        ? `UPDATE external_contacts
              SET subscribed_at = ?, subscribed_by = ?, updated_at = ?
            WHERE id = ? AND team_id = ?`
        : `UPDATE external_contacts
              SET unsubscribed_at = ?, updated_at = ?
            WHERE id = ? AND team_id = ?`,
    )
      .bind(
        ...(body.subscribed ? [now, member.id, now] : [now, now]),
        c.req.param('id'),
        teamId,
      )
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    const row = await c.env.DB.prepare(
      `SELECT ${CONTACT_COLUMNS} FROM external_contacts WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('id'), teamId)
      .first();
    return c.json({ contact: row });
  },
);

newsletters.delete(
  '/contacts/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId } = authOf(c);
    const result = await c.env.DB.prepare(
      'DELETE FROM external_contacts WHERE id = ? AND team_id = ?',
    )
      .bind(c.req.param('id'), teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  },
);

// ---------------------------------------------------------------- newsletters

newsletters.get('/newsletters', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const season = await currentSeason(c, teamId);
  if (!season) return c.json({ newsletters: [], subscriber_count: 0 });

  const [rows, subscribers] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${NEWSLETTER_SUMMARY} FROM newsletters
        WHERE team_id = ? AND season_id = ?
        ORDER BY COALESCE(sent_at, scheduled_for, created_at) DESC
        LIMIT 200`,
    ).bind(teamId, season.id),
    c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM external_contacts
        WHERE team_id = ? AND season_id = ? AND ${SUBSCRIBED_SQL}`,
    ).bind(teamId, season.id),
  ]);

  // The live subscriber count rides along so the list can say who a draft
  // WOULD reach, next to the snapshot of who a sent one DID reach.
  return c.json({
    newsletters: rows.results,
    subscriber_count: (subscribers.results[0] as { n: number }).n,
  });
});

/** The single read, the only one carrying the body — the editor's fetch. */
newsletters.get('/newsletters/:id', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const row = await c.env.DB.prepare(
    `SELECT ${NEWSLETTER_FULL} FROM newsletters WHERE id = ? AND team_id = ?`,
  )
    .bind(c.req.param('id'), teamId)
    .first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ newsletter: row });
});

newsletters.post(
  '/newsletters',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const title = optionalString(body.title, 200);
    if (!title) return c.json({ error: 'missing_title' }, 400);

    const season = await currentSeason(c, teamId);
    if (!season) return c.json({ error: 'no_current_season' }, 409);

    const id = uuid();
    const now = nowSeconds();
    await c.env.DB.prepare(
      `INSERT INTO newsletters
         (id, team_id, season_id, title, body, body_text, rev, status,
          created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 0, 'draft', ?, ?, ?, ?)`,
    )
      .bind(id, teamId, season.id, title, emptyDoc(), member.id, member.id, now, now)
      .run();

    const row = await c.env.DB.prepare(
      `SELECT ${NEWSLETTER_FULL} FROM newsletters WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ newsletter: row }, 201);
  },
);

/**
 * Title, schedule and the draft/scheduled flip.
 *
 * `status` accepts 'draft' and 'scheduled' and refuses 'sent': marking
 * something sent asserts a mail left the building, so it has its own route.
 * Same split as 'committed' on sponsor_prospects.
 */
newsletters.patch(
  '/newsletters/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);

    const sets: string[] = [];
    const values: unknown[] = [];

    if (body.title !== undefined) {
      const title = optionalString(body.title, 200);
      if (!title) return c.json({ error: 'missing_title' }, 400);
      sets.push('title = ?');
      values.push(title);
    }
    if (body.scheduled_for !== undefined) {
      if (body.scheduled_for === null) {
        sets.push('scheduled_for = ?');
        values.push(null);
      } else {
        const when = boundedInt(body.scheduled_for, 0, MAX_EPOCH);
        if (when === null) return c.json({ error: 'invalid_scheduled_for' }, 400);
        sets.push('scheduled_for = ?');
        values.push(when);
      }
    }
    if (body.status !== undefined) {
      if (!isSettableStatus(body.status)) return c.json({ error: 'invalid_status' }, 400);
      sets.push('status = ?');
      values.push(body.status);
      // Leaving 'sent' un-does the send stamps, so the row cannot claim both
      // "draft" and "went out on the 3rd".
      if (body.status === 'draft') {
        sets.push('sent_at = ?', 'sent_by = ?', 'recipient_count = ?');
        values.push(null, null, null);
      }
    }
    if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

    sets.push('updated_by = ?', 'updated_at = ?');
    values.push(member.id, nowSeconds());

    const result = await c.env.DB.prepare(
      `UPDATE newsletters SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`,
    )
      .bind(...values, c.req.param('id'), teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

    const row = await c.env.DB.prepare(
      `SELECT ${NEWSLETTER_FULL} FROM newsletters WHERE id = ? AND team_id = ?`,
    )
      .bind(c.req.param('id'), teamId)
      .first();
    return c.json({ newsletter: row });
  },
);

/**
 * The body, on a compare-and-swap. routes/docs.ts's content route again, third
 * document type — see the header there and on the campaign pitch route.
 */
newsletters.put(
  '/newsletters/:id/body',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);
    const id = c.req.param('id');

    const parsed = parseContent(body.content);
    if ('error' in parsed) {
      const status = parsed.error === 'invalid_content' ? 400 : 409;
      return c.json({ error: parsed.error }, status);
    }
    const content = body.content as string;

    const current = await c.env.DB.prepare(
      'SELECT rev, body FROM newsletters WHERE id = ? AND team_id = ?',
    )
      .bind(id, teamId)
      .first<{ rev: number; body: string }>();
    if (!current) return c.json({ error: 'not_found' }, 404);

    const baseRev = typeof body.base_rev === 'number' ? body.base_rev : null;
    if (baseRev !== null && baseRev !== current.rev) {
      const server = await c.env.DB.prepare(
        `SELECT ${NEWSLETTER_FULL} FROM newsletters WHERE id = ? AND team_id = ?`,
      )
        .bind(id, teamId)
        .first();
      return c.json({ error: 'stale_content', newsletter: server }, 409);
    }

    if (current.body === content) {
      const row = await c.env.DB.prepare(
        `SELECT ${NEWSLETTER_FULL} FROM newsletters WHERE id = ? AND team_id = ?`,
      )
        .bind(id, teamId)
        .first();
      return c.json({ newsletter: row, unchanged: true });
    }

    const now = nowSeconds();
    const result = await c.env.DB.prepare(
      `UPDATE newsletters
          SET body = ?, body_text = ?, rev = rev + 1, updated_by = ?, updated_at = ?
        WHERE id = ? AND team_id = ? AND rev = ?`,
    )
      .bind(content, parsed.text, member.id, now, id, teamId, current.rev)
      .run();

    if (result.meta.changes === 0) {
      const server = await c.env.DB.prepare(
        `SELECT ${NEWSLETTER_FULL} FROM newsletters WHERE id = ? AND team_id = ?`,
      )
        .bind(id, teamId)
        .first();
      if (!server) return c.json({ error: 'not_found' }, 404);
      return c.json({ error: 'stale_content', newsletter: server }, 409);
    }

    const row = await c.env.DB.prepare(
      `SELECT ${NEWSLETTER_FULL} FROM newsletters WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ newsletter: row });
  },
);

/**
 * "I have sent this."
 *
 * The only writer of `sent_at`, and it runs because a person pressed a button
 * after mailing the thing themselves. Coglin did not send it and does not
 * claim to; what this records is the team's own assertion, with their name on
 * it.
 *
 * `recipient_count` is snapshotted here rather than counted later, because the
 * contact list keeps moving and "it went to fourteen people" is a fact about
 * the day it went.
 */
newsletters.post(
  '/newsletters/:id/sent',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId, member } = authOf(c);
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare(
      'SELECT id, season_id, status FROM newsletters WHERE id = ? AND team_id = ?',
    )
      .bind(id, teamId)
      .first<{ id: string; season_id: string; status: string }>();
    if (!existing) return c.json({ error: 'not_found' }, 404);
    if (existing.status === 'sent') return c.json({ error: 'already_sent' }, 409);

    const subscribers = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM external_contacts
        WHERE team_id = ? AND season_id = ? AND ${SUBSCRIBED_SQL}`,
    )
      .bind(teamId, existing.season_id)
      .first<{ n: number }>();

    const now = nowSeconds();
    const result = await c.env.DB.prepare(
      `UPDATE newsletters
          SET status = 'sent', sent_at = ?, sent_by = ?, recipient_count = ?,
              updated_by = ?, updated_at = ?
        WHERE id = ? AND team_id = ? AND status <> 'sent'`,
    )
      .bind(now, member.id, subscribers?.n ?? 0, member.id, now, id, teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'already_sent' }, 409);

    const row = await c.env.DB.prepare(
      `SELECT ${NEWSLETTER_FULL} FROM newsletters WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ newsletter: row });
  },
);

/**
 * Delete an update.
 *
 * Allowed at any status, unlike a paid sponsor. A newsletter is the team's own
 * writing with no counterparty relying on the record — the reason the ledger
 * refuses is that somebody else's money is described in it, and that does not
 * apply here.
 */
newsletters.delete(
  '/newsletters/:id',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId } = authOf(c);
    const result = await c.env.DB.prepare(
      'DELETE FROM newsletters WHERE id = ? AND team_id = ?',
    )
      .bind(c.req.param('id'), teamId)
      .run();
    if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
    return c.json({ ok: true });
  },
);

export { newsletters };

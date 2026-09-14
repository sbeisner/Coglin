/**
 * Portfolio candidates (COG-036 / COG-017, front half).
 *
 * A candidate is a pointer to anything plus a judgement about it. Flagging is
 * the cheapest possible gesture on purpose — one tap, no required fields, open
 * to students — because the portfolio is assembled in March from work done in
 * November, and the only version of this that works is the one where marking
 * something costs nothing at the moment it happens.
 *
 * `source_id` is polymorphic and therefore has no foreign key, which makes
 * validating it the Worker's job rather than the database's. Every flag checks
 * that the thing being flagged exists **within the caller's team** before
 * inserting; skipping that would let a guessed id from another team into the
 * inbox.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import { optionalString, readJson } from '../lib/http';
import {
  isAwardKey,
  isCandidateSourceType,
  isCandidateState,
  type CandidateSourceType,
} from '../lib/meetings';
import {
  auth as authOf,
  denyRole,
  requireMember,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const candidates = new Hono<AppEnv>();

const CANDIDATE_COLUMNS = `id, source_type, source_id, suggested_award, why, state,
        placed_page_id, flagged_by, decided_by, decided_at, created_at, updated_at`;

/** Where each source type lives, so a flag can be checked against the team. */
const SOURCE_TABLES: Record<CandidateSourceType, string> = {
  meeting: 'meetings',
  note_doc: 'note_docs',
  media: 'media',
  task: 'tasks',
  outreach_event: 'outreach_events',
};

async function sourceExists(
  db: D1Database,
  teamId: string,
  type: CandidateSourceType,
  id: string,
): Promise<boolean> {
  // A student's face is not award evidence. Roster photos are refused as
  // candidates rather than filtered out of the inbox afterwards, so a
  // portfolio can never come to contain one by way of a guessed media id.
  //
  // A soft-deleted document cannot be newly flagged either. An EXISTING flag on
  // one stays listed and says so — that rule lives in the inbox below, because
  // the flag was one person's decision and the delete was another person's.
  // Named positively, not as "anything but a roster photo". The negative form
  // meant every kind added later became flaggable evidence by default, which is
  // how a CAD attachment (0013) would have silently turned into a portfolio
  // candidate. A new kind should have to be let in, not have to be kept out.
  const extra =
    type === 'media'
      ? " AND kind IN ('photo', 'file')"
      : type === 'note_doc'
        ? ' AND deleted_at IS NULL'
        : '';
  const row = await db
    .prepare(
      `SELECT id FROM ${SOURCE_TABLES[type]} WHERE id = ? AND team_id = ?${extra}`,
    )
    .bind(id, teamId)
    .first();
  return row !== null;
}

async function currentSeasonId(
  db: D1Database,
  teamId: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT id FROM seasons WHERE team_id = ? AND is_current = 1')
    .bind(teamId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

// --------------------------------------------------------------------- flag

/**
 * Flag something. Idempotent: re-flagging returns the existing row with a 200.
 *
 * A student tapping the mark on an already-flagged paragraph should feel like
 * it worked, not like a conflict — and two students flagging the same paragraph
 * is one act, not two rows to reconcile in March.
 */
candidates.post('/candidates', sameOriginOnly, requireMember, denyRole('viewer'), async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const sourceType = body.source_type;
  if (!isCandidateSourceType(sourceType)) {
    return c.json({ error: 'invalid_source_type' }, 400);
  }
  const sourceId = optionalString(body.source_id, 64);
  if (!sourceId) return c.json({ error: 'invalid_source_id' }, 400);

  if (body.suggested_award !== undefined && body.suggested_award !== null) {
    if (!isAwardKey(body.suggested_award)) {
      return c.json({ error: 'invalid_award' }, 400);
    }
  }

  const { teamId, member } = authOf(c);
  const seasonId = await currentSeasonId(c.env.DB, teamId);
  if (!seasonId) return c.json({ error: 'no_current_season' }, 409);

  // Mandatory, because source_id has no FK to enforce it.
  if (!(await sourceExists(c.env.DB, teamId, sourceType, sourceId))) {
    return c.json({ error: 'source_not_found' }, 404);
  }

  const existing = await c.env.DB.prepare(
    `SELECT ${CANDIDATE_COLUMNS} FROM portfolio_candidates
      WHERE team_id = ? AND source_type = ? AND source_id = ?`,
  )
    .bind(teamId, sourceType, sourceId)
    .first();
  if (existing) return c.json({ candidate: existing }, 200);

  const id = uuid();
  const now = nowSeconds();
  await c.env.DB.prepare(
    `INSERT INTO portfolio_candidates
       (id, team_id, season_id, source_type, source_id, suggested_award, why,
        state, flagged_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?)`,
  )
    .bind(
      id,
      teamId,
      seasonId,
      sourceType,
      sourceId,
      (body.suggested_award as string | undefined) ?? null,
      optionalString(body.why, 1000),
      member.id,
      now,
      now,
    )
    .run();

  const row = await c.env.DB.prepare(
    `SELECT ${CANDIDATE_COLUMNS} FROM portfolio_candidates WHERE id = ? AND team_id = ?`,
  )
    .bind(id, teamId)
    .first();
  return c.json({ candidate: row }, 201);
});

/**
 * Unflag by source, so the editor's toggle does not have to know the candidate
 * id it is removing.
 */
candidates.delete('/candidates', sameOriginOnly, requireMember, denyRole('viewer'), async (c) => {
  const url = new URL(c.req.url);
  const sourceType = url.searchParams.get('source_type');
  const sourceId = url.searchParams.get('source_id');
  if (!isCandidateSourceType(sourceType) || !sourceId) {
    return c.json({ error: 'invalid_source' }, 400);
  }

  const { teamId } = authOf(c);
  const existing = await c.env.DB.prepare(
    `SELECT id, state FROM portfolio_candidates
      WHERE team_id = ? AND source_type = ? AND source_id = ?`,
  )
    .bind(teamId, sourceType, sourceId)
    .first<{ id: string; state: string }>();
  if (!existing) return c.json({ error: 'not_found' }, 404);
  // Unplace it first, deliberately: silently removing something already laid
  // out on a portfolio page is not an undo, it is a surprise.
  if (existing.state === 'placed') return c.json({ error: 'candidate_placed' }, 409);

  await c.env.DB.prepare(
    'DELETE FROM portfolio_candidates WHERE id = ? AND team_id = ?',
  )
    .bind(existing.id, teamId)
    .run();
  return c.json({ ok: true });
});

// --------------------------------------------------------------------- list

/**
 * The inbox, hydrated.
 *
 * Each row carries a preview resolved per source type, fetched with grouped
 * `IN (...)` queries rather than one lookup per candidate — the inbox is the
 * screen most likely to hold a season's worth of rows, and N+1 there is a real
 * bill on D1's per-row pricing.
 *
 * `source_deleted` is how a flag on a soft-deleted paragraph surfaces. It stays
 * in the list rather than vanishing, because the block was deleted by somebody
 * other than whoever flagged it.
 */
candidates.get('/candidates', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const url = new URL(c.req.url);
  const state = url.searchParams.get('state');
  if (state !== null && !isCandidateState(state)) {
    return c.json({ error: 'invalid_state' }, 400);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT ${CANDIDATE_COLUMNS} FROM portfolio_candidates
      WHERE team_id = ? AND (? IS NULL OR state = ?)
      ORDER BY created_at DESC
      LIMIT 500`,
  )
    .bind(teamId, state, state)
    .all<{ id: string; source_type: CandidateSourceType; source_id: string }>();

  const byType = new Map<CandidateSourceType, string[]>();
  for (const row of results) {
    const list = byType.get(row.source_type) ?? [];
    list.push(row.source_id);
    byType.set(row.source_type, list);
  }

  const previews = new Map<string, Record<string, unknown>>();

  const docIds = byType.get('note_doc') ?? [];
  if (docIds.length > 0) {
    // The excerpt comes from content_text, which is why that column exists: the
    // body is ProseMirror JSON and no amount of SQL will pull a readable sentence
    // out of it. LEFT JOIN because a document need not belong to a meeting.
    const { results: rows } = await c.env.DB.prepare(
      `SELECT d.id AS id, d.title AS title,
              SUBSTR(d.content_text, 1, 280) AS excerpt,
              d.deleted_at AS deleted_at, d.meeting_id AS meeting_id,
              m.title AS meeting_title, m.starts_at AS meeting_starts_at
         FROM note_docs d
         LEFT JOIN meetings m ON m.id = d.meeting_id AND m.team_id = d.team_id
        WHERE d.team_id = ? AND d.id IN (${docIds.map(() => '?').join(',')})`,
    )
      .bind(teamId, ...docIds)
      .all<Record<string, unknown>>();
    for (const row of rows) previews.set(`note_doc:${row.id}`, row);
  }

  const meetingIds = byType.get('meeting') ?? [];
  if (meetingIds.length > 0) {
    const { results: meetings } = await c.env.DB.prepare(
      `SELECT id, title, starts_at FROM meetings
        WHERE team_id = ? AND id IN (${meetingIds.map(() => '?').join(',')})`,
    )
      .bind(teamId, ...meetingIds)
      .all<Record<string, unknown>>();
    for (const meeting of meetings) previews.set(`meeting:${meeting.id}`, meeting);
  }

  const mediaIds = byType.get('media') ?? [];
  if (mediaIds.length > 0) {
    const { results: media } = await c.env.DB.prepare(
      `SELECT id, caption, width, height FROM media
        WHERE team_id = ? AND id IN (${mediaIds.map(() => '?').join(',')})`,
    )
      .bind(teamId, ...mediaIds)
      .all<Record<string, unknown>>();
    for (const item of media) previews.set(`media:${item.id}`, item);
  }

  return c.json({
    candidates: results.map((row) => {
      const preview = previews.get(`${row.source_type}:${row.source_id}`) ?? null;
      return {
        ...row,
        preview,
        source_deleted:
          preview === null || (preview as { deleted_at?: number }).deleted_at != null,
      };
    }),
  });
});

// -------------------------------------------------------------------- triage

/**
 * Triage. Shortlisting and rejecting are open to students — the argument about
 * what is good is theirs to have — but PLACING something on a page is
 * coach/mentor, because the portfolio is fifteen pages and that is a scarce,
 * contested resource.
 *
 * Rejecting does NOT delete the flag or unmark the block. A triage decision
 * must not silently erase a student's own mark in their own notes.
 */
candidates.patch('/candidates/:id', sameOriginOnly, requireMember, denyRole('viewer'), async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);

  const { teamId, member } = authOf(c);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    `SELECT id, source_type, source_id, state FROM portfolio_candidates
      WHERE id = ? AND team_id = ?`,
  )
    .bind(id, teamId)
    .first<{ id: string; state: string }>();
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const sets: string[] = [];
  const values: unknown[] = [];

  if (body.state !== undefined) {
    if (!isCandidateState(body.state)) return c.json({ error: 'invalid_state' }, 400);
    if (body.state === 'placed') {
      if (member.role !== 'coach' && member.role !== 'mentor') {
        return c.json({ error: 'forbidden' }, 403);
      }
      if (!optionalString(body.placed_page_id, 64)) {
        return c.json({ error: 'missing_page' }, 400);
      }
    }
    sets.push('state = ?', 'decided_by = ?', 'decided_at = ?');
    values.push(body.state, member.id, nowSeconds());
  }
  if (body.suggested_award !== undefined) {
    if (body.suggested_award !== null && !isAwardKey(body.suggested_award)) {
      return c.json({ error: 'invalid_award' }, 400);
    }
    sets.push('suggested_award = ?');
    values.push(body.suggested_award);
  }
  if (body.why !== undefined) {
    sets.push('why = ?');
    values.push(optionalString(body.why, 1000));
  }
  if (body.placed_page_id !== undefined) {
    sets.push('placed_page_id = ?');
    values.push(optionalString(body.placed_page_id, 64));
  }
  if (sets.length === 0) return c.json({ error: 'nothing_to_update' }, 400);

  sets.push('updated_at = ?');
  values.push(nowSeconds());

  await c.env.DB.prepare(
    `UPDATE portfolio_candidates SET ${sets.join(', ')} WHERE id = ? AND team_id = ?`,
  )
    .bind(...values, id, teamId)
    .run();

  const row = await c.env.DB.prepare(
    `SELECT ${CANDIDATE_COLUMNS} FROM portfolio_candidates WHERE id = ? AND team_id = ?`,
  )
    .bind(id, teamId)
    .first();
  return c.json({ candidate: row });
});

// --------------------------------------------------------------------- pages

/**
 * The fifteen-page budget, seeded on first read.
 *
 * `portfolio_pages` has no rows and no migration can create them — a migration
 * does not know which teams exist. Seeding lazily here is what gives `placed`
 * somewhere to point. `INSERT OR IGNORE` against the existing unique index
 * makes it idempotent.
 */
candidates.get('/pages', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const seasonId = await currentSeasonId(c.env.DB, teamId);
  if (!seasonId) return c.json({ error: 'no_current_season' }, 409);

  const existing = await c.env.DB.prepare(
    'SELECT COUNT(*) AS n FROM portfolio_pages WHERE team_id = ? AND season_id = ?',
  )
    .bind(teamId, seasonId)
    .first<{ n: number }>();

  if ((existing?.n ?? 0) === 0) {
    const now = nowSeconds();
    void now;
    // Page 0 is the cover; 1..15 is the Competition Manual's hard limit.
    const statements = Array.from({ length: 16 }, (_, pageNo) =>
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO portfolio_pages
           (id, team_id, season_id, page_no, title, state)
         VALUES (?, ?, ?, ?, ?, 'empty')`,
      ).bind(
        uuid(),
        teamId,
        seasonId,
        pageNo,
        pageNo === 0 ? 'Cover' : `Page ${pageNo}`,
      ),
    );
    await c.env.DB.batch(statements);
  }

  const { results } = await c.env.DB.prepare(
    `SELECT id, page_no, title, owner_member_id, state FROM portfolio_pages
      WHERE team_id = ? AND season_id = ? ORDER BY page_no ASC`,
  )
    .bind(teamId, seasonId)
    .all();
  return c.json({ pages: results });
});

export { candidates };

/**
 * Note documents: a tree of pages, some belonging to a meeting and some not.
 *
 * These are NOT under /api/meetings/:id/docs, and that is deliberate twice over.
 * A document may be standalone, so a path naming a meeting cannot address one —
 * and a document's identity must not change when it is dragged to another
 * meeting, which a URL embedding meeting_id would break by 404ing immediately
 * after the drop. `meeting_id` is a field, not a path segment.
 *
 * THE WRITE MODEL, which replaces the PATCH/PUT split the block routes used:
 *
 *   PUT   /:id/content  the keystroke path. Debounced on the client, one row, and
 *                       a no-op autosave writes nothing at all.
 *   PATCH /:id          the title. A rename must not be a content write, or
 *                       renaming clobbers whatever a co-editor typed since your
 *                       last load.
 *   POST  /:id/move     the structural path. A drag moves ONE document, so there
 *                       is no analogue of "reorder forty blocks atomically".
 *
 * The old split existed because a document was N rows. With the body in one
 * column that distinction collapses — a content save IS the whole-document write —
 * but the reason for it survives, which is why the cheap path and the structural
 * path are still separate routes.
 *
 * CONCURRENCY. One content column gives last-write-wins at DOCUMENT granularity
 * where blocks gave it at paragraph granularity, and migrations/0006 is explicit
 * that this is the cost of the change. The mitigation is compare-and-swap:
 * `base_rev` is the `rev` the client last saw, and the UPDATE carries
 * `AND rev = ?`, so a stale write answers 409 with the server's copy instead of
 * silently overwriting somebody. The real fix is a Durable Object.
 *
 * `rev` and not `updated_at`, which the first cut used: timestamps here are epoch
 * SECONDS, so two saves in the same second compared equal and the guard waved
 * through exactly the case it exists to catch. A counter has no resolution to run
 * out of.
 *
 * Documents are SOFT deleted, together with their descendants. One delete now
 * removes what used to be forty flaggable paragraphs, and a portfolio flag
 * somebody else put on a document has to outlive it.
 */
import { Hono } from 'hono';
import { getServerByName } from 'partyserver';
import { MEMBER_HEADER, READ_ONLY_HEADER, roomName } from '../noteRoom';
import { nowSeconds, uuid } from '../lib/crypto';
import { optionalString, readJson } from '../lib/http';
import { POSITION_GAP, positionBetween } from '../lib/meetings';
import {
  MAX_DEPTH,
  MAX_DOCS,
  MAX_SUBTREE,
  MAX_TITLE,
  emptyDoc,
  liveNotesEnabled,
  parseContent,
} from '../lib/notes';
import {
  auth as authOf,
  denyRole,
  requireMember,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const docs = new Hono<AppEnv>();

/**
 * `content` is deliberately absent. Shipping every body to draw a sidebar is the
 * N+1's fat cousin: one request, but forty documents of prose to render a list of
 * forty titles. `content_bytes` is what lets the tree grey out an empty page.
 */
const DOC_SUMMARY = `d.id AS id, d.parent_doc_id AS parent_doc_id,
        d.meeting_id AS meeting_id, d.position AS position, d.title AS title,
        d.created_by AS created_by, d.updated_by AS updated_by,
        d.created_at AS created_at, d.updated_at AS updated_at,
        LENGTH(d.content) AS content_bytes`;

const DOC_FULL = `id, parent_doc_id, meeting_id, position, title, content,
        content_text, rev, created_by, updated_by, created_at, updated_at`;

interface DocRow {
  id: string;
  parent_doc_id: string | null;
  meeting_id: string | null;
  position: number;
  title: string;
}

async function ownedDoc(
  db: D1Database,
  teamId: string,
  docId: string,
): Promise<DocRow | null> {
  return await db
    .prepare(
      `SELECT id, parent_doc_id, meeting_id, position, title FROM note_docs
        WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
    )
    .bind(docId, teamId)
    .first<DocRow>();
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

/**
 * A document and everything under it, with depths relative to the root.
 *
 * `AND d.team_id = ?` inside the RECURSIVE arm is the house rule applied to a
 * CTE, and it is not decoration: without it the recursion can walk across a
 * tenant boundary through a hand-forged parent_doc_id, which is the one bug this
 * codebase cannot ship. The depth bound is belt and braces against a cycle that
 * somehow exists despite the guard below.
 */
async function subtree(
  db: D1Database,
  teamId: string,
  rootId: string,
): Promise<{ id: string; depth: number }[]> {
  const { results } = await db
    .prepare(
      `WITH RECURSIVE sub(id, depth) AS (
         SELECT id, 0 FROM note_docs
          WHERE id = ?1 AND team_id = ?2 AND deleted_at IS NULL
         UNION ALL
         SELECT d.id, sub.depth + 1
           FROM note_docs d JOIN sub ON d.parent_doc_id = sub.id
          WHERE d.team_id = ?2 AND d.deleted_at IS NULL AND sub.depth < 16
       )
       SELECT id, depth FROM sub`,
    )
    .bind(rootId, teamId)
    .all<{ id: string; depth: number }>();
  return results;
}

/**
 * Position for a document dropped after `afterId` among a given parent's children.
 *
 * `IS` rather than `=` for both nullable columns. `= NULL` never matches, so with
 * `=` every root-level sibling query silently returns nothing and every new root
 * document lands on the same position — the easiest bug to write in this file.
 */
async function positionAmong(
  db: D1Database,
  teamId: string,
  parentId: string | null,
  meetingId: string | null,
  afterId: string | null,
): Promise<number> {
  const { results: siblings } = await db
    .prepare(
      `SELECT id, position FROM note_docs
        WHERE team_id = ? AND parent_doc_id IS ? AND meeting_id IS ?
          AND deleted_at IS NULL
        ORDER BY position ASC`,
    )
    .bind(teamId, parentId, meetingId)
    .all<{ id: string; position: number }>();

  if (afterId === null) {
    const last = siblings[siblings.length - 1];
    return last ? last.position + POSITION_GAP : POSITION_GAP;
  }
  const index = siblings.findIndex((s) => s.id === afterId);
  if (index === -1) {
    const last = siblings[siblings.length - 1];
    return last ? last.position + POSITION_GAP : POSITION_GAP;
  }
  return positionBetween(
    siblings[index].position,
    siblings[index + 1]?.position ?? null,
  );
}

// --------------------------------------------------------------------- reading

/**
 * The season's whole tree, flat, in one batch with its portfolio flags.
 *
 * FLAT plus parent pointers, not nested. A nested response means two
 * representations of ordering — array order AND `position` — which can disagree,
 * and it leaves a client unable to reorder optimistically without re-nesting. The
 * tree build is ten lines in src/lib/docTree.ts, where the drag code needs the
 * same helper anyway.
 *
 * The meeting is joined so the sidebar can group by meeting without a second
 * request.
 */
docs.get('/', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const seasonId = await currentSeasonId(c.env.DB, teamId);
  if (!seasonId) return c.json({ error: 'no_current_season' }, 409);

  const [tree, candidates] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ${DOC_SUMMARY}, m.title AS meeting_title,
              m.starts_at AS meeting_starts_at
         FROM note_docs d
         LEFT JOIN meetings m ON m.id = d.meeting_id AND m.team_id = d.team_id
        WHERE d.team_id = ? AND d.season_id = ? AND d.deleted_at IS NULL
        ORDER BY d.parent_doc_id ASC, d.position ASC`,
    ).bind(teamId, seasonId),
    c.env.DB.prepare(
      `SELECT source_id FROM portfolio_candidates
        WHERE team_id = ? AND season_id = ? AND source_type = 'note_doc'`,
    ).bind(teamId, seasonId),
  ]);

  return c.json({
    docs: tree.results,
    flagged: (candidates.results as { source_id: string }[]).map((r) => r.source_id),
  });
});

docs.get('/:docId', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const row = await c.env.DB.prepare(
    `SELECT ${DOC_FULL} FROM note_docs
      WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('docId'), teamId)
    .first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  // `live` tells the editor which write path to use. When it is true, `content`
  // may trail the room by a few seconds and is only for the first paint.
  return c.json({
    doc: { ...row, live: liveNotesEnabled(c.env.LIVE_NOTES_TEAMS, teamId) },
  });
});

/** The polling seam. One row, so a freshness check is not a document download. */
docs.get('/:docId/rev', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const row = await c.env.DB.prepare(
    `SELECT rev, updated_at FROM note_docs
      WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('docId'), teamId)
    .first<{ rev: number; updated_at: number }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ rev: row.rev, updated_at: row.updated_at });
});

/**
 * The live connection (COG-051): a WebSocket into the document's NoteRoom.
 *
 * Everything the room knows about the caller comes from here. Tenancy is the
 * usual rule — the room name is built from the session's team, so a doc id from
 * another team names a room that does not exist rather than one that does — and
 * the member id and read-only bit ride on headers this route SETS, overwriting
 * anything the browser sent under the same names.
 *
 * sameOriginOnly matters more here than on a POST. Browsers attach cookies to a
 * cross-site WebSocket handshake and apply no CORS to it, so without the Origin
 * check any page a student visits could open their notes in the background.
 */
docs.get('/:docId/live', sameOriginOnly, requireMember, async (c) => {
  const { teamId, member } = authOf(c);
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return c.json({ error: 'expected_websocket' }, 426);
  }
  if (!liveNotesEnabled(c.env.LIVE_NOTES_TEAMS, teamId)) {
    return c.json({ error: 'not_live' }, 404);
  }
  const docId = c.req.param('docId');
  if (!(await ownedDoc(c.env.DB, teamId, docId))) {
    return c.json({ error: 'not_found' }, 404);
  }

  const request = new Request(c.req.raw);
  request.headers.set(MEMBER_HEADER, member.id);
  request.headers.set(READ_ONLY_HEADER, member.role === 'viewer' ? '1' : '0');
  const room = await getServerByName(c.env.NOTE_ROOMS, roomName(teamId, docId));
  return room.fetch(request);
});

// --------------------------------------------------------------------- writing

docs.post('/', sameOriginOnly, requireMember, denyRole('viewer'), async (c) => {
  const body = (await readJson(c)) ?? {};
  const { teamId, member } = authOf(c);

  const seasonId = await currentSeasonId(c.env.DB, teamId);
  if (!seasonId) return c.json({ error: 'no_current_season' }, 409);

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM note_docs
      WHERE team_id = ? AND season_id = ? AND deleted_at IS NULL`,
  )
    .bind(teamId, seasonId)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_DOCS) {
    return c.json({ error: 'too_many_docs', max: MAX_DOCS }, 409);
  }

  let parentId = optionalString(body.parent_doc_id, 64);
  let meetingId = optionalString(body.meeting_id, 64);

  if (parentId !== null) {
    const parent = await ownedDoc(c.env.DB, teamId, parentId);
    if (!parent) return c.json({ error: 'not_found' }, 404);
    const depth = await depthOf(c.env.DB, teamId, parent);
    if (depth + 1 >= MAX_DEPTH) {
      return c.json({ error: 'too_deep', max: MAX_DEPTH }, 409);
    }
    // The parent decides. A subdocument of a meeting-attached page belongs to
    // that meeting, so a body naming both is not an error — the parent wins.
    meetingId = parent.meeting_id;
  } else if (meetingId !== null) {
    const meeting = await c.env.DB.prepare(
      'SELECT id FROM meetings WHERE id = ? AND team_id = ?',
    )
      .bind(meetingId, teamId)
      .first();
    if (!meeting) return c.json({ error: 'not_found' }, 404);
  }

  const title = optionalString(body.title, MAX_TITLE) ?? 'Untitled';
  const now = nowSeconds();
  const position = await positionAmong(
    c.env.DB,
    teamId,
    parentId,
    meetingId,
    optionalString(body.after_id, 64),
  );

  /**
   * The client may choose the id, and a UNIQUE collision returns the existing row
   * with 200 rather than 201.
   *
   * Kept from the block routes, and it matters MORE now: the failure it covers is
   * shop wifi retrying a create, and a duplicate used to be one stray paragraph.
   * It is now a whole ghost document in the sidebar.
   */
  const id = optionalString(body.id, 64) ?? uuid();
  const content = emptyDoc();

  try {
    await c.env.DB.prepare(
      `INSERT INTO note_docs
         (id, team_id, season_id, parent_doc_id, meeting_id, position, title,
          content, content_text, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?)`,
    )
      .bind(
        id,
        teamId,
        seasonId,
        parentId,
        meetingId,
        position,
        title,
        content,
        member.id,
        member.id,
        now,
        now,
      )
      .run();
  } catch (error) {
    const existing = await ownedDoc(c.env.DB, teamId, id);
    if (!existing) throw error;
    const row = await c.env.DB.prepare(
      `SELECT ${DOC_FULL} FROM note_docs WHERE id = ? AND team_id = ?`,
    )
      .bind(id, teamId)
      .first();
    return c.json({ doc: row }, 200);
  }

  const row = await c.env.DB.prepare(
    `SELECT ${DOC_FULL} FROM note_docs WHERE id = ? AND team_id = ?`,
  )
    .bind(id, teamId)
    .first();
  return c.json({ doc: row }, 201);
});

/** Rename. Title only — see the header on why this is not a content write. */
docs.patch(
  '/:docId',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);
    const docId = c.req.param('docId');

    const title = optionalString(body.title, MAX_TITLE);
    if (title === null) return c.json({ error: 'missing_title' }, 400);

    const now = nowSeconds();
    const result = await c.env.DB.prepare(
      `UPDATE note_docs SET title = ?, updated_by = ?, updated_at = ?
        WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND title <> ?`,
    )
      .bind(title, member.id, now, docId, teamId, title)
      .run();

    // Zero changes is either "gone" or "the title already said that". Only the
    // first is an error, so check before answering.
    if (result.meta.changes === 0) {
      const existing = await ownedDoc(c.env.DB, teamId, docId);
      if (!existing) return c.json({ error: 'not_found' }, 404);
    }

    const row = await c.env.DB.prepare(
      `SELECT ${DOC_FULL} FROM note_docs WHERE id = ? AND team_id = ?`,
    )
      .bind(docId, teamId)
      .first();
    return c.json({ doc: row });
  },
);

/** The keystroke path. Compare-and-swap on updated_at — see the header. */
docs.put(
  '/:docId/content',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);
    const docId = c.req.param('docId');

    // A live team's notes are written by their NoteRoom, which would fold this
    // write away on its next save. Refusing it is what keeps a tab from before
    // the switch from quietly overwriting what everyone typed since.
    if (liveNotesEnabled(c.env.LIVE_NOTES_TEAMS, teamId)) {
      return c.json({ error: 'live_doc' }, 409);
    }

    const parsed = parseContent(body.content);
    if ('error' in parsed) {
      const status = parsed.error === 'invalid_content' ? 400 : 409;
      return c.json({ error: parsed.error }, status);
    }
    const content = body.content as string;

    const current = await c.env.DB.prepare(
      `SELECT rev, content FROM note_docs
        WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
    )
      .bind(docId, teamId)
      .first<{ rev: number; content: string }>();
    if (!current) return c.json({ error: 'not_found' }, 404);

    const baseRev = typeof body.base_rev === 'number' ? body.base_rev : null;
    if (baseRev !== null && baseRev !== current.rev) {
      // NOT retryable, and the client must not put it in a backoff loop: retrying
      // a stale write forever is the failure mode. The server's copy rides along
      // so the editor can offer "keep mine" or "load theirs".
      const server = await c.env.DB.prepare(
        `SELECT ${DOC_FULL} FROM note_docs WHERE id = ? AND team_id = ?`,
      )
        .bind(docId, teamId)
        .first();
      return c.json({ error: 'stale_content', doc: server }, 409);
    }

    // A no-op autosave writes zero rows. The D1 per-row billing argument from the
    // block routes is unchanged, just at document granularity now.
    if (current.content === content) {
      const row = await c.env.DB.prepare(
        `SELECT ${DOC_FULL} FROM note_docs WHERE id = ? AND team_id = ?`,
      )
        .bind(docId, teamId)
        .first();
      return c.json({ doc: row, unchanged: true });
    }

    const now = nowSeconds();
    const result = await c.env.DB.prepare(
      `UPDATE note_docs
          SET content = ?, content_text = ?, rev = rev + 1,
              updated_by = ?, updated_at = ?
        WHERE id = ? AND team_id = ? AND deleted_at IS NULL AND rev = ?`,
    )
      .bind(content, parsed.text, member.id, now, docId, teamId, current.rev)
      .run();

    if (result.meta.changes === 0) {
      // Somebody wrote between the read and the UPDATE. The `AND rev = ?`
      // predicate is what makes that a 409 rather than a lost paragraph, and it is
      // why this route needs no transaction.
      const server = await c.env.DB.prepare(
        `SELECT ${DOC_FULL} FROM note_docs WHERE id = ? AND team_id = ?`,
      )
        .bind(docId, teamId)
        .first();
      if (!server) return c.json({ error: 'not_found' }, 404);
      return c.json({ error: 'stale_content', doc: server }, 409);
    }

    const row = await c.env.DB.prepare(
      `SELECT ${DOC_FULL} FROM note_docs WHERE id = ? AND team_id = ?`,
    )
      .bind(docId, teamId)
      .first();
    return c.json({ doc: row });
  },
);

/** How deep a document sits, by walking up. Bounded, so a cycle cannot spin it. */
async function depthOf(
  db: D1Database,
  teamId: string,
  doc: DocRow,
): Promise<number> {
  let depth = 0;
  let parentId = doc.parent_doc_id;
  while (parentId !== null && depth <= MAX_DEPTH + 1) {
    const parent = await db
      .prepare(
        `SELECT parent_doc_id FROM note_docs
          WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
      )
      .bind(parentId, teamId)
      .first<{ parent_doc_id: string | null }>();
    if (!parent) break;
    depth++;
    parentId = parent.parent_doc_id;
  }
  return depth;
}

/**
 * Reparent, change meeting, reorder — one route, because they are one gesture.
 *
 * Dragging a document onto another page and dragging it onto a meeting group are
 * the same action with different drop targets, and both resolve here.
 *
 * CYCLE PREVENTION walks UP from the proposed parent rather than enumerating the
 * moved document's descendants. That is O(depth) instead of O(subtree), needs no
 * CTE, and the hop limit doubles as the depth check. The invariant holds
 * inductively because every write of parent_doc_id goes through this guard, and
 * the bound means even a tree corrupted by hand cannot spin the loop.
 */
docs.post(
  '/:docId/move',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = await readJson(c);
    if (!body) return c.json({ error: 'invalid_body' }, 400);
    const { teamId, member } = authOf(c);
    const docId = c.req.param('docId');

    const doc = await ownedDoc(c.env.DB, teamId, docId);
    if (!doc) return c.json({ error: 'not_found' }, 404);

    const hasParent = 'parent_doc_id' in body;
    const hasMeeting = 'meeting_id' in body;
    const parentId = hasParent
      ? optionalString(body.parent_doc_id, 64)
      : doc.parent_doc_id;
    let meetingId = hasMeeting
      ? optionalString(body.meeting_id, 64)
      : doc.meeting_id;

    const moved = await subtree(c.env.DB, teamId, docId);
    if (moved.length > MAX_SUBTREE) {
      return c.json({ error: 'subtree_too_large', max: MAX_SUBTREE }, 409);
    }
    const height = moved.reduce((max, row) => Math.max(max, row.depth), 0);

    if (parentId !== null) {
      const parent = await ownedDoc(c.env.DB, teamId, parentId);
      if (!parent) return c.json({ error: 'not_found' }, 404);
      if (parent.id === doc.id) {
        return c.json({ error: 'cycle', doc_id: docId, parent_doc_id: parentId }, 409);
      }

      let cursor: string | null = parent.parent_doc_id;
      let hops = 0;
      while (cursor !== null) {
        if (cursor === docId) {
          return c.json(
            { error: 'cycle', doc_id: docId, parent_doc_id: parentId },
            409,
          );
        }
        if (++hops > MAX_DEPTH + 1) {
          return c.json({ error: 'too_deep', max: MAX_DEPTH }, 409);
        }
        const next: { parent_doc_id: string | null } | null = await c.env.DB.prepare(
          `SELECT parent_doc_id FROM note_docs
            WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
        )
          .bind(cursor, teamId)
          .first<{ parent_doc_id: string | null }>();
        if (!next) break;
        cursor = next.parent_doc_id;
      }

      const parentDepth = await depthOf(c.env.DB, teamId, parent);
      if (parentDepth + 1 + height >= MAX_DEPTH) {
        return c.json({ error: 'too_deep', max: MAX_DEPTH }, 409);
      }

      // The parent wins, as on create.
      meetingId = parent.meeting_id;
    } else if (meetingId !== null) {
      const meeting = await c.env.DB.prepare(
        'SELECT id FROM meetings WHERE id = ? AND team_id = ?',
      )
        .bind(meetingId, teamId)
        .first();
      if (!meeting) return c.json({ error: 'not_found' }, 404);
    }

    const now = nowSeconds();
    const position = await positionAmong(
      c.env.DB,
      teamId,
      parentId,
      meetingId,
      optionalString(body.after_id, 64),
    );

    const statements = [
      c.env.DB.prepare(
        `UPDATE note_docs
            SET parent_doc_id = ?, meeting_id = ?, position = ?,
                updated_by = ?, updated_at = ?
          WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
      ).bind(parentId, meetingId, position, member.id, now, docId, teamId),
    ];

    // The denormalisation invariant: every descendant carries the same meeting.
    if (meetingId !== doc.meeting_id) {
      const descendants = moved.filter((row) => row.id !== docId).map((row) => row.id);
      for (let i = 0; i < descendants.length; i += 50) {
        const chunk = descendants.slice(i, i + 50);
        statements.push(
          c.env.DB.prepare(
            `UPDATE note_docs SET meeting_id = ?, updated_at = ?
              WHERE team_id = ? AND id IN (${chunk.map(() => '?').join(', ')})`,
          ).bind(meetingId, now, teamId, ...chunk),
        );
      }
    }

    await c.env.DB.batch(statements);

    const row = await c.env.DB.prepare(
      `SELECT ${DOC_FULL} FROM note_docs WHERE id = ? AND team_id = ?`,
    )
      .bind(docId, teamId)
      .first();
    return c.json({ doc: row, moved: moved.length });
  },
);

/**
 * Soft delete, cascading to descendants in one batch.
 *
 * Cascaded explicitly rather than filtered on read: a tree query that checks
 * every ancestor's deleted_at is not an index scan. The returned id list is what
 * lets restore put back exactly this set rather than guessing.
 */
docs.delete(
  '/:docId',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const { teamId } = authOf(c);
    const docId = c.req.param('docId');
    const doc = await ownedDoc(c.env.DB, teamId, docId);
    if (!doc) return c.json({ error: 'not_found' }, 404);

    const ids = (await subtree(c.env.DB, teamId, docId)).map((row) => row.id);
    const now = nowSeconds();

    const statements = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      statements.push(
        c.env.DB.prepare(
          `UPDATE note_docs SET deleted_at = ?, updated_at = ?
            WHERE team_id = ? AND id IN (${chunk.map(() => '?').join(', ')})`,
        ).bind(now, now, teamId, ...chunk),
      );
    }
    await c.env.DB.batch(statements);

    // The flag was one person's decision and the delete is another person's
    // action, so say so rather than quietly dropping it.
    const orphaned = await c.env.DB.prepare(
      `SELECT COUNT(*) AS n FROM portfolio_candidates
        WHERE team_id = ? AND source_type = 'note_doc'
          AND source_id IN (${ids.map(() => '?').join(', ')})`,
    )
      .bind(teamId, ...ids)
      .first<{ n: number }>();

    return c.json({
      ok: true,
      deleted: ids,
      candidate_orphaned: (orphaned?.n ?? 0) > 0,
    });
  },
);

docs.post(
  '/:docId/restore',
  sameOriginOnly,
  requireMember,
  denyRole('viewer'),
  async (c) => {
    const body = (await readJson(c)) ?? {};
    const { teamId } = authOf(c);
    const docId = c.req.param('docId');

    // Restore takes the id list the delete returned, so a document that was
    // already a child of something else does not get dragged back with it.
    const ids = Array.isArray(body.ids)
      ? (body.ids as unknown[]).filter((v): v is string => typeof v === 'string')
      : [docId];
    if (!ids.includes(docId)) ids.push(docId);

    const now = nowSeconds();
    const statements = [];
    for (let i = 0; i < ids.length; i += 50) {
      const chunk = ids.slice(i, i + 50);
      statements.push(
        c.env.DB.prepare(
          `UPDATE note_docs SET deleted_at = NULL, updated_at = ?
            WHERE team_id = ? AND id IN (${chunk.map(() => '?').join(', ')})`,
        ).bind(now, teamId, ...chunk),
      );
    }
    await c.env.DB.batch(statements);

    const row = await c.env.DB.prepare(
      `SELECT ${DOC_FULL} FROM note_docs
        WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
    )
      .bind(docId, teamId)
      .first();
    if (!row) return c.json({ error: 'not_found' }, 404);
    return c.json({ doc: row });
  },
);

export { docs };

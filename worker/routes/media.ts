/**
 * Image upload and serving (COG-008, the slice meetings needs).
 *
 * Students paste photos straight into their notes, so this path carries files
 * taken by minors on their own phones. Two consequences shape everything here:
 *
 *   - Every upload is stripped of metadata before it is stored. Phone JPEGs
 *     carry GPS, media is served to the whole team, and the nightly backup
 *     copies it into R2 — so an unstripped upload publishes a child's home
 *     location to the roster and to every future restore of that dump.
 *   - The format is decided by the file's own magic bytes, never the header the
 *     client sent. `/media/*` is same-origin, so an SVG accepted as an image
 *     would be stored XSS against every teammate's session.
 *
 * The read route deliberately does NOT live under `/api`, because the no-store
 * middleware in index.ts would make every image a fresh round trip forever.
 */
import { Hono } from 'hono';
import { nowSeconds, uuid } from '../lib/crypto';
import {
  ALLOWED_TYPES,
  dimensions,
  EXTENSIONS,
  sniff,
  sniffReceipt,
  stripMetadata,
  type ReceiptType,
} from '../lib/images';
import {
  extensionOf,
  fileContentType,
  FILE_EXTENSIONS,
  pdfMismatch,
  sanitizeFilename,
} from '../lib/files';
import { optionalString, readJson } from '../lib/http';
import {
  auth as authOf,
  denyRole,
  requireMember,
  sameOriginOnly,
  type AppEnv,
} from '../lib/tenancy';

const media = new Hono<AppEnv>();

/**
 * Per file. The client downscales to 2000px before uploading, so anything this
 * large is a client that failed to and a bill we would rather not pay.
 */
export const MAX_BYTES = 10 * 1024 * 1024;
/**
 * Per non-image attachment.
 *
 * Higher than MAX_BYTES because there is no downscale to lean on: a photo is
 * 2000px by the time it leaves the browser, whereas a SolidWorks assembly is
 * whatever it is. 25MB covers what an FTC team actually exports and still
 * refuses somebody using the team's notes as a file host.
 *
 * Worth knowing, and worth telling a coach: attachments count against the same
 * MAX_TEAM_BYTES below. One of these eats roughly eighty times what a
 * downscaled photo does, so a season is about eighty large CAD files.
 */
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
/** Per team per season. Roughly a thousand photos, which is a generous season. */
const MAX_TEAM_BYTES = 2 * 1024 * 1024 * 1024;

/**
 * `photo` is anything in a meeting or the library. `roster_photo` is a picture
 * of a student's face, which is treated differently everywhere it appears: kept
 * out of the library, refused as portfolio evidence, withheld from viewers, and
 * deleted when the member is no longer active. See 0004_roster_photos.sql.
 * `receipt` is a file evidencing a ledger transaction (0009): it may be a PDF,
 * it carries a transaction_id, and the library list leaves it out — a receipt
 * belongs to its ledger line, not to the photo gallery.
 * `file` is a CAD file or a PDF attached to a note (0013). It is the one kind
 * whose bytes are NOT known from their own magic — see lib/files.ts — which is
 * why it is served as an opaque download rather than inline.
 */
export type MediaKind = 'photo' | 'roster_photo' | 'receipt' | 'file';

export interface IngestResult {
  id: string;
  content_type: string;
  bytes: number;
  width: number | null;
  height: number | null;
}

/**
 * Sniff, strip, measure, store.
 *
 * Shared by the meeting-notes upload and the roster-photo upload so there is
 * exactly one place that decides what an acceptable image is — and, more to the
 * point, exactly one place that strips EXIF. A second upload path that forgot to
 * would be the whole GPS problem again, quietly.
 */
export async function ingestImage(
  env: { DB: D1Database; MEDIA: R2Bucket },
  input: {
    teamId: string;
    seasonId: string;
    uploaderMemberId: string;
    kind: MediaKind;
    /**
     * Widens the accepted formats. Only the receipt route passes this (with
     * RECEIPT_TYPES, which adds PDF) — every other caller keeps the image-only
     * default, so a PDF pasted into notes is still refused.
     */
    allowed?: readonly ReceiptType[];
    /** The ledger line a receipt evidences. Set only when kind is 'receipt'. */
    transactionId?: string;
  },
  raw: Uint8Array,
): Promise<IngestResult | { error: string; status: 400 | 413 | 415 | 507 }> {
  if (raw.byteLength === 0) return { error: 'empty_body', status: 400 };
  if (raw.byteLength > MAX_BYTES) return { error: 'file_too_large', status: 413 };

  const allowed: readonly ReceiptType[] = input.allowed ?? ALLOWED_TYPES;
  const sniffed = allowed.includes('application/pdf')
    ? sniffReceipt(raw)
    : sniff(raw);
  if (!sniffed || !allowed.includes(sniffed)) {
    return { error: 'unsupported_media_type', status: 415 };
  }

  if (await overQuota(env.DB, input.teamId, input.seasonId, raw.byteLength)) {
    return { error: 'quota_exceeded', status: 507 };
  }

  // PDF skips both: stripMetadata is image-container splicing that must not
  // touch a PDF's object graph, and the deliberate decision NOT to strip PDF
  // metadata at all is argued at sniffReceipt in lib/images.ts. Dimensions are
  // an image concept — a PDF stores NULLs, which the column always allowed.
  const cleaned =
    sniffed === 'application/pdf' ? raw : stripMetadata(raw, sniffed);
  const size =
    sniffed === 'application/pdf' ? null : dimensions(cleaned, sniffed);

  const id = uuid();
  const key = `teams/${input.teamId}/${input.seasonId}/${id}.${EXTENSIONS[sniffed]}`;

  await env.MEDIA.put(key, cleaned, { httpMetadata: { contentType: sniffed } });

  try {
    await env.DB.prepare(
      `INSERT INTO media
         (id, team_id, season_id, r2_key, kind, bytes, width, height, caption,
          tags, uploaded_by, transaction_id, content_type, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.teamId,
        input.seasonId,
        key,
        input.kind,
        cleaned.byteLength,
        size?.width ?? null,
        size?.height ?? null,
        input.uploaderMemberId,
        input.transactionId ?? null,
        sniffed,
        nowSeconds(),
      )
      .run();
  } catch (err) {
    // Do not leave an orphan object paying rent in R2 for a row that does not
    // exist. The reverse order — row first — would leave a media id that 404s.
    await env.MEDIA.delete(key).catch(() => undefined);
    throw err;
  }

  return {
    id,
    content_type: sniffed,
    bytes: cleaned.byteLength,
    width: size?.width ?? null,
    height: size?.height ?? null,
  };
}

/**
 * The per-season storage check, shared by both ingest paths.
 *
 * Extracted when ingestFile arrived rather than duplicated, because a second
 * upload path that forgot the quota is a second way to run up a bill.
 */
async function overQuota(
  db: D1Database,
  teamId: string,
  seasonId: string,
  adding: number,
): Promise<boolean> {
  const usage = await db
    .prepare(
      'SELECT COALESCE(SUM(bytes), 0) AS used FROM media WHERE team_id = ? AND season_id = ?',
    )
    .bind(teamId, seasonId)
    .first<{ used: number }>();
  return (usage?.used ?? 0) + adding > MAX_TEAM_BYTES;
}

/**
 * Store a CAD file or a PDF attached to a note.
 *
 * A SIBLING of ingestImage, not a mode of it, and that is a deliberate cost.
 * ingestImage's docstring makes "exactly one place that strips EXIF" an
 * invariant, and a flag that skipped stripping would turn that into "strips EXIF
 * unless…", which nobody can verify by reading the function. Keeping its
 * signature frozen also proves the roster-photo and receipt callers are
 * untouched by a change whose whole subject is "we now accept arbitrary bytes".
 * The two share what is genuinely shared — the quota, and the R2-put-then-D1-
 * insert with rollback — and nothing else, because nothing else is the same:
 * different validation, different cap, different columns, different failures.
 *
 * The EXIF invariant is then kept STRUCTURALLY rather than by care: this refuses
 * anything sniff() recognises as an image. Without that line, a student renaming
 * IMG_4471.jpg to bracket.stl would put their phone's GPS coordinates into R2
 * and into every nightly backup, through a path that by design never calls
 * stripMetadata. It is the sharpest failure mode in the feature and it has its
 * own test.
 */
export async function ingestFile(
  env: { DB: D1Database; MEDIA: R2Bucket },
  input: {
    teamId: string;
    seasonId: string;
    uploaderMemberId: string;
    /** Already basename-reduced and character-allowlisted by the route. */
    filename: string;
  },
  raw: Uint8Array,
): Promise<
  | (IngestResult & { filename: string })
  | { error: string; status: 400 | 413 | 415 | 507 }
> {
  if (raw.byteLength === 0) return { error: 'empty_body', status: 400 };
  if (raw.byteLength > MAX_FILE_BYTES) {
    return { error: 'file_too_large', status: 413 };
  }

  const extension = extensionOf(input.filename);

  // An image wearing a CAD extension. Refused, not quietly stripped: this path
  // has no stripMetadata call and must never be the one that stores a photo.
  if (sniff(raw) !== null) return { error: 'image_not_a_file', status: 415 };

  // The one format here whose bytes can be checked against its name.
  if (pdfMismatch(extension, raw)) {
    return { error: 'unsupported_file_type', status: 415 };
  }

  if (await overQuota(env.DB, input.teamId, input.seasonId, raw.byteLength)) {
    return { error: 'quota_exceeded', status: 507 };
  }

  const contentType = fileContentType(raw);
  const id = uuid();
  // The user's stem never enters the key — only the allowlisted extension does.
  const key = `teams/${input.teamId}/${input.seasonId}/${id}.${extension}`;

  await env.MEDIA.put(key, raw, { httpMetadata: { contentType } });

  try {
    await env.DB.prepare(
      `INSERT INTO media
         (id, team_id, season_id, r2_key, kind, bytes, width, height, caption,
          tags, uploaded_by, transaction_id, filename, content_type, created_at)
       VALUES (?, ?, ?, ?, 'file', ?, NULL, NULL, NULL, '[]', ?, NULL, ?, ?, ?)`,
    )
      .bind(
        id,
        input.teamId,
        input.seasonId,
        key,
        raw.byteLength,
        input.uploaderMemberId,
        input.filename,
        contentType,
        nowSeconds(),
      )
      .run();
  } catch (err) {
    await env.MEDIA.delete(key).catch(() => undefined);
    throw err;
  }

  return {
    id,
    content_type: contentType,
    bytes: raw.byteLength,
    width: null,
    height: null,
    filename: input.filename,
  };
}

/**
 * Detach and destroy a roster photo: R2 object, media row, and the pointer.
 *
 * Shared by replace, delete, consent withdrawal and the nightly retention
 * sweep, because a child's photograph is the one thing in this system that must
 * actually be gone when it is supposed to be gone — not merely unreferenced.
 * R2 first, so a failure leaves a row pointing at a missing object (which the
 * read route reports) rather than an object nobody can find or delete.
 */
export async function deleteRosterPhoto(
  env: { DB: D1Database; MEDIA: R2Bucket },
  teamId: string,
  memberId: string,
  mediaId: string | null,
): Promise<void> {
  await env.DB.prepare(
    'UPDATE members SET photo_media_id = NULL WHERE id = ? AND team_id = ?',
  )
    .bind(memberId, teamId)
    .run();

  if (!mediaId) return;

  const row = await env.DB.prepare(
    'SELECT r2_key FROM media WHERE id = ? AND team_id = ?',
  )
    .bind(mediaId, teamId)
    .first<{ r2_key: string }>();
  if (!row) return;

  await env.MEDIA.delete(row.r2_key).catch(() => undefined);
  await env.DB.prepare('DELETE FROM media WHERE id = ? AND team_id = ?')
    .bind(mediaId, teamId)
    .run();
}

/**
 * The retention sweep, run nightly.
 *
 * `members.status <> 'active'` is the documented trigger for deleting a roster
 * photo, and this exists because the trigger cannot be trusted to fire on its
 * own: the realistic failure is a coach who never marks a graduated senior
 * inactive, at which point "kept while the member is active" quietly becomes
 * the indefinite retention the COPPA amendments prohibit. Sweeping means the
 * rule holds even when nobody remembers to apply it.
 */
export async function purgeRetiredRosterPhotos(env: {
  DB: D1Database;
  MEDIA: R2Bucket;
}): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT id, team_id, photo_media_id FROM members
      WHERE photo_media_id IS NOT NULL AND status <> 'active'`,
  ).all<{ id: string; team_id: string; photo_media_id: string }>();

  for (const row of results) {
    await deleteRosterPhoto(env, row.team_id, row.id, row.photo_media_id);
  }
  return results.length;
}

// ------------------------------------------------------------------- upload

media.post('/', sameOriginOnly, requireMember, denyRole('viewer'), async (c) => {
  const { teamId, member } = authOf(c);

  const season = await c.env.DB.prepare(
    'SELECT id FROM seasons WHERE team_id = ? AND is_current = 1',
  )
    .bind(teamId)
    .first<{ id: string }>();
  if (!season) return c.json({ error: 'no_current_season' }, 409);

  // Checked twice on purpose: Content-Length lets an oversized upload be
  // refused before its bytes are read, and the second check catches a chunked
  // request that simply lied about its length.
  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return c.json({ error: 'file_too_large', max_bytes: MAX_BYTES }, 413);
  }

  const raw = new Uint8Array(await c.req.arrayBuffer());
  const result = await ingestImage(
    c.env,
    {
      teamId,
      seasonId: season.id,
      uploaderMemberId: member.id,
      kind: 'photo',
    },
    raw,
  );

  if ('error' in result) {
    // One code for "not an image" and "an image we do not accept". The client
    // maps it to copy naming the formats; the server does not owe a prober a
    // breakdown of what it recognised.
    return c.json(
      { error: result.error, max_bytes: MAX_BYTES, allowed: ALLOWED_TYPES },
      result.status,
    );
  }

  return c.json({ ...result, url: `/media/${result.id}` }, 201);
});

/**
 * Attach a CAD file or a PDF to a note.
 *
 * A separate route rather than a branch inside POST /api/media, so the image
 * path keeps its own Content-Length pre-check, its own MAX_BYTES and its own
 * error payload — and so the 413 threshold is unambiguous per route rather than
 * depending on what the body turns out to be.
 *
 * The filename travels in a header because the body is the raw bytes: that is
 * what lets lib/upload.ts keep its XHR progress path instead of being rewritten
 * as multipart. It is percent-encoded by the client, because headers are latin-1
 * and `Motörhalterung_v2.step` throws in setRequestHeader untouched.
 */
media.post('/files', sameOriginOnly, requireMember, denyRole('viewer'), async (c) => {
  const { teamId, member } = authOf(c);

  const season = await c.env.DB.prepare(
    'SELECT id FROM seasons WHERE team_id = ? AND is_current = 1',
  )
    .bind(teamId)
    .first<{ id: string }>();
  if (!season) return c.json({ error: 'no_current_season' }, 409);

  const header = c.req.header('X-Filename');
  if (!header) return c.json({ error: 'filename_required' }, 400);
  // Bounded BEFORE decoding, so a megabyte of %41 is refused rather than
  // expanded. sanitizeFilename bounds it again; this is the cheaper gate.
  if (header.length > 512) return c.json({ error: 'filename_invalid' }, 400);

  let decoded: string;
  try {
    decoded = decodeURIComponent(header);
  } catch {
    return c.json({ error: 'filename_invalid' }, 400);
  }

  const filename = sanitizeFilename(decoded);
  if (!filename) {
    return c.json(
      { error: 'unsupported_file_type', allowed: FILE_EXTENSIONS },
      415,
    );
  }

  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_FILE_BYTES) {
    return c.json({ error: 'file_too_large', max_bytes: MAX_FILE_BYTES }, 413);
  }

  const raw = new Uint8Array(await c.req.arrayBuffer());
  const result = await ingestFile(
    c.env,
    {
      teamId,
      seasonId: season.id,
      uploaderMemberId: member.id,
      filename,
    },
    raw,
  );

  if ('error' in result) {
    return c.json(
      { error: result.error, max_bytes: MAX_FILE_BYTES, allowed: FILE_EXTENSIONS },
      result.status,
    );
  }

  return c.json({ ...result, url: `/media/${result.id}` }, 201);
});

// --------------------------------------------------------------------- list

/**
 * The team's library.
 *
 * Only `kind = 'photo'` — a positive filter now that there are three kinds.
 * Roster photos are pictures of students' faces attached to their roster rows,
 * not team media — surfacing them in a browsable gallery would turn a "put
 * faces to names" convenience into a directory of children. Receipts belong to
 * their ledger lines and are listed there, not here.
 */
media.get('/', requireMember, async (c) => {
  const { teamId } = authOf(c);
  const { results } = await c.env.DB.prepare(
    `SELECT id, season_id, kind, bytes, width, height, caption, uploaded_by, created_at
       FROM media
      WHERE team_id = ? AND kind = 'photo'
      ORDER BY created_at DESC LIMIT 200`,
  )
    .bind(teamId)
    .all();
  return c.json({ media: results });
});

media.patch('/:id', sameOriginOnly, requireMember, denyRole('viewer'), async (c) => {
  const body = await readJson(c);
  if (!body) return c.json({ error: 'invalid_body' }, 400);
  const { teamId } = authOf(c);

  const result = await c.env.DB.prepare(
    'UPDATE media SET caption = ? WHERE id = ? AND team_id = ?',
  )
    .bind(optionalString(body.caption, 500), c.req.param('id'), teamId)
    .run();
  if (result.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

export { media };

// ------------------------------------------------------------------ serving

/**
 * Mounted at `/media`, outside `/api`, so images can actually be cached.
 *
 * Every request still costs a session read, a membership read and a media read
 * before a byte streams — three D1 rows — so a meeting with ten photos would be
 * thirty rows on every single open without the cache header below.
 */
const mediaFiles = new Hono<AppEnv>();

mediaFiles.get('/:id', requireMember, async (c) => {
  const { teamId, member } = authOf(c);

  // D1 first, always. R2 is never consulted with a key the tenancy check has
  // not already approved.
  const row = await c.env.DB.prepare(
    'SELECT r2_key, kind, filename, content_type FROM media WHERE id = ? AND team_id = ?',
  )
    .bind(c.req.param('id'), teamId)
    .first<{
      r2_key: string;
      kind: string;
      filename: string | null;
      content_type: string | null;
    }>();
  // 404 rather than 403: a 403 would confirm the object exists on another team.
  if (!row) return c.json({ error: 'not_found' }, 404);

  // A viewer is a parent or a sponsor. They may see the team's work; they may
  // not be handed pictures of other people's children. This has to live here
  // rather than in the roster projection, because the projection only controls
  // whether a URL is offered — not whether it resolves when guessed.
  if (row.kind === 'roster_photo' && member.role === 'viewer') {
    return c.json({ error: 'not_found' }, 404);
  }

  const object = await c.env.MEDIA.get(row.r2_key, {
    onlyIf: c.req.raw.headers,
  });
  if (!object) {
    // The row exists and the object does not, which means a delete went half
    // way. Worth being loud about rather than silently 404ing.
    console.error('media object missing for key', row.r2_key);
    return c.json({ error: 'not_found' }, 404);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('ETag', object.httpEtag);
  // `private`, never `public`: a per-tenant object in a shared cache is a
  // tenancy leak by HTTP semantics rather than by SQL. `immutable` is safe
  // because media is write-once — no route mutates the bytes at a given id.
  headers.set('Cache-Control', 'private, max-age=31536000, immutable');
  headers.set('Vary', 'Cookie');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('Content-Disposition', 'inline');

  /**
   * Attachments are handed over as opaque downloads, never rendered.
   *
   * This is the security answer for the whole feature, so it is worth being
   * explicit about what it defends. A CAD file is validated by its EXTENSION —
   * most of these formats have no magic bytes to check — which means the bytes
   * are not known to be what the name claims. Any member can upload a complete
   * HTML page containing a script and call it `bracket.stl`. /media/* is
   * same-origin with the app, so a browser talked into rendering it as a
   * document would run that script with the viewer's session. That is the exact
   * attack image/svg+xml is banned for, and there the ban holds only because
   * sniff() reads magic bytes.
   *
   * Four independent controls, because the failure of any one of them is a
   * session takeover for everyone on the roster:
   *   - the Content-Type comes from the tenancy-checked D1 row, not from R2
   *     metadata, and for a file it is octet-stream or PDF and nothing else;
   *   - nosniff (already set above) forbids the browser reaching text/html on
   *     its own anyway;
   *   - attachment forces a download rather than a render even if the type were
   *     somehow wrong;
   *   - the sandbox CSP is what survives a future bug in the three above.
   *
   * Branching on `kind` rather than on content_type is deliberate: one rule, and
   * no per-type conditional in the one place where a per-type conditional IS the
   * vulnerability. Receipts keep `inline` — their types are magic-byte sniffed.
   *
   * PDF gets `attachment` too. One unconditional rule for kind='file' is worth
   * more than an inline preview, and a chip's affordance is "download" anyway.
   *
   * Set above the 304 early return below, so a cached revalidation carries the
   * same headers as a fresh body. sanitizeFilename already guarantees the name
   * matches [A-Za-z0-9._ -], which is why the quoted token needs no escaping and
   * header injection is impossible — the reason sanitising happens at ingest
   * rather than here.
   */
  if (row.kind === 'file') {
    headers.set('Content-Type', row.content_type ?? 'application/octet-stream');
    const name = row.filename ?? 'attachment';
    headers.set(
      'Content-Disposition',
      `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    );
    headers.set('Content-Security-Policy', "default-src 'none'; sandbox");
  }

  if (!('body' in object) || object.body === null) {
    // onlyIf matched, so the client's copy is current.
    return new Response(null, { status: 304, headers });
  }

  return new Response(object.body, { headers });
});

/**
 * Terminal 404 for anything else under /media.
 *
 * Without this a miss falls through to the assets handler, whose
 * `not_found_handling: single-page-application` hands back index.html with a
 * 200 — so a broken `<img>` would receive the entire app as HTML and no error
 * would ever surface.
 */
mediaFiles.all('/*', (c) => c.json({ error: 'not_found' }, 404));

export { mediaFiles };

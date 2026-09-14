import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  callJson,
  inviteAndAccept,
  signUpCoach,
  stubResend,
  whoami,
} from './_helpers';

beforeAll(() => {
  stubResend();
});

// ------------------------------------------------------------------ fixtures

function join(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

const ascii = (text: string) => new Uint8Array([...text].map((c) => c.charCodeAt(0)));
const be32 = (n: number) =>
  new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  return join(be32(data.length), ascii(type), data, be32(0));
}

/** A structurally valid PNG. Enough for sniffing, dimensions and stripping. */
function png(width: number, height: number, extra: Uint8Array[] = []): Uint8Array {
  return join(
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', join(be32(width), be32(height), new Uint8Array([8, 6, 0, 0, 0]))),
    ...extra,
    pngChunk('IDAT', new Uint8Array([0x78, 0x9c, 0x00])),
    pngChunk('IEND', new Uint8Array(0)),
  );
}

async function upload(
  cookie: string,
  bytes: Uint8Array,
  contentType = 'image/png',
): Promise<Response> {
  return call('/api/media', {
    method: 'POST',
    cookie,
    headers: { 'Content-Type': contentType },
    body: bytes as unknown as BodyInit,
  });
}

describe('upload', () => {
  it('stores an image and reports its real dimensions', async () => {
    const cookie = await signUpCoach(7100);
    const response = await upload(cookie, png(1200, 800));
    expect(response.status).toBe(201);

    const body = (await response.json()) as {
      id: string;
      url: string;
      width: number;
      height: number;
    };
    expect(body.width).toBe(1200);
    expect(body.height).toBe(800);
    expect(body.url).toBe(`/media/${body.id}`);

    const row = await env.DB.prepare('SELECT r2_key, bytes FROM media WHERE id = ?')
      .bind(body.id)
      .first<{ r2_key: string; bytes: number }>();
    // Key derives only from immutable ids, never from a user-editable label.
    expect(row?.r2_key).toMatch(/^teams\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.png$/);
    expect(await env.MEDIA.get(row!.r2_key)).not.toBeNull();
  });

  it('strips metadata before anything is stored', async () => {
    // The reason this whole path is careful: students paste phone photos, and
    // phone photos carry GPS.
    const cookie = await signUpCoach(7101);
    const withGps = png(64, 64, [
      pngChunk('eXIf', ascii('GPSLatitude 42.3601 GPSLongitude -71.0589')),
      pngChunk('tEXt', ascii('Author\0A Student')),
    ]);
    const response = await upload(cookie, withGps);
    expect(response.status).toBe(201);
    const { id } = (await response.json()) as { id: string };

    const row = await env.DB.prepare('SELECT r2_key FROM media WHERE id = ?')
      .bind(id)
      .first<{ r2_key: string }>();
    const stored = await env.MEDIA.get(row!.r2_key);
    const text = await stored!.text();

    expect(text).not.toContain('GPSLatitude');
    expect(text).not.toContain('42.3601');
    expect(text).not.toContain('A Student');
  });

  it('rejects an SVG even when the header claims it is a PNG', async () => {
    // /media/* is same-origin, so a stored SVG is XSS against every teammate.
    const cookie = await signUpCoach(7102);
    const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const response = await upload(cookie, svg, 'image/png');
    expect(response.status).toBe(415);
    expect(((await response.json()) as { error: string }).error).toBe(
      'unsupported_media_type',
    );

    // Scoped to this team: storage is isolated per test FILE, not per test, so
    // a global count would be measuring the fixtures of every test above.
    const count = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM media
        WHERE team_id = (SELECT id FROM teams WHERE team_number = 7102)`,
    ).first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('rejects an empty body and an oversized file', async () => {
    const cookie = await signUpCoach(7103);
    expect((await upload(cookie, new Uint8Array(0))).status).toBe(400);

    const huge = join(png(4, 4), new Uint8Array(11 * 1024 * 1024));
    expect((await upload(cookie, huge)).status).toBe(413);
  });

  it('refuses uploads from a viewer', async () => {
    const coach = await signUpCoach(7104);
    const viewer = await inviteAndAccept(coach, { role: 'viewer', handle: 'guest' });
    expect((await upload(viewer.cookie, png(8, 8))).status).toBe(403);
  });
});

describe('serving', () => {
  it('returns the exact bytes with an immutable private cache', async () => {
    const cookie = await signUpCoach(7200);
    const { id } = (await (await upload(cookie, png(32, 32))).json()) as { id: string };

    const response = await call(`/media/${id}`, { cookie });
    expect(response.status).toBe(200);

    const cacheControl = response.headers.get('Cache-Control') ?? '';
    // The regression test for someone moving this route under /api, where the
    // no-store middleware would make every photo a fresh round trip forever.
    expect(cacheControl).not.toContain('no-store');
    expect(cacheControl).toContain('immutable');
    // `private`, never `public`: a per-tenant object in a shared cache is a
    // tenancy leak by HTTP semantics rather than by SQL.
    expect(cacheControl).toContain('private');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Vary')).toBe('Cookie');

    const served = new Uint8Array(await response.arrayBuffer());
    expect(served.length).toBeGreaterThan(0);
  });

  it('404s a missing id as JSON, not as the app shell', async () => {
    // Without the terminal /media/* handler this falls through to
    // not_found_handling: single-page-application, and a broken <img> receives
    // the whole app as HTML with a 200.
    const cookie = await signUpCoach(7201);
    const response = await call(`/media/${crypto.randomUUID()}`, { cookie });
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.text()).not.toContain('<!doctype html');
  });

  it('requires a session', async () => {
    const cookie = await signUpCoach(7202);
    const { id } = (await (await upload(cookie, png(8, 8))).json()) as { id: string };
    expect((await call(`/media/${id}`)).status).toBe(401);
  });
});

describe('tenancy isolation', () => {
  it('never serves or lists one team\'s photos to another', async () => {
    const alpha = await signUpCoach(7300);
    const beta = await signUpCoach(7301);

    const betaMedia = (await (await upload(beta, png(100, 100))).json()) as {
      id: string;
    };

    // 404 rather than 403: a 403 confirms the object exists somewhere.
    const read = await call(`/media/${betaMedia.id}`, { cookie: alpha });
    expect(read.status).toBe(404);

    const list = await callJson<{ media: unknown[] }>('/api/media', { cookie: alpha });
    expect(list.body.media).toHaveLength(0);

    // Captioning another team's photo.
    expect(
      (
        await call(`/api/media/${betaMedia.id}`, {
          method: 'PATCH',
          cookie: alpha,
          body: JSON.stringify({ caption: 'ALPHA WAS HERE' }),
        })
      ).status,
    ).toBe(404);

    const row = await env.DB.prepare('SELECT caption FROM media WHERE id = ?')
      .bind(betaMedia.id)
      .first<{ caption: string | null }>();
    expect(row?.caption).toBeNull();
  });

  it('will not let a flag point at another team\'s photo', async () => {
    const alpha = await signUpCoach(7302);
    const beta = await signUpCoach(7303);
    const betaMedia = (await (await upload(beta, png(20, 20))).json()) as { id: string };

    const response = await callJson<{ error: string }>('/api/portfolio/candidates', {
      method: 'POST',
      cookie: alpha,
      body: JSON.stringify({ source_type: 'media', source_id: betaMedia.id }),
    });
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('source_not_found');
  });
});

// ------------------------------------------------------- attachment fixtures

/** ISO-10303-21 is a STEP file's first line. No magic bytes — just text. */
const step = () => ascii('ISO-10303-21;\nHEADER;\nFILE_NAME("arm.step");\n');
const stl = () => ascii('solid cube\n facet normal 0 0 1\nendsolid cube\n');
const pdf = () => ascii('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\n');

function uploadFile(
  cookie: string,
  bytes: Uint8Array,
  filename: string,
): Promise<Response> {
  return call('/api/media/files', {
    method: 'POST',
    cookie,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Filename': encodeURIComponent(filename),
    },
    body: bytes as unknown as BodyInit,
  });
}

describe('attachment upload', () => {
  it('stores a STEP file as opaque bytes under its own kind', async () => {
    const cookie = await signUpCoach(7400);
    const response = await uploadFile(cookie, step(), 'arm.step');
    expect(response.status).toBe(201);

    const body = (await response.json()) as { id: string; filename: string };
    expect(body.filename).toBe('arm.step');

    const row = await env.DB.prepare(
      'SELECT kind, filename, content_type, width, height, r2_key FROM media WHERE id = ?',
    )
      .bind(body.id)
      .first<{
        kind: string;
        filename: string;
        content_type: string;
        width: number | null;
        height: number | null;
        r2_key: string;
      }>();

    expect(row).toMatchObject({
      kind: 'file',
      filename: 'arm.step',
      content_type: 'application/octet-stream',
      width: null,
      height: null,
    });
    // The key derives only from immutable ids plus the allowlisted extension —
    // no part of the user's stem reaches a path.
    expect(row?.r2_key).toMatch(/^teams\/[0-9a-f-]+\/[0-9a-f-]+\/[0-9a-f-]+\.step$/);
  });

  it('recognises a real PDF from its signature', async () => {
    const cookie = await signUpCoach(7401);
    const body = (await (await uploadFile(cookie, pdf(), 'sheet.pdf')).json()) as {
      id: string;
    };
    const row = await env.DB.prepare('SELECT content_type FROM media WHERE id = ?')
      .bind(body.id)
      .first<{ content_type: string }>();
    expect(row?.content_type).toBe('application/pdf');
  });

  it('refuses a .pdf whose bytes are not a PDF', async () => {
    const cookie = await signUpCoach(7402);
    const response = await uploadFile(cookie, ascii('<html>'), 'sheet.pdf');
    expect(response.status).toBe(415);
  });

  /**
   * The invariant that keeps a child's location out of R2.
   *
   * ingestFile never calls stripMetadata — it has no image container to splice.
   * So a phone photo renamed to a CAD extension has to be refused outright, or
   * this becomes a second upload path that stores GPS coordinates, and the
   * nightly backup copies them forward forever.
   */
  it('refuses an image wearing a CAD extension, EXIF and all', async () => {
    const cookie = await signUpCoach(7310);
    const withExif = png(800, 600, [pngChunk('eXIf', ascii('GPS here'))]);

    const response = await uploadFile(cookie, withExif, 'bracket.stl');
    expect(response.status).toBe(415);

    // Scoped to this team: the file suite shares one database, and earlier
    // tests have legitimately stored attachments of their own.
    const { team_id: teamId } = await whoami(cookie);
    const stored = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM media WHERE kind = 'file' AND team_id = ?",
    )
      .bind(teamId)
      .first<{ n: number }>();
    expect(stored?.n).toBe(0);
  });

  /**
   * The stored-XSS guard.
   *
   * Extension-only validation cannot tell a CAD file from an HTML page, so the
   * bytes below WILL be stored. What must never happen is a browser rendering
   * them as a document on this origin, where the script would run against a
   * teammate's session.
   */
  it('serves a disguised HTML payload as an undisplayable download', async () => {
    const cookie = await signUpCoach(7311);
    const payload = ascii('<html><script>alert(document.cookie)</script></html>');

    const created = await uploadFile(cookie, payload, 'bracket.stl');
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };

    const served = await call(`/media/${id}`, { cookie });
    expect(served.status).toBe(200);

    const type = served.headers.get('Content-Type');
    expect(type).toBe('application/octet-stream');
    expect(type).not.toContain('text/html');

    const disposition = served.headers.get('Content-Disposition') ?? '';
    expect(disposition.startsWith('attachment')).toBe(true);
    expect(disposition).not.toContain('inline');
    expect(disposition).toContain('bracket.stl');

    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(served.headers.get('Content-Security-Policy')).toContain('sandbox');
  });

  it('serves a PDF as a download too, rather than inline', async () => {
    const cookie = await signUpCoach(7312);
    const { id } = (await (await uploadFile(cookie, pdf(), 'sheet.pdf')).json()) as {
      id: string;
    };
    const served = await call(`/media/${id}`, { cookie });
    expect(served.headers.get('Content-Type')).toBe('application/pdf');
    expect(served.headers.get('Content-Disposition')?.startsWith('attachment')).toBe(
      true,
    );
  });

  it('refuses an extension that is not on the list', async () => {
    const cookie = await signUpCoach(7320);
    for (const name of ['payload.html', 'run.exe', 'icon.svg', 'bracket']) {
      const response = await uploadFile(cookie, stl(), name);
      expect(response.status).toBe(415);
    }
  });

  it('requires a filename, and refuses an absurd one before decoding it', async () => {
    const cookie = await signUpCoach(7321);

    const missing = await call('/api/media/files', {
      method: 'POST',
      cookie,
      headers: { 'Content-Type': 'application/octet-stream' },
      body: stl() as unknown as BodyInit,
    });
    expect(missing.status).toBe(400);

    const huge = await call('/api/media/files', {
      method: 'POST',
      cookie,
      headers: {
        'Content-Type': 'application/octet-stream',
        'X-Filename': 'a'.repeat(5000),
      },
      body: stl() as unknown as BodyInit,
    });
    expect(huge.status).toBe(400);
  });

  it('takes a 20MB file and refuses a 26MB one', async () => {
    const cookie = await signUpCoach(7330);

    const big = new Uint8Array(20 * 1024 * 1024);
    big.set(stl(), 0);
    expect((await uploadFile(cookie, big, 'assembly.sldasm')).status).toBe(201);

    const tooBig = new Uint8Array(26 * 1024 * 1024);
    tooBig.set(stl(), 0);
    expect((await uploadFile(cookie, tooBig, 'huge.sldasm')).status).toBe(413);
  });

  /** The regression a carelessly widened MAX_BYTES would cause. */
  it('leaves the image route at its own 10MB cap', async () => {
    const cookie = await signUpCoach(7331);
    const big = png(100, 100, [pngChunk('teXt', new Uint8Array(15 * 1024 * 1024))]);
    expect((await upload(cookie, big)).status).toBe(413);
  });

  it('refuses a viewer, and still lets one download', async () => {
    const coach = await signUpCoach(7340);
    const viewer = await inviteAndAccept(coach, { role: 'viewer', handle: 'parent' });

    expect((await uploadFile(viewer.cookie, stl(), 'arm.stl')).status).toBe(403);

    const { id } = (await (await uploadFile(coach, stl(), 'arm.stl')).json()) as {
      id: string;
    };
    // Attachments are the team's work product, not pictures of children — a
    // sponsor or a parent may read them. Asserted so the decision is deliberate.
    expect((await call(`/media/${id}`, { cookie: viewer.cookie })).status).toBe(200);
  });

  it('keeps attachments out of the photo library', async () => {
    const cookie = await signUpCoach(7350);
    await uploadFile(cookie, stl(), 'arm.stl');
    await upload(cookie, png(400, 400));

    const listed = await callJson<{ media: { kind: string }[] }>('/api/media', {
      cookie,
    });
    expect(listed.body.media).toHaveLength(1);
    expect(listed.body.media[0].kind).toBe('photo');
  });

  it('cannot be read across teams', async () => {
    const teamA = await signUpCoach(7360);
    const teamB = await signUpCoach(7361);
    const { id } = (await (await uploadFile(teamA, step(), 'arm.step')).json()) as {
      id: string;
    };
    expect((await call(`/media/${id}`, { cookie: teamB })).status).toBe(404);
  });
});

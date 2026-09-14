/**
 * Non-image attachments: what a name may be, and what a file may be called.
 *
 * A sibling of lib/images.ts rather than part of it, because the two answer the
 * same question by completely different means. That module decides what a file
 * IS by reading its magic bytes, and every guarantee it offers rests on that.
 * A STEP file has no magic bytes. Neither does an STL, an F3D, a SLDPRT or a
 * DWG — most CAD formats are either plain ASCII or a zip container with nothing
 * distinguishing in the header. For those the extension is the only signal that
 * exists, so this module is about NAMES, and it is deliberately paranoid about
 * them.
 *
 * The consequence has to be stated plainly, because it is the whole security
 * posture of the feature: with extension-only validation, the bytes of an
 * attachment are NOT known to be what they claim. Somebody can upload a complete
 * HTML page with a script in it and call it `bracket.stl`, and nothing here can
 * tell. /media/* is same-origin with the app, so a browser induced to RENDER
 * those bytes would run that script with a teammate's session — the same attack
 * that keeps image/svg+xml out of ALLOWED_TYPES.
 *
 * What stops it is not this module. It is the response headers on the way back
 * out (see the kind === 'file' branch in routes/media.ts): an
 * application/octet-stream content type, X-Content-Type-Options: nosniff so the
 * browser cannot sniff its way to text/html anyway, Content-Disposition:
 * attachment so it downloads rather than renders even if the type were wrong,
 * and a default-src 'none'; sandbox CSP underneath all three. Four independent
 * controls, because the failure mode of any one of them is a session takeover
 * for everyone on the roster.
 *
 * This module's job is narrower: refuse the obviously wrong, and make sure the
 * name that reaches a Content-Disposition header cannot break out of it.
 */

/**
 * What may be attached, and what content type each is STORED as.
 *
 * Note what these are not: `model/step`, `model/stl` and `model/3mf` are real
 * registered IANA types, and using them would be a mistake. The stored type is
 * what goes on the wire, and the only question that matters on the wire is
 * whether a browser can be talked into rendering the bytes as a document in this
 * origin. `application/octet-stream` answers "no" and locks with nosniff and
 * attachment; a long-tail model/* type buys no UX whatsoever — no browser
 * renders STEP inline — while putting a per-format decision on the one code path
 * where a mistake is stored XSS. The pretty label in the chip is derived from
 * the extension, client-side, where being wrong costs nothing.
 *
 * PDF is the exception, and only because it is the one format here whose bytes
 * can actually be checked. See `fileContentType`.
 */
export const FILE_EXTENSIONS: readonly string[] = [
  'pdf',
  // CAD / CAM / 3D print. Chosen from what an FTC team actually produces:
  // Onshape and SolidWorks export STEP, slicers eat STL and 3MF and emit gcode,
  // and Fusion and Inventor have their own native containers.
  'step',
  'stp',
  'stl',
  'f3d',
  'sldprt',
  'sldasm',
  'dwg',
  'dxf',
  '3mf',
  'gcode',
  'ipt',
  'iam',
];

const EXTENSIONS: ReadonlySet<string> = new Set(FILE_EXTENSIONS);

/** Long enough for a real CAD filename, short enough to render in a chip. */
export const MAX_FILENAME = 120;

/** %PDF- — the five bytes every PDF starts with. */
function isPdf(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  );
}

/**
 * The content type to STORE, from the bytes where that is possible and from
 * nothing at all where it is not.
 *
 * PDF is decided by its signature, never by the name — so a PDF uploaded as
 * `drawing.stl` is still stored and served as a PDF, and a `.pdf` that is not
 * one is refused by the caller. That keeps "the bytes decide, never the header"
 * alive for the single format here where bytes can decide.
 */
export function fileContentType(bytes: Uint8Array): string {
  return isPdf(bytes) ? 'application/pdf' : 'application/octet-stream';
}

/** True when the name claims PDF but the bytes are not one. */
export function pdfMismatch(extension: string, bytes: Uint8Array): boolean {
  return extension === 'pdf' && !isPdf(bytes);
}

/** The lowercased extension of an already-sanitised filename. */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

/**
 * A filename safe to store, to render in a chip, and to put in a header.
 *
 * Returns null for anything that does not survive, which the caller turns into a
 * 415 or a 400. The order matters:
 *
 *   1. Basename only, splitting on BOTH separators. `../../etc/passwd.stl` and
 *      a Windows drag-and-drop `C:\Users\ada\part.stl` both reduce to the last
 *      segment, so no part of a caller's string can influence a path.
 *   2. An ALLOWLIST of characters, not a blocklist. This is what removes control
 *      characters, CR/LF (header injection), quotes (breaking out of the
 *      Content-Disposition token) and — the one people forget — U+202E, the
 *      right-to-left override, which renders `trap<U+202E>lts.exe` in a chip as
 *      `trapexe.stl`. A blocklist would have to anticipate every one of those;
 *      an allowlist anticipates none of them and is still correct.
 *   3. The extension must be one we accept. For ten of the thirteen formats this
 *      is the ONLY check there is.
 *
 * Double extensions are worth stating explicitly, because a reviewer will ask.
 * `report.pdf.html` has extension `html` and is refused. `arm.html.stl` passes,
 * and that is fine: the served Content-Type and Content-Disposition come from
 * the row's `kind`, never from its name.
 */
export function sanitizeFilename(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length === 0 || raw.length > 512) return null;

  // Both separators, so a Windows path cannot smuggle a segment past a check
  // that only knows about '/'.
  const base = raw.split(/[/\\]/).pop() ?? '';
  if (base.length === 0) return null;

  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, '_').trim();
  if (cleaned.length === 0 || cleaned.length > MAX_FILENAME) return null;

  // Collapse runs of dots, so `part...stl` and the `..` segment both flatten.
  const collapsed = cleaned.replace(/\.{2,}/g, '.');

  const dot = collapsed.lastIndexOf('.');
  // No extension, or a dotfile with an empty stem — neither is a CAD file.
  if (dot <= 0 || dot === collapsed.length - 1) return null;

  const stem = collapsed.slice(0, dot);
  const extension = collapsed.slice(dot + 1).toLowerCase();
  if (stem.trim().length === 0) return null;
  if (!EXTENSIONS.has(extension)) return null;

  return `${stem}.${extension}`;
}

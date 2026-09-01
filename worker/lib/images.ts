/**
 * Image bytes, inspected and sanitised without decoding them.
 *
 * A Worker has no image library and no decoder, and Cloudflare Image Resizing
 * is not bound. Everything here is therefore header arithmetic — reading the
 * few bytes that describe a file and splicing out the ones that should not be
 * stored. That is enough for the three jobs this module has:
 *
 *   1. SNIFF the real format, because the Content-Type header is attacker
 *      controlled. An SVG announced as image/png is stored XSS: /media/* is
 *      same-origin, so a script inside an uploaded SVG runs with a teammate's
 *      session. Only the magic bytes decide what a file is.
 *
 *   2. STRIP metadata, which is the one in this file that protects a person
 *      rather than the app. Students are 12-18 and they paste photos straight
 *      off a phone; phone JPEGs carry GPS coordinates in EXIF. Coglin serves
 *      media back to the whole team and the nightly backup copies it to R2, so
 *      an un-stripped upload publishes a child's home location to everyone on
 *      the roster and every future restore of that dump. Stripping is not a
 *      hardening nicety here, it is the reason uploads can ship at all.
 *
 *   3. Read DIMENSIONS, so the editor can reserve an aspect-ratio box and the
 *      image does not shove the notes down the page when it loads. Purely
 *      cosmetic — a parse failure stores NULL rather than rejecting a file a
 *      student can plainly see is a photo.
 *
 * Everything is bounds-checked and returns null rather than throwing. The input
 * is a file from the internet; a malformed one must be a 415, never a 500.
 */

export type ImageType = 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';

/**
 * What may be uploaded. Note what is absent:
 *
 * - `image/svg+xml` — see the XSS note above. It is not an oversight and it
 *   should not be added.
 * - `image/avif` — reading its dimensions means walking the ISO-BMFF
 *   meta/iprp/ipco/ispe box tree, and nothing a student pastes from a phone or
 *   a screenshot tool is AVIF. Not worth the parser until something produces it.
 * - `image/heic` — iPhones hand it over, but no browser decodes it, so the
 *   client-side downscale cannot read it either. Rejecting it with a clear
 *   message beats storing a file that renders as a broken image forever.
 */
export const ALLOWED_TYPES: readonly ImageType[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

/**
 * Images plus PDF, for receipt uploads only.
 *
 * A receipt is as often a vendor's emailed PDF as a photo of a paper slip, so
 * the finance routes accept both. PDF is NOT added to ALLOWED_TYPES: a PDF
 * pasted into meeting notes would store a file the <img> tag renders as
 * nothing, and the notes upload path should keep refusing it plainly.
 *
 * The stored-XSS argument that bans SVG does not extend to PDF — /media/:id
 * serves with nosniff and browsers open PDFs in their own sandboxed viewer,
 * where embedded script cannot reach the page origin. SVG stays out.
 */
export type ReceiptType = ImageType | 'application/pdf';

export const RECEIPT_TYPES: readonly ReceiptType[] = [
  ...ALLOWED_TYPES,
  'application/pdf',
];

export const EXTENSIONS: Record<ReceiptType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
};

export interface Dimensions {
  width: number;
  height: number;
}

// -------------------------------------------------------------- byte readers

const u16be = (b: Uint8Array, i: number): number => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number): number => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number): number =>
  b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
// >>> 0 because a PNG chunk length with the top bit set would otherwise come
// back negative and turn a bounds check into an infinite loop.
const u32be = (b: Uint8Array, i: number): number =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u32le = (b: Uint8Array, i: number): number =>
  (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;

function ascii(b: Uint8Array, i: number, len: number): string {
  let s = '';
  for (let n = 0; n < len; n++) s += String.fromCharCode(b[i + n]);
  return s;
}

function startsWith(b: Uint8Array, sig: readonly number[]): boolean {
  if (b.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (b[i] !== sig[i]) return false;
  return true;
}

// -------------------------------------------------------------------- sniff

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIG = [0xff, 0xd8, 0xff];

/**
 * The real format, from the leading bytes, or null.
 *
 * The return value is what gets stored and what gets served back as
 * Content-Type. The header the client sent is only ever used to *disagree*
 * with this, never to override it.
 */
export function sniff(bytes: Uint8Array): ImageType | null {
  if (bytes.length < 12) return null;
  if (startsWith(bytes, PNG_SIG)) return 'image/png';
  if (startsWith(bytes, JPEG_SIG)) return 'image/jpeg';
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return 'image/gif';
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

/**
 * `sniff`, widened to accept PDF, for receipt uploads.
 *
 * A separate function rather than a wider return type on `sniff` itself, so
 * every existing image caller keeps a type system that cannot hand it a PDF.
 *
 * PDF metadata (the Info dictionary, XMP) is deliberately NOT stripped the way
 * image EXIF is. A receipt PDF is a vendor's document about a purchase, not a
 * file produced on a child's phone — there are no GPS coordinates in it, and
 * rewriting PDF object graphs to remove an author string is real parser risk
 * for no protective gain. If that judgement changes, change it here and in
 * ingestImage's strip branch together.
 */
export function sniffReceipt(bytes: Uint8Array): ReceiptType | null {
  // %PDF- — the five-byte signature every PDF version starts with.
  if (
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d
  ) {
    return 'application/pdf';
  }
  return sniff(bytes);
}

// --------------------------------------------------------------- dimensions

export function dimensions(bytes: Uint8Array, type: ImageType): Dimensions | null {
  switch (type) {
    case 'image/png':
      return pngDimensions(bytes);
    case 'image/gif':
      return gifDimensions(bytes);
    case 'image/jpeg':
      return jpegDimensions(bytes);
    case 'image/webp':
      return webpDimensions(bytes);
  }
}

function ok(width: number, height: number): Dimensions | null {
  // A zero dimension means the parse went somewhere wrong, and a value past
  // 65535 is beyond anything a phone or a screenshot produces.
  if (width <= 0 || height <= 0 || width > 65535 || height > 65535) return null;
  return { width, height };
}

/** IHDR is required by spec to be the first chunk, so its offsets are fixed. */
function pngDimensions(b: Uint8Array): Dimensions | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') return null;
  return ok(u32be(b, 16), u32be(b, 20));
}

/** The logical screen descriptor, immediately after the 6-byte signature. */
function gifDimensions(b: Uint8Array): Dimensions | null {
  if (b.length < 10) return null;
  return ok(u16le(b, 6), u16le(b, 8));
}

/**
 * Walk the marker chain to the first frame header.
 *
 * Dimensions live in a SOF (start of frame) segment, and which SOF depends on
 * the encoding — baseline is C0, progressive is C2, and a phone may emit either.
 * So the loop accepts any C0-CF except the three that are not frame headers:
 * C4 (Huffman tables), C8 (reserved), CC (arithmetic coding conditioning).
 */
function jpegDimensions(b: Uint8Array): Dimensions | null {
  let p = 2; // past the SOI
  while (p + 3 < b.length) {
    if (b[p] !== 0xff) return null; // desynced; refuse rather than guess
    const marker = b[p + 1];

    // Standalone markers carry no length field.
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      p += 2;
      continue;
    }
    // Entropy-coded data starts here and dimensions were declared before it.
    if (marker === 0xda || marker === 0xd9) return null;

    const length = u16be(b, p + 2);
    if (length < 2 || p + 2 + length > b.length) return null;

    const isFrameHeader =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrameHeader) {
      if (p + 9 > b.length) return null;
      return ok(u16be(b, p + 7), u16be(b, p + 5)); // width, height — height first in the file
    }
    p += 2 + length;
  }
  return null;
}

/** Three sub-formats behind the same RIFF container, all laid out differently. */
function webpDimensions(b: Uint8Array): Dimensions | null {
  if (b.length < 30) return null;
  const fourcc = ascii(b, 12, 4);

  if (fourcc === 'VP8 ') {
    // Lossy: 3-byte frame tag, 3-byte start code, then 14-bit dimensions.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return ok(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff);
  }
  if (fourcc === 'VP8L') {
    // Lossless: signature byte then two 14-bit fields, stored minus one.
    if (b[20] !== 0x2f) return null;
    const bits = u32le(b, 21);
    return ok((bits & 0x3fff) + 1, ((bits >>> 14) & 0x3fff) + 1);
  }
  if (fourcc === 'VP8X') {
    // Extended: 4 flag bytes, then 24-bit canvas dimensions, stored minus one.
    return ok(u24le(b, 24) + 1, u24le(b, 27) + 1);
  }
  return null;
}

// ----------------------------------------------------------------- stripping

function concat(parts: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Remove metadata that should never leave the uploader's phone.
 *
 * Splicing, not re-encoding: every container here is a chain of
 * length-prefixed segments, so a segment can be dropped by not copying it. The
 * pixels are untouched and the file still decodes byte-identically.
 *
 * Anything unparseable is returned unchanged rather than mangled — the caller
 * has already sniffed the type, and a file that survives sniffing but confuses
 * the walker is better stored intact than corrupted. (It is also, by then,
 * already bounded and allowlisted.)
 */
export function stripMetadata(bytes: Uint8Array, type: ImageType): Uint8Array {
  switch (type) {
    case 'image/jpeg':
      return stripJpeg(bytes);
    case 'image/png':
      return stripPng(bytes);
    case 'image/webp':
      return stripWebp(bytes);
    case 'image/gif':
      // GIF has no EXIF block. Its extension blocks carry comments and
      // application identifiers, not camera or location data, so there is
      // nothing here worth the risk of rewriting a container to remove.
      return bytes;
  }
}

/**
 * Drop APP1 and APP13.
 *
 * APP1 is EXIF (GPS, camera serial, timestamps) and also where XMP lives.
 * APP13 is Photoshop's IPTC block, which carries author and location fields.
 *
 * APP0 (JFIF) and APP2 (ICC colour profile) are deliberately KEPT: dropping the
 * ICC profile visibly shifts colour on wide-gamut phone photos, and neither
 * carries anything about the person who took the picture.
 */
function stripJpeg(b: Uint8Array): Uint8Array {
  if (!startsWith(b, JPEG_SIG)) return b;

  const parts: Uint8Array[] = [b.subarray(0, 2)];
  let total = 2;
  let p = 2;

  while (p + 3 < b.length) {
    if (b[p] !== 0xff) return b; // desynced; leave the file alone
    const marker = b[p + 1];

    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(b.subarray(p, p + 2));
      total += 2;
      p += 2;
      continue;
    }
    if (marker === 0xda) {
      // Scan data runs to the end of the file. Copy the rest verbatim.
      parts.push(b.subarray(p));
      total += b.length - p;
      p = b.length;
      break;
    }

    const length = u16be(b, p + 2);
    if (length < 2 || p + 2 + length > b.length) return b;

    if (marker !== 0xe1 && marker !== 0xed) {
      parts.push(b.subarray(p, p + 2 + length));
      total += 2 + length;
    }
    p += 2 + length;
  }

  return concat(parts, total);
}

/** Textual and EXIF chunks. Everything else, including IEND, is copied. */
const PNG_DROP = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt', 'tIME']);

function stripPng(b: Uint8Array): Uint8Array {
  if (!startsWith(b, PNG_SIG)) return b;

  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let total = 8;
  let p = 8;

  while (p + 8 <= b.length) {
    const length = u32be(b, p);
    const chunkType = ascii(b, p + 4, 4);
    const end = p + 12 + length; // length + type + data + crc
    if (end > b.length) return b; // truncated; leave it alone

    if (!PNG_DROP.has(chunkType)) {
      parts.push(b.subarray(p, end));
      total += end - p;
    }
    p = end;
    if (chunkType === 'IEND') break;
  }

  return concat(parts, total);
}

/**
 * Drop the EXIF and XMP chunks from a RIFF container.
 *
 * The RIFF size field has to be rewritten to match, or every decoder that
 * trusts it reads past the end of the file.
 */
function stripWebp(b: Uint8Array): Uint8Array {
  if (b.length < 12 || ascii(b, 0, 4) !== 'RIFF' || ascii(b, 8, 4) !== 'WEBP') {
    return b;
  }

  const parts: Uint8Array[] = [b.subarray(0, 12)];
  let total = 12;
  let p = 12;
  let dropped = false;

  while (p + 8 <= b.length) {
    const fourcc = ascii(b, p, 4);
    const size = u32le(b, p + 4);
    // Chunks are padded to an even length; the pad byte is not counted in size.
    const end = p + 8 + size + (size % 2);
    if (end > b.length) return b;

    if (fourcc === 'EXIF' || fourcc === 'XMP ') {
      dropped = true;
    } else {
      parts.push(b.subarray(p, end));
      total += end - p;
    }
    p = end;
  }

  if (!dropped) return b;

  const out = concat(parts, total);
  // RIFF size counts everything after the 8-byte 'RIFF' + size header.
  const size = total - 8;
  out[4] = size & 0xff;
  out[5] = (size >>> 8) & 0xff;
  out[6] = (size >>> 16) & 0xff;
  out[7] = (size >>> 24) & 0xff;
  return out;
}

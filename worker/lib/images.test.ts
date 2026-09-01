/**
 * Fixtures here are built byte by byte rather than checked in as binaries.
 *
 * Two reasons. A committed .jpg is opaque — when a parser test fails you cannot
 * see from the diff what the file was supposed to contain — and the interesting
 * cases (a GPS EXIF block, a truncated chunk, an SVG wearing a PNG header) are
 * ones no camera produces on demand anyway.
 *
 * PNG chunk CRCs are left as zeros throughout: nothing in images.ts verifies
 * them, so computing real ones here would only test the test helper.
 */
import { describe, expect, it } from 'vitest';
import {
  dimensions,
  sniff,
  sniffReceipt,
  stripMetadata,
  type ImageType,
} from './images';

// ------------------------------------------------------------------ builders

function bytes(...values: number[]): Uint8Array {
  return new Uint8Array(values);
}

function join(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function ascii(text: string): Uint8Array {
  return new Uint8Array([...text].map((c) => c.charCodeAt(0)));
}

function be16(n: number): Uint8Array {
  return bytes((n >> 8) & 0xff, n & 0xff);
}

function be32(n: number): Uint8Array {
  return bytes((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function le16(n: number): Uint8Array {
  return bytes(n & 0xff, (n >> 8) & 0xff);
}

function le24(n: number): Uint8Array {
  return bytes(n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff);
}

function le32(n: number): Uint8Array {
  return bytes(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff);
}

const PNG_SIG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  return join(be32(data.length), ascii(type), data, be32(0));
}

function png(
  width: number,
  height: number,
  extra: Uint8Array[] = [],
): Uint8Array {
  const ihdr = join(be32(width), be32(height), bytes(8, 6, 0, 0, 0));
  return join(
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    ...extra,
    pngChunk('IDAT', bytes(0x78, 0x9c, 0x00)),
    pngChunk('IEND', new Uint8Array(0)),
  );
}

function gif(width: number, height: number): Uint8Array {
  return join(ascii('GIF89a'), le16(width), le16(height), bytes(0xf0, 0, 0, 0));
}

/** A JPEG segment: FF <marker> <length including the 2 length bytes> <data>. */
function jpegSegment(marker: number, data: Uint8Array): Uint8Array {
  return join(bytes(0xff, marker), be16(data.length + 2), data);
}

const EXIF_GPS = join(
  ascii('Exif\0\0'),
  // A plausible little-endian TIFF header plus a byte pattern standing in for
  // a GPS IFD. The stripper never parses this — it drops the whole segment —
  // so its only job is to be findable in the output if stripping fails.
  bytes(0x49, 0x49, 0x2a, 0x00),
  ascii('GPSLatitude 42.3601 GPSLongitude -71.0589'),
);

function jpeg(
  width: number,
  height: number,
  opts: { app1?: boolean; app13?: boolean; icc?: boolean; progressive?: boolean } = {},
): Uint8Array {
  const parts: Uint8Array[] = [bytes(0xff, 0xd8)];
  // APP0/JFIF comes first in a real file and must survive stripping.
  parts.push(jpegSegment(0xe0, join(ascii('JFIF\0'), bytes(1, 2, 0, 0, 1, 0, 1, 0, 0))));
  if (opts.app1) parts.push(jpegSegment(0xe1, EXIF_GPS));
  if (opts.icc) parts.push(jpegSegment(0xe2, join(ascii('ICC_PROFILE\0'), bytes(1, 1, 0, 0))));
  if (opts.app13) {
    parts.push(jpegSegment(0xed, join(ascii('Photoshop 3.0\0'), ascii('8BIM city=Boston'))));
  }
  // Huffman tables sit between the app segments and the frame header in a real
  // file, and C4 must not be mistaken for a frame header.
  parts.push(jpegSegment(0xc4, bytes(0x00, 0x01, 0x02)));
  parts.push(
    jpegSegment(
      opts.progressive ? 0xc2 : 0xc0,
      join(bytes(8), be16(height), be16(width), bytes(1), bytes(1, 0x11, 0)),
    ),
  );
  parts.push(jpegSegment(0xda, bytes(1, 1, 0, 0, 63, 0)));
  parts.push(bytes(0x12, 0x34, 0x56, 0x78)); // entropy-coded data
  parts.push(bytes(0xff, 0xd9));
  return join(...parts);
}

function riff(chunks: Uint8Array[]): Uint8Array {
  const body = join(...chunks);
  return join(ascii('RIFF'), le32(body.length + 4), ascii('WEBP'), body);
}

function webpChunk(fourcc: string, data: Uint8Array): Uint8Array {
  const pad = data.length % 2 === 1 ? bytes(0) : new Uint8Array(0);
  return join(ascii(fourcc), le32(data.length), data, pad);
}

function webpLossy(width: number, height: number): Uint8Array {
  return riff([
    webpChunk(
      'VP8 ',
      join(bytes(0, 0, 0), bytes(0x9d, 0x01, 0x2a), le16(width), le16(height), bytes(0, 0)),
    ),
  ]);
}

function webpLossless(width: number, height: number): Uint8Array {
  const packed = (width - 1) | ((height - 1) << 14);
  return riff([
    webpChunk('VP8L', join(bytes(0x2f), le32(packed >>> 0), bytes(0, 0, 0, 0))),
  ]);
}

function webpExtended(width: number, height: number, extra: Uint8Array[] = []): Uint8Array {
  return riff([
    webpChunk('VP8X', join(bytes(0x08, 0, 0, 0), le24(width - 1), le24(height - 1))),
    ...extra,
    webpChunk('VP8 ', join(bytes(0, 0, 0), bytes(0x9d, 0x01, 0x2a), le16(width), le16(height))),
  ]);
}

function contains(haystack: Uint8Array, needle: string): boolean {
  const bin = String.fromCharCode(...haystack);
  return bin.includes(needle);
}

// -------------------------------------------------------------------- sniff

describe('sniff', () => {
  it('identifies each allowed format from its magic bytes', () => {
    expect(sniff(png(4, 4))).toBe('image/png');
    expect(sniff(gif(4, 4))).toBe('image/gif');
    expect(sniff(jpeg(4, 4))).toBe('image/jpeg');
    expect(sniff(webpLossy(4, 4))).toBe('image/webp');
    expect(sniff(webpLossless(4, 4))).toBe('image/webp');
    expect(sniff(webpExtended(4, 4))).toBe('image/webp');
  });

  it('accepts GIF87a as well as GIF89a', () => {
    const old = join(ascii('GIF87a'), le16(6), le16(7), bytes(0, 0, 0, 0));
    expect(sniff(old)).toBe('image/gif');
  });

  // The reason this module exists. An SVG is a script-bearing document served
  // same-origin from /media/*; if the Content-Type header were trusted, this
  // upload would be stored XSS against every teammate's session.
  it('rejects an SVG no matter what the caller calls it', () => {
    const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(sniff(svg)).toBeNull();
  });

  it('rejects an SVG with a leading XML declaration and whitespace', () => {
    const svg = ascii('<?xml version="1.0"?>\n  <svg onload="fetch(\'/api/team\')"/>');
    expect(sniff(svg)).toBeNull();
  });

  it('rejects other things a file picker can produce', () => {
    expect(sniff(join(ascii('%PDF-1.7'), bytes(0, 0, 0, 0)))).toBeNull();
    expect(sniff(join(ascii('PK'), bytes(3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)))).toBeNull();
    expect(sniff(ascii('#!/bin/sh\necho hello world'))).toBeNull();
    expect(sniff(bytes(0x00, 0x00, 0x01, 0x00, 1, 0, 16, 16, 0, 0, 0, 0))).toBeNull(); // .ico
  });

  it('rejects a RIFF container that is not WEBP', () => {
    const wav = join(ascii('RIFF'), le32(36), ascii('WAVE'), bytes(0, 0, 0, 0));
    expect(sniff(wav)).toBeNull();
  });

  it('returns null for empty and truncated input rather than throwing', () => {
    expect(sniff(new Uint8Array(0))).toBeNull();
    expect(sniff(bytes(0x89, 0x50))).toBeNull();
    expect(sniff(bytes(0xff, 0xd8))).toBeNull();
  });
});

// ------------------------------------------------------------ sniffReceipt

describe('sniffReceipt', () => {
  it('accepts a PDF that plain sniff rejects', () => {
    const pdf = join(ascii('%PDF-1.7'), bytes(0x0a, 0, 0, 0));
    expect(sniff(pdf)).toBeNull();
    expect(sniffReceipt(pdf)).toBe('application/pdf');
  });

  it('falls through to sniff for images', () => {
    expect(sniffReceipt(png(4, 4))).toBe('image/png');
    expect(sniffReceipt(jpeg(4, 4))).toBe('image/jpeg');
  });

  // The widened list must not widen the XSS surface: SVG stays out, and so
  // does anything merely CLAIMING to be a PDF without the signature.
  it('still rejects an SVG and near-miss PDF signatures', () => {
    const svg = ascii('<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(sniffReceipt(svg)).toBeNull();
    expect(sniffReceipt(ascii('%PDX-1.7 not a pdf'))).toBeNull();
    expect(sniffReceipt(ascii(' %PDF-1.7'))).toBeNull(); // signature must be at offset 0
    expect(sniffReceipt(ascii('%PDF'))).toBeNull(); // truncated before the dash
  });
});

// --------------------------------------------------------------- dimensions

describe('dimensions', () => {
  it('reads a PNG', () => {
    expect(dimensions(png(1, 1), 'image/png')).toEqual({ width: 1, height: 1 });
    expect(dimensions(png(1920, 1080), 'image/png')).toEqual({ width: 1920, height: 1080 });
  });

  it('reads a GIF', () => {
    expect(dimensions(gif(2, 3), 'image/gif')).toEqual({ width: 2, height: 3 });
  });

  it('reads a baseline JPEG, skipping the app and Huffman segments', () => {
    expect(dimensions(jpeg(640, 480), 'image/jpeg')).toEqual({ width: 640, height: 480 });
  });

  it('reads a progressive JPEG', () => {
    // A phone may emit either, and a parser that only accepts C0 silently
    // returns null for half of them.
    expect(dimensions(jpeg(800, 600, { progressive: true }), 'image/jpeg')).toEqual({
      width: 800,
      height: 600,
    });
  });

  it('reads a JPEG whose dimensions sit behind a large EXIF block', () => {
    expect(dimensions(jpeg(4032, 3024, { app1: true }), 'image/jpeg')).toEqual({
      width: 4032,
      height: 3024,
    });
  });

  it('reads all three WebP sub-formats', () => {
    expect(dimensions(webpLossy(320, 240), 'image/webp')).toEqual({ width: 320, height: 240 });
    expect(dimensions(webpLossless(17, 33), 'image/webp')).toEqual({ width: 17, height: 33 });
    expect(dimensions(webpExtended(2000, 1500), 'image/webp')).toEqual({
      width: 2000,
      height: 1500,
    });
  });

  it('handles WebP dimensions at the 14-bit field boundary', () => {
    expect(dimensions(webpLossless(16384, 16384), 'image/webp')).toEqual({
      width: 16384,
      height: 16384,
    });
  });

  // Dimensions are a layout nicety, not a validity condition: a truncated file
  // that still sniffs as an image should be stored with NULL dimensions rather
  // than rejected, and it must never throw.
  it('returns null for truncated input instead of throwing', () => {
    const cases: [Uint8Array, ImageType][] = [
      [png(4, 4).subarray(0, 20), 'image/png'],
      [gif(4, 4).subarray(0, 7), 'image/gif'],
      [jpeg(4, 4).subarray(0, 12), 'image/jpeg'],
      [webpLossy(4, 4).subarray(0, 24), 'image/webp'],
      [new Uint8Array(0), 'image/png'],
    ];
    for (const [input, type] of cases) {
      expect(dimensions(input, type)).toBeNull();
    }
  });

  it('returns null for a JPEG that ends before any frame header', () => {
    const headerless = join(bytes(0xff, 0xd8), jpegSegment(0xda, bytes(1, 1, 0)), bytes(0xff, 0xd9));
    expect(dimensions(headerless, 'image/jpeg')).toBeNull();
  });

  it('returns null rather than looping on a zero-length JPEG segment', () => {
    // A length field below 2 would advance the cursor backwards.
    const evil = join(bytes(0xff, 0xd8), bytes(0xff, 0xe1), be16(0), bytes(0xff, 0xd9));
    expect(dimensions(evil, 'image/jpeg')).toBeNull();
  });

  it('returns null for zero dimensions', () => {
    expect(dimensions(png(0, 0), 'image/png')).toBeNull();
    expect(dimensions(gif(0, 5), 'image/gif')).toBeNull();
  });
});

// ---------------------------------------------------------------- stripping

describe('stripMetadata', () => {
  it('removes a GPS EXIF block from a JPEG', () => {
    const withExif = jpeg(4032, 3024, { app1: true });
    expect(contains(withExif, 'Exif\0\0')).toBe(true);
    expect(contains(withExif, 'GPSLatitude')).toBe(true);

    const stripped = stripMetadata(withExif, 'image/jpeg');
    expect(contains(stripped, 'Exif\0\0')).toBe(false);
    expect(contains(stripped, 'GPSLatitude')).toBe(false);
    expect(contains(stripped, '42.3601')).toBe(false);
  });

  it('removes an IPTC block from a JPEG', () => {
    const stripped = stripMetadata(jpeg(8, 8, { app13: true }), 'image/jpeg');
    expect(contains(stripped, 'Photoshop 3.0')).toBe(false);
    expect(contains(stripped, 'city=Boston')).toBe(false);
  });

  it('leaves the image decodable and the same size after stripping', () => {
    // The whole premise of splicing rather than re-encoding: the pixels and the
    // frame header are untouched, so the file still parses to the same image.
    const stripped = stripMetadata(jpeg(4032, 3024, { app1: true, app13: true }), 'image/jpeg');
    expect(sniff(stripped)).toBe('image/jpeg');
    expect(dimensions(stripped, 'image/jpeg')).toEqual({ width: 4032, height: 3024 });
    expect(stripped[stripped.length - 2]).toBe(0xff);
    expect(stripped[stripped.length - 1]).toBe(0xd9); // EOI survived
  });

  it('keeps JFIF and the ICC colour profile', () => {
    // Dropping ICC visibly shifts colour on wide-gamut phone photos, and
    // neither segment says anything about the person who took the picture.
    const stripped = stripMetadata(jpeg(8, 8, { app1: true, icc: true }), 'image/jpeg');
    expect(contains(stripped, 'JFIF')).toBe(true);
    expect(contains(stripped, 'ICC_PROFILE')).toBe(true);
    expect(contains(stripped, 'Exif\0\0')).toBe(false);
  });

  it('preserves entropy-coded scan data verbatim', () => {
    const original = jpeg(16, 16, { app1: true });
    const stripped = stripMetadata(original, 'image/jpeg');
    // The scan bytes are the image. If the walker mis-handles SOS they are the
    // first thing to be truncated.
    expect(contains(stripped, String.fromCharCode(0x12, 0x34, 0x56, 0x78))).toBe(true);
    expect(stripped.length).toBeLessThan(original.length);
  });

  it('removes eXIf and text chunks from a PNG', () => {
    const withMeta = png(100, 50, [
      pngChunk('eXIf', join(bytes(0x49, 0x49, 0x2a, 0x00), ascii('GPSLatitude 42.3601'))),
      pngChunk('tEXt', ascii('Author\0Ada Lovelace')),
      pngChunk('iTXt', ascii('Comment\0\0\0\0taken at home')),
    ]);
    const stripped = stripMetadata(withMeta, 'image/png');

    expect(contains(stripped, 'GPSLatitude')).toBe(false);
    expect(contains(stripped, 'Ada Lovelace')).toBe(false);
    expect(contains(stripped, 'taken at home')).toBe(false);
    expect(sniff(stripped)).toBe('image/png');
    expect(dimensions(stripped, 'image/png')).toEqual({ width: 100, height: 50 });
    expect(contains(stripped, 'IDAT')).toBe(true);
    expect(contains(stripped, 'IEND')).toBe(true);
  });

  it('leaves a clean PNG untouched', () => {
    const clean = png(10, 10);
    expect(stripMetadata(clean, 'image/png')).toEqual(clean);
  });

  it('removes EXIF from a WebP and fixes the RIFF size', () => {
    const withExif = webpExtended(640, 480, [
      webpChunk('EXIF', join(bytes(0x49, 0x49, 0x2a, 0x00), ascii('GPSLatitude 42.3601'))),
    ]);
    const stripped = stripMetadata(withExif, 'image/webp');

    expect(contains(stripped, 'GPSLatitude')).toBe(false);
    expect(sniff(stripped)).toBe('image/webp');
    expect(dimensions(stripped, 'image/webp')).toEqual({ width: 640, height: 480 });

    // A stale RIFF size makes every decoder that trusts it read past the end.
    const declared =
      stripped[4] | (stripped[5] << 8) | (stripped[6] << 16) | (stripped[7] << 24);
    expect(declared).toBe(stripped.length - 8);
  });

  it('returns a GIF unchanged', () => {
    const g = gif(6, 6);
    expect(stripMetadata(g, 'image/gif')).toEqual(g);
  });

  it('returns malformed input unchanged rather than corrupting it', () => {
    const truncated = png(4, 4).subarray(0, 20);
    expect(stripMetadata(truncated, 'image/png')).toEqual(truncated);
    const desynced = join(bytes(0xff, 0xd8), bytes(0x00, 0x00, 0x00));
    expect(stripMetadata(desynced, 'image/jpeg')).toEqual(desynced);
  });
});

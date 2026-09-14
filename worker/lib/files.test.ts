import { describe, expect, it } from 'vitest';
import {
  extensionOf,
  fileContentType,
  pdfMismatch,
  sanitizeFilename,
  FILE_EXTENSIONS,
} from './files';

const ascii = (t: string) => new Uint8Array([...t].map((c) => c.charCodeAt(0)));

describe('sanitizeFilename', () => {
  it('accepts every extension on the list, in any case', () => {
    for (const ext of FILE_EXTENSIONS) {
      expect(sanitizeFilename(`part.${ext}`)).toBe(`part.${ext}`);
      expect(sanitizeFilename(`part.${ext.toUpperCase()}`)).toBe(`part.${ext}`);
    }
  });

  it('refuses anything not on the list', () => {
    for (const name of [
      'payload.exe',
      'page.html',
      'page.htm',
      'icon.svg',
      'script.js',
      'shell.sh',
      'notes.txt',
      'photo.jpg',
    ]) {
      expect(sanitizeFilename(name)).toBeNull();
    }
  });

  it('refuses a name with no extension at all', () => {
    expect(sanitizeFilename('bracket')).toBeNull();
    expect(sanitizeFilename('bracket.')).toBeNull();
  });

  it('refuses a dotfile, which has no stem to show in a chip', () => {
    expect(sanitizeFilename('.stl')).toBeNull();
  });

  it('reduces a POSIX traversal to its basename', () => {
    expect(sanitizeFilename('../../etc/passwd.stl')).toBe('passwd.stl');
    expect(sanitizeFilename('/var/tmp/arm.step')).toBe('arm.step');
  });

  it('reduces a Windows path to its basename', () => {
    // Drag-and-drop from Explorer hands over the whole path on some browsers,
    // and a split on '/' alone would keep every backslash segment.
    expect(sanitizeFilename('C:\\Users\\ada\\Desktop\\arm.step')).toBe('arm.step');
    expect(sanitizeFilename('..\\..\\windows\\system32\\cmd.stl')).toBe('cmd.stl');
  });

  it('judges a double extension by its LAST one', () => {
    expect(sanitizeFilename('report.pdf.html')).toBeNull();
    expect(sanitizeFilename('arm.html.stl')).toBe('arm.html.stl');
  });

  it('strips the right-to-left override that disguises an extension', () => {
    // Without this, a chip renders "trap\u202Elts.exe" as "trapexe.stl" — the
    // name reads as a CAD file and the download is an executable.
    const out = sanitizeFilename('trap\u202Elts.exe');
    expect(out).toBeNull();
    // And when the real extension IS allowed, the override character is gone.
    const kept = sanitizeFilename('trap\u202Elts.stl');
    expect(kept).not.toBeNull();
    expect(kept).not.toContain('\u202E');
  });

  it('strips characters that would break a Content-Disposition header', () => {
    expect(sanitizeFilename('a"b.stl')).toBe('a_b.stl');
    expect(sanitizeFilename('a\r\nb.stl')).toBe('a__b.stl');
    expect(sanitizeFilename('a;b.stl')).toBe('a_b.stl');
    expect(sanitizeFilename('a\u0000b.stl')).toBe('a_b.stl');
  });

  it('always returns something a header can carry verbatim', () => {
    for (const raw of [
      'Motörhalterung_v2.step',
      'arm (copy).stl',
      'part #3.dxf',
      '../a\\b"c\r\n.3mf',
      '日本語.gcode',
    ]) {
      const out = sanitizeFilename(raw);
      if (out !== null) expect(out).toMatch(/^[A-Za-z0-9._ -]+$/);
    }
  });

  it('refuses a name longer than a chip can show', () => {
    expect(sanitizeFilename(`${'a'.repeat(200)}.stl`)).toBeNull();
    // And a hostile header value is refused before the replace() runs at all.
    expect(sanitizeFilename('a'.repeat(600))).toBeNull();
  });

  it('refuses anything that is not a string', () => {
    expect(sanitizeFilename(undefined)).toBeNull();
    expect(sanitizeFilename(null)).toBeNull();
    expect(sanitizeFilename(42)).toBeNull();
    expect(sanitizeFilename('')).toBeNull();
  });

  it('collapses dot runs', () => {
    expect(sanitizeFilename('part...stl')).toBe('part.stl');
  });
});

describe('fileContentType', () => {
  it('stores a real PDF as a PDF, from its signature', () => {
    expect(fileContentType(ascii('%PDF-1.7\n...'))).toBe('application/pdf');
  });

  it('stores everything else as opaque bytes', () => {
    expect(fileContentType(ascii('solid cube\nfacet normal'))).toBe(
      'application/octet-stream',
    );
    expect(fileContentType(ascii('ISO-10303-21;'))).toBe('application/octet-stream');
  });

  it('never returns a type a browser would render as a document', () => {
    // The single property this function exists to guarantee.
    for (const body of [
      '<html><script>alert(1)</script></html>',
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      '<?xml version="1.0"?><x/>',
      'GIF89a',
    ]) {
      const type = fileContentType(ascii(body));
      expect(type).toBe('application/octet-stream');
      expect(type).not.toBe('text/html');
      expect(type).not.toBe('image/svg+xml');
    }
  });
});

describe('pdfMismatch', () => {
  it('catches a .pdf that is not one', () => {
    expect(pdfMismatch('pdf', ascii('<html>'))).toBe(true);
    expect(pdfMismatch('pdf', ascii('%PDF-1.4'))).toBe(false);
  });

  it('says nothing about formats whose bytes cannot be checked', () => {
    expect(pdfMismatch('stl', ascii('<html>'))).toBe(false);
  });
});

describe('extensionOf', () => {
  it('reads the last extension, lowercased', () => {
    expect(extensionOf('arm.html.stl')).toBe('stl');
    expect(extensionOf('arm.STEP')).toBe('step');
    expect(extensionOf('arm')).toBe('');
  });
});

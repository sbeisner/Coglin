import { describe, expect, it } from 'vitest';
import {
  MAX_CONTENT_BYTES,
  MAX_NODES,
  emptyDoc,
  parseContent,
} from './notes';

/**
 * parseContent is the only thing standing between a hand-forged body and every
 * future reader of a document, and it derives content_text in the same walk — so
 * a bug here is either a stored node type nothing can render, or an excerpt that
 * reads backwards. Both are invisible until somebody opens the portfolio inbox.
 */

const doc = (...content: unknown[]) => JSON.stringify({ type: 'doc', content });
const para = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});

describe('parseContent', () => {
  it('derives plain text in document order', () => {
    // The traversal is stack-based, so children are pushed reversed. Get that
    // wrong and every excerpt in the portfolio inbox reads backwards.
    const result = parseContent(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Chassis' }] },
        para('Swapped to 2in wheels'),
        para('After the weight test'),
      ),
    );
    expect('text' in result && result.text).toBe(
      'Chassis Swapped to 2in wheels After the weight test',
    );
  });

  it('keeps words from running together across blocks', () => {
    const result = parseContent(doc(para('Chassis'), para('notes')));
    expect('text' in result && result.text).toBe('Chassis notes');
  });

  it('walks nested lists in order', () => {
    const result = parseContent(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para('first')] },
          { type: 'listItem', content: [para('second')] },
        ],
      }),
    );
    expect('text' in result && result.text).toBe('first second');
  });

  it('rejects a node type the editor cannot render', () => {
    // An unknown type would round-trip into every future reader forever, and
    // there is no CHECK constraint to stop it.
    const result = parseContent(doc({ type: 'script', content: [] }));
    expect(result).toEqual({ error: 'invalid_content' });
  });

  it('rejects anything that is not a doc', () => {
    for (const bad of [
      '[]',
      '"hello"',
      'null',
      'not json at all',
      JSON.stringify({ type: 'paragraph' }),
      42,
      undefined,
    ]) {
      expect(parseContent(bad as unknown), String(bad)).toEqual({
        error: 'invalid_content',
      });
    }
  });

  it('rejects a text node with no text', () => {
    const result = parseContent(doc({ type: 'paragraph', content: [{ type: 'text' }] }));
    expect(result).toEqual({ error: 'invalid_content' });
  });

  it('measures size in bytes, not characters', () => {
    // A multi-byte character counts for what it costs. Length would let a body
    // three times over the limit through.
    const oversized = doc(para('😀'.repeat(MAX_CONTENT_BYTES / 2)));
    expect(parseContent(oversized)).toEqual({ error: 'content_too_large' });
  });

  it('caps the node count before the byte cap would catch it', () => {
    // Bare paragraphs, so this trips the node limit rather than the size limit —
    // the two bounds guard different things and a test that cannot tell them
    // apart is not testing either. 5010 empty paragraphs is ~120KB, well under
    // MAX_CONTENT_BYTES, and still far past MAX_NODES.
    const many = Array.from({ length: MAX_NODES + 10 }, () => ({ type: 'paragraph' }));
    expect(parseContent(doc(...many))).toEqual({ error: 'too_many_nodes' });
  });

  it('does not blow the stack on a deeply nested body', () => {
    // Iterative for exactly this reason: a RangeError here would be a 500 where
    // it should be a 400.
    let node: unknown = { type: 'paragraph' };
    for (let i = 0; i < 5_000; i++) {
      node = { type: 'blockquote', content: [node] };
    }
    expect(parseContent(doc(node))).toEqual({ error: 'invalid_content' });
  });

  it('accepts what a new document is created with', () => {
    const result = parseContent(emptyDoc());
    expect('text' in result && result.text).toBe('');
  });
});

describe('attachment nodes', () => {
  const doc = (...content: unknown[]) =>
    JSON.stringify({ type: 'doc', content });

  const file = (attrs: Record<string, unknown>) => ({ type: 'mediaFile', attrs });

  it('accepts a well-formed attachment', () => {
    const out = parseContent(
      doc(file({ mediaId: 'abc', filename: 'arm.step', size: 2048, uploadId: null })),
    );
    expect('error' in out).toBe(false);
  });

  it('puts the filename into the text projection, so search can find it', () => {
    // Unlike a photo, which contributes nothing — an attachment's name is
    // usually the only searchable trace it leaves in the document.
    const out = parseContent(doc(file({ filename: 'arm_bracket_v3.step' })));
    expect('error' in out).toBe(false);
    if (!('error' in out)) expect(out.text).toContain('arm_bracket_v3.step');
  });

  it('refuses a filename long enough to bloat the document', () => {
    const out = parseContent(doc(file({ filename: 'a'.repeat(300) })));
    expect(out).toEqual({ error: 'invalid_content' });
  });

  it('refuses a filename that is not text', () => {
    expect(parseContent(doc(file({ filename: 42 })))).toEqual({
      error: 'invalid_content',
    });
  });

  it('refuses a nonsense size', () => {
    expect(parseContent(doc(file({ size: -1 })))).toEqual({
      error: 'invalid_content',
    });
    expect(parseContent(doc(file({ size: 999 * 1024 * 1024 })))).toEqual({
      error: 'invalid_content',
    });
    expect(parseContent(doc(file({ size: 'big' })))).toEqual({
      error: 'invalid_content',
    });
  });

  it('refuses an overlong media id', () => {
    expect(parseContent(doc(file({ mediaId: 'x'.repeat(100) })))).toEqual({
      error: 'invalid_content',
    });
  });

  it('leaves other nodes attribute-unchecked, as before', () => {
    // The bound is deliberately narrow: only mediaFile, only its own attrs.
    const out = parseContent(
      doc({ type: 'heading', attrs: { level: 2, anything: 'x'.repeat(500) } }),
    );
    expect('error' in out).toBe(false);
  });
});

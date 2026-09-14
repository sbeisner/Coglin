import { describe, expect, it } from 'vitest';
import {
  insertImageNodes,
  type InsertTarget,
  type PreparedImage,
} from './useDocImages';

/**
 * The regression guard for "you can only attach one image per note".
 *
 * A real Editor cannot be built here — the worker test runtime has no DOM — so
 * the assertion is on what gets handed to ProseMirror, which is exactly where
 * the bug lived. The old code called insertContent once per file; because
 * insertContent replaces the current selection and a freshly inserted block atom
 * IS the current selection, each photo overwrote the one before it. One call
 * carrying every node is the fix, so that is what these tests pin.
 */
function stubEditor() {
  const calls: unknown[] = [];
  const editor: InsertTarget = {
    chain: () => ({
      focus: () => ({
        insertContent: (content: unknown) => {
          calls.push(content);
          return { run: () => undefined };
        },
      }),
    }),
  };
  return { editor, calls };
}

function prepared(n: number): PreparedImage[] {
  return Array.from({ length: n }, (_, i) => ({
    file: { name: `photo-${i}.jpg` } as File,
    uploadId: `upload-${i}`,
    previewUrl: `blob:preview-${i}`,
    size: { width: 100 + i, height: 200 + i },
  }));
}

describe('insertImageNodes', () => {
  it('inserts every photo in a single call', () => {
    const { editor, calls } = stubEditor();
    insertImageNodes(editor, prepared(3));

    // One call. Two would mean the second overwrites the first.
    expect(calls).toHaveLength(1);

    const content = calls[0] as { type: string; attrs?: { uploadId: string } }[];
    const images = content.filter((node) => node.type === 'mediaImage');
    expect(images).toHaveLength(3);
    expect(images.map((node) => node.attrs?.uploadId)).toEqual([
      'upload-0',
      'upload-1',
      'upload-2',
    ]);
  });

  it('carries each photo its own measured size', () => {
    const { editor, calls } = stubEditor();
    insertImageNodes(editor, prepared(2));

    const content = calls[0] as {
      type: string;
      attrs?: { width: number | null; height: number | null };
    }[];
    const images = content.filter((node) => node.type === 'mediaImage');
    expect(images[0].attrs).toMatchObject({ width: 100, height: 200 });
    expect(images[1].attrs).toMatchObject({ width: 101, height: 201 });
  });

  it('stores null dimensions when a photo could not be measured', () => {
    const { editor, calls } = stubEditor();
    const one = prepared(1);
    one[0].size = null;
    insertImageNodes(editor, one);

    const content = calls[0] as {
      type: string;
      attrs?: { width: number | null; height: number | null };
    }[];
    expect(content[0].attrs).toMatchObject({ width: null, height: null });
  });

  it('appends a trailing paragraph so the caret has somewhere to go', () => {
    const { editor, calls } = stubEditor();
    insertImageNodes(editor, prepared(2));

    const content = calls[0] as { type: string }[];
    expect(content).toHaveLength(3);
    expect(content[content.length - 1]).toEqual({ type: 'paragraph' });
  });

  it('does nothing when no files were picked', () => {
    const { editor, calls } = stubEditor();
    insertImageNodes(editor, []);
    expect(calls).toHaveLength(0);
  });
});

import { describe, expect, it } from 'vitest';
import { buildTree, eligibleParents, subtreeIds, toMarkdown } from './docText';
import type { NoteDocSummary } from '@/types';

/**
 * The markdown serialiser and the tree helpers. Both pure, both load-bearing:
 * "Copy notes" is the most-used thing in the whole feature because a team's real
 * channel is Discord, and the tree helpers decide which moves the row menu offers.
 */

const doc = (...content: unknown[]) => JSON.stringify({ type: 'doc', content });
const text = (value: string) => ({ type: 'text', text: value });
const para = (value: string) => ({ type: 'paragraph', content: [text(value)] });

describe('toMarkdown', () => {
  it('writes headings at their real level', () => {
    const out = toMarkdown(
      doc(
        { type: 'heading', attrs: { level: 2 }, content: [text('Chassis')] },
        { type: 'heading', attrs: { level: 3 }, content: [text('Wheels')] },
      ),
    );
    expect(out).toContain('## Chassis');
    expect(out).toContain('### Wheels');
  });

  it('writes bullets and keeps nesting', () => {
    const out = toMarkdown(
      doc({
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [para('outer')] },
          {
            type: 'listItem',
            content: [
              para('has children'),
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [para('inner')] }],
              },
            ],
          },
        ],
      }),
    );
    expect(out).toContain('- outer');
    expect(out).toContain('inner');
  });

  it('numbers an ordered list, honouring where it starts', () => {
    const out = toMarkdown(
      doc({
        type: 'orderedList',
        attrs: { start: 3 },
        content: [
          { type: 'listItem', content: [para('third')] },
          { type: 'listItem', content: [para('fourth')] },
        ],
      }),
    );
    expect(out).toContain('3. third');
    expect(out).toContain('4. fourth');
  });

  it('writes task items as checkboxes, checked and not', () => {
    const out = toMarkdown(
      doc({
        type: 'taskList',
        content: [
          { type: 'taskItem', attrs: { checked: true }, content: [para('ordered')] },
          { type: 'taskItem', attrs: { checked: false }, content: [para('not yet')] },
        ],
      }),
    );
    expect(out).toContain('- [x] ordered');
    expect(out).toContain('- [ ] not yet');
  });

  it('marks a photo by its caption, or plainly when it has none', () => {
    expect(toMarkdown(doc({ type: 'mediaImage', attrs: { alt: 'the chassis' } }))).toBe(
      '(photo: the chassis)',
    );
    expect(toMarkdown(doc({ type: 'mediaImage', attrs: {} }))).toBe('(photo)');
  });

  it('survives a body it cannot parse', () => {
    // A crash here would hide notes that are still safely on the server.
    expect(toMarkdown('not json')).toBe('');
    expect(toMarkdown('')).toBe('');
  });

  it('keeps links, which used to be dropped on the way to the clipboard', () => {
    const out = toMarkdown(
      doc({
        type: 'paragraph',
        content: [
          text('See '),
          {
            type: 'text',
            text: 'the build log',
            marks: [{ type: 'link', attrs: { href: 'https://example.com/log' } }],
          },
        ],
      }),
    );
    expect(out).toContain('[the build log](https://example.com/log)');
  });

  it('leaves a bare autolinked URL alone rather than doubling it', () => {
    // autolink marks the URL with itself as the href. `[url](url)` is noise.
    const out = toMarkdown(
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: 'https://example.com',
            marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
          },
        ],
      }),
    );
    expect(out).toContain('https://example.com');
    expect(out).not.toContain('](');
  });

  it('names an attachment, which would otherwise vanish from a copied note', () => {
    const out = toMarkdown(
      doc({ type: 'mediaFile', attrs: { filename: 'arm_bracket.step' } }),
    );
    expect(out).toContain('(file: arm_bracket.step)');
  });
});

const summary = (
  id: string,
  parent: string | null,
  position: number,
): NoteDocSummary => ({
  id,
  parent_doc_id: parent,
  meeting_id: null,
  position,
  title: id,
  content_bytes: 0,
  created_by: null,
  updated_by: null,
  created_at: 0,
  updated_at: 0,
});

describe('buildTree', () => {
  it('nests children under parents, ordered by position', () => {
    const tree = buildTree([
      summary('b', null, 2048),
      summary('a', null, 1024),
      summary('a2', 'a', 2048),
      summary('a1', 'a', 1024),
    ]);
    expect(tree.map((n) => n.doc.id)).toEqual(['a', 'b']);
    expect(tree[0].children.map((n) => n.doc.id)).toEqual(['a1', 'a2']);
  });

  it('treats an orphan as a root rather than dropping it', () => {
    // A parent in another season, or one just deleted. A document nobody can see
    // is worse than one in a slightly wrong place.
    const tree = buildTree([summary('orphan', 'missing', 1024)]);
    expect(tree.map((n) => n.doc.id)).toEqual(['orphan']);
  });
});

describe('subtreeIds and eligibleParents', () => {
  const docs = [
    summary('root', null, 1024),
    summary('child', 'root', 1024),
    summary('grandchild', 'child', 1024),
    summary('elsewhere', null, 2048),
  ];

  it('collects a whole subtree, root included', () => {
    expect(subtreeIds(docs, 'root')).toEqual(
      new Set(['root', 'child', 'grandchild']),
    );
  });

  it('never offers a page its own descendant as a parent', () => {
    // The client half of the cycle guard. The server enforces the same rule; this
    // is what keeps the menu from offering a move that is going to 409 — including
    // the GRANDCHILD, which a one-level check would happily list.
    const parents = eligibleParents(docs, 'root').map((d) => d.id);
    expect(parents).toEqual(['elsewhere']);
    expect(parents).not.toContain('grandchild');
  });
});

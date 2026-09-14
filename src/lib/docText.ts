/**
 * ProseMirror JSON to markdown, and the tree helpers the sidebar and the drag
 * code share.
 *
 * `toMarkdown` is the descendant of toPlainText in the old lib/notes.ts, and it
 * survives for the reason that comment gave: "Copy notes" is the most-used thing
 * in the whole feature, because a team's actual channel is Discord and what gets
 * pasted there is what gets read.
 *
 * Pure and React-free, like the module it replaces.
 */
import type { NoteDocSummary } from '@/types';

export interface DocMark {
  type: string;
  attrs?: Record<string, unknown>;
}

export interface DocNode {
  type: string;
  text?: string;
  content?: DocNode[];
  attrs?: Record<string, unknown>;
  marks?: DocMark[];
}

/**
 * The href on a text node, if it carries a link mark.
 *
 * Marks were ignored entirely until now, which meant every URL in a note was
 * silently dropped on the way to the clipboard — the text survived, the link
 * did not. Given that what gets pasted into Discord IS the note, that lost the
 * single most useful thing a note can carry.
 */
function linkHref(node: DocNode): string | null {
  const mark = node.marks?.find((m) => m.type === 'link');
  const href = mark?.attrs?.href;
  return typeof href === 'string' && href.length > 0 ? href : null;
}

function inline(node: DocNode): string {
  if (node.type === 'text') {
    const text = node.text ?? '';
    const href = linkHref(node);
    // Bare autolinked URLs are the common case, and `[url](url)` is noise no
    // reader wants. Only wrap when the label actually differs from the target.
    if (!href || text === href) return text;
    return `[${text}](${href})`;
  }
  if (node.type === 'hardBreak') return '\n';
  return (node.content ?? []).map(inline).join('');
}

function block(node: DocNode, depth: number): string {
  const pad = '  '.repeat(depth);
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 2);
      return `\n${'#'.repeat(level)} ${inline(node)}`;
    }
    case 'bulletList':
      return (node.content ?? [])
        .map((item) => block(item, depth))
        .join('\n');
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1);
      return (node.content ?? [])
        .map((item, i) => {
          const body = (item.content ?? [])
            .map((child) => block(child, depth + 1))
            .join('\n')
            .trim();
          return `${pad}${start + i}. ${body}`;
        })
        .join('\n');
    }
    case 'listItem': {
      const body = (node.content ?? [])
        .map((child) => block(child, depth + 1))
        .join('\n')
        .trim();
      return `${pad}- ${body}`;
    }
    case 'taskList':
      return (node.content ?? []).map((item) => block(item, depth)).join('\n');
    case 'taskItem': {
      const done = node.attrs?.checked === true ? 'x' : ' ';
      const body = (node.content ?? []).map(inline).join('').trim();
      return `${pad}- [${done}] ${body}`;
    }
    case 'blockquote':
      return (node.content ?? [])
        .map((child) => `> ${block(child, depth).trim()}`)
        .join('\n');
    case 'codeBlock':
      return `\`\`\`\n${inline(node)}\n\`\`\``;
    case 'horizontalRule':
      return '---';
    case 'mediaImage': {
      const caption = typeof node.attrs?.alt === 'string' ? node.attrs.alt : '';
      return caption ? `(photo: ${caption})` : '(photo)';
    }
    case 'mediaFile': {
      // Without a case here the `default` falls through to inline(), which
      // returns '' for an atom — so the attachment would simply vanish from a
      // copied note, which is how most people read these.
      const filename =
        typeof node.attrs?.filename === 'string' ? node.attrs.filename : '';
      return filename ? `(file: ${filename})` : '(file)';
    }
    default:
      return inline(node);
  }
}

/** The document as markdown, for pasting somewhere a person will read it. */
export function toMarkdown(content: string): string {
  let doc: DocNode;
  try {
    doc = JSON.parse(content) as DocNode;
  } catch {
    return '';
  }
  return (doc.content ?? [])
    .map((node) => block(node, 0))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// -------------------------------------------------------------------- the tree

export interface DocTreeNode {
  doc: NoteDocSummary;
  children: DocTreeNode[];
}

/**
 * Build the tree the server deliberately did not send.
 *
 * The API returns a flat list plus parent pointers so ordering has exactly one
 * representation; this is where it becomes nested, and it is the same function
 * the drag code uses to work out which parents a document may legally move to.
 *
 * A row whose parent is missing from the list — deleted, or in another season —
 * is treated as a root rather than dropped, because a document nobody can see is
 * worse than one in a slightly wrong place.
 */
export function buildTree(docs: NoteDocSummary[]): DocTreeNode[] {
  const nodes = new Map<string, DocTreeNode>();
  for (const doc of docs) nodes.set(doc.id, { doc, children: [] });

  const roots: DocTreeNode[] = [];
  for (const doc of docs) {
    const node = nodes.get(doc.id)!;
    const parent = doc.parent_doc_id ? nodes.get(doc.parent_doc_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: DocTreeNode[]) => {
    list.sort((a, b) => a.doc.position - b.doc.position);
    for (const node of list) sort(node.children);
  };
  sort(roots);
  return roots;
}

/**
 * Every id in a subtree, including its root.
 *
 * The client half of the cycle guard: these are the documents a page may NOT be
 * moved under. The server enforces the same rule independently — this exists so
 * the menu does not offer a move that is going to 409.
 */
export function subtreeIds(docs: NoteDocSummary[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const doc of docs) {
    if (!doc.parent_doc_id) continue;
    const list = childrenOf.get(doc.parent_doc_id) ?? [];
    list.push(doc.id);
    childrenOf.set(doc.parent_doc_id, list);
  }

  const ids = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    for (const child of childrenOf.get(stack.pop()!) ?? []) {
      if (ids.has(child)) continue;
      ids.add(child);
      stack.push(child);
    }
  }
  return ids;
}

/** Documents a page may legally become a child of: everything but its own subtree. */
export function eligibleParents(
  docs: NoteDocSummary[],
  docId: string,
): NoteDocSummary[] {
  const forbidden = subtreeIds(docs, docId);
  return docs.filter((doc) => !forbidden.has(doc.id));
}

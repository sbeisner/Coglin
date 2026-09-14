/**
 * Note documents: the vocabulary, the bounds, and the content validator.
 *
 * No DB access and no Hono — the same split lib/meetings.ts keeps, so the parts
 * that are pure arithmetic and pure vocabulary can be reasoned about without a
 * request in scope.
 */

// ---------------------------------------------------------------------- bounds

/** One document. Past this it is a chapter, not a page. */
export const MAX_CONTENT_BYTES = 200_000;
export const MAX_TITLE = 200;
/** Documents per team per season. */
export const MAX_DOCS = 2_000;
/** Tree depth. Confluence stops being navigable well before this. */
export const MAX_DEPTH = 8;
/** Documents moved by one reparent, i.e. the size of a subtree. */
export const MAX_SUBTREE = 200;
/** Nodes in one document, so a hostile body cannot wedge the client renderer. */
export const MAX_NODES = 5_000;
/** Nesting depth WITHIN a document, which is a different thing from tree depth. */
export const MAX_NODE_DEPTH = 24;

// ------------------------------------------------------------ the doc schema

/**
 * The server's copy of the editor schema.
 *
 * Values first and the type derived, exactly as lib/meetings.ts explains: a
 * hand-written union beside a separate array drifted once and cost a 400 that
 * nobody could reproduce.
 *
 * The Worker has no ProseMirror schema to validate against, so an unknown node
 * type would round-trip into every future reader forever. `content` has no FK and
 * no CHECK, which makes validating it the Worker's job for the same reason
 * routes/candidates.ts validates a polymorphic source_id.
 */
export const DOC_NODE_TYPES = [
  'doc',
  'paragraph',
  'text',
  'heading',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'hardBreak',
  'horizontalRule',
  'mediaImage',
  'mediaFile',
] as const;
export type DocNodeType = (typeof DOC_NODE_TYPES)[number];

const NODE_TYPES: ReadonlySet<string> = new Set(DOC_NODE_TYPES);

export interface JsonNode {
  type: string;
  text?: string;
  content?: JsonNode[];
  attrs?: Record<string, unknown>;
  marks?: unknown[];
}

export type ContentError =
  | 'invalid_content'
  | 'content_too_large'
  | 'too_many_nodes';

/**
 * Bounds on the attributes of the nodes that carry any.
 *
 * `attrs` went unvalidated for as long as every attribute was an id or a number
 * put there by our own editor. `mediaFile.filename` is neither: it is text that
 * originates with whoever uploaded the file and gets rendered into a chip. Two
 * things follow that are worth a check. A 200KB filename fits comfortably under
 * MAX_CONTENT_BYTES inside one node, and a chip reading `budget.pdf` that
 * downloads `payload.stl` is a small social-engineering primitive — which is
 * why the client adopts the server's sanitised name rather than keeping its own.
 *
 * Deliberately narrow. Only the node types listed here are checked at all, and
 * only for the attributes named, so this stays a bound on known hazards rather
 * than a second schema to keep in sync with the editor.
 */
const MAX_ATTR_STRING = 120;
const MAX_ATTR_ID = 64;

function validAttrs(node: JsonNode): boolean {
  if (node.type !== 'mediaFile') return true;
  const attrs = node.attrs;
  if (attrs === undefined) return true;
  if (typeof attrs !== 'object' || attrs === null) return false;

  const { filename, size, mediaId, uploadId } = attrs as Record<string, unknown>;

  if (filename !== undefined && filename !== null) {
    if (typeof filename !== 'string' || filename.length > MAX_ATTR_STRING) {
      return false;
    }
  }
  if (size !== undefined && size !== null) {
    if (
      typeof size !== 'number' ||
      !Number.isFinite(size) ||
      size < 0 ||
      size > 25 * 1024 * 1024
    ) {
      return false;
    }
  }
  for (const id of [mediaId, uploadId]) {
    if (id === undefined || id === null) continue;
    if (typeof id !== 'string' || id.length > MAX_ATTR_ID) return false;
  }
  return true;
}

/**
 * Validate a document body and derive its plain text in one walk.
 *
 * Returns either the parsed doc plus its text projection, or a single error code.
 * One function so `content` and `content_text` cannot disagree: they are produced
 * from the same traversal, and the route writes both or neither.
 */
export function parseContent(
  value: unknown,
): { doc: JsonNode; text: string } | { error: ContentError } {
  if (typeof value !== 'string') return { error: 'invalid_content' };
  // Bytes, not characters. An emoji-heavy document is bigger than its length.
  if (new TextEncoder().encode(value).length > MAX_CONTENT_BYTES) {
    return { error: 'content_too_large' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: 'invalid_content' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { error: 'invalid_content' };
  }
  const doc = parsed as JsonNode;
  if (doc.type !== 'doc') return { error: 'invalid_content' };

  const parts: string[] = [];
  let nodes = 0;

  // Iterative, not recursive: a hand-forged 10,000-deep body would blow the
  // stack, and a RangeError is a 500 where this should be a 400.
  const stack: { node: JsonNode; depth: number }[] = [{ node: doc, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (!node || typeof node !== 'object' || typeof node.type !== 'string') {
      return { error: 'invalid_content' };
    }
    if (!NODE_TYPES.has(node.type)) return { error: 'invalid_content' };
    if (depth > MAX_NODE_DEPTH) return { error: 'invalid_content' };
    if (++nodes > MAX_NODES) return { error: 'too_many_nodes' };
    if (!validAttrs(node)) return { error: 'invalid_content' };

    if (node.type === 'text') {
      if (typeof node.text !== 'string') return { error: 'invalid_content' };
      parts.push(node.text);
    }
    // An attachment contributes its NAME to the text projection, unlike a photo,
    // which contributes nothing. content_text powers the notes search, and
    // `arm_bracket_v3.step` is usually the only searchable trace an attachment
    // leaves anywhere in the document.
    if (node.type === 'mediaFile') {
      const filename = node.attrs?.filename;
      if (typeof filename === 'string') parts.push(filename);
    }
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return { error: 'invalid_content' };
      // Reversed so the text projection comes out in document order despite the
      // stack. Getting this wrong makes every excerpt read backwards.
      for (let i = node.content.length - 1; i >= 0; i--) {
        stack.push({ node: node.content[i] as JsonNode, depth: depth + 1 });
      }
    }
    // A block boundary is a space, so "Chassis" and "notes" do not become
    // "Chassisnotes" in an excerpt or a LIKE.
    if (node.type !== 'text' && node.type !== 'doc') parts.push(' ');
  }

  return { doc, text: parts.join('').replace(/\s+/g, ' ').trim() };
}

/** An empty document, so a freshly created page has somewhere to put the caret. */
export function emptyDoc(): string {
  return JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
}

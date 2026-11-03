/**
 * The note document schema, shared by the editor and the Worker.
 *
 * Shared because live editing made the Worker a writer. The Durable Object that
 * hosts a live note turns stored ProseMirror JSON into a Yjs document and back,
 * and the first half of that needs a real ProseMirror schema. If the Worker's
 * schema and the editor's ever disagree, a node the Worker does not know is
 * dropped during seeding and the student's photo silently disappears, so there
 * is exactly one list and both sides build from it.
 *
 * Nothing here may import React or touch the DOM at module scope. The editor adds
 * its node views on top (components/notes/MediaImage.tsx and MediaFile.tsx); the
 * Worker uses these bare.
 *
 * worker/lib/notes.ts keeps its own DOC_NODE_TYPES allowlist on purpose: that is
 * a validator for bodies from the network, and it should keep failing closed
 * even if somebody adds an extension here.
 */
import { Node, getSchema, textblockTypeInputRule } from '@tiptap/core';
import type { Extensions } from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';
import Image from '@tiptap/extension-image';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import StarterKit from '@tiptap/starter-kit';

/**
 * A photo in a document, stored as a media id. See components/notes/MediaImage.tsx
 * for why it is an id and never a URL or base64.
 */
export const MediaImageNode = Image.extend({
  name: 'mediaImage',

  addAttributes() {
    return {
      mediaId: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-media-id'),
        renderHTML: (attributes) => {
          if (!attributes.mediaId) return {};
          return {
            'data-media-id': attributes.mediaId,
            src: `/media/${attributes.mediaId}`,
          };
        },
      },
      /**
       * Transient, and never persisted with a value: it is how an in-flight
       * upload finds its own node again after the student kept typing and the
       * positions moved. Cleared when the media id arrives.
       */
      uploadId: { default: null, renderHTML: () => ({}) },
      width: { default: null },
      height: { default: null },
      alt: {
        default: '',
        parseHTML: (element) => element.getAttribute('alt') ?? '',
      },
    };
  },
}).configure({ inline: false, allowBase64: false });

/**
 * A CAD file or a PDF in a document, stored as a media id. See
 * components/notes/MediaFile.tsx for the reasoning behind each attribute.
 */
export const MediaFileNode = Node.create({
  name: 'mediaFile',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      mediaId: { default: null },
      /** Transient, exactly as MediaImage's is: how an in-flight upload finds
       *  its own node again after the writer kept typing. Never persisted. */
      uploadId: { default: null, renderHTML: () => ({}) },
      filename: { default: '' },
      size: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'a[data-media-file]' }];
  },

  /**
   * A real anchor, so a document rendered without the node view — a paste into
   * another page, a future read-only view — is still a working download rather
   * than an empty block.
   */
  renderHTML({ HTMLAttributes }) {
    const { mediaId, filename } = HTMLAttributes as {
      mediaId?: string;
      filename?: string;
    };
    return [
      'a',
      {
        'data-media-file': '',
        href: mediaId ? `/media/${mediaId}` : '#',
        download: filename || '',
      },
      filename || 'Attachment',
    ];
  },
});

/**
 * Heading, with the markdown ladder shifted down one rung.
 *
 * A note must not out-rank the page's own h1, so the levels stop at 2 and 3.
 * StarterKit's own rule maps hashes to levels literally, which meant "# " typed
 * nothing at all and cost every writer the same confused minute.
 *
 * So one hash is an h2 and two are an h3. Three clamps to h3 rather than falling
 * through as literal "### " text: there is no h4 to give, and silently swallowing
 * the keystrokes is the very failure this extension exists to fix.
 */
export const ShiftedHeading = Heading.extend({
  addInputRules() {
    return [
      textblockTypeInputRule({
        find: /^(#{1,3})\s$/,
        type: this.type,
        getAttributes: (match) => ({
          level: Math.min(match[1].length + 1, 3),
        }),
      }),
    ];
  },
}).configure({
  levels: [2, 3],
});

/**
 * Every extension that contributes to the schema, minus node views.
 *
 * `live` turns off StarterKit's undo history. Collaboration brings its own undo,
 * which only undoes YOUR edits; ProseMirror's would happily undo a teammate's
 * paragraph, and TipTap refuses to run both.
 */
export function docSchemaExtensions({
  live = false,
  mediaImage = MediaImageNode,
  mediaFile = MediaFileNode,
}: {
  live?: boolean;
  /** The editor passes the node-view versions; the Worker takes the defaults. */
  mediaImage?: typeof MediaImageNode;
  mediaFile?: typeof MediaFileNode;
} = {}): Extensions {
  return [
    StarterKit.configure({
      // Replaced wholesale by ShiftedHeading.
      heading: false,
      ...(live ? { undoRedo: false } : {}),
    }),
    ShiftedHeading,
    mediaImage,
    mediaFile,
    TaskList,
    TaskItem.configure({
      nested: true,
    }),
  ];
}

/** The ProseMirror schema the Worker seeds live documents with. */
export function docSchema() {
  return getSchema(docSchemaExtensions());
}

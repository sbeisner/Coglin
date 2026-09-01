import { useCallback, useEffect, useRef } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { textblockTypeInputRule } from '@tiptap/core';
import { Heading } from '@tiptap/extension-heading';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import { Placeholder } from '@tiptap/extensions';
import { ImagePlus } from 'lucide-react';
import { MediaImage } from '@/components/notes/MediaImage';
import { useDocImages } from '@/components/notes/useDocImages';
import { Button } from '@/components/ui/button';

/**
 * The document editor.
 *
 * TipTap, after the block editor it replaces spent 667 lines arguing against a
 * rich-text engine. That argument was sound and its premise is gone: textareas
 * were chosen because a student had to flag one PARAGRAPH, which meant every
 * paragraph needed to be an addressable server row. Flagging is per document now,
 * so the constraint that ruled out ProseMirror no longer exists — and the two
 * things that comment apologised for, undo across the document and selecting
 * across paragraphs, work for free.
 *
 * The markdown the user asked for is StarterKit's input rules, not a parser:
 * typing "- " becomes a real bullet, "# " a heading, "1. " an auto-continuing
 * numbered list, and Tab/Shift-Tab nest via ListItem's own shortcuts. Storage
 * stays ProseMirror JSON — see migrations/0006 on why not markdown and why not
 * HTML.
 */

export function DocEditor({
  docId,
  initialContent,
  editable,
  onChange,
  onReady,
  placeholder = 'Start typing…',
}: {
  docId: string;
  /** ProseMirror JSON as a string. Read ONCE — see the seeding rule below. */
  initialContent: string;
  editable: boolean;
  /**
   * Hands back a getter rather than the document. Serialising per keystroke on a
   * school Chromebook is measurable; the queue calls this once per save.
   */
  onChange: (getJSON: () => string, immediate?: boolean) => void;
  onReady?: (editor: { setContent: (content: string) => void }) => void;
  /**
   * The empty-document prompt. A parameter because this editor now serves two
   * documents: meeting notes, where "Start typing…" is right because the person
   * already knows what they came to write, and campaign pitch copy, where a
   * blank page is genuinely hard to start and the prompt is the help.
   */
  placeholder?: string;
}) {
  const editor = useEditor(
    {
      editable,
      extensions: [
        StarterKit.configure({
          // Replaced wholesale by ShiftedHeading below.
          heading: false,
        }),
        ShiftedHeading,
        Placeholder.configure({
          placeholder,
        }),
        MediaImage,
        TaskList,
        TaskItem.configure({
          nested: true,
        }),
      ],
      content: safeParse(initialContent),
      editorProps: {
        attributes: {
          class:
            'note-prose focus:outline-none min-h-[8rem] px-1 py-2 md:px-2',
        },
      },
      onUpdate: ({ editor: instance }) => {
        onChange(() => JSON.stringify(instance.getJSON()));
      },
    },
    // Keyed on the document so switching pages builds a fresh instance rather
    // than calling setContent, which would destroy the caret and the undo stack.
    [docId],
  );

  const images = useDocImages(editor);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editor || !onReady) return;
    onReady({
      // The ONLY sanctioned setContent callers are explicit user acts: restoring
      // a local draft, and choosing the server's copy after a conflict. Never a
      // poll — see the seeding rule in routes/Meeting.tsx's ancestor comment.
      setContent: (content: string) => {
        editor.commands.setContent(safeParse(content));
      },
    });
  }, [editor, onReady]);

  const pickFiles = useCallback(
    (files: FileList | null) => {
      if (!files || files.length === 0) return;
      images.insert(Array.from(files));
    },
    [images],
  );

  if (!editor) return null;

  return (
    <div>
      <EditorContent editor={editor} />

      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            multiple
            className="sr-only"
            onChange={(event) => {
              pickFiles(event.target.files);
              // Reset so picking the same photo twice still fires a change.
              event.target.value = '';
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-11 md:min-h-9"
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus className="size-4" aria-hidden />
            Add a photo
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A body the editor can load, whatever the column actually held.
 *
 * An empty string is what a freshly created row has before its first save, and a
 * corrupt body should render as an empty page rather than a white screen — the
 * notes are still on the server either way, and a crash here would hide them.
 */
function safeParse(content: string): object {
  if (!content) return { type: 'doc', content: [{ type: 'paragraph' }] };
  try {
    return JSON.parse(content) as object;
  } catch {
    return { type: 'doc', content: [{ type: 'paragraph' }] };
  }
}

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
const ShiftedHeading = Heading.extend({
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

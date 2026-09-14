import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useSyncExternalStore } from 'react';
import { Paperclip } from 'lucide-react';
import { formatBytes } from '@/lib/format';
import { subscribeUploads, uploadState } from '@/components/notes/useDocImages';

/**
 * A CAD file or a PDF in a document, stored as a media id.
 *
 * Deliberately NOT an extension of @tiptap/extension-image the way MediaImage
 * is: an <img> pointing at a STEP file is nonsense, and Image's src and
 * allowBase64 machinery has no meaning for bytes nobody will ever render. This
 * is a plain atom that renders as a download chip.
 *
 * `filename` is held on the node as well as in the media row so the chip can be
 * drawn before the upload finishes — but the value written after the upload is
 * the SERVER's sanitised one, never the browser's. A chip reading `budget.pdf`
 * that downloads something else is a small social-engineering primitive, and the
 * two copies agreeing by construction is cheaper than checking.
 *
 * The href is /media/:id and the server sends it back as an attachment with a
 * nosniff, octet-stream, sandboxed CSP response — see the kind === 'file' branch
 * in worker/routes/media.ts for why all four of those are load-bearing.
 */
export const MediaFile = Node.create({
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

  addNodeView() {
    return ReactNodeViewRenderer(MediaFileView);
  },
});

function MediaFileView({ node }: NodeViewProps) {
  const mediaId = node.attrs.mediaId as string | null;
  const uploadId = node.attrs.uploadId as string | null;
  const filename = (node.attrs.filename as string) || 'Attachment';
  const size = node.attrs.size as number | null;

  const pending = useSyncExternalStore(subscribeUploads, () =>
    uploadId ? uploadState(uploadId) : null,
  );

  const extension = filename.split('.').pop()?.toUpperCase() ?? '';
  const meta = [extension, size ? formatBytes(size) : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <NodeViewWrapper>
      <div className="my-3" contentEditable={false}>
        <div className="border-border bg-card relative flex items-center gap-3 overflow-hidden rounded-md border px-3 py-2.5">
          <Paperclip className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            {mediaId ? (
              /* No target=_blank: the response is Content-Disposition:
                 attachment, so this downloads rather than navigating. */
              <a
                href={`/media/${mediaId}`}
                download={filename}
                className="text-primary-ink block truncate text-sm font-medium underline underline-offset-2"
              >
                {filename}
              </a>
            ) : (
              <span className="block truncate text-sm font-medium">{filename}</span>
            )}
            {meta && (
              <span className="text-muted-foreground text-xs">{meta}</span>
            )}
          </div>

          {pending && pending.status === 'uploading' && (
            <div
              role="progressbar"
              aria-valuenow={Math.round(pending.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Uploading ${filename}`}
              className="bg-primary absolute bottom-0 left-0 h-1 transition-[width]"
              style={{ width: `${Math.round(pending.progress * 100)}%` }}
            />
          )}
        </div>

        {pending && pending.status === 'failed' && (
          <div
            role="alert"
            className="text-destructive mt-1 flex flex-wrap items-center gap-2 text-sm"
          >
            {/* The chip is kept on failure, so Retry does not begin with the
                student finding the file on their machine all over again. */}
            <span>{pending.error}</span>
            <button
              type="button"
              className="underline underline-offset-2"
              onClick={() => pending.retry()}
            >
              Retry
            </button>
          </div>
        )}
      </div>
    </NodeViewWrapper>
  );
}

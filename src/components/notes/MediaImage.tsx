import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { useSyncExternalStore } from 'react';
import { subscribeUploads, uploadState } from '@/components/notes/useDocImages';
import { MediaImageNode } from '../../../shared/docSchema';

/**
 * A photo in a document, stored as a media id.
 *
 * NOT a resolved URL: /media/:id is auth-gated and the R2 key is server-side
 * only, so a baked URL would break the moment the storage layout moved and would
 * hide the reference from the media retention sweep.
 *
 * allowBase64 is OFF and that is load-bearing, not tidiness. Two phone photos as
 * data URLs blow the 5MB localStorage quota the draft parachute lives in — see
 * writeDraft in lib/useDocSync.ts — and base64 in `content` would also put image
 * bytes in D1 and therefore in the nightly R2 dump, which worker/backup.test.ts
 * already asserts against. That existing test guards this format for free.
 *
 * The schema half lives in shared/docSchema.ts, because the Worker builds live
 * documents from it; only the React node view is here.
 */
export const MediaImage = MediaImageNode.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MediaImageView);
  },
});

function MediaImageView({ node, updateAttributes, editor }: NodeViewProps) {
  const mediaId = node.attrs.mediaId as string | null;
  const uploadId = node.attrs.uploadId as string | null;
  const width = node.attrs.width as number | null;
  const height = node.attrs.height as number | null;
  const alt = (node.attrs.alt as string) ?? '';

  const pending = useSyncExternalStore(
    subscribeUploads,
    () => (uploadId ? uploadState(uploadId) : null),
  );
  const src = mediaId ? `/media/${mediaId}` : pending?.previewUrl;

  return (
    <NodeViewWrapper>
      <figure className="my-3">
        <div
          className="bg-muted relative overflow-hidden rounded-md"
          /* The box is reserved from the file's intrinsic size before the upload
             lands, so the paragraphs below do not jump when it arrives. */
          style={
            width && height
              ? { aspectRatio: `${width} / ${height}`, maxHeight: '60vh' }
              : undefined
          }
        >
          {src && (
            <img
              src={src}
              alt={alt}
              className="h-full max-h-[60vh] w-full object-contain"
            />
          )}
          {pending && pending.status === 'uploading' && (
            <div
              role="progressbar"
              aria-valuenow={Math.round(pending.progress * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Uploading photo"
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
            {/* The thumbnail is kept on failure. A retry that first makes the
                student find the photo again is not a retry. */}
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

        {editor.isEditable && (
          <input
            value={alt}
            placeholder="Caption (optional)"
            aria-label="Photo caption"
            onChange={(event) => updateAttributes({ alt: event.target.value })}
            className="text-muted-foreground mt-1 w-full bg-transparent text-sm focus:outline-none"
          />
        )}
        {!editor.isEditable && alt && (
          <figcaption className="text-muted-foreground mt-1 text-sm">{alt}</figcaption>
        )}
      </figure>
    </NodeViewWrapper>
  );
}

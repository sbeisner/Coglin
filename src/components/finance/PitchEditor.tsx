/**
 * The pitch: what the team says to a business to ask for money.
 *
 * This is DocPane from the notes screen in miniature (src/routes/Notes.tsx),
 * against a campaign instead of a note document. The whole save queue is
 * reused through `pitchSyncAdapter` — same debounce, same retry ladder, same
 * localStorage parachute, same non-retryable conflict — because the failure
 * modes are identical: a student typing on school wifi, two students editing
 * the night before a deadline.
 *
 * The editor is lazy-loaded for the reason Notes.tsx loads it lazily: TipTap and
 * ProseMirror are a large chunk, and most visits to the Finance section never
 * open the pitch.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import {
  clearDraft,
  pitchSyncAdapter,
  readDraft,
  useDocSync,
} from '@/lib/useDocSync';
import { SaveIndicator } from '@/components/notes/SaveIndicator';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import type { SponsorshipCampaign } from '@/types';

const DocEditor = lazy(() =>
  import('@/components/notes/DocEditor').then((m) => ({ default: m.DocEditor })),
);

export function PitchEditor({
  campaignId,
  canEdit,
}: {
  campaignId: string;
  canEdit: boolean;
}) {
  const [campaign, setCampaign] = useState<SponsorshipCampaign | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [draftOffer, setDraftOffer] = useState<{ content: string } | null>(null);

  const { state, enqueue, flushNow, setBaseRev, keepMine, discardMine } = useDocSync(
    campaignId,
    canEdit,
    pitchSyncAdapter,
  );

  /** The body as the editor currently holds it, for conflict resolution. */
  const latest = useRef<(() => string) | null>(null);
  const editorRef = useRef<{ setContent: (content: string) => void } | null>(null);

  // The single read carries the pitch body; the list deliberately does not.
  useEffect(() => {
    let cancelled = false;
    setCampaign(null);
    setLoadError(false);
    api
      .getCampaign(campaignId)
      .then((fresh) => {
        if (cancelled) return;
        setCampaign(fresh);
        setBaseRev(fresh.rev);
        // A draft newer than the server's copy means a save never landed —
        // wifi died, or a session expired. Offer it rather than silently
        // picking a side.
        const draft = readDraft(campaignId, pitchSyncAdapter);
        if (draft && draft.savedAt > fresh.updated_at * 1000) {
          setDraftOffer({ content: draft.content });
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, setBaseRev]);

  const onChange = useCallback(
    (getJSON: () => string, immediate?: boolean) => {
      latest.current = getJSON;
      enqueue(getJSON, immediate);
    },
    [enqueue],
  );

  /** Take the server's copy: re-read it and put it in the editor. */
  const loadTheirs = useCallback(async () => {
    const fresh = await api.getCampaign(campaignId);
    setCampaign(fresh);
    editorRef.current?.setContent(fresh.pitch ?? '');
    discardMine(fresh.rev);
  }, [campaignId, discardMine]);

  if (loadError) {
    return (
      <p role="alert" className="text-destructive text-sm">
        Could not load the pitch. Reload the page.
      </p>
    );
  }

  if (!campaign) return <Skeleton className="h-40" />;

  return (
    <div className="space-y-3">
      {draftOffer && (
        <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3">
          <p className="min-w-0 flex-1 text-sm">
            There are unsaved changes on this device from a previous visit.
          </p>
          <Button
            size="sm"
            onClick={() => {
              editorRef.current?.setContent(draftOffer.content);
              // Structural, so it goes immediately rather than waiting for a
              // keystroke that may never come.
              enqueue(() => draftOffer.content, true);
              setDraftOffer(null);
            }}
          >
            Restore them
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              clearDraft(campaignId, pitchSyncAdapter);
              setDraftOffer(null);
            }}
          >
            Discard
          </Button>
        </div>
      )}

      <div className="bg-card border-border rounded-lg border px-3 py-2 md:px-4">
        <Suspense fallback={<Skeleton className="h-40" />}>
          <DocEditor
            docId={campaignId}
            initialContent={campaign.pitch ?? ''}
            editable={canEdit}
            onChange={onChange}
            onReady={(editor) => {
              editorRef.current = editor;
            }}
            placeholder="Why should a local business back this team? What do they get?"
          />
        </Suspense>
      </div>

      {canEdit && (
        <div className="flex items-center justify-between gap-3">
          <SaveIndicator
            status={state.status}
            savedAt={state.savedAt}
            subject="pitch"
            onRetry={flushNow}
            onKeepMine={() => {
              // Re-read to learn the server's rev, then overwrite it. The person
              // asked for this, having been shown what they would lose.
              void api.getCampaign(campaignId).then((fresh) => keepMine(fresh.rev));
            }}
            onLoadTheirs={() => void loadTheirs()}
          />
          <span className="text-muted-foreground text-xs">
            Images go in the team library.
          </span>
        </div>
      )}
    </div>
  );
}

import { formatTime } from '@/lib/format';
import type { SyncStatus } from '@/lib/useDocSync';

/**
 * Save state as one quiet line, not a toast.
 *
 * Every message here is a persistent STATE — saved, saving, not saved, in
 * conflict — and a toast that disappears while the wifi is still down is a lie. On
 * a phone it would also land under the tab bar and the keyboard.
 *
 * Moved verbatim from the meeting screen, plus the conflict branch, which is the
 * one state that must not resolve itself: retrying a stale write forever is the
 * failure mode, so it asks instead of spinning.
 */
export function SaveIndicator({
  status,
  savedAt,
  onRetry,
  onKeepMine,
  onLoadTheirs,
  subject = 'page',
}: {
  status: SyncStatus;
  savedAt: number | null;
  onRetry: () => void;
  onKeepMine: () => void;
  onLoadTheirs: () => void;
  /**
   * What the person is editing, for the conflict sentence. A parameter because
   * this indicator now serves note pages and campaign pitches, and "somebody
   * edited this page" is wrong about the second one.
   */
  subject?: string;
}) {
  if (status === 'conflict') {
    return (
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/10 text-destructive flex flex-wrap items-center gap-3 rounded-md border px-3 py-2 text-sm"
      >
        <span>Somebody else edited this {subject} while you were typing.</span>
        <button
          type="button"
          onClick={onKeepMine}
          className="focus-visible:ring-ring min-h-11 font-medium underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Keep mine
        </button>
        <button
          type="button"
          onClick={onLoadTheirs}
          className="focus-visible:ring-ring min-h-11 font-medium underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Load theirs
        </button>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div
        role="alert"
        className="border-destructive/40 bg-destructive/10 text-destructive flex items-center gap-3 rounded-md border px-3 py-2 text-sm"
      >
        <span>Not saved — retrying.</span>
        <button
          type="button"
          onClick={onRetry}
          className="focus-visible:ring-ring min-h-11 font-medium underline focus-visible:ring-2 focus-visible:outline-none"
        >
          Retry now
        </button>
      </div>
    );
  }

  return (
    <p aria-live="polite" className="text-muted-foreground text-xs">
      {status === 'saving' && 'Saving…'}
      {status === 'saved' && savedAt && `Saved · ${formatTime(Math.floor(savedAt / 1000))}`}
      {status === 'idle' && ' '}
    </p>
  );
}

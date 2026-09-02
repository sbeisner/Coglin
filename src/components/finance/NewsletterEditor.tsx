/**
 * Write a sponsor update, then take it somewhere that can actually send it.
 *
 * COGLIN DOES NOT SEND THESE, and this component is where a person meets that
 * fact. There are two copy buttons and a "mark sent" — the team pastes the text
 * and the addresses into their own mail, sends it, and records that they did.
 * `scheduled_for` is a date the list nudges about; pressing nothing makes
 * nothing happen. See migrations/0011_newsletters.sql for the two blockers
 * standing between this and real delivery.
 *
 * The body reuses the notes editor and its save queue through
 * `newsletterSyncAdapter` — third document type on the same machinery.
 */
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Users } from 'lucide-react';
import * as api from '@/lib/api';
import {
  clearDraft,
  newsletterSyncAdapter,
  readDraft,
  useDocSync,
} from '@/lib/useDocSync';
import { toMarkdown } from '@/lib/docText';
import { SaveIndicator } from '@/components/notes/SaveIndicator';
import { Skeleton } from '@/components/Skeleton';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isSubscribed, type ExternalContact, type Newsletter } from '@/types';

const DocEditor = lazy(() =>
  import('@/components/notes/DocEditor').then((m) => ({ default: m.DocEditor })),
);

const ERROR_COPY: Record<string, string> = {
  missing_title: 'Give the update a title.',
  invalid_status: 'That is not something an edit can set.',
  invalid_scheduled_for: 'Pick a date.',
  already_sent: 'This one is already marked sent. Reload the page.',
  forbidden: 'Viewers cannot edit updates.',
  not_found: 'That update is already gone. Reload the page.',
};

function toDateInput(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function NewsletterEditor({
  newsletterId,
  contacts,
  canEdit,
  onOpenChange,
  onChanged,
}: {
  newsletterId: string | null;
  contacts: ExternalContact[];
  canEdit: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  return (
    <Dialog open={newsletterId !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {/* The hooks live in the inner component so they mount and unmount with
            the dialog rather than running against a null id. */}
        {newsletterId !== null && (
          <Body
            newsletterId={newsletterId}
            contacts={contacts}
            canEdit={canEdit}
            onClose={() => onOpenChange(false)}
            onChanged={onChanged}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  newsletterId,
  contacts,
  canEdit,
  onClose,
  onChanged,
}: {
  newsletterId: string;
  contacts: ExternalContact[];
  canEdit: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [newsletter, setNewsletter] = useState<Newsletter | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [title, setTitle] = useState('');
  const [scheduledFor, setScheduledFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<'text' | 'addresses' | null>(null);
  const [draftOffer, setDraftOffer] = useState<{ content: string } | null>(null);

  const { state, enqueue, flushNow, setBaseRev, keepMine, discardMine } = useDocSync(
    newsletterId,
    canEdit,
    newsletterSyncAdapter,
  );

  const latest = useRef<(() => string) | null>(null);
  const editorRef = useRef<{ setContent: (content: string) => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .getNewsletter(newsletterId)
      .then((fresh) => {
        if (cancelled) return;
        setNewsletter(fresh);
        setTitle(fresh.title);
        setScheduledFor(fresh.scheduled_for ? toDateInput(fresh.scheduled_for) : '');
        setBaseRev(fresh.rev);
        const draft = readDraft(newsletterId, newsletterSyncAdapter);
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
  }, [newsletterId, setBaseRev]);

  const onChange = useCallback(
    (getJSON: () => string, immediate?: boolean) => {
      latest.current = getJSON;
      enqueue(getJSON, immediate);
    },
    [enqueue],
  );

  const act = useCallback(
    async (fn: () => Promise<Newsletter>) => {
      setError(null);
      try {
        const fresh = await fn();
        setNewsletter(fresh);
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : '');
      }
    },
    [onChanged],
  );

  const subscribed = contacts.filter(isSubscribed);

  /**
   * The copy-out. Plain text via toMarkdown rather than HTML, because nothing
   * in this codebase renders ProseMirror JSON to HTML yet — 0011 names that as
   * one of the two blockers for real sending. Text pastes into any mail client
   * and loses only the formatting, which is the right trade for an update whose
   * value is the words.
   */
  async function copyText() {
    if (!newsletter) return;
    const body = latest.current
      ? toMarkdown(latest.current())
      : toMarkdown(newsletter.body ?? '');
    await navigator.clipboard.writeText(`${newsletter.title}\n\n${body}`);
    setCopied('text');
    setTimeout(() => setCopied(null), 2000);
  }

  async function copyAddresses() {
    await navigator.clipboard.writeText(subscribed.map((c) => c.email).join(', '));
    setCopied('addresses');
    setTimeout(() => setCopied(null), 2000);
  }

  if (loadError) {
    return (
      <p role="alert" className="text-destructive py-6 text-sm">
        Could not load that update. Reload the page.
      </p>
    );
  }
  if (!newsletter) return <Skeleton className="h-64" />;

  const sent = newsletter.status === 'sent';

  return (
    <>
      <DialogHeader>
        <DialogTitle>{sent ? 'Sent update' : 'Sponsor update'}</DialogTitle>
        <DialogDescription>
          {sent
            ? `Marked sent to ${newsletter.recipient_count ?? 0} ${
                newsletter.recipient_count === 1 ? 'contact' : 'contacts'
              }.`
            : `Coglin does not send these. Copy the text and the addresses, send it from your own mail, then mark it sent.`}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4 py-4">
        <div className="space-y-1.5">
          <Label htmlFor="newsletter-title">Title</Label>
          <Input
            id="newsletter-title"
            value={title}
            maxLength={200}
            readOnly={!canEdit}
            placeholder="What your sponsorship built this autumn"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => {
              if (canEdit && title.trim() !== '' && title !== newsletter.title) {
                void act(() => api.updateNewsletter(newsletterId, { title: title.trim() }));
              }
            }}
          />
        </div>

        {draftOffer && (
          <div className="border-border bg-card flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2">
            <p className="min-w-0 flex-1 text-sm">
              There are unsaved changes on this device from a previous visit.
            </p>
            <Button
              size="sm"
              onClick={() => {
                editorRef.current?.setContent(draftOffer.content);
                enqueue(() => draftOffer.content, true);
                setDraftOffer(null);
              }}
            >
              Restore
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                clearDraft(newsletterId, newsletterSyncAdapter);
                setDraftOffer(null);
              }}
            >
              Discard
            </Button>
          </div>
        )}

        <div className="space-y-1.5">
          <Label>The update</Label>
          <div className="border-border max-h-80 overflow-y-auto rounded-lg border px-3 py-2">
            <Suspense fallback={<Skeleton className="h-32" />}>
              <DocEditor
                docId={newsletterId}
                initialContent={newsletter.body ?? ''}
                editable={canEdit}
                onChange={onChange}
                onReady={(editor) => {
                  editorRef.current = editor;
                }}
                placeholder="What the team has been doing, and what their money paid for."
              />
            </Suspense>
          </div>
          {canEdit && (
            <SaveIndicator
              status={state.status}
              savedAt={state.savedAt}
              subject="update"
              onRetry={flushNow}
              onKeepMine={() => {
                void api.getNewsletter(newsletterId).then((fresh) => keepMine(fresh.rev));
              }}
              onLoadTheirs={() => {
                void api.getNewsletter(newsletterId).then((fresh) => {
                  setNewsletter(fresh);
                  editorRef.current?.setContent(fresh.body ?? '');
                  discardMine(fresh.rev);
                });
              }}
            />
          )}
        </div>

        {canEdit && !sent && (
          <div className="space-y-1.5">
            <Label htmlFor="newsletter-when">Aim to send</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="newsletter-when"
                type="date"
                value={scheduledFor}
                onChange={(e) => {
                  setScheduledFor(e.target.value);
                  const when = e.target.value
                    ? Math.floor(new Date(`${e.target.value}T00:00`).getTime() / 1000)
                    : null;
                  void act(() =>
                    api.updateNewsletter(newsletterId, {
                      scheduled_for: when,
                      status: when === null ? 'draft' : 'scheduled',
                    }),
                  );
                }}
                className="w-44"
              />
              {/* Says plainly what the date does, so nobody waits for a send
                  that is never coming. */}
              <span className="text-muted-foreground text-xs">
                A reminder for the team — nothing sends on its own.
              </span>
            </div>
          </div>
        )}

        {/* The actual way this update reaches anybody. */}
        <div className="border-border space-y-2 rounded-lg border border-dashed px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => void copyText()}>
              {copied === 'text' ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
              {copied === 'text' ? 'Copied' : 'Copy the update'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={subscribed.length === 0}
              onClick={() => void copyAddresses()}
            >
              {copied === 'addresses' ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Users className="size-4" aria-hidden />
              )}
              {copied === 'addresses'
                ? 'Copied'
                : `Copy ${subscribed.length} ${subscribed.length === 1 ? 'address' : 'addresses'}`}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            Paste both into your own mail. The text comes out plain — formatting
            and images do not travel yet.
          </p>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive mb-4 text-sm">
          {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
        </p>
      )}

      <DialogFooter className="gap-2 sm:justify-between">
        {canEdit ? (
          sent ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() =>
                void act(() => api.updateNewsletter(newsletterId, { status: 'draft' }))
              }
            >
              Reopen as a draft
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => {
                // Flush the editor first: marking it sent while a keystroke is
                // still in the debounce would record a send of an older draft.
                flushNow();
                void act(() => api.markNewsletterSent(newsletterId));
              }}
            >
              I have sent this
            </Button>
          )
        ) : (
          <span />
        )}
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </DialogFooter>
    </>
  );
}

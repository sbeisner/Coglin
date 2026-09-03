/**
 * The season's sponsor updates.
 *
 * Sent ones first as the record of what the team has actually told its
 * sponsors — the thing a Sustain narrative can point at — then whatever is
 * still being written.
 */
import { useCallback, useState } from 'react';
import { Plus } from 'lucide-react';
import * as api from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { NewsletterEditor } from './NewsletterEditor';
import {
  NEWSLETTER_STATUS_LABELS,
  type ExternalContact,
  type Newsletter,
  type NewsletterStatus,
} from '@/types';

const ERROR_COPY: Record<string, string> = {
  missing_title: 'Give the update a title.',
  no_current_season: 'This team has no current season yet.',
  forbidden: 'Viewers cannot write updates.',
  not_found: 'That update is already gone.',
};

const STATUS_CLASS: Record<NewsletterStatus, string> = {
  draft: 'border-border text-muted-foreground border',
  scheduled: 'bg-accent text-accent-foreground',
  sent: 'bg-primary/10 text-primary-ink',
};

export function NewslettersSection({
  newsletters,
  contacts,
  subscriberCount,
  canEdit,
  onChanged,
}: {
  newsletters: Newsletter[];
  contacts: ExternalContact[];
  subscriberCount: number;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = api.now();

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
        onChanged();
      } catch (err) {
        setError(err instanceof Error ? err.message : '');
      }
    },
    [onChanged],
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">
          Written here, sent from your own mail.
        </p>
        {canEdit && !creating && (
          <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            Write an update
          </Button>
        )}
      </div>

      {creating && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={title}
            maxLength={200}
            autoFocus
            placeholder="What your sponsorship built this autumn"
            aria-label="Update title"
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && title.trim() !== '') {
                e.preventDefault();
                void act(async () => {
                  const created = await api.createNewsletter({ title: title.trim() });
                  setTitle('');
                  setCreating(false);
                  setOpenId(created.id);
                });
              }
            }}
            className="min-h-11 min-w-48 flex-1 md:min-h-9"
          />
          <Button
            size="sm"
            disabled={title.trim() === ''}
            onClick={() =>
              void act(async () => {
                const created = await api.createNewsletter({ title: title.trim() });
                setTitle('');
                setCreating(false);
                setOpenId(created.id);
              })
            }
          >
            Start writing
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
        </p>
      )}

      {newsletters.length === 0 ? (
        <EmptyState
          title={canEdit ? 'No updates written yet.' : 'No updates yet.'}
          aside="A sponsor who hears nothing between September and next September's ask is a sponsor you are about to lose. One update a season is enough to change that."
          action={
            canEdit ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                Write an update
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="bg-card border-border divide-border divide-y rounded-lg border">
          {newsletters.map((n) => {
            // A date that has passed on something still unsent is the nudge —
            // the only thing a schedule does, since nothing sends itself.
            const overdue =
              n.status === 'scheduled' && n.scheduled_for !== null && n.scheduled_for < now;
            return (
              <li key={n.id} className="flex items-center gap-3 px-4 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setOpenId(n.id)}
                      className="focus-visible:ring-ring truncate text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {n.title}
                    </button>
                    <span
                      className={cn(
                        'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium',
                        STATUS_CLASS[n.status],
                      )}
                    >
                      {NEWSLETTER_STATUS_LABELS[n.status]}
                    </span>
                    {overdue && (
                      <span className="text-destructive shrink-0 text-[10px]">
                        past its date
                      </span>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-xs">
                    {n.status === 'sent' && n.sent_at
                      ? `Sent ${formatDate(n.sent_at)} to ${n.recipient_count ?? 0} ${
                          n.recipient_count === 1 ? 'contact' : 'contacts'
                        }`
                      : n.scheduled_for
                        ? `Aiming for ${formatDate(n.scheduled_for)}`
                        : (n.body_text.slice(0, 80) || 'Nothing written yet')}
                  </p>
                </div>
                {canEdit && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-muted-foreground shrink-0"
                    onClick={() => void act(() => api.deleteNewsletter(n.id))}
                  >
                    Delete
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <NewsletterEditor
        newsletterId={openId}
        contacts={contacts}
        canEdit={canEdit}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        onChanged={onChanged}
      />

      {newsletters.length > 0 && subscriberCount === 0 && canEdit && (
        <p className="text-muted-foreground text-xs">
          Nobody is on the update list yet, so there is nowhere for these to go.
        </p>
      )}
    </div>
  );
}

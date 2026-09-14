/**
 * The agenda, finally interactive.
 *
 * Every route this needs has existed and been tested since 0003 — create,
 * update, delete, and a `done` flag on the row — but nothing in the client ever
 * called them. The meeting page rendered a read-only <ul> of titles, `item.done`
 * was read by no component at all, and the only way an agenda row could exist
 * was a seed script or a hand-rolled request. So "tick it off as you go", which
 * is the entire point of having an agenda during a meeting, was unreachable.
 *
 * Optimistic with rollback, copying onToggleWholeMeeting in routes/Meeting.tsx:
 * a checkbox that waits for a round trip before moving feels broken in a room
 * where somebody is reading the next item aloud.
 *
 * Reordering is deliberately absent. There is no reorder route — `position` is
 * only ever set on insert, by nextPosition() appending MAX + gap — so offering a
 * drag handle here would mean inventing the server half too. New items append.
 */
import { useEffect, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { AgendaItem } from '@/types';

const ERROR_COPY: Record<string, string> = {
  agenda_full: 'That is as many agenda items as one meeting can hold.',
  missing_title: 'Give the item a title.',
  not_found: 'That item is already gone. Someone else may have removed it.',
  forbidden: 'You do not have permission to change this agenda.',
};

export function AgendaPanel({
  meetingId,
  agenda,
  canEdit,
  /** Bigger type and roomier rows, for a projector at the back of a shop. */
  large = false,
  onChanged,
}: {
  meetingId: string;
  agenda: AgendaItem[];
  canEdit: boolean;
  large?: boolean;
  onChanged?: () => void;
}) {
  const [items, setItems] = useState<AgendaItem[]>(agenda);
  const [adding, setAdding] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The server's copy wins whenever the parent refetches. Local state exists
  // only so a tick lands instantly, not as a second source of truth.
  useEffect(() => setItems(agenda), [agenda]);

  function fail(err: unknown) {
    const code = err instanceof Error ? err.message : '';
    setError(ERROR_COPY[code] ?? 'That did not save. Try again.');
  }

  async function toggle(item: AgendaItem) {
    const next = item.done ? 0 : 1;
    setError(null);
    setItems((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, done: next } : i)),
    );
    try {
      await api.updateAgendaItem(meetingId, item.id, { done: next === 1 });
      onChanged?.();
    } catch (err) {
      setItems((prev) =>
        prev.map((i) => (i.id === item.id ? { ...i, done: item.done } : i)),
      );
      fail(err);
    }
  }

  async function add() {
    const title = adding.trim();
    if (!title) return;
    setPending(true);
    setError(null);
    try {
      const created = await api.createAgendaItem(meetingId, { title });
      setItems((prev) => [...prev, created]);
      setAdding('');
      onChanged?.();
    } catch (err) {
      fail(err);
    } finally {
      setPending(false);
    }
  }

  async function remove(item: AgendaItem) {
    const snapshot = items;
    setError(null);
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      await api.deleteAgendaItem(meetingId, item.id);
      onChanged?.();
    } catch (err) {
      setItems(snapshot);
      fail(err);
    }
  }

  const done = items.filter((i) => i.done).length;

  return (
    <section>
      <h2 className="u-eyebrow mb-3">
        Agenda{' '}
        {items.length > 0 && (
          <span className="tabular text-muted-foreground font-mono">
            {done}/{items.length}
          </span>
        )}
      </h2>

      {items.length > 0 && (
        <ul className="bg-card border-border divide-border divide-y rounded-lg border">
          {items.map((item) => (
            <li
              key={item.id}
              className={cn(
                'flex items-start gap-3 px-4',
                large ? 'py-4 text-lg' : 'py-3 text-sm',
              )}
            >
              <button
                type="button"
                role="checkbox"
                aria-checked={item.done === 1}
                aria-label={item.title}
                disabled={!canEdit}
                onClick={() => void toggle(item)}
                className={cn(
                  'focus-visible:ring-ring mt-0.5 flex shrink-0 items-center justify-center rounded border focus-visible:ring-2 focus-visible:outline-none disabled:opacity-50',
                  large ? 'size-6' : 'size-5',
                  item.done
                    ? 'bg-primary border-primary text-primary-foreground'
                    : 'border-border',
                )}
              >
                {item.done === 1 && (
                  <Check className={large ? 'size-4' : 'size-3.5'} aria-hidden />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    item.done === 1 && 'text-muted-foreground line-through',
                  )}
                >
                  {item.title}
                  {item.minutes_planned && (
                    <span className="text-muted-foreground tabular ml-2 font-mono text-xs">
                      {item.minutes_planned}m
                    </span>
                  )}
                </div>
                {/* `detail` has been on the row since 0003 and was never shown. */}
                {item.detail && (
                  <p
                    className={cn(
                      'text-muted-foreground mt-0.5',
                      large ? 'text-base' : 'text-xs',
                    )}
                  >
                    {item.detail}
                  </p>
                )}
              </div>

              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${item.title}`}
                  onClick={() => void remove(item)}
                  className="text-muted-foreground hover:text-destructive focus-visible:ring-ring shrink-0 rounded focus-visible:ring-2 focus-visible:outline-none"
                >
                  <X className="size-4" aria-hidden />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="mt-2 flex items-center gap-1">
          <Input
            value={adding}
            maxLength={200}
            disabled={pending}
            placeholder="Add an agenda item"
            aria-label="New agenda item"
            onChange={(e) => setAdding(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            className={large ? 'min-h-11 text-base' : 'min-h-11 md:min-h-9'}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={pending || adding.trim() === ''}
            onClick={() => void add()}
          >
            <Plus className="size-4" aria-hidden />
            Add
          </Button>
        </div>
      )}

      {items.length === 0 && !canEdit && (
        <p className="text-muted-foreground text-sm">Nothing on the agenda.</p>
      )}

      {error && (
        <p role="alert" className="text-destructive mt-2 text-sm">
          {error}
        </p>
      )}
    </section>
  );
}

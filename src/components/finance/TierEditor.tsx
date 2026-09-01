/**
 * What a sponsor gets for what they give.
 *
 * Up/down buttons rather than drag-and-drop: a campaign has three to six tiers,
 * the reorder route takes the whole list anyway, and drag on a phone in a pit is
 * the interaction this codebase has already decided to avoid where a button will
 * do (see the meeting calendar's day cells).
 */
import { useState } from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import * as api from '@/lib/api';
import { formatCents, parseDollars } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SponsorshipTier } from '@/types';

const ERROR_COPY: Record<string, string> = {
  missing_name: 'Give the tier a name.',
  invalid_amount: 'Enter an amount over $0.',
  too_many_tiers: 'Twelve tiers is the limit. Trim one first.',
  stale_order: 'The tiers changed while you were reordering. Reload the page.',
  forbidden: 'Viewers cannot edit the tiers.',
  not_found: 'That tier is already gone.',
};

export function TierEditor({
  campaignId,
  tiers,
  canEdit,
  onChanged,
}: {
  campaignId: string;
  tiers: SponsorshipTier[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountCents = parseDollars(amount);
  const canAdd = name.trim() !== '' && amountCents !== null;

  async function act(fn: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  async function add() {
    if (!canAdd || amountCents === null) return;
    await act(async () => {
      await api.createTier(campaignId, {
        name: name.trim(),
        amount_cents: amountCents,
      });
      setName('');
      setAmount('');
    });
  }

  /** Swap with the neighbour and send the whole list — see the header. */
  async function move(index: number, delta: number) {
    const next = index + delta;
    if (next < 0 || next >= tiers.length) return;
    const ids = tiers.map((t) => t.id);
    [ids[index], ids[next]] = [ids[next], ids[index]];
    await act(() => api.reorderTiers(campaignId, ids));
  }

  return (
    <div className="space-y-3">
      {tiers.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No tiers yet.{' '}
          {canEdit
            ? 'Three is typical — something a local business can say yes to, something a bigger one can.'
            : ''}
        </p>
      ) : (
        <ul className="bg-card border-border divide-border divide-y rounded-lg border">
          {tiers.map((tier, index) => (
            <li key={tier.id} className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{tier.name}</div>
                {tier.benefits && (
                  <p className="text-muted-foreground mt-0.5 text-xs">{tier.benefits}</p>
                )}
              </div>
              <span className="tabular shrink-0 font-mono text-sm">
                {formatCents(tier.amount_cents)}
              </span>
              {canEdit && (
                <span className="flex shrink-0 items-center gap-0.5">
                  <button
                    type="button"
                    aria-label={`Move ${tier.name} up`}
                    disabled={pending || index === 0}
                    onClick={() => void move(index, -1)}
                    className="focus-visible:ring-ring text-muted-foreground hover:text-primary-ink flex size-11 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30 md:size-7"
                  >
                    <ChevronUp className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move ${tier.name} down`}
                    disabled={pending || index === tiers.length - 1}
                    onClick={() => void move(index, 1)}
                    className="focus-visible:ring-ring text-muted-foreground hover:text-primary-ink flex size-11 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none disabled:opacity-30 md:size-7"
                  >
                    <ChevronDown className="size-4" aria-hidden />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${tier.name}`}
                    disabled={pending}
                    onClick={() => void act(() => api.deleteTier(campaignId, tier.id))}
                    className="focus-visible:ring-ring text-muted-foreground hover:text-destructive flex size-11 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:size-7"
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            maxLength={100}
            placeholder="Gold"
            aria-label="Tier name"
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 min-w-32 flex-1 md:min-h-9"
          />
          <Input
            value={amount}
            inputMode="decimal"
            placeholder="750.00"
            aria-label="Tier amount"
            onChange={(e) => setAmount(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void add();
              }
            }}
            className="tabular min-h-11 w-32 font-mono md:min-h-9"
          />
          <Button size="sm" disabled={pending || !canAdd} onClick={() => void add()}>
            <Plus className="size-4" aria-hidden />
            Add tier
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
        </p>
      )}
    </div>
  );
}

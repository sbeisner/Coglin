/**
 * Manage the pots: rename, re-date, choose the default, remove.
 *
 * A dialog rather than a tab because a team has three or four of these and
 * touches them twice a season — at setup and when a new allocation lands.
 */
import { useState } from 'react';
import { Check, Plus, Trash2 } from 'lucide-react';
import * as api from '@/lib/api';
import { formatCents, formatDate } from '@/lib/format';
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
import { cn } from '@/lib/utils';
import { fundRemaining, type Fund } from '@/types';

const ERROR_COPY: Record<string, string> = {
  missing_name: 'Give the fund a name.',
  invalid_expires_at: 'Pick a valid deadline.',
  too_many_funds: 'That is more funds than Coglin holds.',
  fund_in_use:
    'Ledger lines still point at this fund. Move them to another fund first — deleting it would erase which pot paid for them.',
  forbidden: 'Only coaches and mentors can change funds.',
  not_found: 'That fund is already gone.',
};

function toDateInput(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function FundsDialog({
  open,
  funds,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  funds: Fund[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [expires, setExpires] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Funds</DialogTitle>
          <DialogDescription>
            A fund with a deadline is use-or-lose; one without carries over. Next
            year&rsquo;s allocation is a new fund, not this one reset.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <ul className="bg-card border-border divide-border divide-y rounded-lg border">
            {funds.map((fund) => (
              <li key={fund.id} className="space-y-2 px-3 py-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{fund.name}</span>
                      {fund.is_default === 1 && (
                        <span className="border-primary text-primary-ink shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px]">
                          default
                        </span>
                      )}
                    </div>
                    <p className="text-muted-foreground mt-0.5 text-xs">
                      {fund.expires_at === null
                        ? 'Carries over'
                        : `Use by ${formatDate(fund.expires_at)}`}
                      {' · '}
                      {formatCents(fundRemaining(fund))} left
                    </p>
                  </div>
                  {fund.is_default !== 1 && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground shrink-0"
                      disabled={pending}
                      onClick={() => void act(() => api.setDefaultFund(fund.id))}
                    >
                      Make default
                    </Button>
                  )}
                  {confirming === fund.id ? (
                    <span className="flex shrink-0 items-center gap-2 text-xs">
                      Remove?
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={pending}
                        onClick={() =>
                          void act(async () => {
                            await api.deleteFund(fund.id);
                            setConfirming(null);
                          })
                        }
                      >
                        Remove
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirming(null)}
                      >
                        Keep
                      </Button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Remove ${fund.name}`}
                      disabled={pending}
                      onClick={() => setConfirming(fund.id)}
                      className="focus-visible:ring-ring text-muted-foreground hover:text-destructive flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:size-7"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>

                {/* The deadline is the only field worth editing inline: it is
                    the one that changes when a district confirms the money
                    rolls after all. */}
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    type="date"
                    aria-label={`Deadline for ${fund.name}`}
                    value={fund.expires_at === null ? '' : toDateInput(fund.expires_at)}
                    disabled={pending}
                    onChange={(e) =>
                      void act(() =>
                        api.updateFund(fund.id, {
                          expires_at: e.target.value
                            ? Math.floor(
                                new Date(`${e.target.value}T00:00`).getTime() / 1000,
                              )
                            : null,
                        }),
                      )
                    }
                    className="min-h-11 w-40 md:min-h-9"
                  />
                  {fund.expires_at !== null && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      disabled={pending}
                      onClick={() =>
                        void act(() => api.updateFund(fund.id, { expires_at: null }))
                      }
                    >
                      <Check className="size-4" aria-hidden />
                      Carries over instead
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          <div className="border-border space-y-2 rounded-lg border border-dashed p-3">
            <Label htmlFor="new-fund">Add a fund</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                id="new-fund"
                value={name}
                maxLength={120}
                placeholder="District allocation FY27"
                onChange={(e) => setName(e.target.value)}
                className="min-h-11 min-w-40 flex-1 md:min-h-9"
              />
              <Input
                type="date"
                value={expires}
                aria-label="Deadline (leave empty if it carries over)"
                onChange={(e) => setExpires(e.target.value)}
                className="min-h-11 w-40 md:min-h-9"
              />
              <Button
                size="sm"
                disabled={pending || name.trim() === ''}
                onClick={() =>
                  void act(async () => {
                    await api.createFund({
                      name: name.trim(),
                      expires_at: expires
                        ? Math.floor(new Date(`${expires}T00:00`).getTime() / 1000)
                        : null,
                    });
                    setName('');
                    setExpires('');
                  })
                }
              >
                <Plus className="size-4" aria-hidden />
                Add
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Leave the date empty for money that carries over. Record what is in
              it as an income line with the &ldquo;Opening balance&rdquo; category.
            </p>
          </div>
        </div>

        {error && (
          <p role="alert" className={cn('text-destructive mb-4 text-sm')}>
            {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
          </p>
        )}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

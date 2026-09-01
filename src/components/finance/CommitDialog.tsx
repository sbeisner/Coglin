/**
 * They said yes.
 *
 * Deliberately small: the only two questions are what to call them on the
 * sponsor list and how much they promised. Everything else is already on the
 * prospect.
 *
 * This records a PROMISE, and the copy says so — the money arriving is a
 * separate act, by a coach, on the ledger. Conflating the two would put income
 * in the books that the team does not have.
 */
import { useEffect, useState, type FormEvent } from 'react';
import * as api from '@/lib/api';
import { formatCents, parseDollars } from '@/lib/format';
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
import type { SponsorProspect, SponsorshipTier } from '@/types';

const ERROR_COPY: Record<string, string> = {
  missing_amount:
    'How much did they promise? There is no tier or estimate on this prospect to fall back on.',
  invalid_amount: 'Enter an amount over $0.',
  already_committed: 'This one is already a sponsor. Reload the page.',
  forbidden: 'Viewers cannot commit a sponsor.',
  not_found: 'That prospect is already gone. Reload the page.',
};

export function CommitDialog({
  prospect,
  tiers,
  onOpenChange,
  onChanged,
}: {
  prospect: SponsorProspect | null;
  tiers: SponsorshipTier[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!prospect) return;
    setError(null);
    setPending(false);
    setName(prospect.org_name);
    // The same fallback chain the server uses: what they pledged, else what
    // their tier costs, else blank and the person tells us.
    const tier = tiers.find((t) => t.id === prospect.tier_id);
    const prefill = prospect.pledged_cents ?? tier?.amount_cents ?? null;
    setAmount(prefill != null ? (prefill / 100).toFixed(2) : '');
  }, [prospect, tiers]);

  const amountCents = parseDollars(amount);
  const valid = name.trim() !== '' && amountCents !== null;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!prospect || !valid || amountCents === null) return;
    setPending(true);
    setError(null);
    try {
      await api.commitProspect(prospect.id, {
        name: name.trim(),
        amount_cents: amountCents,
      });
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={prospect !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Add them as a sponsor</DialogTitle>
            <DialogDescription>
              This records what they promised. When the money actually arrives, a
              coach records the payment against them on the ledger.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="commit-name">Name on the sponsor list</Label>
              <Input
                id="commit-name"
                value={name}
                maxLength={200}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="commit-amount">Amount promised</Label>
              <Input
                id="commit-amount"
                value={amount}
                inputMode="decimal"
                placeholder="750.00"
                onChange={(e) => setAmount(e.target.value)}
                className="tabular font-mono"
              />
              {prospect?.tier_name && (
                <p className="text-muted-foreground text-xs">
                  {prospect.tier_name} tier
                  {tiers.find((t) => t.id === prospect.tier_id) &&
                    ` · ${formatCents(
                      tiers.find((t) => t.id === prospect.tier_id)!.amount_cents,
                    )}`}
                </p>
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? 'Saving…' : 'Add sponsor'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

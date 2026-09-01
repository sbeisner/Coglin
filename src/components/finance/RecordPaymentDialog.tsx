/**
 * The cheque arrived: book it against this sponsor.
 *
 * A slim dialog rather than reusing TransactionDialog, deliberately. Every
 * choice that dialog offers — income or expense, which category, what label —
 * is already decided here: it is income, it is 'sponsorship', and it is named
 * after the sponsor. Offering those controls would be offering a way to get
 * this wrong, and the fixed caption below states the shape instead.
 *
 * Coach and mentor only, because this writes the ledger. Its own submit is
 * disabled while a request is in flight: a sponsor may legitimately pay twice,
 * so the server cannot refuse a repeat, which puts double-press protection here.
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
import { Textarea } from '@/components/ui/textarea';
import type { Sponsor } from '@/types';

const ERROR_COPY: Record<string, string> = {
  invalid_amount: 'Enter an amount over $0.',
  invalid_occurred_at: 'Pick the date the money arrived.',
  forbidden: 'Only coaches and mentors can record a payment.',
  not_found: 'That sponsor is already gone. Reload the page.',
};

function todayInput(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function RecordPaymentDialog({
  sponsor,
  onOpenChange,
  onChanged,
}: {
  sponsor: Sponsor | null;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sponsor) return;
    setError(null);
    setPending(false);
    setNote('');
    setDate(todayInput());
    // Prefill what is still outstanding rather than the whole pledge — the
    // common case for a second cheque, and correct for the first one too.
    const outstanding = sponsor.amount_cents - sponsor.paid_cents;
    setAmount(outstanding > 0 ? (outstanding / 100).toFixed(2) : '');
  }, [sponsor]);

  const amountCents = parseDollars(amount);
  const valid = amountCents !== null && date !== '';

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sponsor || !valid || amountCents === null) return;
    setPending(true);
    setError(null);
    try {
      await api.recordSponsorPayment(sponsor.id, {
        amount_cents: amountCents,
        occurred_at: Math.floor(new Date(`${date}T00:00`).getTime() / 1000),
        note: note.trim() === '' ? null : note.trim(),
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
    <Dialog open={sponsor !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>Record a payment</DialogTitle>
            <DialogDescription>
              {sponsor && (
                <>
                  {sponsor.name} promised {formatCents(sponsor.amount_cents)} and has
                  paid {formatCents(sponsor.paid_cents)} so far.
                </>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="payment-amount">Amount</Label>
                <Input
                  id="payment-amount"
                  value={amount}
                  inputMode="decimal"
                  onChange={(e) => setAmount(e.target.value)}
                  className="tabular font-mono"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="payment-date">Date received</Label>
                <Input
                  id="payment-date"
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="payment-note">Note</Label>
              <Textarea
                id="payment-note"
                value={note}
                maxLength={1000}
                rows={2}
                placeholder="Optional — cheque number, who handed it over."
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            {/* States the shape rather than offering it as a choice. */}
            <p className="text-muted-foreground text-xs">
              Goes on the ledger as income, category sponsorship, linked to this
              sponsor.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {ERROR_COPY[error] ?? 'Could not record that. Try again.'}
            </p>
          )}

          <DialogFooter>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? 'Recording…' : 'Record payment'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

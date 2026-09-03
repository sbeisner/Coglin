/**
 * Pre-initialise finance for a team that already has money.
 *
 * A team adopting Coglin in March holds a reserve and part of an allocation.
 * Asking them to back-enter a season of transactions to make the balances
 * right is how you lose them in the first ten minutes, so this asks for the
 * two numbers they actually know and writes the opening lines itself.
 *
 * It asks how much is LEFT, not what was originally allocated — in March the
 * remaining figure is the one a coach can read off a statement, and the
 * original is a number they would have to go and look up.
 *
 * The copy says plainly that these become ledger lines. A balance appearing
 * from nowhere is a balance nobody trusts six months later.
 */
import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import * as api from '@/lib/api';
import { parseDollars } from '@/lib/format';
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

const ERROR_COPY: Record<string, string> = {
  already_initialized:
    'This team already has funds set up. Add another one from Manage funds instead.',
  nothing_to_initialize: 'Fill in at least one amount.',
  missing_name: 'Give each expiring fund a name.',
  invalid_amount: 'Amounts are dollars and cents, like 1200.00.',
  invalid_expires_at: 'Pick a deadline.',
  no_current_season: 'This team has no current season yet.',
  too_many_funds: 'That is more funds than Coglin holds.',
  forbidden: 'Only coaches and mentors can set up funds.',
};

interface ExpiringRow {
  name: string;
  amount: string;
  expires: string;
}

const emptyRow = (): ExpiringRow => ({ name: '', amount: '', expires: '' });

export function FundsSetup({
  open,
  onOpenChange,
  onChanged,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [reserve, setReserve] = useState('');
  const [rows, setRows] = useState<ExpiringRow[]>([emptyRow()]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reserveCents = reserve.trim() === '' ? null : parseDollars(reserve);
  const reserveValid = reserve.trim() === '' || reserveCents !== null;
  const filledRows = rows.filter(
    (r) => r.name.trim() !== '' || r.amount.trim() !== '' || r.expires !== '',
  );
  const rowsValid = filledRows.every(
    (r) => r.name.trim() !== '' && parseDollars(r.amount) !== null && r.expires !== '',
  );
  const valid =
    reserveValid && rowsValid && (reserveCents !== null || filledRows.length > 0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid) return;
    setPending(true);
    setError(null);
    try {
      await api.initializeFunds({
        reserve_cents: reserveCents,
        funds: filledRows.map((r) => ({
          name: r.name.trim(),
          amount_cents: parseDollars(r.amount),
          expires_at: Math.floor(new Date(`${r.expires}T00:00`).getTime() / 1000),
        })),
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={onSubmit}>
          <DialogHeader>
            <DialogTitle>What do you have right now?</DialogTitle>
            <DialogDescription>
              Enter what is left in each pot today. Coglin records each amount as
              an opening-balance line on the ledger, so the numbers are always
              traceable — you do not need to back-enter last season.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="reserve">Money that carries over</Label>
              <Input
                id="reserve"
                value={reserve}
                inputMode="decimal"
                placeholder="1200.00"
                onChange={(e) => setReserve(e.target.value)}
                className="tabular font-mono"
              />
              <p className="text-muted-foreground text-xs">
                Sponsorship, donations, fundraising — money that is still there
                next year. This becomes your default fund.
              </p>
              {!reserveValid && (
                <p className="text-destructive text-xs">
                  Dollars and cents, like 1200.00.
                </p>
              )}
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">
                Money you have to spend by a deadline
              </legend>
              <p className="text-muted-foreground text-xs">
                District or booster allocations, grants with a spend-by date.
                Coglin will warn you before each one expires.
              </p>
              {rows.map((row, index) => (
                <div key={index} className="flex flex-wrap items-start gap-2">
                  <Input
                    value={row.name}
                    maxLength={120}
                    placeholder="District allocation FY26"
                    aria-label={`Fund ${index + 1} name`}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === index ? { ...r, name: e.target.value } : r,
                        ),
                      )
                    }
                    className="min-h-11 min-w-40 flex-1 md:min-h-9"
                  />
                  <Input
                    value={row.amount}
                    inputMode="decimal"
                    placeholder="340.00"
                    aria-label={`Fund ${index + 1} amount left`}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === index ? { ...r, amount: e.target.value } : r,
                        ),
                      )
                    }
                    className="tabular min-h-11 w-28 font-mono md:min-h-9"
                  />
                  <Input
                    type="date"
                    value={row.expires}
                    aria-label={`Fund ${index + 1} deadline`}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev.map((r, i) =>
                          i === index ? { ...r, expires: e.target.value } : r,
                        ),
                      )
                    }
                    className="min-h-11 w-40 md:min-h-9"
                  />
                  {rows.length > 1 && (
                    <button
                      type="button"
                      aria-label={`Remove fund ${index + 1}`}
                      onClick={() =>
                        setRows((prev) => prev.filter((_, i) => i !== index))
                      }
                      className="focus-visible:ring-ring text-muted-foreground hover:text-destructive flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:size-9"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setRows((prev) => [...prev, emptyRow()])}
              >
                <Plus className="size-4" aria-hidden />
                Another one
              </Button>
            </fieldset>
          </div>

          {error && (
            <p role="alert" className="text-destructive mb-4 text-sm">
              {ERROR_COPY[error] ?? 'Could not set that up. Try again.'}
            </p>
          )}

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => onOpenChange(false)}
            >
              Not now
            </Button>
            <Button type="submit" disabled={pending || !valid}>
              {pending ? 'Setting up…' : 'Set up funds'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

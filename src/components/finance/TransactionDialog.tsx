/**
 * Create or edit one ledger line.
 *
 * Coach/mentor only — the parent does not render this for anyone else, and if
 * it somehow did, every write answers 403.
 *
 * Money is typed in dollars and stored in cents: parseDollars owns the one
 * conversion, and a value that does not parse disables the save button rather
 * than rounding silently. After a CREATE the dialog stays open showing the
 * receipt zone — "add the expense, attach the receipt" is one errand, and
 * closing between the two steps would make the receipt a chore nobody does.
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ReceiptChips } from './ReceiptChips';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type Fund,
  type Transaction,
  type TransactionCategory,
  type TransactionKind,
} from '@/types';

/** The Select needs a value for "no fund"; '' is not one. */
const NO_FUND = 'unassigned';

export type TransactionDialogState =
  | { mode: 'create' }
  | { mode: 'edit'; transaction: Transaction }
  | null;

const ERROR_COPY: Record<string, string> = {
  invalid_kind: 'Pick income or expense.',
  invalid_category: 'Pick a category that fits the kind.',
  missing_label: 'Give the line a label.',
  invalid_amount: 'Enter an amount over $0.',
  invalid_occurred_at: 'Pick a date.',
  no_current_season: 'This team has no current season yet, so the ledger has nowhere to live.',
  forbidden: 'Only coaches and mentors can edit the ledger.',
  not_found: 'That line is already gone. Reload the page.',
};

function toDateInput(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

export function TransactionDialog({
  state,
  funds,
  onOpenChange,
  onChanged,
}: {
  state: TransactionDialogState;
  funds: Fund[];
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const editing = state?.mode === 'edit' ? state.transaction : null;

  const [kind, setKind] = useState<TransactionKind>('expense');
  const [category, setCategory] = useState<TransactionCategory>('parts');
  const [label, setLabel] = useState('');
  const [note, setNote] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState('');
  const [fundId, setFundId] = useState<string>(NO_FUND);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set after a create, so the dialog can offer the receipt zone for a line
  // that did not exist when it opened.
  const [created, setCreated] = useState<Transaction | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // Rebuild the drafts when the dialog opens on a different entity. Keyed on
  // the id rather than the object so a reload of the same line does not wipe
  // an edit in progress.
  const entityKey = state === null ? 'closed' : (editing?.id ?? 'create');
  useEffect(() => {
    if (state === null) return;
    setError(null);
    setCreated(null);
    setConfirmingDelete(false);
    setPending(false);
    if (editing) {
      setKind(editing.kind);
      setCategory(editing.category);
      setLabel(editing.label);
      setNote(editing.note ?? '');
      setAmount((editing.amount_cents / 100).toFixed(2));
      setDate(toDateInput(editing.occurred_at));
      setFundId(editing.fund_id ?? NO_FUND);
    } else {
      setKind('expense');
      setCategory('parts');
      setLabel('');
      setNote('');
      setAmount('');
      setDate(toDateInput(Math.floor(Date.now() / 1000)));
      // Pre-fill the team's default pot, which is where money goes unless
      // somebody says otherwise.
      setFundId(funds.find((f) => f.is_default === 1)?.id ?? NO_FUND);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey]);

  const categories = kind === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
  const amountCents = parseDollars(amount);
  const valid = label.trim() !== '' && amountCents !== null && date !== '';

  function switchKind(next: TransactionKind) {
    setKind(next);
    // The old category may not exist under the new kind; 'other' always does.
    const list = next === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES;
    if (!list.some((c) => c.id === category)) setCategory('other');
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!valid || amountCents === null) return;
    setPending(true);
    setError(null);
    const payload = {
      kind,
      category,
      label: label.trim(),
      note: note.trim() === '' ? null : note.trim(),
      amount_cents: amountCents,
      occurred_at: Math.floor(new Date(`${date}T00:00`).getTime() / 1000),
      fund_id: fundId === NO_FUND ? null : fundId,
    };
    try {
      if (editing) {
        await api.updateTransaction(editing.id, payload);
        onChanged();
        onOpenChange(false);
      } else {
        const transaction = await api.createTransaction(payload);
        setCreated(transaction);
        onChanged();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  async function onDelete() {
    if (!editing) return;
    setPending(true);
    setError(null);
    try {
      await api.deleteTransaction(editing.id);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={state !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {created ? (
          <>
            <DialogHeader>
              <DialogTitle>Recorded — add a receipt?</DialogTitle>
              <DialogDescription>
                {created.label} · {formatCents(created.amount_cents)}. A photo
                or PDF here is what makes the line auditable later.
              </DialogDescription>
            </DialogHeader>
            <div className="py-4">
              <ReceiptChips
                transactionId={created.id}
                receipts={created.receipts}
                canManage
                onChanged={async () => {
                  // Re-read so newly attached receipts appear in the zone.
                  const lines = await api.listTransactions();
                  const fresh = lines.find((t) => t.id === created.id);
                  if (fresh) setCreated(fresh);
                  onChanged();
                }}
              />
            </div>
            <DialogFooter>
              <Button type="button" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </DialogFooter>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>
                {editing ? 'Edit ledger line' : 'Record money in or out'}
              </DialogTitle>
              <DialogDescription>
                {editing
                  ? 'Fix the amount, label or date. Receipts live below.'
                  : 'One line per movement — a sponsorship cheque, a parts order, a registration fee.'}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="flex gap-1.5" role="group" aria-label="Kind">
                {(['expense', 'income'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={kind === k}
                    onClick={() => switchKind(k)}
                    className={
                      kind === k
                        ? 'bg-primary text-primary-foreground min-h-11 flex-1 rounded-md px-3 text-sm md:min-h-9'
                        : 'bg-muted text-muted-foreground hover:bg-accent min-h-11 flex-1 rounded-md px-3 text-sm md:min-h-9'
                    }
                  >
                    {k === 'expense' ? 'Money out' : 'Money in'}
                  </button>
                ))}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tx-label">Label</Label>
                <Input
                  id="tx-label"
                  value={label}
                  maxLength={200}
                  placeholder={kind === 'expense' ? 'REV kit restock' : 'Acme Tool sponsorship'}
                  onChange={(e) => setLabel(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tx-amount">Amount</Label>
                  <Input
                    id="tx-amount"
                    inputMode="decimal"
                    value={amount}
                    placeholder="312.40"
                    onChange={(e) => setAmount(e.target.value)}
                    className="tabular font-mono"
                  />
                  {amount.trim() !== '' && amountCents === null && (
                    <p className="text-destructive text-xs">
                      Dollars and cents, like 312.40.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tx-date">Date</Label>
                  <Input
                    id="tx-date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="tx-category">Category</Label>
                <Select
                  value={category}
                  onValueChange={(v) => setCategory(v as TransactionCategory)}
                >
                  <SelectTrigger id="tx-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Which pot, only once a team has any. A team that does not
                  track funds never sees this control. */}
              {funds.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="tx-fund">Fund</Label>
                  <Select value={fundId} onValueChange={setFundId}>
                    <SelectTrigger id="tx-fund">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_FUND}>Unassigned</SelectItem>
                      {funds.map((fund) => (
                        <SelectItem key={fund.id} value={fund.id}>
                          {fund.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="tx-note">Note</Label>
                <Textarea
                  id="tx-note"
                  value={note}
                  maxLength={1000}
                  rows={2}
                  placeholder="Optional — who, what for, order number."
                  onChange={(e) => setNote(e.target.value)}
                />
              </div>

              {editing && (
                <div className="space-y-1.5">
                  <Label>Receipts</Label>
                  <ReceiptChips
                    transactionId={editing.id}
                    receipts={editing.receipts}
                    canManage
                    onChanged={onChanged}
                  />
                </div>
              )}
            </div>

            {error && (
              <p role="alert" className="text-destructive mb-4 text-sm">
                {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
              </p>
            )}

            <DialogFooter className="gap-2 sm:justify-between">
              {editing ? (
                confirmingDelete ? (
                  <span className="flex items-center gap-2 text-sm">
                    Delete this line and its receipts?
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      disabled={pending}
                      onClick={() => void onDelete()}
                    >
                      Delete
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmingDelete(false)}
                    >
                      Keep it
                    </Button>
                  </span>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => setConfirmingDelete(true)}
                  >
                    Delete
                  </Button>
                )
              ) : (
                <span />
              )}
              <Button type="submit" disabled={pending || !valid}>
                {pending ? 'Saving…' : editing ? 'Save' : 'Record it'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

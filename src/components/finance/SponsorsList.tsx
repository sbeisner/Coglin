/**
 * Everyone who said yes, with pledged and paid side by side.
 *
 * The two numbers are never merged. A sponsor who promised $750 and has paid
 * $250 is a real and common state, and the row says so rather than picking one
 * figure to display — a team writing a Sustain narrative in March needs to know
 * which promises are still outstanding.
 *
 * The thank-you toggle is here rather than on a separate screen because this is
 * the list somebody scans when a coach asks "have we thanked everyone".
 */
import { useCallback, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import * as api from '@/lib/api';
import { formatCents, formatDate, parseDollars } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { cn } from '@/lib/utils';
import { RecordPaymentDialog } from './RecordPaymentDialog';
import type { Sponsor } from '@/types';

const ERROR_COPY: Record<string, string> = {
  sponsor_has_payments:
    'This sponsor has payments on the ledger. Delete those lines first if you really mean to remove them.',
  missing_name: 'Give the sponsor a name.',
  invalid_amount: 'Enter an amount over $0.',
  forbidden: 'Viewers cannot change the sponsor list.',
  not_found: 'That sponsor is already gone.',
};

export function SponsorsList({
  sponsors,
  canEdit,
  canRecordPayment,
  onChanged,
}: {
  sponsors: Sponsor[];
  canEdit: boolean;
  canRecordPayment: boolean;
  onChanged: () => void;
}) {
  const [paying, setPaying] = useState<Sponsor | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [amount, setAmount] = useState('');

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

  const amountCents = parseDollars(amount);
  const canAdd = name.trim() !== '' && amountCents !== null;

  return (
    <div className="space-y-3">
      {canEdit && (
        <div className="flex justify-end">
          {adding ? (
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={name}
                maxLength={200}
                autoFocus
                placeholder="Riverside Dental"
                aria-label="Sponsor name"
                onChange={(e) => setName(e.target.value)}
                className="min-h-11 min-w-40 md:min-h-9"
              />
              <Input
                value={amount}
                inputMode="decimal"
                placeholder="250.00"
                aria-label="Amount promised"
                onChange={(e) => setAmount(e.target.value)}
                className="tabular min-h-11 w-32 font-mono md:min-h-9"
              />
              <Button
                size="sm"
                disabled={!canAdd}
                onClick={() =>
                  void act(async () => {
                    if (amountCents === null) return;
                    await api.createSponsor({
                      name: name.trim(),
                      amount_cents: amountCents,
                    });
                    setName('');
                    setAmount('');
                    setAdding(false);
                  })
                }
              >
                Add
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              Add a sponsor directly
            </Button>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
        </p>
      )}

      {sponsors.length === 0 ? (
        <EmptyState
          title="No sponsors yet."
          aside="When a business says yes in the pipeline above, they land here — with what they promised, what has actually arrived, and whether anyone has thanked them."
        />
      ) : (
        <ul className="bg-card border-border divide-border divide-y rounded-lg border">
          {sponsors.map((sponsor) => (
            <SponsorRow
              key={sponsor.id}
              sponsor={sponsor}
              canEdit={canEdit}
              canRecordPayment={canRecordPayment}
              onPay={() => setPaying(sponsor)}
              onAct={act}
            />
          ))}
        </ul>
      )}

      <RecordPaymentDialog
        sponsor={paying}
        onOpenChange={(open) => {
          if (!open) setPaying(null);
        }}
        onChanged={onChanged}
      />
    </div>
  );
}

function SponsorRow({
  sponsor: s,
  canEdit,
  canRecordPayment,
  onPay,
  onAct,
}: {
  sponsor: Sponsor;
  canEdit: boolean;
  canRecordPayment: boolean;
  onPay: () => void;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const outstanding = s.amount_cents - s.paid_cents;
  const thanked = s.thanked_at !== null;

  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{s.name}</span>
            {s.tier_name && (
              <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium">
                {s.tier_name}
              </span>
            )}
            {s.prospect_id && (
              <span className="text-muted-foreground shrink-0 text-[10px]">
                from the pipeline
              </span>
            )}
          </div>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {thanked && s.thanked_at
              ? `Thanked${s.thanked_by_name ? ` by ${s.thanked_by_name}` : ''} · ${formatDate(s.thanked_at)}`
              : 'Not thanked yet'}
          </p>
        </div>

        <div className="shrink-0 text-right">
          <div className="tabular font-mono text-sm">
            {formatCents(s.paid_cents)}
            <span className="text-muted-foreground"> / {formatCents(s.amount_cents)}</span>
          </div>
          <div
            className={cn(
              'mt-0.5 text-xs',
              outstanding > 0 ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {outstanding > 0
              ? `${formatCents(outstanding)} outstanding`
              : s.payment_count > 0
                ? `paid in full${s.payment_count > 1 ? ` · ${s.payment_count} payments` : ''}`
                : 'pledged'}
          </div>
        </div>
      </div>

      {(canEdit || canRecordPayment) && (
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button
              size="sm"
              variant={thanked ? 'outline' : 'default'}
              onClick={() => void onAct(() => api.setSponsorThanked(s.id, !thanked))}
            >
              {thanked ? (
                <>
                  <Check className="size-4" aria-hidden />
                  Thanked
                </>
              ) : (
                'Mark thanked'
              )}
            </Button>
          )}
          {canRecordPayment && (
            <Button size="sm" variant="outline" onClick={onPay}>
              Record payment
            </Button>
          )}
          {canEdit &&
            (confirmingDelete ? (
              <span className="flex items-center gap-2 text-xs">
                Remove {s.name}?
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => void onAct(() => api.deleteSponsor(s.id))}
                >
                  Remove
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingDelete(false)}
                >
                  Keep
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => setConfirmingDelete(true)}
              >
                Remove
              </Button>
            ))}
        </div>
      )}
    </li>
  );
}

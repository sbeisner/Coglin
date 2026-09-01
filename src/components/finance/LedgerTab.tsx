/**
 * The season's ledger: every movement of money, newest first.
 *
 * Readable by everyone on the roster including viewers — a sponsor is owed the
 * answer to "where did it go". Only coaches and mentors get the add and edit
 * affordances; for everyone else the rows are inert.
 */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatCents, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { cn } from '@/lib/utils';
import { ReceiptChips } from './ReceiptChips';
import { TransactionDialog, type TransactionDialogState } from './TransactionDialog';
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  type Transaction,
} from '@/types';

const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(
  [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES].map((c) => [c.id, c.label]),
);

export function LedgerTab({
  canManage,
  onChanged,
  reloadKey,
}: {
  canManage: boolean;
  /** Bumped by the parent whenever either tab writes, so the tiles stay true. */
  reloadKey: number;
  onChanged: () => void;
}) {
  const lines = useAsync(api.listTransactions, [reloadKey]);
  const [dialog, setDialog] = useState<TransactionDialogState>(null);

  const list = lines.data ?? [];

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden />
            Record money
          </Button>
        </div>
      )}

      {lines.status === 'loading' && <Skeleton className="h-48" />}

      {lines.status === 'error' && (
        <p role="alert" className="text-destructive text-sm">
          Could not load the ledger. Reload the page.
        </p>
      )}

      {lines.status === 'ready' && list.length === 0 && (
        <EmptyState
          title={
            canManage
              ? 'Record your first income or expense.'
              : 'No money has been recorded yet.'
          }
          aside="Sponsorship cheques, parts orders, registration fees — the Sustain judges want to see all of it accounted for."
          action={
            canManage ? (
              <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
                Record money
              </Button>
            ) : undefined
          }
        />
      )}

      {list.length > 0 && (
        <ul className="bg-card border-border divide-border divide-y rounded-lg border">
          {list.map((t) => (
            <LedgerRow
              key={t.id}
              transaction={t}
              canManage={canManage}
              onEdit={() => setDialog({ mode: 'edit', transaction: t })}
              onChanged={onChanged}
            />
          ))}
        </ul>
      )}

      <TransactionDialog
        state={dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onChanged={onChanged}
      />
    </div>
  );
}

function LedgerRow({
  transaction: t,
  canManage,
  onEdit,
  onChanged,
}: {
  transaction: Transaction;
  canManage: boolean;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const isExpense = t.kind === 'expense';
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <button
                type="button"
                onClick={onEdit}
                className="focus-visible:ring-ring truncate text-left text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                {t.label}
              </button>
            ) : (
              <span className="truncate text-sm font-medium">{t.label}</span>
            )}
            <span className="bg-muted text-muted-foreground shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium">
              {CATEGORY_LABEL[t.category] ?? t.category}
            </span>
            {t.order_item !== null && (
              <span
                className="text-muted-foreground shrink-0 text-[10px]"
                title={`Booked from the part order: ${t.order_item}`}
              >
                from a part order
              </span>
            )}
          </div>
          {t.note && (
            <p className="text-muted-foreground mt-0.5 truncate text-xs">{t.note}</p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <div
            className={cn(
              'tabular font-mono text-sm',
              isExpense ? 'text-destructive' : 'text-heading',
            )}
          >
            {isExpense ? '−' : '+'}
            {formatCents(t.amount_cents)}
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {formatDate(t.occurred_at)}
          </div>
        </div>
      </div>

      {/* Read-only in the row — fifty attach buttons would bury the numbers.
          Adding and removing receipts happens in the edit dialog. */}
      {t.receipts.length > 0 && (
        <ReceiptChips
          transactionId={t.id}
          receipts={t.receipts}
          canManage={false}
          onChanged={onChanged}
        />
      )}
    </li>
  );
}

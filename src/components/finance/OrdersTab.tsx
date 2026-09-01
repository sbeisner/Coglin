/**
 * The part-order queue: pending first, then in flight, then settled.
 *
 * Everyone on the roster can read it; who can act on a row depends on what the
 * row is waiting for. Approvers (coach, mentor, or a member with the flag)
 * decide and move orders; the requester can edit or pull their own request
 * while it is still pending. The routes enforce all of it — buttons here are
 * offers, not authority.
 */
import { useCallback, useState } from 'react';
import { ExternalLink, Plus } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { formatCents, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { cn } from '@/lib/utils';
import { OrderDialog, type OrderDialogState } from './OrderDialog';
import { ORDER_STATUS_LABELS, type PartOrder } from '@/types';

const ERROR_COPY: Record<string, string> = {
  forbidden: 'You do not have permission to do that to this request.',
  invalid_state: 'Somebody else got there first. The list has been refreshed.',
  not_found: 'That request is already gone.',
};

export function OrdersTab({
  canSubmit,
  canApprove,
  canManage,
  reloadKey,
  onChanged,
}: {
  canSubmit: boolean;
  canApprove: boolean;
  canManage: boolean;
  reloadKey: number;
  onChanged: () => void;
}) {
  const orders = useAsync(api.listPartOrders, [reloadKey]);
  const { member } = useSession();
  const [dialog, setDialog] = useState<OrderDialogState>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : '');
      } finally {
        // Refresh either way: a 409 means the list is stale, and showing the
        // fresh state is the answer to "somebody else got there first".
        onChanged();
      }
    },
    [onChanged],
  );

  const list = orders.data ?? [];
  const pending = list.filter((o) => o.status === 'pending');
  const active = list.filter((o) => o.status === 'approved' || o.status === 'ordered');
  const settled = list.filter(
    (o) => o.status === 'received' || o.status === 'denied' || o.status === 'canceled',
  );

  return (
    <div className="space-y-6">
      {canSubmit && (
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden />
            Request a part
          </Button>
        </div>
      )}

      {orders.status === 'loading' && <Skeleton className="h-48" />}

      {orders.status === 'error' && (
        <p role="alert" className="text-destructive text-sm">
          Could not load the requests. Reload the page.
        </p>
      )}

      {orders.status === 'ready' && list.length === 0 && (
        <EmptyState
          title="No part requests yet."
          aside="When somebody in the pit says “we need two more servos”, this is where that sentence gets written down."
          action={
            canSubmit ? (
              <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
                Request a part
              </Button>
            ) : undefined
          }
        />
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
        </p>
      )}

      {pending.length > 0 && (
        <Section title={`Waiting for a decision · ${pending.length}`}>
          {pending.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              canApprove={canApprove}
              canManage={canManage}
              isMine={o.requested_by === member.id}
              onAct={act}
              onEdit={() => setDialog({ mode: 'edit', order: o })}
            />
          ))}
        </Section>
      )}

      {active.length > 0 && (
        <Section title="In flight">
          {active.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              canApprove={canApprove}
              canManage={canManage}
              isMine={o.requested_by === member.id}
              onAct={act}
              onEdit={() => setDialog({ mode: 'edit', order: o })}
            />
          ))}
        </Section>
      )}

      {settled.length > 0 && (
        <Section title="Settled">
          {settled.map((o) => (
            <OrderRow
              key={o.id}
              order={o}
              canApprove={canApprove}
              canManage={canManage}
              isMine={o.requested_by === member.id}
              onAct={act}
              onEdit={() => setDialog({ mode: 'edit', order: o })}
            />
          ))}
        </Section>
      )}

      <OrderDialog
        state={dialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onChanged={onChanged}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="u-eyebrow mb-3">{title}</h2>
      <ul className="bg-card border-border divide-border divide-y rounded-lg border">
        {children}
      </ul>
    </section>
  );
}

const STATUS_CLASS: Record<PartOrder['status'], string> = {
  pending: 'bg-accent text-accent-foreground',
  approved: 'bg-primary/10 text-primary-ink',
  ordered: 'bg-primary text-primary-foreground',
  received: 'border-border text-muted-foreground border',
  denied: 'text-destructive border-destructive/40 border',
  canceled: 'border-border text-muted-foreground border',
};

function OrderRow({
  order: o,
  canApprove,
  canManage,
  isMine,
  onAct,
  onEdit,
}: {
  order: PartOrder;
  canApprove: boolean;
  canManage: boolean;
  isMine: boolean;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
  onEdit: () => void;
}) {
  // The deny affordance asks for the reason inline — a denial without one
  // reads as a shrug, and the requester deserves the sentence.
  const [denying, setDenying] = useState(false);
  const [denyNote, setDenyNote] = useState('');

  const estimate = o.qty * o.unit_price_cents;
  const isPending = o.status === 'pending';
  const canEdit = isPending && (isMine || canManage);
  const canCancel =
    (isPending && (isMine || canManage)) || (o.status === 'approved' && canManage);

  return (
    <li className="space-y-2.5 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">
              {o.qty > 1 && <span className="tabular font-mono">{o.qty}× </span>}
              {o.item}
            </span>
            {o.url && (
              <a
                href={o.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Product link for ${o.item}`}
                className="text-muted-foreground hover:text-primary-ink shrink-0"
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
            <span
              className={cn(
                'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium',
                STATUS_CLASS[o.status],
              )}
            >
              {ORDER_STATUS_LABELS[o.status]}
            </span>
          </div>
          <div className="text-muted-foreground mt-0.5 text-xs">
            {o.requested_by_name ?? 'Someone'} · {formatDate(o.created_at)}
            {o.vendor && <> · {o.vendor}</>}
          </div>
          {o.description && (
            <p className="text-muted-foreground mt-1 text-xs">{o.description}</p>
          )}
          {o.decision_note && (
            <p className="text-muted-foreground mt-1 text-xs">
              {o.status === 'denied' ? 'Denied' : 'Decision'}
              {o.decided_by_name ? ` by ${o.decided_by_name}` : ''}: {o.decision_note}
            </p>
          )}
        </div>

        <div className="shrink-0 text-right">
          <div className="tabular font-mono text-sm">{formatCents(estimate)}</div>
          {o.qty > 1 && (
            <div className="text-muted-foreground mt-0.5 text-xs">
              {formatCents(o.unit_price_cents)} each
            </div>
          )}
        </div>
      </div>

      {/* The action row. Offers, not authority — the routes decide. */}
      {denying ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={denyNote}
            maxLength={500}
            autoFocus
            placeholder="Why not? The requester sees this."
            onChange={(e) => setDenyNote(e.target.value)}
            className="min-h-11 min-w-40 flex-1 md:min-h-9"
          />
          <Button
            size="sm"
            variant="destructive"
            onClick={() => {
              setDenying(false);
              void onAct(() =>
                api.decidePartOrder(o.id, 'denied', denyNote.trim() || undefined),
              );
            }}
          >
            Deny
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDenying(false)}>
            Never mind
          </Button>
        </div>
      ) : (
        (isPending || o.status === 'approved' || o.status === 'ordered') && (
          <div className="flex flex-wrap items-center gap-2">
            {isPending && canApprove && (
              <>
                <Button
                  size="sm"
                  onClick={() => void onAct(() => api.decidePartOrder(o.id, 'approved'))}
                >
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => setDenying(true)}>
                  Deny
                </Button>
              </>
            )}
            {o.status === 'approved' && canApprove && (
              <Button
                size="sm"
                onClick={() => void onAct(() => api.markOrderOrdered(o.id))}
                title="Books the estimated spend on the ledger"
              >
                Mark ordered
              </Button>
            )}
            {o.status === 'ordered' && canApprove && (
              <Button
                size="sm"
                onClick={() => void onAct(() => api.markOrderReceived(o.id))}
              >
                Mark received
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="ghost" onClick={onEdit}>
                Edit
              </Button>
            )}
            {canCancel && (
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground"
                onClick={() => void onAct(() => api.cancelPartOrder(o.id))}
              >
                Cancel request
              </Button>
            )}
          </div>
        )
      )}
    </li>
  );
}

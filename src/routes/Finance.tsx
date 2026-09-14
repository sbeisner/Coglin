/**
 * Finance: the ledger and the part-order queue (phase 1 of COG's finance
 * section — sponsorship campaigns and newsletters come later and land here).
 *
 * Everything on this screen is readable by every role, viewers included; the
 * write affordances split by what the write is. See worker/routes/finance.ts
 * for the table and the argument.
 */
import { useState } from 'react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/PageHeader';
import { StatTile } from '@/components/StatTile';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { OverviewTab } from '@/components/finance/OverviewTab';
import { LedgerTab } from '@/components/finance/LedgerTab';
import { OrdersTab } from '@/components/finance/OrdersTab';
import { SponsorsTab } from '@/components/finance/SponsorsTab';
import { formatCents } from '@/lib/format';
import { financeBalance } from '@/types';

export default function Finance() {
  // One reload key for the whole screen: a decision in the orders tab moves
  // the ledger (mark-ordered books a line) and every write moves the tiles,
  // so refreshing them separately would show a screen disagreeing with itself.
  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  const { member } = useSession();
  const canManage = member.role === 'coach' || member.role === 'mentor';
  const canApprove = canManage || member.is_purchase_approver;
  const canSubmit = member.role !== 'viewer';

  const summary = useAsync(api.financeSummary, [reloadKey]);
  const s = summary.data;
  // Opening balances count here even though they are excluded from Income —
  // the reserve is really in the bank. financeBalance is the one definition.
  const balance = s ? financeBalance(s) : null;

  return (
    <>
      <PageHeader eyebrow="Season" title="Finance" />

      <div className="space-y-6 px-4 py-6 md:px-8">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatTile
            value={balance === null ? '—' : formatCents(balance)}
            label="Balance"
            tone={balance !== null && balance < 0 ? 'alert' : 'default'}
          />
          <StatTile value={s ? formatCents(s.income_cents) : '—'} label="Income" />
          <StatTile value={s ? formatCents(s.expense_cents) : '—'} label="Spent" />
          <StatTile
            value={s ? s.pending_orders : '—'}
            label="Pending requests"
            tone={s && s.pending_orders > 0 ? 'alert' : 'default'}
            hint={
              s && s.pending_orders > 0
                ? `${formatCents(s.pending_estimate_cents)} if approved`
                : undefined
            }
          />
        </div>

        {/* Overview lands first: the season-altitude answer is what someone
            opening this screen is usually after, and the rows are one click
            away. */}
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="ledger">Ledger</TabsTrigger>
            <TabsTrigger value="orders">Part orders</TabsTrigger>
            <TabsTrigger value="sponsors">Sponsors</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="mt-4">
            <OverviewTab reloadKey={reloadKey} />
          </TabsContent>
          <TabsContent value="ledger" className="mt-4">
            <LedgerTab canManage={canManage} reloadKey={reloadKey} onChanged={reload} />
          </TabsContent>
          <TabsContent value="orders" className="mt-4">
            <OrdersTab
              canSubmit={canSubmit}
              canApprove={canApprove}
              canManage={canManage}
              reloadKey={reloadKey}
              onChanged={reload}
            />
          </TabsContent>
          <TabsContent value="sponsors" className="mt-4">
            {/* Students own the campaign; only adults record that money
                arrived, because that writes the ledger. */}
            <SponsorsTab
              canEdit={canSubmit}
              canRecordPayment={canManage}
              reloadKey={reloadKey}
              onChanged={reload}
            />
          </TabsContent>
        </Tabs>
      </div>
    </>
  );
}

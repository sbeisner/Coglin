/**
 * The season's money at a glance: its shape over time, and where it went.
 *
 * One request feeds both visuals, so they cannot disagree about which season
 * they describe. Both rollups are computed server-side — see
 * worker/routes/finance.ts /breakdown for why that is a correctness call rather
 * than a performance one.
 *
 * SCOPE: everything on this tab is SEASON-scoped. Funds are TEAM-scoped and
 * deliberately carry no season_id ("the fund is the scope",
 * migrations/0012_funds.sql), so a fund's remaining includes prior-season
 * lines while Balance does not. Never put a fund figure on a shared scale with
 * anything here — on one axis that is a false comparison with a plausible
 * appearance. Fund expiry stays in FundsStrip, on the Ledger tab.
 *
 * The charts are lazy because recharts is ~110KB gzipped and App.tsx imports
 * Finance statically: a static import here would also drag recharts into
 * scripts/prerender.mjs and run it in Node on every build for no output.
 */
import { Suspense, lazy } from 'react';
import * as api from '@/lib/api';
import { useAsync, useLastGood } from '@/lib/useAsync';
import { Skeleton } from '@/components/Skeleton';
import { EmptyState } from '@/components/EmptyState';

const CashFlowByMonth = lazy(() =>
  import('./CashFlowByMonth').then((m) => ({ default: m.CashFlowByMonth })),
);
const SpendByCategory = lazy(() =>
  import('./SpendByCategory').then((m) => ({ default: m.SpendByCategory })),
);

export function OverviewTab({ reloadKey }: { reloadKey: number }) {
  const state = useAsync(api.financeBreakdown, [reloadKey]);
  // Every write bumps the shared reloadKey and sends useAsync back to `loading`
  // with null data, so without useLastGood recording a transaction would
  // collapse both charts to skeletons. See useAsync.ts.
  const data = useLastGood(state);
  const now = api.now();

  if (!data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-72" />
        <Skeleton className="h-56" />
      </div>
    );
  }

  const hasLines = data.buckets.some((b) => b.line_count > 0);
  if (!hasLines) {
    return (
      <EmptyState
        title="No money recorded yet"
        aside="Once the ledger has a few lines, this is where the season's shape shows up — what came in, what went out, and what is left."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Two lines have no shape, and drawing a trend through them is the
          invented-delta failure mode. The category rollup still works. */}
      {data.buckets.filter((b) => b.line_count > 0).length >= 2 && (
        <Suspense fallback={<Skeleton className="h-72" />}>
          <CashFlowByMonth buckets={data.buckets} now={now} />
        </Suspense>
      )}

      {data.by_category.length > 0 && (
        <Suspense fallback={<Skeleton className="h-56" />}>
          <SpendByCategory rows={data.by_category} />
        </Suspense>
      )}
    </div>
  );
}

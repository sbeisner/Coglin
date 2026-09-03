/**
 * What is in each pot, and which pot is about to disappear.
 *
 * The point of this strip is one sentence a coach can act on in April: "$341
 * of district money goes away in 41 days." Everything else here is in service
 * of that.
 *
 * Renders nothing for a team with no funds beyond a quiet setup affordance for
 * an adult — a team funded entirely by sponsorship has one pot and should
 * never meet the concept.
 */
import { useState } from 'react';
import { Coins, TriangleAlert } from 'lucide-react';
import * as api from '@/lib/api';
import { formatCents, formatDate, relativeDays } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FundsDialog } from './FundsDialog';
import { FundsSetup } from './FundsSetup';
import {
  fundIsExpired,
  fundIsExpiringSoon,
  fundRemaining,
  type FundsResponse,
} from '@/types';

export function FundsStrip({
  data,
  canManage,
  onChanged,
}: {
  data: FundsResponse | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [managing, setManaging] = useState(false);
  const [settingUp, setSettingUp] = useState(false);
  const now = api.now();

  const funds = data?.funds ?? [];
  const unassigned = data?.unassigned;
  const unassignedTotal = unassigned
    ? unassigned.income_cents - unassigned.expense_cents
    : 0;

  // A team that does not track pots sees one quiet line, and only if they
  // could do something about it.
  if (funds.length === 0) {
    if (!canManage) return null;
    return (
      <>
        <div className="border-border flex flex-wrap items-center gap-3 rounded-lg border border-dashed px-4 py-3">
          <Coins className="text-muted-foreground size-4 shrink-0" aria-hidden />
          <p className="text-muted-foreground min-w-0 flex-1 text-xs">
            Track money that expires separately from money that carries over —
            district allocations, grants, your reserve.
          </p>
          <Button size="sm" variant="outline" onClick={() => setSettingUp(true)}>
            Set up funds
          </Button>
        </div>
        <FundsSetup
          open={settingUp}
          onOpenChange={setSettingUp}
          onChanged={onChanged}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="u-eyebrow">Funds</h3>
          {canManage && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setManaging(true)}
            >
              Manage funds
            </Button>
          )}
        </div>

        <ul className="bg-card border-border divide-border divide-y rounded-lg border">
          {funds.map((fund) => {
            const remaining = fundRemaining(fund);
            const expired = fundIsExpired(fund, now);
            const soon = fundIsExpiringSoon(fund, now) && remaining > 0;
            return (
              <li key={fund.id} className="flex items-center gap-3 px-4 py-2.5">
                {soon && (
                  <TriangleAlert
                    className="text-destructive size-4 shrink-0"
                    aria-hidden
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium">{fund.name}</span>
                    {fund.is_default === 1 && (
                      <span className="text-muted-foreground shrink-0 text-[10px]">
                        default
                      </span>
                    )}
                  </div>
                  <p
                    className={cn(
                      'mt-0.5 text-xs',
                      soon ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {fund.expires_at === null
                      ? 'Carries over'
                      : expired
                        ? // Say what was lost rather than hiding it. Nothing
                          // wrote this state — see worker/lib/funds.ts.
                          remaining > 0
                          ? `Expired ${formatDate(fund.expires_at)} · ${formatCents(remaining)} forfeited`
                          : `Expired ${formatDate(fund.expires_at)}`
                        : `Use by ${formatDate(fund.expires_at)} · ${relativeDays(fund.expires_at, now)}`}
                  </p>
                </div>
                <span
                  className={cn(
                    'tabular shrink-0 font-mono text-sm',
                    remaining < 0 && 'text-destructive',
                    expired && remaining > 0 && 'text-muted-foreground line-through',
                  )}
                >
                  {formatCents(remaining)}
                </span>
              </li>
            );
          })}

          {/* Only when there is something in it. Money that predates funds, or
              that nobody has filed yet — a real state, not an error. */}
          {unassigned && unassigned.transaction_count > 0 && (
            <li className="flex items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <span className="text-muted-foreground truncate text-sm">
                  Unassigned
                </span>
                <p className="text-muted-foreground mt-0.5 text-xs">
                  {unassigned.transaction_count}{' '}
                  {unassigned.transaction_count === 1 ? 'line' : 'lines'} with no fund
                </p>
              </div>
              <span className="tabular text-muted-foreground shrink-0 font-mono text-sm">
                {formatCents(unassignedTotal)}
              </span>
            </li>
          )}
        </ul>
      </div>

      <FundsDialog
        open={managing}
        funds={funds}
        onOpenChange={setManaging}
        onChanged={onChanged}
      />
    </>
  );
}

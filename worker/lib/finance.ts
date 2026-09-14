/**
 * Finance vocabulary and the approval gate.
 *
 * The validators mirror `meetings.ts`: values first, types derived, because a
 * hand-written union plus a matching array has already bitten once (see the
 * header there). `src/types.ts` holds the client's copy for labels — the two
 * are kept in sync by hand, for the reason `roles.ts` explains.
 */
import type { MemberRow } from './tenancy';
import { zonedTimeToEpoch } from './tz';

/**
 * amount_cents is always positive; `kind` carries the sign. A signed amount
 * plus a kind column can disagree with itself, and then somebody has to decide
 * which one was lying.
 */
export const TRANSACTION_KINDS = ['income', 'expense'] as const;
export type TransactionKind = (typeof TRANSACTION_KINDS)[number];

/**
 * Categories are PER KIND. 'parts' is not something a team earns and
 * 'sponsorship' is not something it spends, and a single flat list would let
 * either through. 'sponsorship' is deliberately reserved: the campaigns phase
 * promotes a committed sponsor into an income line with this category, the way
 * `meeting_action_items.task_id` promotes into a task today.
 */
export const EXPENSE_CATEGORIES = [
  'parts',
  'tools',
  'registration',
  'travel',
  'outreach',
  'food',
  'other',
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const INCOME_CATEGORIES = [
  'sponsorship',
  'fundraising',
  'grant',
  'dues',
  /**
   * Money the team already had when it started using Coglin, or when it opened
   * a new pot part-way through a season.
   *
   * A category rather than a column on `funds`, because as far as this ledger
   * is concerned an opening balance genuinely IS money arriving — and keeping
   * it in `transactions` is what lets a fund's remaining stay pure ledger math
   * (see migrations/0012_funds.sql).
   *
   * It is the one income category the INCOME figure excludes: "income" means
   * what the team raised this season, and counting a $1,200 reserve as income
   * would overstate that. BALANCE includes it, because the money is really
   * there. The summary route does both.
   */
  'opening_balance',
  'other',
] as const;

export type IncomeCategory = (typeof INCOME_CATEGORIES)[number];

/**
 * Referenced by the summary query, the initialize route and the client. Named
 * so there is one spelling of it rather than three string literals that can
 * drift apart.
 */
export const OPENING_BALANCE_CATEGORY: IncomeCategory = 'opening_balance';

export type TransactionCategory = ExpenseCategory | IncomeCategory;

/**
 * The status ladder. Transitions are guarded in SQL at the route (`WHERE
 * status = ?` on the UPDATE), so this list only decides what may enter D1 at
 * all — a body naming a status outside it is a 400 before any row is read.
 *
 *   pending -> approved | denied     an approver's decision
 *   approved -> ordered              the order was actually placed
 *   ordered -> received              the box arrived
 *   pending | approved -> canceled   withdrawn before money moved
 */
export const ORDER_STATUSES = [
  'pending',
  'approved',
  'denied',
  'ordered',
  'received',
  'canceled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

export const isTransactionKind = oneOf(TRANSACTION_KINDS);
export const isOrderStatus = oneOf(ORDER_STATUSES);

const isExpenseCategory = oneOf(EXPENSE_CATEGORIES);
const isIncomeCategory = oneOf(INCOME_CATEGORIES);

/** Whether `value` is a category the given kind accepts. */
export function isCategoryForKind(
  kind: TransactionKind,
  value: unknown,
): value is TransactionCategory {
  return kind === 'expense' ? isExpenseCategory(value) : isIncomeCategory(value);
}

/**
 * The upper bound a single ledger line or unit price may carry: $500,000 in
 * cents. An FTC season budget is four figures — anything past this is a typo
 * (dollars pasted where cents go, usually), and rejecting it beats storing a
 * balance that reads like a bank failure.
 */
export const MAX_AMOUNT_CENTS = 50_000_000;

/** Far-future bound for occurred_at, matching due_at's bound in records.ts. */
export const MAX_EPOCH = 4_102_444_800;

/**
 * Who may decide, order, receive and cancel other people's part orders.
 *
 * NOT a role, and not a positive role list at the route either. Coaches and
 * mentors always can; any other member can be granted it, because the team
 * treasurer is often a student and that is the point of the business sub-team.
 * The flag rides the membership row that `requireMember` already fetches, so
 * asking costs nothing.
 *
 * A viewer with the flag is still refused: the flag extends a member's reach,
 * it does not turn an outsider into a member. That case should be impossible
 * to create through the roster UI, and this line is why it stays harmless if
 * somebody creates it anyway.
 */
export function canApproveOrders(member: MemberRow): boolean {
  if (member.role === 'viewer') return false;
  if (member.role === 'coach' || member.role === 'mentor') return true;
  return member.is_purchase_approver === 1;
}

// ------------------------------------------------------------ season months

/** Upper bound on the columns one series may carry. See seasonMonths. */
export const MAX_SERIES_MONTHS = 24;

/** One month of a season, as a local calendar month plus the epoch it opens. */
export interface MonthSlot {
  y: number;
  m: number;
  /** Epoch seconds of local midnight on the 1st, in the team's zone. */
  start: number;
}

/**
 * A season's months, in the team's zone.
 *
 * Deliberately NOT `strftime('%Y-%m', occurred_at, 'unixepoch')`. That buckets
 * in UTC, so a receipt entered at 8pm EDT on Oct 31 books to November and the
 * cash-flow chart shows a column of money the team spent in a different month.
 * lib/tz.ts is the authority for this whole class of bug, and its header
 * documents the DST failure it exists to prevent.
 *
 * Each month is resolved INDEPENDENTLY from (y, m, 1, 00:00, tz) rather than by
 * adding 30 days to the previous one — the gap between two local midnights is
 * not constant, which is rule 1 in lib/tz.ts.
 *
 * Note the deliberate split: the RANGE of months is read in UTC, the BOUNDARY
 * of each one in the team's zone. seasons.starts_at is authored as
 * `Date.UTC(y, 8, 1)` (auth.ts currentSeason: the FTC season is Sept 1-May 31),
 * so Sept 1 UTC is Aug 31 8pm in New York — reading the range locally would
 * prepend an August column that can never hold anything. Reading it in UTC
 * matches how the row was written and yields the nine months a team would name.
 * The boundaries still have to be local midnights, or a transaction lands in
 * the wrong column, so a line dated in that Aug 31 sliver folds into September
 * via the ladder's leading edge-catch.
 *
 * The `{y, m}` ride along so the client can label a column from the same pair
 * that defined it. Re-deriving the month from an epoch in the browser is what
 * makes a label disagree with the column it sits under.
 */
export function seasonMonths(
  startsAt: number,
  endsAt: number,
  tz: string,
): MonthSlot[] {
  const from = new Date(startsAt * 1000);
  const to = new Date(Math.max(startsAt, endsAt) * 1000);
  const lastY = to.getUTCFullYear();
  const lastM = to.getUTCMonth() + 1;

  const slots: MonthSlot[] = [];
  let y = from.getUTCFullYear();
  let m = from.getUTCMonth() + 1;
  // A season is ~9 months. The cap is a guard against a mis-entered ends_at
  // decades out turning one request into a thousand-branch CASE ladder.
  while (slots.length < MAX_SERIES_MONTHS) {
    slots.push({ y, m, start: zonedTimeToEpoch(y, m, 1, 0, 0, tz) });
    if (y === lastY && m === lastM) break;
    if (m === 12) {
      y += 1;
      m = 1;
    } else {
      m += 1;
    }
  }
  return slots;
}

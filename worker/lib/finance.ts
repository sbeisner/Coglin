/**
 * Finance vocabulary and the approval gate.
 *
 * The validators mirror `meetings.ts`: values first, types derived, because a
 * hand-written union plus a matching array has already bitten once (see the
 * header there). `src/types.ts` holds the client's copy for labels — the two
 * are kept in sync by hand, for the reason `roles.ts` explains.
 */
import type { MemberRow } from './tenancy';

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

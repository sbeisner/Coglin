/**
 * Sponsorship vocabulary.
 *
 * Values first, types derived, same as `meetings.ts` and `finance.ts` — the
 * argument for it is in the header of meetings.ts and it has already been paid
 * for once. The `oneOf` factory is three lines and is copied rather than
 * exported from finance.ts, matching how each domain lib carries its own.
 *
 * `src/types.ts` holds the client's labels and must be kept in sync by hand
 * (worker tsconfig includes only `worker/`).
 */
import type { TransactionKind } from './finance';

/**
 * Where a conversation with a business currently stands.
 *
 * 'pitched' rather than 'meeting': `meeting` is already a table, a route, a nav
 * section and a CandidateSourceType here, and `isProspectStage('meeting')`
 * sitting next to `isCandidateSourceType('meeting')` would be a sentence nobody
 * can read twice the same way.
 *
 * 'committed' IS in this list, because a row can hold it and the client has to
 * label it. It is deliberately NOT settable through `PATCH /prospects/:id` —
 * committing creates a sponsor record, so only the commit route may write it,
 * and that route is the only place the promote guard exists. See
 * `isSettableStage` below, which is what the PATCH handler actually calls.
 */
export const PROSPECT_STAGES = [
  'researching',
  'contacted',
  'pitched',
  'committed',
  'declined',
] as const;
export type ProspectStage = (typeof PROSPECT_STAGES)[number];

/**
 * How a prospect got here. 'ai' is reserved for the prospect-research feature
 * and is never read from a request body — a client cannot claim a row was found
 * by the model.
 */
export const PROSPECT_SOURCES = ['manual', 'ai'] as const;
export type ProspectSource = (typeof PROSPECT_SOURCES)[number];

/**
 * Caps. Both are "past this you are describing something other than an FTC
 * team's sponsorship program", and both are reported rather than silently
 * truncated so somebody who has typed twelve tiers finds out why the
 * thirteenth did not land.
 */
export const MAX_TIERS = 12;
export const MAX_CAMPAIGNS = 10;

/** Gap between adjacent tier positions, matching POSITION_GAP in meetings.ts. */
export const TIER_POSITION_GAP = 1024;

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

export const isProspectStage = oneOf(PROSPECT_STAGES);

/**
 * The stages a stage-edit may set. Every one except 'committed', for the reason
 * given above.
 */
export function isSettableStage(value: unknown): value is Exclude<ProspectStage, 'committed'> {
  return isProspectStage(value) && value !== 'committed';
}

/**
 * A sponsor payment is always this kind and category. Not parameters — the
 * whole point of the route is that it books one specific shape of ledger line,
 * and 'sponsorship' is the income category 0009 reserved for exactly this.
 */
export const SPONSOR_PAYMENT_KIND: TransactionKind = 'income';
export const SPONSOR_PAYMENT_CATEGORY = 'sponsorship';

/**
 * A lightweight sanity check, not validation.
 *
 * Matching the auth.ts precedent (`email.includes('@')`) rather than a regex:
 * the address is a note about who to call, nothing is sent to it by this
 * feature, and refusing a legitimately odd corporate address would be worse
 * than storing a typo somebody can see and fix.
 */
export function looksLikeEmail(value: string): boolean {
  return value.includes('@');
}

/**
 * http(s) only. A `javascript:` URL stored here would be handed to every
 * teammate who opens the pipeline — the same guard the part-order route
 * applies to product links.
 */
export function isWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

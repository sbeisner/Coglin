/**
 * Newsletter vocabulary.
 *
 * Values first, types derived — the rule meetings.ts explains and finance.ts
 * and sponsorship.ts both follow. `src/types.ts` holds the client's labels and
 * is kept in sync by hand.
 */

/**
 * Where an update stands.
 *
 * 'sent' asserts something happened outside this system: a person copied the
 * text out and mailed it. So it is settable only by the mark-sent route, never
 * by an ordinary PATCH and never by a background job — see `isSettableStatus`,
 * which is what the edit handler actually calls, and the header of
 * migrations/0011_newsletters.sql for why no cron may ever write it.
 */
export const NEWSLETTER_STATUSES = ['draft', 'scheduled', 'sent'] as const;
export type NewsletterStatus = (typeof NEWSLETTER_STATUSES)[number];

const oneOf =
  <T extends string>(values: readonly T[]) =>
  (value: unknown): value is T =>
    typeof value === 'string' && (values as readonly string[]).includes(value);

export const isNewsletterStatus = oneOf(NEWSLETTER_STATUSES);

/** Every status an edit may set: both of them that a person can honestly claim. */
export function isSettableStatus(
  value: unknown,
): value is Exclude<NewsletterStatus, 'sent'> {
  return isNewsletterStatus(value) && value !== 'sent';
}

/** Far-future bound for scheduled_for, matching MAX_EPOCH in finance.ts. */
export const MAX_EPOCH = 4_102_444_800;

/**
 * Enough to catch a typo, not enough to reject a legitimately odd corporate
 * address. Same call auth.ts makes about a coach's email and 0010 makes about
 * a prospect contact's: nothing is delivered by this feature, so a strict
 * regex would only ever refuse a real address somebody wanted to keep.
 */
export function looksLikeEmail(value: string): boolean {
  return value.includes('@');
}

/**
 * Normalise an address for the uniqueness index.
 *
 * Lower-cased and trimmed, because "Dana@Example.com" and "dana@example.com"
 * are one person and a list that mails them twice is a list nobody trusts.
 * The local part of an address is technically case-sensitive; no mail provider
 * a small business uses treats it that way, and duplicate sponsor mail is the
 * worse failure.
 */
export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

/** A contact may be mailed only if it opted in and has not opted out since. */
export function isSubscribed(row: {
  subscribed_at: number | null;
  unsubscribed_at: number | null;
}): boolean {
  if (row.subscribed_at === null) return false;
  if (row.unsubscribed_at === null) return true;
  return row.subscribed_at > row.unsubscribed_at;
}

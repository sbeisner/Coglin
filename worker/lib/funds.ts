/**
 * Fund vocabulary and the derived questions the screens actually ask.
 *
 * A fund is a pot of money. Some pots expire (a district allocation you must
 * spend by June 30) and some do not (sponsorship, donations). The whole
 * distinction is whether `expires_at` is set — see the header of
 * migrations/0012_funds.sql for why that is one column rather than two.
 *
 * `src/types.ts` mirrors the three predicates below for the client, the same
 * way it mirrors `isSubscribed` from lib/newsletters.ts.
 */

/**
 * How far ahead to start warning that money is about to disappear.
 *
 * Sixty days, not thirty. School spending usually has to go through a
 * requisition or a purchase order, and that takes weeks to clear — so a
 * warning that arrives thirty days out is a warning about money the team can
 * no longer realistically convert into parts. Sixty gives them a month of
 * build season to actually spend it, which is the only outcome that matters.
 */
export const EXPIRY_WARNING_DAYS = 60;

/** Seconds in the warning window, since every timestamp here is epoch seconds. */
export const EXPIRY_WARNING_SECONDS = EXPIRY_WARNING_DAYS * 86_400;

/**
 * A team has a handful of pots: an allocation, a booster line, sponsorship,
 * maybe a named grant. Twenty is far past that and exists so a runaway script
 * cannot fill the table — hit it and the route says so rather than silently
 * accepting the twenty-first.
 */
export const MAX_FUNDS = 20;

export const MAX_FUND_NAME = 120;
export const MAX_FUND_NOTE = 500;

/** The shape the predicates below need. Both routes and tests build it. */
export interface FundTiming {
  expires_at: number | null;
}

/** Use-or-lose. The absence of a deadline is what makes a fund carry over. */
export function isExpiring(fund: FundTiming): boolean {
  return fund.expires_at !== null;
}

/**
 * The deadline has passed. Nothing in this codebase acts on that — no cron, no
 * status flip — because a fund quietly zeroing itself would be the app
 * asserting something about the world it cannot know. The screen says
 * "expired" and shows what was left; a person decides what that means.
 */
export function isExpired(fund: FundTiming, now: number): boolean {
  return fund.expires_at !== null && fund.expires_at < now;
}

/** Expiring, not yet expired, and close enough that somebody should act. */
export function isExpiringSoon(fund: FundTiming, now: number): boolean {
  if (fund.expires_at === null) return false;
  if (fund.expires_at < now) return false;
  return fund.expires_at - now <= EXPIRY_WARNING_SECONDS;
}

/**
 * The team's default pot, or null when it has none.
 *
 * Shared by every writer that books money without being told which pot it came
 * from — the manual ledger create, part-order mark-ordered, sponsor payments —
 * so those three cannot drift on what "the default" means.
 *
 * Null is a normal answer: a team that has never set up funds books everything
 * unassigned, which is exactly how the ledger behaved before funds existed.
 */
export async function defaultFundId(
  db: D1Database,
  teamId: string,
): Promise<string | null> {
  const row = await db
    .prepare('SELECT id FROM funds WHERE team_id = ? AND is_default = 1 LIMIT 1')
    .bind(teamId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * Resolve the fund a write should use: the one it named, else the default.
 *
 * Returns `{ error }` when the named fund is not this team's, which the caller
 * turns into a 400 — a client naming another team's pot is a bug or a probe,
 * and either way the write must not land somewhere invisible to its owner.
 */
export async function resolveFundId(
  db: D1Database,
  teamId: string,
  requested: string | null | undefined,
): Promise<{ fundId: string | null } | { error: 'invalid_fund' }> {
  if (requested === undefined) return { fundId: await defaultFundId(db, teamId) };
  // An explicit null means "unassigned", which is a deliberate choice and not
  // the same as saying nothing.
  if (requested === null) return { fundId: null };

  const row = await db
    .prepare('SELECT id FROM funds WHERE id = ? AND team_id = ?')
    .bind(requested, teamId)
    .first<{ id: string }>();
  if (!row) return { error: 'invalid_fund' };
  return { fundId: row.id };
}

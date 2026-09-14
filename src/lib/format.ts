/**
 * Formatting helpers. All timestamps in this app are epoch SECONDS, matching
 * the D1 schema — every conversion to milliseconds happens here and nowhere
 * else, so there is one place to be wrong.
 */

const DAY = 86400;

export function toDate(epochSeconds: number): Date {
  return new Date(epochSeconds * 1000);
}

export function formatDate(epochSeconds: number): string {
  return toDate(epochSeconds).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function formatLongDate(epochSeconds: number): string {
  return toDate(epochSeconds).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

export function formatTime(epochSeconds: number): string {
  return toDate(epochSeconds).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function daysBetween(from: number, to: number): number {
  return Math.round((to - from) / DAY);
}

/**
 * "in 3 days" / "2 days ago" / "today". Deliberately plain — a due date is
 * operational information, and cute phrasing makes it harder to scan.
 */
export function relativeDays(epochSeconds: number, now: number): string {
  const d = daysBetween(now, epochSeconds);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d < 0) return `${Math.abs(d)} days ago`;
  return `in ${d} days`;
}

export function isOverdue(dueAt: number | null, now: number): boolean {
  return dueAt !== null && dueAt < now;
}

/** 4.5 → "4.5", 3 → "3". Hours are logged in halves; don't print "3.0". */
export function formatHours(hours: number): string {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

export function formatCount(n: number): string {
  return n.toLocaleString();
}

/**
 * Cents → "$312.40". Money is INTEGER cents everywhere (see 0009_finance.sql),
 * so the one division by 100 lives here — the same single-conversion rule as
 * the seconds→milliseconds one at the top of this file.
 */
export function formatCents(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
  });
}

/**
 * "$14.99" typed into a form → 1499, or null when it does not parse. Accepts
 * a leading $ and commas, because people paste prices from vendor pages.
 */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/^\$/, '').replace(/,/g, '');
  if (cleaned.length === 0 || !/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(parseFloat(cleaned) * 100);
}

/** "Nadia Cole" → "NC". Two letters max; initials get crowded past that. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

// ------------------------------------------------------------------- calendar

/**
 * A month, as a calendar fact rather than an instant. `m` is 1-12, mirroring
 * LocalDate in worker/lib/tz.ts so both sides count months the same way.
 */
export interface CalendarMonth {
  y: number;
  m: number;
}

/**
 * Which calendar day an instant falls on, as the integer YYYYMMDD.
 *
 * A day is an integer here and never a Date, for three reasons. It is the same
 * encoding the schema already uses for `meetings.series_slot` (see toSlot in
 * worker/lib/tz.ts), so client and server describe "which day" identically.
 * Integers compare, sort and key React lists with no allocation. And an array of
 * 42 Date objects invites epoch arithmetic across a DST boundary, which is
 * exactly the silent failure worker/lib/tz.ts exists to prevent.
 *
 * This reads the browser's zone, deliberately, because that is the zone every
 * other function in this file formats in. A grid bucketed by the TEAM's timezone
 * wrapping rows formatted in the viewer's would print a cell saying Tuesday
 * around a row saying Wednesday, about the same meeting — worse than either
 * consistent choice. Making it zone-aware is one optional parameter here plus the
 * same argument threaded through the four formatters above, and it needs
 * `timezone` added to the session payload (worker/routes/auth.ts) because
 * Session['team'] does not carry it. That is its own commit: it touches auth.
 */
export function dayKey(epochSeconds: number): number {
  const d = toDate(epochSeconds);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

export function monthOf(epochSeconds: number): CalendarMonth {
  const d = toDate(epochSeconds);
  return { y: d.getFullYear(), m: d.getMonth() + 1 };
}

/** The month containing a YYYYMMDD day. */
export function monthOfDay(day: number): CalendarMonth {
  return { y: Math.floor(day / 10000), m: Math.floor((day % 10000) / 100) };
}

/** Month arithmetic that rolls the year. Date.UTC normalises m = 0 and m = 13. */
export function addMonths({ y, m }: CalendarMonth, delta: number): CalendarMonth {
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/**
 * The month's cells as YYYYMMDD day keys: six whole weeks, always.
 *
 * All arithmetic goes through Date.UTC. A calendar date has no timezone in it, so
 * the safe place to add days to one is the only place with no DST — the same
 * rule, for the same reason, as addLocalDay in worker/lib/tz.ts.
 *
 * There is no month-length table and no leap-year branch: passing a day index
 * past the end of a month to Date.UTC normalises it into the next one, so
 * February gets 28 or 29 for free and 2100 — divisible by 100, not a leap year —
 * is right without anybody having to remember the rule.
 *
 * SIX rows, not five-or-six. A grid that is 5 rows in November and 6 in December
 * changes height when you press the arrow, which moves everything below it; on a
 * phone that means the day list you were reading jumps out from under your thumb
 * mid-tap. About half of all months pay for one mostly-grey trailing row, and a
 * control that does not move is worth more than that row.
 *
 * Week starts Sunday. Not Intl.Locale#getWeekInfo: it is not reliably present,
 * and worse, it would put the grid out of step with WEEKDAYS in types.ts and with
 * MeetingSeries.days_of_week, which are already 0 = Sunday. A calendar starting
 * Monday while the recurrence picker starts Sunday is a bug that only ever shows
 * up as a mis-click.
 */
export function monthGrid(y: number, m: number, weekStartsOn = 0): number[] {
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() - weekStartsOn + 7) % 7;
  const cells: number[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(Date.UTC(y, m - 1, 1 - lead + i));
    cells.push(
      d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate(),
    );
  }
  return cells;
}

/**
 * "September 2026".
 *
 * `timeZone: 'UTC'` is load-bearing. This Date is UTC midnight on the 1st, and in
 * any negative-offset zone — which is every zone an FTC team is in — default local
 * formatting prints the PREVIOUS month, so a September grid gets an "August 2026"
 * header. One option, and the header stops lying.
 */
export function formatMonthTitle({ y, m }: CalendarMonth): string {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * "Sep" — a chart column's label. Short because nine of them share the width of
 * a phone, and built from {y, m} rather than an epoch for formatMonthTitle's
 * reason: the pair IS the month, so it cannot drift by a timezone.
 */
export function formatMonthAbbr({ y, m }: CalendarMonth): string {
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, {
    month: 'short',
    timeZone: 'UTC',
  });
}

/** "Tuesday, September 8" — a day cell's accessible name. */
export function formatDayName(day: number): string {
  const y = Math.floor(day / 10000);
  const m = Math.floor((day % 10000) / 100);
  const d = day % 100;
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

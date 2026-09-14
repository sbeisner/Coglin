import { describe, expect, it } from 'vitest';
import {
  addMonths,
  dayKey,
  formatBytes,
  formatDayName,
  formatMonthTitle,
  monthGrid,
  monthOf,
  monthOfDay,
} from './format';

/**
 * The calendar arithmetic, which is the part that is silently wrong when it is
 * wrong — a grid with 41 cells or a February that skips the 29th still renders.
 * worker/lib/tz.test.ts is the standing precedent for testing this and trusting
 * nothing else.
 *
 * These run in workerd like every other test here, which carries full ICU, so the
 * Intl assertions are real.
 */

function dayOfWeek(day: number): number {
  const y = Math.floor(day / 10000);
  const m = Math.floor((day % 10000) / 100);
  return new Date(Date.UTC(y, m - 1, day % 100)).getUTCDay();
}

function toUtc(day: number): number {
  const y = Math.floor(day / 10000);
  const m = Math.floor((day % 10000) / 100);
  return Date.UTC(y, m - 1, day % 100);
}

describe('monthGrid', () => {
  it('is always six whole weeks, for every month of two years', () => {
    // Six rows regardless of month length or start weekday: the grid must not
    // change height when somebody presses the arrow.
    for (const y of [2026, 2027]) {
      for (let m = 1; m <= 12; m++) {
        expect(monthGrid(y, m), `${y}-${m}`).toHaveLength(42);
      }
    }
  });

  it('produces consecutive days with no gap or repeat', () => {
    // The invariant that catches a bad month rollover without hardcoding 42
    // expectations: every cell is exactly one day after the one before it.
    for (const y of [2024, 2026, 2100]) {
      for (let m = 1; m <= 12; m++) {
        const cells = monthGrid(y, m);
        for (let i = 1; i < cells.length; i++) {
          expect(toUtc(cells[i]) - toUtc(cells[i - 1]), `${y}-${m} cell ${i}`).toBe(
            86400_000,
          );
        }
      }
    }
  });

  it('starts every row on the week start', () => {
    for (const y of [2026, 2027]) {
      for (let m = 1; m <= 12; m++) {
        const cells = monthGrid(y, m);
        for (let row = 0; row < 6; row++) {
          expect(dayOfWeek(cells[row * 7]), `${y}-${m} row ${row}`).toBe(0);
        }
      }
    }
  });

  it('has no lead cells when a month starts on the week start', () => {
    // 2026-02-01 is a Sunday, so the first cell is the 1st itself.
    expect(monthGrid(2026, 2)[0]).toBe(20260201);
  });

  it('has six lead cells when a month starts on a Saturday', () => {
    // 2026-08-01 is a Saturday, the worst case for a Sunday-start week.
    const cells = monthGrid(2026, 8);
    expect(cells[0]).toBe(20260726);
    expect(cells[6]).toBe(20260801);
  });

  it('gets leap years right without a rule anybody has to remember', () => {
    // 2024 is a leap year. 2100 is divisible by 100 and is NOT — the case
    // hand-rolled month-length tables get wrong.
    expect(monthGrid(2024, 2)).toContain(20240229);
    expect(monthGrid(2100, 2)).not.toContain(21000229);
    expect(monthGrid(2100, 2)).toContain(21000228);
  });
});

describe('month arithmetic', () => {
  it('rolls the year in both directions', () => {
    expect(addMonths({ y: 2026, m: 12 }, 1)).toEqual({ y: 2027, m: 1 });
    expect(addMonths({ y: 2026, m: 1 }, -1)).toEqual({ y: 2025, m: 12 });
    expect(addMonths({ y: 2026, m: 6 }, 12)).toEqual({ y: 2027, m: 6 });
  });

  it('round-trips a day back to its month', () => {
    expect(monthOfDay(20260908)).toEqual({ y: 2026, m: 9 });
    expect(monthOfDay(20261231)).toEqual({ y: 2026, m: 12 });
  });
});

describe('formatting', () => {
  it('names the month the grid is actually showing', () => {
    // The assertion that catches a missing timeZone: 'UTC'. Without it, workerd's
    // default zone makes a September grid print an August header.
    expect(formatMonthTitle({ y: 2026, m: 9 })).toContain('September');
    expect(formatMonthTitle({ y: 2026, m: 9 })).toContain('2026');
    expect(formatMonthTitle({ y: 2026, m: 1 })).toContain('January');
  });

  it('names a day for a screen reader', () => {
    // 2026-09-08 is a Tuesday. Same UTC reasoning as the month title.
    const name = formatDayName(20260908);
    expect(name).toContain('Tuesday');
    expect(name).toContain('September');
    expect(name).toContain('8');
  });
});

describe('dayKey', () => {
  it('agrees with the browser calendar it is derived from', () => {
    // Asserted against locally derived getters, never hardcoded integers:
    // hardcoding passes on a laptop in America/New_York and fails in CI at UTC,
    // and this config sets no TZ.
    for (const seconds of [0, 1_780_000_000, 1_800_000_000, 2_000_000_000]) {
      const d = new Date(seconds * 1000);
      expect(dayKey(seconds)).toBe(
        d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate(),
      );
    }
  });

  it('agrees with monthOf about which month a day is in', () => {
    const seconds = 1_800_000_000;
    expect(monthOfDay(dayKey(seconds))).toEqual(monthOf(seconds));
  });
});

describe('formatBytes', () => {
  it('uses decimal units, the way a file manager does', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(999)).toBe('999 B');
    expect(formatBytes(1000)).toBe('1 KB');
    expect(formatBytes(45_000)).toBe('45 KB');
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
  });

  it('keeps a decimal in megabytes, so the 25 MB limit is legible', () => {
    expect(formatBytes(24_900_000)).toBe('24.9 MB');
    expect(formatBytes(25 * 1000 * 1000)).toBe('25.0 MB');
  });

  it('says nothing rather than something wrong', () => {
    expect(formatBytes(-1)).toBe('');
    expect(formatBytes(Number.NaN)).toBe('');
  });
});

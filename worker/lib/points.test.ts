import { describe, expect, it } from 'vitest';
import {
  POINT_RULES,
  candidatePoints,
  docPoints,
  outreachPoints,
  scoreBoard,
  walkStreak,
  type ScoringInput,
  type ScoringMark,
} from './points';

/**
 * The scoring rules are the part students will argue with, so every number a
 * student can see is pinned here. The route test covers which rows reach these
 * functions; this file covers what they make of them.
 */

const empty = (): ScoringInput => ({
  members: [],
  meetings: [],
  marks: [],
  docs: [],
  candidates: [],
  outreach: [],
});

const mark = (
  meeting_id: string,
  member_id: string,
  state: string,
  confirmed = 1,
): ScoringMark => ({ meeting_id, member_id, state, confirmed });

describe('walkStreak', () => {
  it('banks a bonus at every multiple of five and keeps it after a break', () => {
    const result = walkStreak([
      ...Array<'extend'>(7).fill('extend'),
      'break',
      ...Array<'extend'>(10).fill('extend'),
    ]);
    // 5 (first run), then 5 and 10 (second run).
    expect(result.bonus).toBe(3 * POINT_RULES.streakBonus);
    expect(result.best).toBe(10);
    expect(result.current).toBe(10);
  });

  it('lets neutral meetings pass without extending or breaking', () => {
    const result = walkStreak(['extend', 'extend', 'neutral', 'extend', 'extend', 'extend']);
    expect(result.current).toBe(5);
    expect(result.bonus).toBe(POINT_RULES.streakBonus);
  });
});

describe('per-record rules', () => {
  it('scores documents by length, with a floor', () => {
    expect(docPoints(POINT_RULES.docMinChars - 1)).toBe(0);
    expect(docPoints(POINT_RULES.docMinChars)).toBe(POINT_RULES.doc);
    expect(docPoints(POINT_RULES.docLongChars)).toBe(POINT_RULES.docLong);
  });

  it('scores a flag only once a coach has kept it', () => {
    expect(candidatePoints('candidate')).toBe(0);
    expect(candidatePoints('rejected')).toBe(0);
    expect(candidatePoints('shortlisted')).toBe(POINT_RULES.shortlisted);
    expect(candidatePoints('placed')).toBe(POINT_RULES.placed);
  });

  it('caps outreach per event and survives junk hours', () => {
    expect(outreachPoints(0)).toBe(POINT_RULES.outreachBase);
    expect(outreachPoints(2)).toBe(POINT_RULES.outreachBase + 2 * POINT_RULES.outreachPerHour);
    expect(outreachPoints(100)).toBe(POINT_RULES.outreachCap);
    expect(outreachPoints(Number.NaN)).toBe(POINT_RULES.outreachBase);
  });
});

describe('scoreBoard', () => {
  it('scores only confirmed presence, and skips meetings with no roll taken', () => {
    const input = empty();
    input.members = [{ id: 'ada', display_name: 'Ada' }];
    input.meetings = [
      { id: 'm1', starts_at: 1 },
      { id: 'm2', starts_at: 2 }, // nobody took the roll
      { id: 'm3', starts_at: 3 },
      { id: 'm4', starts_at: 4 },
    ];
    input.marks = [
      mark('m1', 'ada', 'present'),
      mark('m3', 'ada', 'present', 0), // self check-in, not yet confirmed
      mark('m3', 'coachs-kid', 'present'), // so the roll on m3 WAS taken
      mark('m4', 'ada', 'present'),
    ];
    const [ada] = scoreBoard(input).members;
    expect(ada.breakdown.attendance).toBe(2 * POINT_RULES.attendance);
    // m2 skipped, m3 neutral: the run is unbroken.
    expect(ada.streak.current).toBe(2);
  });

  it('breaks a streak on absent or on being left off a taken roll, not on other', () => {
    const input = empty();
    input.members = [
      { id: 'ada', display_name: 'Ada' },
      { id: 'grace', display_name: 'Grace' },
    ];
    input.meetings = [
      { id: 'm1', starts_at: 1 },
      { id: 'm2', starts_at: 2 },
      { id: 'm3', starts_at: 3 },
    ];
    input.marks = [
      mark('m1', 'ada', 'present'),
      mark('m1', 'grace', 'present'),
      mark('m2', 'ada', 'other'),
      // grace has no row on m2, which ada's mark proves was taken
      mark('m3', 'ada', 'present'),
      mark('m3', 'grace', 'present'),
    ];
    const byId = new Map(scoreBoard(input).members.map((m) => [m.member_id, m]));
    expect(byId.get('ada')?.streak).toEqual({ current: 2, best: 2 });
    expect(byId.get('grace')?.streak).toEqual({ current: 1, best: 1 });
  });

  it('ranks with shared places and totals the team', () => {
    const input = empty();
    input.members = [
      { id: 'a', display_name: 'Ada' },
      { id: 'b', display_name: 'Bea' },
      { id: 'c', display_name: 'Cy' },
    ];
    input.docs = [
      { created_by: 'a', chars: 300 },
      { created_by: 'b', chars: 300 },
      { created_by: 'c', chars: 2000 },
      { created_by: 'not-a-student', chars: 5000 },
    ];
    const board = scoreBoard(input);
    expect(board.members.map((m) => [m.display_name, m.rank])).toEqual([
      ['Cy', 1],
      ['Ada', 2],
      ['Bea', 2],
    ]);
    expect(board.team_total).toBe(POINT_RULES.doc * 2 + POINT_RULES.docLong);
  });

  it('derives badges from the same numbers', () => {
    const input = empty();
    input.members = [{ id: 'a', display_name: 'Ada' }];
    input.meetings = Array.from({ length: 10 }, (_, i) => ({ id: `m${i}`, starts_at: i }));
    input.marks = input.meetings.map((m) => mark(m.id, 'a', 'present'));
    input.docs = [{ created_by: 'a', chars: 250 }];
    input.candidates = [{ flagged_by: 'a', state: 'placed' }];
    const [ada] = scoreBoard(input).members;
    // 100 attendance + 30 streak + 5 doc + 15 placed
    expect(ada.total).toBe(150);
    expect(ada.badges).toEqual([
      'first_doc',
      'streak_5',
      'streak_10',
      'first_placed',
      'points_100',
    ]);
  });
});

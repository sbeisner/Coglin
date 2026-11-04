/**
 * Team points: the scoring rules behind GET /api/points.
 *
 * Pure functions over plain rows, so the arithmetic is testable without D1 and
 * the route stays a list of SELECTs. Nothing here is stored. Points are DERIVED
 * from records the team already keeps, every time they are read, which is the
 * whole privacy argument for the feature (see the header of routes/points.ts):
 * there is no new table of facts about a named minor, and correcting a roll or
 * deleting a document corrects the score with no second write to forget.
 *
 * The weights live in POINT_RULES and nowhere else. The client mirrors them in
 * src/types.ts for the "how points work" panel, the same duplication lib/roles.ts
 * accepts for seven string literals. If you change a number here, change it
 * there too.
 */

export const POINT_RULES = {
  /** A coach-confirmed `present` at a held meeting. */
  attendance: 10,
  /** Awarded each time a run of consecutive meetings reaches a multiple of this. */
  streakEvery: 5,
  streakBonus: 15,
  /**
   * A document the student created. The floor stops a one-word page from
   * scoring; the higher tier rewards an actual writeup over a stub. Measured on
   * content_text, which the Worker derives and never accepts from a client.
   */
  docMinChars: 200,
  doc: 5,
  docLongChars: 1500,
  docLong: 10,
  /**
   * Something the student flagged, once a coach has kept it. Flagging alone
   * scores nothing: points for the act would reward flagging everything, and
   * the inbox is where quality is decided.
   */
  shortlisted: 5,
  placed: 15,
  /** Outreach the student logged: a base, plus per hour, capped per event. */
  outreachBase: 5,
  outreachPerHour: 2,
  outreachCap: 25,
} as const;

export const POINT_MILESTONES = [100, 250, 500] as const;

/**
 * Badge keys, never labels. The client owns the copy, the same way the attendance
 * panel owns the copy for error codes.
 */
export type Badge =
  | 'first_doc'
  | 'streak_5'
  | 'streak_10'
  | 'first_placed'
  | 'points_100'
  | 'points_250'
  | 'points_500';

export interface ScoringMember {
  id: string;
  display_name: string;
}

/** A held meeting of the season, in no particular order. */
export interface ScoringMeeting {
  id: string;
  starts_at: number;
}

export interface ScoringMark {
  meeting_id: string;
  member_id: string;
  state: string;
  /** 1 when somebody other than the student recorded the mark. */
  confirmed: number;
}

export interface ScoringDoc {
  created_by: string;
  chars: number;
}

export interface ScoringCandidate {
  flagged_by: string;
  state: string;
}

export interface ScoringOutreach {
  created_by: string;
  hours: number;
}

export interface ScoringInput {
  members: ScoringMember[];
  meetings: ScoringMeeting[];
  marks: ScoringMark[];
  docs: ScoringDoc[];
  candidates: ScoringCandidate[];
  outreach: ScoringOutreach[];
}

export interface Breakdown {
  attendance: number;
  streak: number;
  docs: number;
  portfolio: number;
  outreach: number;
}

export interface MemberPoints {
  member_id: string;
  display_name: string;
  rank: number;
  total: number;
  breakdown: Breakdown;
  streak: { current: number; best: number };
  badges: Badge[];
}

export interface PointsBoard {
  team_total: number;
  members: MemberPoints[];
}

export function docPoints(chars: number): number {
  if (chars >= POINT_RULES.docLongChars) return POINT_RULES.docLong;
  if (chars >= POINT_RULES.docMinChars) return POINT_RULES.doc;
  return 0;
}

export function candidatePoints(state: string): number {
  if (state === 'placed') return POINT_RULES.placed;
  if (state === 'shortlisted') return POINT_RULES.shortlisted;
  return 0;
}

export function outreachPoints(hours: number): number {
  const safe = Number.isFinite(hours) && hours > 0 ? hours : 0;
  return Math.min(
    POINT_RULES.outreachCap,
    POINT_RULES.outreachBase + POINT_RULES.outreachPerHour * Math.round(safe),
  );
}

/** What one meeting did to one student's run. */
export type StreakStep = 'extend' | 'break' | 'neutral';

/**
 * Walk one student's season in meeting order.
 *
 * Only meetings where a roll was actually TAKEN take part, meaning at least one
 * confirmed mark exists for anybody. A held meeting nobody took the roll for
 * says nothing about who was there, and breaking every streak on the team
 * because a coach forgot is punishing the students for the adult.
 *
 * Within a taken roll:
 * - confirmed `present` extends the run.
 * - `absent`, or no row at all while others were marked, breaks it.
 * - `other` is neutral. It is overwhelmingly "late" or "excused", and the 0005
 *   migration made it one bucket of prose that cannot be read mechanically, so
 *   it neither rewards nor punishes.
 * - an UNCONFIRMED self check-in is neutral too. It is a claim waiting on a
 *   coach, and a student should not lose a run because the coach has not
 *   reached their row yet.
 *
 * The bonus is banked as it is reached and survives a later break: a run of
 * seven that ends keeps the bonus it earned at five.
 */
export function walkStreak(steps: StreakStep[]): {
  current: number;
  best: number;
  bonus: number;
} {
  let current = 0;
  let best = 0;
  let bonus = 0;
  for (const step of steps) {
    if (step === 'extend') {
      current += 1;
      if (current > best) best = current;
      if (current % POINT_RULES.streakEvery === 0) bonus += POINT_RULES.streakBonus;
    } else if (step === 'break') {
      current = 0;
    }
  }
  return { current, best, bonus };
}

function badgesFor(
  total: number,
  docCount: number,
  placedCount: number,
  best: number,
): Badge[] {
  const badges: Badge[] = [];
  if (docCount > 0) badges.push('first_doc');
  if (best >= 5) badges.push('streak_5');
  if (best >= 10) badges.push('streak_10');
  if (placedCount > 0) badges.push('first_placed');
  for (const milestone of POINT_MILESTONES) {
    if (total >= milestone) badges.push(`points_${milestone}`);
  }
  return badges;
}

export function scoreBoard(input: ScoringInput): PointsBoard {
  const memberIds = new Set(input.members.map((m) => m.id));

  // meeting -> member -> mark, and the meetings whose roll was taken.
  const marksByMeeting = new Map<string, Map<string, ScoringMark>>();
  const rollTaken = new Set<string>();
  for (const mark of input.marks) {
    let row = marksByMeeting.get(mark.meeting_id);
    if (!row) marksByMeeting.set(mark.meeting_id, (row = new Map()));
    row.set(mark.member_id, mark);
    if (mark.confirmed) rollTaken.add(mark.meeting_id);
  }
  const ordered = input.meetings
    .filter((m) => rollTaken.has(m.id))
    .sort((a, b) => a.starts_at - b.starts_at || a.id.localeCompare(b.id));

  const docs = new Map<string, { points: number; count: number }>();
  for (const doc of input.docs) {
    if (!memberIds.has(doc.created_by)) continue;
    const points = docPoints(doc.chars);
    if (points === 0) continue;
    const entry = docs.get(doc.created_by) ?? { points: 0, count: 0 };
    entry.points += points;
    entry.count += 1;
    docs.set(doc.created_by, entry);
  }

  const portfolio = new Map<string, { points: number; placed: number }>();
  for (const cand of input.candidates) {
    if (!memberIds.has(cand.flagged_by)) continue;
    const entry = portfolio.get(cand.flagged_by) ?? { points: 0, placed: 0 };
    entry.points += candidatePoints(cand.state);
    if (cand.state === 'placed') entry.placed += 1;
    portfolio.set(cand.flagged_by, entry);
  }

  const outreach = new Map<string, number>();
  for (const event of input.outreach) {
    if (!memberIds.has(event.created_by)) continue;
    outreach.set(
      event.created_by,
      (outreach.get(event.created_by) ?? 0) + outreachPoints(event.hours),
    );
  }

  const scored = input.members.map((member) => {
    let attendance = 0;
    const steps: StreakStep[] = ordered.map((meeting) => {
      const mark = marksByMeeting.get(meeting.id)?.get(member.id);
      if (!mark) return 'break';
      if (mark.state === 'absent') return 'break';
      if (mark.state === 'present' && mark.confirmed) {
        attendance += POINT_RULES.attendance;
        return 'extend';
      }
      return 'neutral';
    });
    const streak = walkStreak(steps);
    const doc = docs.get(member.id) ?? { points: 0, count: 0 };
    const port = portfolio.get(member.id) ?? { points: 0, placed: 0 };
    const breakdown: Breakdown = {
      attendance,
      streak: streak.bonus,
      docs: doc.points,
      portfolio: port.points,
      outreach: outreach.get(member.id) ?? 0,
    };
    const total =
      breakdown.attendance +
      breakdown.streak +
      breakdown.docs +
      breakdown.portfolio +
      breakdown.outreach;
    return {
      member_id: member.id,
      display_name: member.display_name,
      rank: 0,
      total,
      breakdown,
      streak: { current: streak.current, best: streak.best },
      badges: badgesFor(total, doc.count, port.placed, streak.best),
    };
  });

  scored.sort(
    (a, b) => b.total - a.total || a.display_name.localeCompare(b.display_name),
  );
  // Standard competition ranking, 1-2-2-4: two students on the same score share
  // a place, and nobody is told they came second to a tie-break on their name.
  scored.forEach((row, i) => {
    row.rank = i > 0 && row.total === scored[i - 1].total ? scored[i - 1].rank : i + 1;
  });

  return {
    team_total: scored.reduce((sum, row) => sum + row.total, 0),
    members: scored,
  };
}

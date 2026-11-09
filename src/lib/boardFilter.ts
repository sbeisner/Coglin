/**
 * The Boards "Mine" filter, kept pure for the same reason `boardOrder.ts` is:
 * the repo has no DOM test environment, so anything worth testing lives
 * outside the component.
 *
 * The filter is display-only. Drag-and-drop still positions cards against the
 * FULL column (see `moveOps`), so a student reordering their own cards never
 * scrambles the hidden ones around them.
 */
import type { Task } from '@/types';

/** Who the board is filtered to: `null` shows everyone's cards. */
export type BoardScope = { memberId: string } | null;

export function inScope(task: Task, scope: BoardScope): boolean {
  return scope === null || task.assignee_member_id === scope.memberId;
}

/**
 * How many of a member's cards sit on each board, so the board switcher can
 * point a student at the board their work is on instead of making them click
 * through every tab to find it. Boards with none are absent, not zero.
 */
export function assignedCountByBoard(
  tasks: Task[],
  memberId: string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const t of tasks) {
    if (t.assignee_member_id !== memberId) continue;
    counts.set(t.board_id, (counts.get(t.board_id) ?? 0) + 1);
  }
  return counts;
}

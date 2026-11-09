import { describe, expect, it } from 'vitest';
import { assignedCountByBoard, inScope } from './boardFilter';
import type { Task } from '@/types';

// Relative import for the module under test: vitest.config.ts has no `@` alias
// (see boardOrder.test.ts). The `@/types` import is type-only and erased.

const task = (id: string, assignee: string | null, boardId = 'board-1'): Task => ({
  id,
  team_id: 'team-1',
  board_id: boardId,
  title: id,
  body: null,
  assignee_member_id: assignee,
  status: 'todo',
  due_at: null,
  position: 1024,
  decision_log: null,
  created_at: 0,
  updated_at: 0,
});

describe('inScope', () => {
  it('shows every card when the board is not filtered', () => {
    expect(inScope(task('a', null), null)).toBe(true);
    expect(inScope(task('b', 'm-2'), null)).toBe(true);
  });

  it('shows only cards assigned to the member when filtered', () => {
    const scope = { memberId: 'm-1' };
    expect(inScope(task('a', 'm-1'), scope)).toBe(true);
    expect(inScope(task('b', 'm-2'), scope)).toBe(false);
    // Unassigned is nobody's — it must not leak into "Mine".
    expect(inScope(task('c', null), scope)).toBe(false);
  });
});

describe('assignedCountByBoard', () => {
  it('counts one member’s cards per board and omits boards with none', () => {
    const counts = assignedCountByBoard(
      [
        task('a', 'm-1', 'board-1'),
        task('b', 'm-1', 'board-1'),
        task('c', 'm-2', 'board-1'),
        task('d', 'm-1', 'board-2'),
        task('e', null, 'board-3'),
      ],
      'm-1',
    );
    expect(Object.fromEntries(counts)).toEqual({ 'board-1': 2, 'board-2': 1 });
  });
});

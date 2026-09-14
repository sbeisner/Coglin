import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { Plus } from 'lucide-react';
import * as api from '@/lib/api';
import { Unauthenticated } from '@/lib/api';
import { columnTasks, moveOps } from '@/lib/boardOrder';
import { useAsync } from '@/lib/useAsync';
import { useBoardPoll } from '@/lib/useBoardPoll';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  SUB_TEAMS,
  TASK_COLUMNS,
  type BoardOp,
  type SubTeam,
  type Task,
  type TaskStatus,
} from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { Column } from '@/components/board/Column';
import { BoardMenu } from '@/components/board/BoardMenu';
import { DraggableTaskCard, TaskCard } from '@/components/board/TaskCard';
import { TaskDialog } from '@/components/board/TaskDialog';
import { cn } from '@/lib/utils';

/**
 * The lanes a team actually splits into, offered so nobody starts from blank.
 *
 * Derived from SUB_TEAMS rather than hand-listed, which fixes two things at
 * once: the hand-listed version covered five of the seven sub-teams, so
 * Business and Drive had no starter board at all; and every starter board was
 * NAMED after a sub-team while carrying `sub_team: null`, because the button
 * called createBoard with no second argument. The badge on the board header was
 * therefore always empty on exactly the boards that most obviously had one.
 */
const STARTER_BOARDS = SUB_TEAMS;

/**
 * Codes, not sentences, cross the api boundary — so the copy lives here.
 * Every one of these is reachable: a season that has not been rolled over, a
 * stale bundle sending a retired sub-team, two people deleting the same card.
 */
const ERROR_COPY: Record<string, string> = {
  no_current_season: 'This team has no current season yet, so a board has nowhere to live.',
  missing_name: 'Give the board a name.',
  missing_title: 'A task needs a title.',
  invalid_sub_team: 'That is not one of the sub-teams. Reload and try again.',
  invalid_status: 'That is not one of the columns. Reload and try again.',
  invalid_position: 'Could not work out where to put that. Reload and try again.',
  too_many_ops: 'That was too many changes at once. Reload and try again.',
  forbidden: 'You do not have permission to change this board.',
  not_found: 'That is already gone. Someone else may have deleted it.',
};

const SUB_TEAM_LABEL = new Map(SUB_TEAMS.map((st) => [st.id, st.label]));

export default function Boards() {
  const now = api.now();
  const [reloadKey, setReloadKey] = useState(0);
  const boards = useAsync(api.listBoards, [reloadKey]);
  const members = useAsync(api.listMembers);
  const allTasks = useAsync(() => api.listTasks(), [reloadKey]);
  const { member, team } = useSession();
  const canManage = member.role === 'coach' || member.role === 'mentor';
  const canEdit = member.role !== 'viewer';
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [boardId, setBoardId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [adding, setAdding] = useState<TaskStatus | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [rev, setRev] = useState<{ rev: number; count: number } | null>(null);
  const addRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (allTasks.data) setTasks(allTasks.data);
  }, [allTasks.data]);

  useEffect(() => {
    // `boards.data?.[0]`, not `boards.data[0]`: a team with no boards is the
    // normal state for everyone who signs up, and indexing straight into the
    // empty array threw before the screen could render at all. The fixtures
    // always had boards, which is precisely why this survived until real data.
    const first = boards.data?.[0];
    if (first && boardId === null) setBoardId(first.id);
  }, [boards.data, boardId]);

  // A fresh board means a fresh revision baseline, or the first poll would see
  // "changed" and refetch a board it already has.
  useEffect(() => {
    setRev(null);
    setAdding(null);
  }, [boardId]);

  const sensors = useSensors(
    // A small distance threshold so tapping a card to open it isn't read as a
    // drag — critical on a phone, where every tap starts as a touch-move.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const memberById = useMemo(
    () => new Map((members.data ?? []).map((m) => [m.id, m])),
    [members.data],
  );

  const board = boards.data?.find((b) => b.id === boardId) ?? null;
  const openTask = tasks.find((t) => t.id === openTaskId) ?? null;

  /**
   * Every mutation goes through the same op shape the server accepts at
   * POST /api/boards/:id/mutate, so the Durable Object (COG-009) can later
   * replay this stream unchanged.
   *
   * Optimistic, then reconciled: local state moves first so a drag feels
   * instant, the server's authoritative task list replaces it on success, and a
   * failure puts the snapshot back. The old version `void`-ed this promise,
   * which meant a 403 or a 409 left the card sitting in its new column until
   * the next reload quietly moved it home.
   */
  const applyOps = useCallback(
    async (ops: BoardOp[]): Promise<void> => {
      if (!boardId || ops.length === 0) return;
      const snapshot = tasks;

      setTasks((prev) => {
        let next = prev;
        for (const op of ops) {
          switch (op.op) {
            case 'move_task':
              next = next.map((t) =>
                t.id === op.task_id
                  ? { ...t, status: op.status, position: op.position }
                  : t,
              );
              break;
            case 'update_task':
              next = next.map((t) => (t.id === op.task_id ? { ...t, ...op.patch } : t));
              break;
            case 'create_task':
              next = [...next, op.task];
              break;
            case 'delete_task':
              next = next.filter((t) => t.id !== op.task_id);
              break;
          }
        }
        return next;
      });

      setPending(true);
      setError(null);
      try {
        const result = await api.mutateBoard(boardId, ops);
        // Adopt the server's copy, and its revision, so the next poll tick does
        // not refetch a board we just wrote.
        setTasks((prev) => [
          ...prev.filter((t) => t.board_id !== boardId),
          ...result.tasks,
        ]);
        setRev({
          rev: result.tasks.reduce((max, t) => Math.max(max, t.updated_at), 0),
          count: result.tasks.length,
        });
      } catch (err) {
        if (err instanceof Unauthenticated) return;
        setTasks(snapshot);
        setError(err instanceof Error ? err.message : '');
      } finally {
        setPending(false);
      }
    },
    [boardId, tasks],
  );

  const onPollTasks = useCallback((polledBoardId: string, next: Task[]) => {
    setTasks((prev) => [...prev.filter((t) => t.board_id !== polledBoardId), ...next]);
  }, []);

  useBoardPoll({
    boardId,
    // A poll landing mid-drag or mid-write would overwrite the optimistic state
    // with the server's pre-move copy, and the card would snap back under the
    // cursor.
    paused: draggingId !== null || pending,
    onTasks: onPollTasks,
    onRev: setRev,
    knownRev: rev,
  });

  async function createBoard(name: string, subTeam?: SubTeam | null): Promise<void> {
    setPending(true);
    setError(null);
    try {
      const created = await api.createBoard({ name, sub_team: subTeam ?? null });
      setReloadKey((k) => k + 1);
      setBoardId(created.id);
    } catch (err) {
      if (err instanceof Unauthenticated) return;
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  async function addTask(status: TaskStatus, title: string): Promise<void> {
    const trimmed = title.trim();
    if (!trimmed || !boardId) return;
    const column = columnTasks(tasks, boardId, status);
    const last = column[column.length - 1];
    await applyOps([
      {
        op: 'create_task',
        task: {
          // The client names the id so the op is idempotent: `create_task` is
          // ON CONFLICT DO NOTHING server-side, which turns a wifi retry into a
          // no-op instead of a duplicate card.
          id: crypto.randomUUID(),
          // Filled to satisfy the Task shape. The server ignores it and uses the
          // session's team — a client that could name its own team_id is the one
          // bug this codebase cannot ship (worker/lib/tenancy.ts).
          team_id: team.id,
          board_id: boardId,
          title: trimmed,
          body: null,
          assignee_member_id: null,
          status,
          due_at: null,
          position: (last?.position ?? 0) + 1024,
          decision_log: null,
          created_at: now,
          updated_at: now,
        },
      },
    ]);
    setNewTitle('');
    addRef.current?.focus();
  }

  function onDragStart(e: DragStartEvent) {
    setDraggingId(String(e.active.id));
  }

  /**
   * Resolve a drop into ops.
   *
   * `over.id` is either a bare status (dropped on the column, including its
   * empty space) or another card's id (dropped between cards). The old version
   * only handled the first and hardcoded `position: 0`, which is why order
   * degraded on every drag and same-column reordering did nothing at all.
   */
  function onDragEnd(e: DragEndEvent) {
    setDraggingId(null);
    const over = e.over?.id;
    if (!over || !boardId) return;

    const taskId = String(e.active.id);
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;

    const overId = String(over);
    const asStatus = TASK_COLUMNS.find((c) => c.id === overId)?.id;

    let status: TaskStatus;
    let index: number;
    if (asStatus) {
      status = asStatus;
      index = columnTasks(tasks, boardId, status).filter((t) => t.id !== taskId).length;
    } else {
      const target = tasks.find((t) => t.id === overId);
      if (!target) return;
      status = target.status;
      const column = columnTasks(tasks, boardId, status).filter((t) => t.id !== taskId);
      const at = column.findIndex((t) => t.id === overId);
      index = at === -1 ? column.length : at;
    }

    if (task.status === status) {
      const column = columnTasks(tasks, boardId, status);
      // Already exactly there — do not spend a write on it.
      if (column.findIndex((t) => t.id === taskId) === index) return;
    }

    void applyOps(moveOps(tasks, boardId, taskId, status, index));
  }

  const dragging = tasks.find((t) => t.id === draggingId);
  const noBoards = boards.status === 'ready' && (boards.data?.length ?? 0) === 0;

  return (
    <>
      <PageHeader eyebrow="Build season" title="Boards">
        {canEdit && board && (
          <Button size="sm" onClick={() => setAdding('todo')}>
            <Plus className="size-4" aria-hidden />
            Add task
          </Button>
        )}
      </PageHeader>

      {/* Board switcher. Horizontal scroll on narrow screens rather than a
          select — five sub-teams is few enough to see all at once. */}
      {!noBoards && (
        <div className="border-border flex items-center gap-2 overflow-x-auto border-b px-4 md:px-8">
          <div className="flex flex-1 gap-1 py-2">
            {boards.status === 'loading' && <Skeleton className="h-9 w-64" />}
            {boards.data?.map((b) => (
              <button
                key={b.id}
                onClick={() => setBoardId(b.id)}
                className={cn(
                  'focus-visible:ring-ring relative min-h-9 shrink-0 rounded-md px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
                  b.id === boardId
                    ? 'text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {b.name}
                {b.sub_team && (
                  <span className="text-muted-foreground ml-1.5 text-xs font-normal">
                    {SUB_TEAM_LABEL.get(b.sub_team)}
                  </span>
                )}
                {b.id === boardId && (
                  <span
                    className="u-bar absolute inset-x-2 -bottom-2 h-[3px]"
                    aria-hidden
                  />
                )}
              </button>
            ))}
            {canManage && <NewBoard disabled={pending} onCreate={createBoard} />}
          </div>
          {board && (
            <BoardMenu
              board={board}
              canManage={canManage}
              canDelete={member.role === 'coach'}
              onRename={async (patch) => {
                await api.updateBoard(board.id, patch);
                setReloadKey((k) => k + 1);
              }}
              onDelete={async (force) => {
                try {
                  await api.deleteBoard(board.id, force);
                } catch (err) {
                  const code = err instanceof Error ? err.message : '';
                  // The server reports the blast radius; hand it back so the
                  // confirm can name a number instead of asking blind.
                  if (code === 'board_has_tasks') {
                    const count = tasks.filter((t) => t.board_id === board.id).length;
                    return { blockedBy: count };
                  }
                  setError(code);
                  return;
                }
                setBoardId(null);
                setReloadKey((k) => k + 1);
              }}
            />
          )}
        </div>
      )}

      <div className="px-4 py-6 md:px-8">
        {/* A team with no boards leaves boardId null forever, so this case has
            to come first — otherwise the condition below treats "nothing to
            select" as "still loading" and the screen shows skeletons that never
            resolve. */}
        {noBoards ? (
          <EmptyState
            title="No boards yet."
            aside={
              canManage
                ? 'Make one per sub-team. Action items from a meeting land on whichever board you pick.'
                : 'Your coach has not set up any boards yet.'
            }
            action={
              canManage ? (
                <div className="flex flex-wrap justify-center gap-2">
                  {STARTER_BOARDS.map((st) => (
                    <Button
                      key={st.id}
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() => void createBoard(st.label, st.id)}
                    >
                      {st.label}
                    </Button>
                  ))}
                </div>
              ) : undefined
            }
          />
        ) : /* boardId is null for a beat after the boards resolve. Without it in
              this condition the screen flashes an empty board before the first
              one is selected. */
        allTasks.status === 'loading' || boardId === null ? (
          <div className="grid gap-3 md:grid-cols-4">
            {TASK_COLUMNS.map((c) => (
              <Skeleton key={c.id} className="h-64" />
            ))}
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            // Announcements describe the OUTCOME, not a grid position — "moved
            // to In progress" is actionable, "moved to position 2 of 4" is not.
            accessibility={{
              announcements: {
                onDragStart: ({ active }) => `Picked up ${label(tasks, active.id)}.`,
                onDragOver: ({ active, over }) =>
                  over
                    ? `${label(tasks, active.id)} is over ${target(tasks, over.id)}.`
                    : `${label(tasks, active.id)} is not over a column.`,
                onDragEnd: ({ active, over }) =>
                  over
                    ? `Moved ${label(tasks, active.id)} to ${target(tasks, over.id)}.`
                    : `${label(tasks, active.id)} was dropped.`,
                onDragCancel: ({ active }) => `Left ${label(tasks, active.id)} where it was.`,
              },
            }}
          >
            {/* Horizontal scroll on phones — pit day means one thumb and a
                narrow screen, not a shrunken desktop grid. */}
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-2 md:-mx-8 md:px-8 xl:mx-0 xl:grid xl:grid-cols-4 xl:overflow-visible xl:px-0">
              {TASK_COLUMNS.map((col) => {
                const items = columnTasks(tasks, boardId, col.id);
                return (
                  <Column
                    key={col.id}
                    status={col.id}
                    label={col.label}
                    ids={items.map((t) => t.id)}
                    canEdit={canEdit}
                    onAdd={(status) => {
                      setAdding(status);
                      setNewTitle('');
                    }}
                  >
                    {items.map((t) => (
                      <DraggableTaskCard
                        key={t.id}
                        task={t}
                        assignee={
                          t.assignee_member_id
                            ? memberById.get(t.assignee_member_id)
                            : undefined
                        }
                        now={now}
                        onOpen={(task) => setOpenTaskId(task.id)}
                      />
                    ))}

                    {adding === col.id && (
                      <div className="bg-card border-border rounded-md border p-2">
                        <Input
                          ref={addRef}
                          autoFocus
                          value={newTitle}
                          maxLength={200}
                          placeholder="Mount the chassis"
                          aria-label={`New task in ${col.label}`}
                          onChange={(e) => setNewTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              void addTask(col.id, newTitle);
                            }
                            if (e.key === 'Escape') setAdding(null);
                          }}
                          className="min-h-11 md:min-h-9"
                        />
                        <div className="mt-2 flex gap-2">
                          <Button
                            size="sm"
                            disabled={pending || newTitle.trim() === ''}
                            onClick={() => void addTask(col.id, newTitle)}
                          >
                            Add
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setAdding(null)}>
                            Done
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* The first-run prompt lives INSIDE the column rather than
                        replacing the board, so the drop targets still exist. The
                        old empty state removed every one of them, which made a
                        new board a dead end you could not add a card to. */}
                    {col.id === 'todo' &&
                      items.length === 0 &&
                      adding === null &&
                      tasks.filter((t) => t.board_id === boardId).length === 0 && (
                        <p className="text-muted-foreground px-2 py-3 text-sm">
                          Nothing here yet. Coglin approves, but the season does not.
                        </p>
                      )}
                  </Column>
                );
              })}
            </div>

            <DragOverlay>
              {dragging ? (
                <TaskCard
                  task={dragging}
                  assignee={
                    dragging.assignee_member_id
                      ? memberById.get(dragging.assignee_member_id)
                      : undefined
                  }
                  now={now}
                />
              ) : null}
            </DragOverlay>
          </DndContext>
        )}

        {error && (
          <p
            role="alert"
            className="text-destructive border-border mt-4 rounded-md border border-dashed px-3 py-2.5 text-sm"
          >
            {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
          </p>
        )}
      </div>

      <TaskDialog
        task={openTask}
        assignee={
          openTask?.assignee_member_id
            ? memberById.get(openTask.assignee_member_id)
            : undefined
        }
        members={members.data ?? []}
        now={now}
        canEdit={canEdit}
        onOpenChange={(open) => !open && setOpenTaskId(null)}
        onPatch={(task, patch) =>
          void applyOps([{ op: 'update_task', task_id: task.id, patch }])
        }
        onDelete={(task) => void applyOps([{ op: 'delete_task', task_id: task.id }])}
      />
    </>
  );
}

/** The "no sub-team" option. Select has no value for null, so it needs a token. */
const NO_SUB_TEAM = '__none__';

/** Inline "new board", so a sixth board is possible once the empty state is gone. */
function NewBoard({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (name: string, subTeam?: SubTeam | null) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  // Pickable at creation, not only afterwards through the board's own settings
  // dialog. The server has always accepted sub_team on POST /api/boards; there
  // was simply no control here, so every hand-made board started unlabelled and
  // most stayed that way.
  const [subTeam, setSubTeam] = useState<string>(NO_SUB_TEAM);

  function submit() {
    if (!name.trim()) return;
    void onCreate(
      name.trim(),
      subTeam === NO_SUB_TEAM ? null : (subTeam as SubTeam),
    ).then(() => {
      setName('');
      setSubTeam(NO_SUB_TEAM);
      setOpen(false);
    });
  }

  if (!open) {
    return (
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground shrink-0"
        onClick={() => setOpen(true)}
      >
        <Plus className="size-4" aria-hidden />
        New board
      </Button>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1">
      <Input
        autoFocus
        value={name}
        maxLength={100}
        disabled={disabled}
        placeholder="Drivetrain"
        aria-label="New board name"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') setOpen(false);
        }}
        className="min-h-9 w-40"
      />
      <Select value={subTeam} onValueChange={setSubTeam} disabled={disabled}>
        <SelectTrigger className="min-h-9 w-36" aria-label="Sub-team">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_SUB_TEAM}>No sub-team</SelectItem>
          {SUB_TEAMS.map((st) => (
            <SelectItem key={st.id} value={st.id}>
              {st.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        size="sm"
        variant="ghost"
        disabled={disabled || name.trim() === ''}
        onClick={submit}
      >
        Add
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
        Cancel
      </Button>
    </div>
  );
}

function label(tasks: Task[], id: string | number): string {
  return tasks.find((t) => t.id === String(id))?.title ?? 'this task';
}

function target(tasks: Task[], id: string | number): string {
  const asColumn = TASK_COLUMNS.find((c) => c.id === String(id));
  if (asColumn) return asColumn.label;
  const over = tasks.find((t) => t.id === String(id));
  if (!over) return 'the board';
  const column = TASK_COLUMNS.find((c) => c.id === over.status);
  return `${over.title} in ${column?.label ?? over.status}`;
}

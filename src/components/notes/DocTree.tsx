import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  ChevronDown,
  ChevronRight,
  FileText,
  GripVertical,
  Plus,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { buildTree, eligibleParents, type DocTreeNode } from '@/lib/docText';
import { formatLongDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { MeetingSummary, NoteDocSummary } from '@/types';

/**
 * The document sidebar, and the drag surface.
 *
 * DRAG TARGETS ARE EXPLICIT rather than offset-based. Drag-to-indent means owning
 * a flattened projection, onDragOver reparenting arithmetic and a fake drop
 * indicator — several hundred lines, and the buggiest part of every dnd-kit tree.
 * Four named droppables say the same things more legibly:
 *
 *   doc-row:{id}          become a subdocument of this page
 *   meeting-group:{id}    move to this meeting
 *   standalone-root       become standalone
 *
 * Reparenting and moving-to-another-meeting are one gesture with different
 * targets, and both resolve to one endpoint.
 *
 * There is NO KeyboardSensor. Boards.tsx registers one and then has to
 * stopPropagation on Enter and Space to get its own buttons back; next to a text
 * editor that fight gets worse. The accessible path is the row menu, which offers
 * every move the drag does — the same call NoteEditor.tsx made: "dragging is a
 * mouse affordance. These are the ones that work for a keyboard, a screen reader,
 * and a thumb in a pit."
 */

export function DocTree({
  docs,
  meetings,
  flagged,
  activeDocId,
  canEdit,
  onMove,
  onCreate,
  onRename,
  onDelete,
}: {
  docs: NoteDocSummary[];
  meetings: MeetingSummary[];
  flagged: Set<string>;
  activeDocId: string | null;
  canEdit: boolean;
  onMove: (
    docId: string,
    input: { parent_doc_id?: string | null; meeting_id?: string | null },
  ) => void;
  onCreate: (input: { parent_doc_id?: string; meeting_id?: string }) => void;
  onRename: (doc: NoteDocSummary) => void;
  onDelete: (doc: NoteDocSummary) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const sensors = useSensors(
    // Copied from Boards.tsx for the same reason: on a phone every tap starts as
    // a touch-move, and tapping a row must open the document, not start a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  /**
   * Two sections, because these are genuinely different things. A flat list makes
   * 39 weeks of meeting notes bury the four documents anybody maintains.
   */
  const { standalone, byMeeting } = useMemo(() => {
    const standaloneDocs = docs.filter((d) => d.meeting_id === null);
    const groups = new Map<string, NoteDocSummary[]>();
    for (const doc of docs) {
      if (doc.meeting_id === null) continue;
      const list = groups.get(doc.meeting_id) ?? [];
      list.push(doc);
      groups.set(doc.meeting_id, list);
    }
    // Newest first: a student opening this on a Tuesday evening wants tonight,
    // with the rest of the season below it.
    const ordered = [...groups.entries()]
      .map(([meetingId, list]) => ({
        meeting: meetings.find((m) => m.id === meetingId),
        meetingId,
        tree: buildTree(list),
      }))
      .sort((a, b) => (b.meeting?.starts_at ?? 0) - (a.meeting?.starts_at ?? 0));
    return { standalone: buildTree(standaloneDocs), byMeeting: ordered };
  }, [docs, meetings]);

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null);
      const docId = String(event.active.id);
      const over = event.over?.id ? String(event.over.id) : null;
      if (!over) return;

      if (over === 'standalone-root') {
        onMove(docId, { parent_doc_id: null, meeting_id: null });
        return;
      }
      if (over.startsWith('meeting-group:')) {
        onMove(docId, {
          parent_doc_id: null,
          meeting_id: over.slice('meeting-group:'.length),
        });
        return;
      }
      if (over.startsWith('doc-row:')) {
        const parentId = over.slice('doc-row:'.length);
        if (parentId === docId) return;
        onMove(docId, { parent_doc_id: parentId });
      }
    },
    [onMove],
  );

  const toggle = useCallback((docId: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  const draggedDoc = dragging ? docs.find((d) => d.id === dragging) : null;

  const rows = (nodes: DocTreeNode[], depth: number) =>
    nodes.map((node) => (
      <Row
        key={node.doc.id}
        node={node}
        depth={depth}
        docs={docs}
        meetings={meetings}
        flagged={flagged}
        activeDocId={activeDocId}
        canEdit={canEdit}
        collapsed={collapsed}
        onToggle={toggle}
        onMove={onMove}
        onCreate={onCreate}
        onRename={onRename}
        onDelete={onDelete}
        renderChildren={rows}
      />
    ));

  return (
    /* DndContext wraps the TREE ONLY, never the editor pane. A DndContext around a
       ProseMirror instance intercepts pointerdown and breaks select-by-drag inside
       the document — structural separation is the fix, not a guard clause. */
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => setDragging(String(event.active.id))}
      onDragCancel={() => setDragging(null)}
      onDragEnd={onDragEnd}
      /* These drop targets are abstract — "under this page", "into that meeting" —
         so a screen-reader user needs the outcome spoken rather than a position. */
      accessibility={{
        announcements: {
          onDragStart: ({ active }) =>
            `Picked up ${title(docs, active.id)}.`,
          onDragOver: ({ active, over }) =>
            over
              ? `${title(docs, active.id)} over ${target(docs, meetings, over.id)}.`
              : `${title(docs, active.id)} is not over a drop target.`,
          onDragEnd: ({ active, over }) =>
            over
              ? `Moved ${title(docs, active.id)} to ${target(docs, meetings, over.id)}.`
              : `${title(docs, active.id)} was left where it was.`,
          onDragCancel: ({ active }) =>
            `Cancelled. ${title(docs, active.id)} was left where it was.`,
        },
      }}
    >
      <div className="space-y-4">
        <Section
          id="standalone-root"
          label="Documents"
          canEdit={canEdit}
          onCreate={() => onCreate({})}
        >
          {standalone.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1.5 text-sm">
              Nothing on its own yet.
            </p>
          ) : (
            <ul>{rows(standalone, 0)}</ul>
          )}
        </Section>

        {byMeeting.map(({ meeting, meetingId, tree }) => (
          <Section
            key={meetingId}
            id={`meeting-group:${meetingId}`}
            label={
              meeting
                ? `${meeting.title} · ${formatLongDate(meeting.starts_at)}`
                : 'Meeting'
            }
            canEdit={canEdit}
            onCreate={() => onCreate({ meeting_id: meetingId })}
          >
            <ul>{rows(tree, 0)}</ul>
          </Section>
        ))}
      </div>

      {/* A static copy rather than transforming the original, so the tree does not
          reflow mid-drag. Same pattern as Boards.tsx. */}
      <DragOverlay>
        {draggedDoc && (
          <div className="bg-card border-border flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm shadow-lg">
            <FileText className="text-muted-foreground size-4" aria-hidden />
            {draggedDoc.title}
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}

/** Names for the drag announcements, so the spoken text is the actual outcome. */
function title(docs: NoteDocSummary[], id: string | number): string {
  return docs.find((d) => d.id === String(id))?.title ?? 'document';
}

function target(
  docs: NoteDocSummary[],
  meetings: MeetingSummary[],
  id: string | number,
): string {
  const over = String(id);
  if (over === 'standalone-root') return 'Documents';
  if (over.startsWith('meeting-group:')) {
    const meetingId = over.slice('meeting-group:'.length);
    return meetings.find((m) => m.id === meetingId)?.title ?? 'that meeting';
  }
  if (over.startsWith('doc-row:')) {
    return `under ${title(docs, over.slice('doc-row:'.length))}`;
  }
  return 'there';
}

function Section({
  id,
  label,
  canEdit,
  onCreate,
  children,
}: {
  id: string;
  label: string;
  canEdit: boolean;
  onCreate: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section
      ref={setNodeRef}
      className={cn('rounded-md', isOver && 'bg-accent ring-primary/40 ring-1')}
    >
      <div className="flex items-center justify-between gap-2 px-2">
        <h2 className="u-eyebrow truncate py-1">{label}</h2>
        {canEdit && (
          <button
            type="button"
            aria-label={`New document in ${label}`}
            onClick={onCreate}
            className="focus-visible:ring-ring text-muted-foreground hover:text-foreground flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:size-7"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Row({
  node,
  depth,
  docs,
  meetings,
  flagged,
  activeDocId,
  canEdit,
  collapsed,
  onToggle,
  onMove,
  onCreate,
  onRename,
  onDelete,
  renderChildren,
}: {
  node: DocTreeNode;
  depth: number;
  docs: NoteDocSummary[];
  meetings: MeetingSummary[];
  flagged: Set<string>;
  activeDocId: string | null;
  canEdit: boolean;
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onMove: (
    docId: string,
    input: { parent_doc_id?: string | null; meeting_id?: string | null },
  ) => void;
  onCreate: (input: { parent_doc_id?: string; meeting_id?: string }) => void;
  onRename: (doc: NoteDocSummary) => void;
  onDelete: (doc: NoteDocSummary) => void;
  renderChildren: (nodes: DocTreeNode[], depth: number) => React.ReactNode;
}) {
  const { doc, children } = node;
  const isOpen = !collapsed.has(doc.id);
  const { setNodeRef: setDropRef, isOver } = useDroppable({ id: `doc-row:${doc.id}` });
  const { attributes, listeners, setNodeRef: setDragRef } = useDraggable({ id: doc.id });
  const parents = useMemo(() => eligibleParents(docs, doc.id), [docs, doc.id]);

  return (
    <li ref={setDropRef}>
      <div
        className={cn(
          'group/row flex items-center gap-1 rounded-md pr-1',
          activeDocId === doc.id && 'bg-accent',
          isOver && 'ring-primary/40 ring-1',
        )}
        style={{ paddingLeft: `${depth * 12}px` }}
      >
        {children.length > 0 ? (
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={isOpen ? `Collapse ${doc.title}` : `Expand ${doc.title}`}
            onClick={() => onToggle(doc.id)}
            className="focus-visible:ring-ring text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded focus-visible:ring-2 focus-visible:outline-none md:size-6"
          >
            {isOpen ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="size-11 shrink-0 md:size-6" />
        )}

        <Link
          to={`/app/notes/${doc.id}`}
          className="focus-visible:ring-ring relative flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded text-sm focus-visible:ring-2 focus-visible:outline-none md:min-h-8"
        >
          {/* The same brand bar a flagged block used to get in the gutter.

              -left-1.5 puts it in the row's gap, not on the title: the Link has
              no left padding of its own (unlike the sidebar's SideLink, which
              parks its bar inside a pl-4), so the bar has to be pushed out past
              the text origin. -6px centres it in the 9px corridor between the
              chevron glyph and the first character — 3px clear either side. It
              is absolute rather than a flex child so a flagged row keeps the
              same title alignment as an unflagged one. */}
          {flagged.has(doc.id) && (
            <span className="u-bar absolute top-1 bottom-1 -left-1.5 w-[3px]" aria-hidden />
          )}
          <span
            className={cn(
              'truncate',
              doc.content_bytes <= 2 && 'text-muted-foreground italic',
            )}
          >
            {doc.title}
          </span>
        </Link>

        {canEdit && (
          <>
            {/* touch-none goes on THIS BUTTON and nowhere else, so the tree still
                scrolls under a thumb. Listeners here only, so a drag can never
                start from the link or the title text. */}
            <button
              ref={setDragRef}
              {...attributes}
              {...listeners}
              aria-label={`Reorder ${doc.title}`}
              className="focus-visible:ring-ring text-muted-foreground flex size-11 shrink-0 touch-none items-center justify-center rounded opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 max-md:opacity-60 focus-visible:ring-2 focus-visible:outline-none md:size-7"
            >
              <GripVertical className="size-4" aria-hidden />
            </button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Actions for ${doc.title}`}
                  className="focus-visible:ring-ring text-muted-foreground flex size-11 shrink-0 items-center justify-center rounded opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100 max-md:opacity-60 focus-visible:ring-2 focus-visible:outline-none md:size-7"
                >
                  ⋯
                </button>
              </DropdownMenuTrigger>
              {/* Every move the drag offers, for a keyboard and a screen reader. */}
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => onRename(doc)}>Rename</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => onCreate({ parent_doc_id: doc.id })}>
                  New subpage
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Make a subpage of…</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    {parents.length === 0 ? (
                      <DropdownMenuItem disabled>Nowhere to put it</DropdownMenuItem>
                    ) : (
                      parents.map((parent) => (
                        <DropdownMenuItem
                          key={parent.id}
                          onSelect={() => onMove(doc.id, { parent_doc_id: parent.id })}
                        >
                          {parent.title}
                        </DropdownMenuItem>
                      ))
                    )}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>Move to meeting…</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
                    <DropdownMenuItem
                      onSelect={() =>
                        onMove(doc.id, { parent_doc_id: null, meeting_id: null })
                      }
                    >
                      No meeting (standalone)
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    {meetings.map((meeting) => (
                      <DropdownMenuItem
                        key={meeting.id}
                        onSelect={() =>
                          onMove(doc.id, {
                            parent_doc_id: null,
                            meeting_id: meeting.id,
                          })
                        }
                      >
                        {meeting.title} · {formatLongDate(meeting.starts_at)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => onDelete(doc)}>
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {isOpen && children.length > 0 && <ul>{renderChildren(children, depth + 1)}</ul>}
    </li>
  );
}

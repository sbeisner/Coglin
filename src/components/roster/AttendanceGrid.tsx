import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/EmptyState';
import { formatDate, formatLongDate, initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AttendanceGrid as Grid, AttendanceState, Member } from '@/types';

type Cell = AttendanceState | 'unrecorded';

/**
 * Colour AND glyph, because a red/green grid read by somebody with
 * red-green colour blindness is a grid of identical squares. The fills are the
 * same tokens the readiness scale uses, so "amber" means "not quite" everywhere
 * in the app.
 */
const CELL: Record<Cell, { label: string; glyph: string; className: string }> = {
  present: { label: 'Present', glyph: '✓', className: 'bg-goblin text-black/70' },
  absent: {
    label: 'Absent',
    glyph: '✕',
    className: 'bg-destructive text-white',
  },
  other: { label: 'Note', glyph: '•', className: 'bg-amber text-black/70' },
  unrecorded: {
    label: 'Not recorded',
    glyph: '',
    className: 'bg-readiness-none text-muted-foreground',
  },
};

const LEGEND: Cell[] = ['present', 'other', 'absent', 'unrecorded'];

type SortKey = 'name' | 'rate';

/**
 * Students down the side, this season's held meetings across the top.
 *
 * The rate is present ÷ meetings held, so a meeting nobody took roll for
 * counts against the student. That is on purpose: the grey squares make a
 * patchy roll visible rather than flattering everybody's percentage.
 */
export function AttendanceGrid({
  grid,
  students,
}: {
  grid: Grid;
  students: Member[];
}) {
  const [sort, setSort] = useState<SortKey>('name');
  const scroller = useRef<HTMLDivElement>(null);

  const marks = useMemo(() => {
    const byKey = new Map<string, Grid['records'][number]>();
    for (const r of grid.records) byKey.set(`${r.member_id}:${r.meeting_id}`, r);
    return byKey;
  }, [grid.records]);

  const held = grid.meetings.length;

  const rows = useMemo(() => {
    const withCounts = students.map((member) => {
      let present = 0;
      for (const m of grid.meetings) {
        if (marks.get(`${member.id}:${m.id}`)?.state === 'present') present++;
      }
      return { member, present, rate: held === 0 ? 0 : present / held };
    });
    return withCounts.sort((a, b) =>
      sort === 'rate' && a.rate !== b.rate
        ? a.rate - b.rate
        : a.member.display_name.localeCompare(b.member.display_name),
    );
  }, [students, grid.meetings, marks, held, sort]);

  // The newest meetings are the ones a coach came here to check, and they are
  // on the right. On a phone that is off-screen, so start scrolled to it.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [held]);

  if (held === 0) {
    return (
      <EmptyState
        title="No meetings held yet this season"
        aside="Attendance shows up here once a meeting is started and roll is taken."
      />
    );
  }

  if (students.length === 0) {
    return <EmptyState title="No students on the roster yet" />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-2 text-xs">
          {LEGEND.map((c) => (
            <li key={c} className="flex items-center gap-1.5">
              <Swatch cell={c} />
              {c === 'other' ? 'Note (e.g. arrived late)' : CELL[c].label}
            </li>
          ))}
        </ul>

        <div
          role="radiogroup"
          aria-label="Sort students"
          className="border-border inline-flex rounded-md border p-0.5"
        >
          {(
            [
              ['name', 'Name'],
              ['rate', 'Lowest attendance'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={sort === id}
              onClick={() => setSort(id)}
              className={cn(
                'focus-visible:ring-ring min-h-11 rounded px-3 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none',
                sort === id ? 'bg-muted text-foreground' : 'text-muted-foreground',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-muted-foreground text-sm">
        <span className="tabular font-mono">{held}</span>{' '}
        {held === 1 ? 'meeting' : 'meetings'} held
        {grid.season ? ` in ${grid.season.label}` : ''}. Tap a square for the
        details.
      </p>

      <div
        ref={scroller}
        className="border-border bg-card overflow-x-auto rounded-lg border"
      >
        <table className="w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="bg-card border-border sticky left-0 z-10 border-b px-3 py-2 text-left font-medium"
              >
                Student
              </th>
              {grid.meetings.map((m) => (
                <th
                  key={m.id}
                  scope="col"
                  title={`${m.title} · ${formatLongDate(m.starts_at)}`}
                  className="border-border text-muted-foreground border-b px-1 py-2 align-bottom text-[11px] font-normal whitespace-nowrap"
                >
                  {/* Rotated so a season of columns stays 28px apiece. */}
                  <span className="tabular inline-block font-mono [writing-mode:vertical-rl] rotate-180">
                    {formatDate(m.starts_at)}
                  </span>
                </th>
              ))}
              {/* Soaks up the spare width on a wide screen, so the totals sit at
                  the right edge instead of trailing the last meeting. */}
              <th aria-hidden className="border-border w-full border-b" />
              <th
                scope="col"
                className="bg-card border-border sticky right-0 z-10 border-b border-l px-3 py-2 text-right font-medium"
              >
                Present
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ member, present, rate }) => (
              <tr key={member.id}>
                <th
                  scope="row"
                  className="bg-card border-border sticky left-0 z-10 border-b px-3 py-1.5 text-left font-normal"
                >
                  <div className="flex max-w-40 items-center gap-2 sm:max-w-56">
                    <Avatar className="size-7 shrink-0">
                      {member.photo_media_id && (
                        <AvatarImage src={`/media/${member.photo_media_id}`} alt="" />
                      )}
                      <AvatarFallback className="text-[10px]">
                        {initials(member.display_name)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{member.display_name}</span>
                  </div>
                </th>
                {grid.meetings.map((m) => {
                  const mark = marks.get(`${member.id}:${m.id}`);
                  return (
                    <td key={m.id} className="border-border border-b px-1 py-1.5 text-center">
                      <CellButton
                        cell={mark?.state ?? 'unrecorded'}
                        note={mark?.note ?? null}
                        meeting={m}
                        studentName={member.display_name}
                      />
                    </td>
                  );
                })}
                <td aria-hidden className="border-border border-b" />
                <td className="bg-card border-border tabular sticky right-0 z-10 border-b border-l px-3 py-1.5 text-right font-mono text-xs whitespace-nowrap">
                  {present}/{held}{' '}
                  <span
                    className={cn(
                      'ml-1',
                      rate < 0.5 ? 'text-destructive' : 'text-muted-foreground',
                    )}
                  >
                    {Math.round(rate * 100)}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Swatch({ cell }: { cell: Cell }) {
  const c = CELL[cell];
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-4 items-center justify-center rounded-[3px] text-[10px] leading-none font-bold',
        c.className,
      )}
    >
      {c.glyph}
    </span>
  );
}

/**
 * A menu rather than a tooltip, because the people reading this grid are on a
 * phone in a workshop and a tooltip never opens under a thumb. The native
 * `title` still gives a mouse the same line on hover.
 */
function CellButton({
  cell,
  note,
  meeting,
  studentName,
}: {
  cell: Cell;
  note: string | null;
  meeting: Grid['meetings'][number];
  studentName: string;
}) {
  const navigate = useNavigate();
  const c = CELL[cell];
  const date = formatDate(meeting.starts_at);
  const summary = `${date} ${meeting.title}: ${c.label}${note ? ` — ${note}` : ''}`;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={summary}
          aria-label={`${studentName}, ${summary}`}
          className={cn(
            'focus-visible:ring-ring inline-flex size-5 items-center justify-center rounded-[3px] text-[11px] leading-none font-bold focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:outline-none',
            c.className,
          )}
        >
          {c.glyph}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" className="w-64">
        <DropdownMenuLabel className="text-foreground font-normal">
          <div className="font-medium">{studentName}</div>
          <div className="text-muted-foreground text-xs">
            {meeting.title} · {formatLongDate(meeting.starts_at)}
          </div>
          <div className="mt-2 flex items-center gap-1.5">
            <Swatch cell={cell} />
            <span>{c.label}</span>
          </div>
          {note && <p className="mt-1 text-sm break-words">“{note}”</p>}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => navigate(`/app/meetings/${meeting.id}`)}>
          Open meeting to change the roll
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookmarkCheck, CalendarDays, List, MapPin } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import {
  formatDayName,
  formatLongDate,
  formatMonthTitle,
  formatTime,
  dayKey,
  monthOf,
  monthOfDay,
  relativeDays,
  type CalendarMonth,
} from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { Badge } from '@/components/ui/badge';
import { ScheduleMeetingDialog } from '@/components/meetings/ScheduleMeetingDialog';
import { MeetingCalendar } from '@/components/meetings/MeetingCalendar';
import { cn } from '@/lib/utils';
import { MEETING_KINDS, type MeetingSummary } from '@/types';

const KIND_LABEL = new Map(MEETING_KINDS.map((k) => [k.id, k.label]));

/**
 * "September 2026", for the month rules down the list.
 *
 * Delegates rather than formatting again, so the list's month rules and the
 * calendar's header cannot disagree about what to call a month.
 */
function monthLabel(epochSeconds: number): string {
  return formatMonthTitle(monthOf(epochSeconds));
}

type MeetingsView = 'list' | 'calendar';

const VIEWS: { id: MeetingsView; label: string; Icon: typeof List }[] = [
  { id: 'list', label: 'List', Icon: List },
  { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
];

const VIEW_KEY = 'coglin:meetings-view';

function storedView(): MeetingsView {
  try {
    return localStorage.getItem(VIEW_KEY) === 'calendar' ? 'calendar' : 'list';
  } catch {
    // A disabled or full localStorage must never stop this page rendering —
    // the same rule readDraft follows in lib/useNoteSync.ts.
    return 'list';
  }
}

function groupByMonth(
  meetings: MeetingSummary[],
): { month: string; meetings: MeetingSummary[] }[] {
  const groups: { month: string; meetings: MeetingSummary[] }[] = [];
  for (const meeting of meetings) {
    const month = monthLabel(meeting.starts_at);
    const last = groups[groups.length - 1];
    if (last && last.month === month) last.meetings.push(meeting);
    else groups.push({ month, meetings: [meeting] });
  }
  return groups;
}

function MeetingRow({ meeting, now }: { meeting: MeetingSummary; now: number }) {
  const cancelled = meeting.status === 'cancelled';
  const past = meeting.starts_at < now;

  return (
    <li>
      <Link
        to={`/app/meetings/${meeting.id}`}
        className={cn(
          'focus-visible:ring-ring block px-4 py-3.5 focus-visible:ring-2 focus-visible:outline-none',
          cancelled && 'opacity-60',
        )}
      >
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span
            className={cn(
              'flex-1 text-sm font-medium',
              cancelled && 'line-through',
            )}
          >
            {meeting.title}
          </span>
          <span className="text-muted-foreground tabular font-mono text-xs">
            {formatLongDate(meeting.starts_at)}
          </span>
        </div>

        <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="tabular font-mono">{formatTime(meeting.starts_at)}</span>
          {!past && !cancelled && (
            <span>{relativeDays(meeting.starts_at, now)}</span>
          )}
          {meeting.location && (
            <span className="inline-flex items-center gap-1">
              <MapPin className="size-3" aria-hidden />
              {meeting.location}
            </span>
          )}
          {meeting.kind !== 'build' && (
            <Badge variant="secondary">{KIND_LABEL.get(meeting.kind)}</Badge>
          )}
          {cancelled && <Badge variant="outline">Cancelled</Badge>}
          {meeting.attendance_count > 0 && (
            <span className="tabular font-mono">
              {meeting.attendance_count} there
            </span>
          )}
          {meeting.flagged_count > 0 && (
            <span className="text-primary-ink inline-flex items-center gap-1">
              <BookmarkCheck className="size-3" aria-hidden />
              <span className="tabular font-mono">{meeting.flagged_count}</span>
            </span>
          )}
          {/* The nag that makes the archive complete. A past meeting with no
              notes is the thing a Think submission cannot get back in March. */}
          {past && !cancelled && meeting.doc_count === 0 && (
            <span className="text-muted-foreground italic">No notes</span>
          )}
        </div>
      </Link>
    </li>
  );
}

export default function Meetings() {
  const [reloadKey, setReloadKey] = useState(0);
  const meetings = useAsync(() => api.listMeetings(), [reloadKey]);
  const season = useAsync(api.getCurrentSeason);
  const { member } = useSession();
  const canSchedule = member.role === 'coach' || member.role === 'mentor';
  const now = api.now();

  const list = useMemo(() => meetings.data ?? [], [meetings.data]);

  const { upcoming, past } = useMemo(() => {
    const upcoming = list.filter((m) => m.starts_at >= now);
    const past = list.filter((m) => m.starts_at < now).reverse();
    return { upcoming, past };
  }, [list, now]);

  /**
   * Default to Past when the last meeting ended within twelve hours and nobody
   * wrote anything down. The person opening this screen at 9pm just finished a
   * meeting, and what they want is the one they were in — not the next one.
   *
   * `doc_count` replaced `block_count` here and the rule is unchanged, not merely
   * renamed: pressing "Start meeting" seeds a document exactly as it used to seed
   * blocks, so "nobody wrote anything down" still means the same thing and still
   * stops firing once somebody has begun.
   */
  const [tab, setTab] = useState<'upcoming' | 'past' | null>(null);
  const activeTab =
    tab ??
    (past[0] && now - past[0].starts_at < 12 * 3600 && past[0].doc_count === 0
      ? 'past'
      : 'upcoming');

  const shown = activeTab === 'upcoming' ? upcoming : past;

  /**
   * The URL is authoritative and localStorage is only the default.
   *
   * ?view and ?day are what let the Dashboard's mini month link straight to the
   * right month with the right day already chosen. Writes use replace: true so
   * the back button does not walk backwards through view toggles.
   */
  const [params, setParams] = useSearchParams();
  const view: MeetingsView =
    params.get('view') === 'calendar'
      ? 'calendar'
      : params.has('view')
        ? 'list'
        : storedView();

  const dayParam = Number(params.get('day'));
  const linkedDay = Number.isFinite(dayParam) && dayParam > 0 ? dayParam : null;

  const setView = useCallback(
    (next: MeetingsView) => {
      const updated = new URLSearchParams(params);
      updated.set('view', next);
      setParams(updated, { replace: true });
      try {
        localStorage.setItem(VIEW_KEY, next);
      } catch {
        // Not being able to remember the preference is not worth an error.
      }
    },
    [params, setParams],
  );

  /**
   * Opens on TODAY's month, not the next meeting's. In July the next meeting is
   * in September, and somebody who opened this screen to find last week's
   * meeting would have to arrow backwards to get to it.
   */
  const [month, setMonth] = useState<CalendarMonth>(() =>
    linkedDay ? monthOfDay(linkedDay) : monthOf(now),
  );
  const [selectedDay, setSelectedDay] = useState<number | null>(
    () => linkedDay ?? null,
  );

  const dayMeetings = useMemo(
    () =>
      selectedDay === null
        ? []
        : list.filter((m) => dayKey(m.starts_at) === selectedDay),
    [list, selectedDay],
  );

  return (
    <>
      <PageHeader eyebrow="Season" title="Meetings" />

      <div className="space-y-6 px-4 py-6 md:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Upcoming/Past is hidden in calendar mode, not disabled. A month grid's
              axis IS the month, so "upcoming only" produces a half-empty September
              that looks like data loss — and a disabled control claims an option
              exists and is unavailable. `tab` state stays alive so switching back
              to List restores whatever the user had. */}
          <div
            className={cn(
              'border-border inline-flex rounded-md border p-0.5',
              view === 'calendar' && 'hidden',
            )}
            role="tablist"
          >
            {(['upcoming', 'past'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeTab === id}
                onClick={() => setTab(id)}
                className={cn(
                  'focus-visible:ring-ring min-h-11 rounded px-4 text-sm font-medium capitalize focus-visible:ring-2 focus-visible:outline-none',
                  activeTab === id
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground',
                )}
              >
                {id}
                {id === 'upcoming' && upcoming.length > 0 && (
                  <span className="tabular text-muted-foreground ml-1.5 font-mono text-xs">
                    {upcoming.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="ml-auto flex items-center gap-2">
            {/* A radiogroup, not a third tablist. The two tablists in this app
                switch WHICH records are listed; this switches how the same records
                are drawn, with no panel behind it — which is what ThemeToggle is,
                and it is styled to match its neighbour so the difference lives in
                the semantics rather than the pixels. */}
            <div
              role="radiogroup"
              aria-label="View"
              className="border-border inline-flex rounded-md border p-0.5"
            >
              {VIEWS.map(({ id, label, Icon }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={view === id}
                  onClick={() => setView(id)}
                  className={cn(
                    'focus-visible:ring-ring inline-flex min-h-11 items-center gap-2 rounded px-3 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none',
                    view === id ? 'bg-muted text-foreground' : 'text-muted-foreground',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {/* The label is the accessible name at every width; it is only
                      visually hidden on a phone, where the row also carries
                      Schedule. */}
                  <span className="sr-only sm:not-sr-only">{label}</span>
                </button>
              ))}
            </div>

            {canSchedule && (
              <ScheduleMeetingDialog
                season={season.data}
                onScheduled={() => setReloadKey((k) => k + 1)}
              />
            )}
          </div>
        </div>

        {/* Empty-before-loading, in the order Boards.tsx documents: checking the
            skeleton first makes "this team has nothing" render as a loading bar
            that never resolves. */}
        {meetings.status === 'ready' && list.length === 0 ? (
          <EmptyState
            title="Nothing on the calendar yet."
            aside={
              canSchedule
                ? 'Schedule your build nights once and Coglin will lay out the whole season.'
                : 'Your coach has not put the schedule in yet.'
            }
          />
        ) : meetings.status === 'loading' ? (
          <Skeleton className="h-64" />
        ) : meetings.status === 'error' ? (
          <EmptyState
            title="Could not load the schedule."
            aside="Check your connection and reload."
          />
        ) : view === 'calendar' ? (
          /* No `shown.length === 0` guard on this branch. An empty month is a true
             and useful answer — the grid still shows where today is and which way
             to arrow — so emptiness is reported inside the day area rather than by
             replacing the control that would let you leave it. */
          <div className="space-y-4">
            <MeetingCalendar
              meetings={list}
              now={now}
              month={month}
              onMonthChange={setMonth}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
            {selectedDay !== null && (
              <section>
                <h2 className="u-eyebrow mb-3">{formatDayName(selectedDay)}</h2>
                {dayMeetings.length === 0 ? (
                  <p className="text-muted-foreground text-sm">Nothing on this day.</p>
                ) : (
                  <ul className="bg-card border-border divide-border divide-y rounded-lg border">
                    {dayMeetings.map((meeting) => (
                      <MeetingRow key={meeting.id} meeting={meeting} now={now} />
                    ))}
                  </ul>
                )}
              </section>
            )}
          </div>
        ) : shown.length === 0 ? (
          <EmptyState
            title={
              activeTab === 'upcoming'
                ? 'Nothing coming up.'
                : 'No meetings have happened yet.'
            }
            aside={
              activeTab === 'upcoming'
                ? 'Coglin has nothing for you to do here — enjoy it while it lasts.'
                : undefined
            }
          />
        ) : (
          <div className="space-y-6">
            {groupByMonth(shown).map((group) => (
              <section key={group.month}>
                <h2 className="u-eyebrow mb-3">{group.month}</h2>
                <ul className="bg-card border-border divide-border divide-y rounded-lg border">
                  {group.meetings.map((meeting) => (
                    <MeetingRow key={meeting.id} meeting={meeting} now={now} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

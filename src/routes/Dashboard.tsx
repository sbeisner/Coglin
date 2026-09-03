import { Link, useNavigate } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import {
  daysBetween,
  formatCents,
  formatCount,
  formatHours,
  formatLongDate,
  formatTime,
  monthOf,
  relativeDays,
} from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { SeasonSpine } from '@/components/SeasonSpine';
import { StatTile } from '@/components/StatTile';
import { EvidenceMeter } from '@/components/EvidenceMeter';
import { MeetingCalendar } from '@/components/meetings/MeetingCalendar';
import { Skeleton } from '@/components/Skeleton';
import { useSession } from '@/lib/session';
import { financeBalance, type AwardKey } from '@/types';

const AWARD_LABELS: Record<AwardKey, string> = {
  inspire: 'Inspire',
  think: 'Think',
  connect: 'Connect',
  reach: 'Reach',
  sustain: 'Sustain',
  innovate: 'Innovate',
  control: 'Control',
  design: 'Design',
};

export default function Dashboard() {
  const { team, member } = useSession();
  const navigate = useNavigate();
  const now = api.now();
  const season = useAsync(api.getCurrentSeason);
  const calendar = useAsync(api.listCalendar);
  const tasks = useAsync(() => api.listTasks());
  const outreach = useAsync(api.listOutreach);
  const criteria = useAsync(api.listAwardCriteria);
  const meetings = useAsync(() => api.listMeetings());

  /**
   * The coach's own follow-ups, gated at the FETCH and not just the render.
   *
   * GET /api/action-items is coach-and-mentor only and answers 403 to everyone
   * else. `useAsync` fires unconditionally, so calling it for a student would put
   * this page into an error state for a section that student is not supposed to
   * know exists — the privacy gate would announce itself. Resolving to an empty
   * list keeps the request from being made at all.
   */
  const canManage = member.role === 'coach' || member.role === 'mentor';
  const coachItems = useAsync(
    () => (canManage ? api.listActionItems('open') : Promise.resolve([])),
    [canManage],
  );

  // NOT gated: the summary is readable by every role, viewers included — a
  // sponsor is owed "where did the money go". See worker/routes/finance.ts.
  const finance = useAsync(api.financeSummary);

  /**
   * The approval queue, for the people who can act on it. Gated at the fetch
   * like coachItems above — not because the list is private (GET /orders is
   * open to the team), but because for everyone else it is a card of buttons
   * they cannot press.
   */
  const canApprove = canManage || member.is_purchase_approver;
  // Hoisted rather than recomputed inline twice, and via the shared helper so
  // this cannot drift from the Finance screen. Opening balances are included.
  const financeBalanceCents = finance.data ? financeBalance(finance.data) : null;
  const pendingOrders = useAsync(
    () =>
      canApprove
        ? api.listPartOrders().then((list) => list.filter((o) => o.status === 'pending'))
        : Promise.resolve([]),
    [canApprove],
  );

  /**
   * The next one, not the first one.
   *
   * The list arrives ordered by start time across the whole season, so once a
   * team actually has a schedule, `meetings[0]` is a night in September and
   * this card would confidently show it until May. Cancelled occurrences are
   * skipped for the same reason: "next meeting" has to mean a meeting that is
   * going to happen.
   */
  const nextMeeting = meetings.data?.find(
    (m) => m.starts_at >= now && m.status !== 'cancelled',
  );

  const nextDeadline = calendar.data
    ?.filter((e) => e.starts_at >= now)
    .find((e) => e.kind === 'deadline' || e.kind === 'qualifier');

  const open = tasks.data?.filter((t) => t.status !== 'done') ?? [];
  const overdue = open.filter((t) => t.due_at !== null && t.due_at < now);
  const dueThisWeek = open.filter(
    (t) => t.due_at !== null && t.due_at >= now && daysBetween(now, t.due_at) <= 7,
  );

  const hours = outreach.data?.reduce((s, o) => s + o.hours, 0) ?? 0;
  const people = outreach.data?.reduce((s, o) => s + o.people_reached, 0) ?? 0;

  /**
   * What the hero says when there is no dated deadline to count down to. The
   * three cases are genuinely different, and only the last one is off-season.
   */
  const heroFallback = !season.data
    ? ' ' // still loading; the spine below already shows a skeleton
    : now < season.data.starts_at
      ? `Season ${season.data.label} starts soon`
      : now <= season.data.ends_at
        ? 'No dates on the calendar yet'
        : 'Off-season';

  const byAward = new Map<AwardKey, ReturnType<typeof Array.prototype.slice>>();
  for (const c of criteria.data ?? []) {
    if (!byAward.has(c.award)) byAward.set(c.award, []);
    byAward.get(c.award)!.push(c);
  }

  return (
    <>
      <PageHeader eyebrow={team.name} title="Dashboard" />

      <div className="space-y-8 px-4 py-6 md:px-8">

        {/* Hero: how much season is left, and what it is pointed at.
            On the ink slab rather than a card — this is the one fact the page
            owes the team, and a white card among white cards makes it just the
            first row of a list. */}
        <section className="bg-ink text-ink-foreground rounded-lg p-5 md:p-7">
          {nextDeadline ? (
            <div className="flex flex-wrap items-end gap-x-4 gap-y-1">
              <span className="u-display tabular font-mono text-5xl leading-none md:text-6xl">
                {daysBetween(now, nextDeadline.starts_at)}
              </span>
              <span className="u-display pb-1 text-lg md:text-xl">
                days to {nextDeadline.title.toLowerCase()}
              </span>
            </div>
          ) : (
            /* No countdown is not the same as no season. This used to say
               "Off-season" whenever the calendar was empty, which told a team
               three weeks out from kickoff that their season was over. Say what
               is actually known instead. */
            <div className="u-display text-2xl">{heroFallback}</div>
          )}

          <div className="mt-6">
            {season.data && calendar.data ? (
              <SeasonSpine
                season={season.data}
                events={calendar.data}
                now={now}
                onInk
              />
            ) : (
              <Skeleton className="bg-ink-foreground/10 h-16" />
            )}
          </div>
        </section>

        {/* Numbers a portfolio and a Reach interview actually ask for. */}
        <section>
          <h2 className="u-eyebrow mb-3">This season</h2>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              value={formatHours(hours)}
              label="Outreach hours"
              hint={`${outreach.data?.length ?? 0} events logged`}
            />
            <StatTile value={formatCount(people)} label="People reached" />
            <StatTile
              value={dueThisWeek.length}
              label="Due this week"
              hint={`${open.length} open tasks`}
            />
            <StatTile
              value={overdue.length}
              label="Overdue"
              tone={overdue.length > 0 ? 'alert' : 'default'}
              hint={overdue.length === 0 ? 'nothing slipping' : undefined}
            />
          </div>
        </section>

        {/* The money, at dashboard altitude: four figures, no rows. The rows
            live in /app/finance. */}
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="u-eyebrow">Money</h2>
            <Link
              to="/app/finance"
              className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
            >
              Open finance
            </Link>
          </div>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile
              value={
                financeBalanceCents === null ? '—' : formatCents(financeBalanceCents)
              }
              label="Balance"
              tone={
                financeBalanceCents !== null && financeBalanceCents < 0
                  ? 'alert'
                  : 'default'
              }
            />
            <StatTile
              value={finance.data ? formatCents(finance.data.income_cents) : '—'}
              label="Income"
            />
            <StatTile
              value={finance.data ? formatCents(finance.data.expense_cents) : '—'}
              label="Spent"
            />
            <StatTile
              value={finance.data?.pending_orders ?? '—'}
              label="Pending requests"
              tone={finance.data && finance.data.pending_orders > 0 ? 'alert' : 'default'}
              hint={
                finance.data && finance.data.pending_orders > 0
                  ? `${formatCents(finance.data.pending_estimate_cents)} if approved`
                  : undefined
              }
            />
          </div>

          {/* Money that is about to disappear. A line rather than a fifth tile:
              the grid above is full, and a tile that usually says "nothing
              expiring" would be clutter every other day of the season. */}
          {(finance.data?.expiring ?? []).length > 0 && (
            <ul className="mt-3 space-y-1">
              {finance.data!.expiring.map((fund) => (
                <li
                  key={fund.id}
                  role="alert"
                  className="border-destructive/40 bg-destructive/10 text-destructive flex flex-wrap items-center gap-x-2 rounded-md border px-3 py-2 text-sm"
                >
                  <TriangleAlert className="size-4 shrink-0" aria-hidden />
                  <span>
                    <span className="tabular font-mono">
                      {formatCents(fund.remaining_cents)}
                    </span>{' '}
                    of {fund.name} disappears{' '}
                    {relativeDays(fund.expires_at, now)}.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-8 lg:grid-cols-[1.4fr_1fr]">
          {/* Award readiness — the product's whole argument, on the front page. */}
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="u-eyebrow">Award readiness</h2>
              <Link
                to="/app/awards"
                className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
              >
                Open tracker
              </Link>
            </div>
            <div className="bg-card border-border divide-border divide-y rounded-lg border">
              {criteria.status === 'loading' && (
                <div className="space-y-3 p-4">
                  <Skeleton className="h-4" />
                  <Skeleton className="h-4" />
                  <Skeleton className="h-4" />
                </div>
              )}
              {criteria.status === 'ready' && byAward.size === 0 && (
                <p className="text-muted-foreground px-4 py-6 text-center text-sm">
                  Award tracking opens once the 2026-27 criteria are in.
                </p>
              )}
              {[...byAward.entries()].map(([award, list]) => (
                <div
                  key={award}
                  className="grid grid-cols-[7rem_1fr] items-center gap-3 px-4 py-3"
                >
                  <span className="text-sm font-medium">
                    {AWARD_LABELS[award]}
                  </span>
                  <EvidenceMeter
                    label={AWARD_LABELS[award]}
                    states={list.map((c) => c.state)}
                  />
                </div>
              ))}
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              Criteria from the Competition Manual §6. Re-verify against the
              2026-27 manual at the season reveal.
            </p>
          </section>

          <div className="space-y-8">
            {/* Next meeting */}
            {/* A compact month reads as SHAPE: which nights this month have
                something on them, and where today sits in that pattern. Neither
                the season spine (whole-season scale) nor the Next meeting card
                (one event) answers that. No arrows — the Dashboard declines to be
                a second place where "which month am I looking at" can be wrong,
                and every cell tap means one thing: go to the calendar, on that
                day. */}
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="u-eyebrow">This month</h2>
                <Link
                  to="/app/meetings?view=calendar"
                  className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                >
                  Open calendar
                </Link>
              </div>
              {meetings.status === 'loading' ? (
                <Skeleton className="h-64" />
              ) : (
                /* Rendered on `ready` even with zero meetings, deliberately: the
                   same lesson the Next meeting card below already learned. An
                   empty grid is a real answer and still shows where today is; a
                   skeleton there is a loading bar that never resolves. */
                <MeetingCalendar
                  meetings={meetings.data ?? []}
                  now={now}
                  month={monthOf(now)}
                  density="compact"
                  selectedDay={null}
                  onSelectDay={(day) =>
                    navigate(`/app/meetings?view=calendar&day=${day}`)
                  }
                />
              )}
            </section>

            <section>
              <h2 className="u-eyebrow mb-3">Next meeting</h2>
              <div className="bg-card border-border rounded-lg border p-4">
                {meetings.status === 'loading' && <Skeleton className="h-16" />}
                {nextMeeting && (
                  <Link
                    to={`/app/meetings/${nextMeeting.id}`}
                    className="focus-visible:ring-ring block rounded focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <div className="u-display text-heading text-base">
                      {formatLongDate(nextMeeting.starts_at)}
                    </div>
                    <div className="text-muted-foreground mt-0.5 text-sm">
                      {formatTime(nextMeeting.starts_at)} ·{' '}
                      {relativeDays(nextMeeting.starts_at, now)}
                    </div>
                    <p className="mt-3 text-sm">{nextMeeting.title}</p>
                    {nextMeeting.location && (
                      <p className="text-muted-foreground mt-0.5 text-sm">
                        {nextMeeting.location}
                      </p>
                    )}
                  </Link>
                )}
                {/* No meeting is a real answer, not a slow one. The old code
                    fell back to a skeleton, so an empty team saw a loading bar
                    that never resolved. */}
                {meetings.status === 'ready' && !nextMeeting && (
                  <p className="text-muted-foreground text-sm">
                    Nothing scheduled yet.
                  </p>
                )}
              </div>
            </section>

            {/* Needs attention */}
            <section>
              <h2 className="u-eyebrow mb-3">Needs attention</h2>
              <ul className="bg-card border-border divide-border divide-y rounded-lg border">
                {[...overdue, ...dueThisWeek].slice(0, 5).map((t) => (
                  <li key={t.id} className="flex items-start gap-3 px-4 py-3">
                    <span
                      className={
                        t.due_at !== null && t.due_at < now
                          ? 'bg-destructive mt-1.5 size-1.5 shrink-0 rounded-[1px]'
                          : 'bg-primary mt-1.5 size-1.5 shrink-0 rounded-[1px]'
                      }
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 text-sm">{t.title}</span>
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {t.due_at !== null ? relativeDays(t.due_at, now) : ''}
                    </span>
                  </li>
                ))}
                {tasks.status === 'ready' &&
                  overdue.length === 0 &&
                  dueThisWeek.length === 0 && (
                    <li className="text-muted-foreground px-4 py-6 text-center text-sm">
                      Nothing due this week. Coglin approves.
                    </li>
                  )}
              </ul>
            </section>

            {/* Part orders waiting on somebody with the approve reach. Rendered
                only for those people — for everyone else it is a card of
                buttons they cannot press. Deciding happens on /app/finance,
                where the deny path can ask for a reason. */}
            {canApprove && (
              <section>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="u-eyebrow">Awaiting approval</h2>
                  <Link
                    to="/app/finance"
                    className="text-muted-foreground hover:text-foreground text-xs underline underline-offset-2"
                  >
                    Open finance
                  </Link>
                </div>
                <ul className="bg-card border-border divide-border divide-y rounded-lg border">
                  {pendingOrders.status === 'loading' && (
                    <li className="p-4">
                      <Skeleton className="h-16" />
                    </li>
                  )}
                  {(pendingOrders.data ?? []).slice(0, 5).map((order) => (
                    <li key={order.id} className="flex items-start gap-3 px-4 py-3">
                      <span
                        className="bg-primary mt-1.5 size-1.5 shrink-0 rounded-[1px]"
                        aria-hidden
                      />
                      <Link
                        to="/app/finance"
                        className="focus-visible:ring-ring min-w-0 flex-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {order.qty > 1 ? `${order.qty}× ` : ''}
                        {order.item}
                        <span className="text-muted-foreground block text-xs">
                          {order.requested_by_name ?? 'Someone'}
                        </span>
                      </Link>
                      <span className="tabular text-muted-foreground shrink-0 font-mono text-xs">
                        {formatCents(order.qty * order.unit_price_cents)}
                      </span>
                    </li>
                  ))}
                  {pendingOrders.status === 'ready' &&
                    (pendingOrders.data ?? []).length === 0 && (
                      <li className="text-muted-foreground px-4 py-6 text-center text-sm">
                        Nothing waiting on you.
                      </li>
                    )}
                </ul>
              </section>
            )}

            {/* The coach's own follow-ups, across every meeting. Same dot, tone
                and relativeDays vocabulary as "Needs attention" above, so the two
                read as one system rather than two lists that happen to be
                adjacent. */}
            {canManage && (
              <section>
                <div className="mb-3 flex items-baseline justify-between">
                  <h2 className="u-eyebrow">Your to-do</h2>
                  <span className="text-muted-foreground text-xs">coaches only</span>
                </div>
                <ul className="bg-card border-border divide-border divide-y rounded-lg border">
                  {coachItems.status === 'loading' && (
                    <li className="p-4">
                      <Skeleton className="h-16" />
                    </li>
                  )}
                  {(coachItems.data ?? []).slice(0, 5).map((item) => (
                    <li key={item.id} className="flex items-start gap-3 px-4 py-3">
                      <span
                        className={
                          item.due_at !== null && item.due_at < now
                            ? 'bg-destructive mt-1.5 size-1.5 shrink-0 rounded-[1px]'
                            : 'bg-primary mt-1.5 size-1.5 shrink-0 rounded-[1px]'
                        }
                        aria-hidden
                      />
                      <Link
                        to={`/app/meetings/${item.meeting_id}`}
                        className="focus-visible:ring-ring min-w-0 flex-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {item.text}
                        <span className="text-muted-foreground block text-xs">
                          {item.meeting_title}
                        </span>
                      </Link>
                      <span className="text-muted-foreground shrink-0 text-xs">
                        {item.due_at !== null ? relativeDays(item.due_at, now) : ''}
                      </span>
                    </li>
                  ))}
                  {/* An empty list is a real answer, not a slow one — the same
                      lesson the Next meeting card above already learned. */}
                  {coachItems.status === 'ready' &&
                    (coachItems.data ?? []).length === 0 && (
                      <li className="text-muted-foreground px-4 py-6 text-center text-sm">
                        Nothing on your list.
                      </li>
                    )}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

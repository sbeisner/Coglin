import type { ReactNode } from 'react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatCount } from '@/lib/format';
import { useSession } from '@/lib/session';
import { PageHeader } from '@/components/PageHeader';
import { StatTile } from '@/components/StatTile';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { Leaderboard } from '@/components/points/Leaderboard';
import { POINT_RULES as R } from '@/types';

/**
 * The full points board.
 *
 * Every number here is derived from records the team already keeps, recomputed
 * on each load, so there is nothing to award and nothing to correct by hand: fix
 * the roll and the points follow. worker/routes/points.ts has the reasoning
 * behind what a classmate can see.
 */
export default function Points() {
  const { member } = useSession();
  // Viewers get 403 from the route, so they are never sent the request at all.
  // The nav has no per-role entries, so a viewer can land here; they get an
  // explanation rather than an error state.
  const isViewer = member.role === 'viewer';
  const board = useAsync(
    () => (isViewer ? Promise.resolve(null) : api.getPoints()),
    [isViewer],
  );
  const data = board.data;
  const mine = data?.members.find((m) => m.member_id === member.id);

  return (
    <>
      <PageHeader eyebrow={data?.season?.label ?? 'This season'} title="Team points" />

      <div className="space-y-8 px-4 py-6 md:px-8">
        {isViewer && (
          <EmptyState
            title="Team points are for the team."
            aside="Students, coaches and mentors can see the board."
          />
        )}

        {!isViewer && (
          <section>
            <div className="grid grid-cols-2 gap-3 lg:max-w-2xl lg:grid-cols-3">
              <StatTile
                value={data ? formatCount(data.team_total) : '—'}
                label="Team total"
                hint={data ? `${data.members.length} students` : undefined}
              />
              {mine && (
                <>
                  <StatTile
                    value={formatCount(mine.total)}
                    label="Your points"
                    hint={`#${mine.rank} on the team`}
                  />
                  <StatTile
                    value={mine.streak.current}
                    label="Meetings in a row"
                    hint={`best ${mine.streak.best}`}
                  />
                </>
              )}
            </div>
          </section>
        )}

        {!isViewer && (
          <section>
            <h2 className="u-eyebrow mb-3">Leaderboard</h2>
            {board.status === 'loading' && <Skeleton className="h-64" />}
            {board.status === 'error' && (
              <EmptyState title="Could not load the board." aside="Reload the page to try again." />
            )}
            {data && data.members.length === 0 && (
              <EmptyState
                title="No students on the roster yet."
                aside="Points appear once students join and the roll gets taken."
              />
            )}
            {data && data.members.length > 0 && (
              <Leaderboard rows={data.members} selfMemberId={member.id} detailed />
            )}
          </section>
        )}

        {!isViewer && (
          <section className="lg:max-w-2xl">
            <h2 className="u-eyebrow mb-3">How points work</h2>
            <ul className="bg-card border-border divide-border divide-y rounded-lg border text-sm">
              <Rule points={`${R.attendance}`}>
                Each meeting you're marked present. A coach or mentor has to take
                or confirm the roll, so tapping "I'm here" counts once they have.
              </Rule>
              <Rule points={`+${R.streakBonus}`}>
                Every {R.streakEvery} meetings in a row. Marked absent breaks the
                run; late or excused doesn't.
              </Rule>
              <Rule points={`${R.doc}–${R.docLong}`}>
                Each notes document you start, once it has {R.docMinChars}+
                characters. {R.docLong} points past {formatCount(R.docLongChars)}.
              </Rule>
              <Rule points={`${R.shortlisted} / ${R.placed}`}>
                Something you flagged for the portfolio gets shortlisted, or placed
                on a page.
              </Rule>
              <Rule points={`up to ${R.outreachCap}`}>
                Each outreach event you log, more for longer events. Outreach
                logging isn't built yet, so this earns nothing for now.
              </Rule>
            </ul>
          </section>
        )}
      </div>
    </>
  );
}

function Rule({ points, children }: { points: string; children: ReactNode }) {
  return (
    <li className="flex gap-4 px-4 py-3">
      <span className="tabular w-20 shrink-0 font-mono font-medium">{points}</span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}

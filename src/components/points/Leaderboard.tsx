import { Badge } from '@/components/ui/badge';
import { formatCount } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BADGE_LABELS, type MemberPoints } from '@/types';

const BREAKDOWN: { key: keyof MemberPoints['breakdown']; label: string }[] = [
  { key: 'attendance', label: 'Attendance' },
  { key: 'streak', label: 'Streaks' },
  { key: 'docs', label: 'Notes' },
  { key: 'portfolio', label: 'Portfolio' },
  { key: 'outreach', label: 'Outreach' },
];

/**
 * The ranked list, shared by the dashboard card and /app/points.
 *
 * The signed-in student's own row is marked, not hoisted: moving it to the top
 * would make every student look first on their own screen, which is a lie the
 * second they compare phones.
 */
export function Leaderboard({
  rows,
  selfMemberId,
  detailed = false,
}: {
  rows: MemberPoints[];
  selfMemberId: string;
  /** Breakdown chips and badges under each row. The full page only. */
  detailed?: boolean;
}) {
  return (
    <ol className="bg-card border-border divide-border divide-y rounded-lg border">
      {rows.map((row, i) => {
        const self = row.member_id === selfMemberId;
        // A gap in rank means rows were skipped (the dashboard shows the top
        // five plus your own row), so draw the break rather than imply 5 → 9
        // are neighbours.
        const gap = i > 0 && row.rank > rows[i - 1].rank + 1 && !detailed;
        return (
          <li
            key={row.member_id}
            className={cn('px-4 py-3', self && 'bg-muted/60', gap && 'border-t-2 border-dashed')}
          >
            <div className="flex items-center gap-3">
              <span className="text-muted-foreground tabular w-6 shrink-0 text-right font-mono text-sm">
                {row.rank}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {row.display_name}
                {self && <span className="text-muted-foreground ml-2 text-xs font-normal">you</span>}
              </span>
              {row.streak.current >= 2 && (
                <span
                  className="text-muted-foreground tabular font-mono text-xs"
                  title="Meetings in a row"
                >
                  {row.streak.current} in a row
                </span>
              )}
              <span className="tabular w-14 shrink-0 text-right font-mono text-sm font-medium">
                {formatCount(row.total)}
              </span>
            </div>

            {detailed && (row.total > 0 || row.badges.length > 0) && (
              <div className="mt-2 flex flex-wrap gap-1.5 pl-9">
                {BREAKDOWN.filter((b) => row.breakdown[b.key] > 0).map((b) => (
                  <Badge key={b.key} variant="outline" className="tabular font-mono">
                    {b.label} {formatCount(row.breakdown[b.key])}
                  </Badge>
                ))}
                {row.badges.map((badge) => (
                  <Badge key={badge} variant="secondary">
                    {BADGE_LABELS[badge]}
                  </Badge>
                ))}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

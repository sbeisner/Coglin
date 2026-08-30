/**
 * Coglin against what a team would otherwise stitch together.
 *
 * Renders from `capabilities.ts`, which is the only place that says what ships.
 * Two rules keep the table credible, and both are easier to state than to hold:
 *
 *   CONCEDE WHAT THEY DO WELL. Trello and Monday do boards, assignment and due
 *   dates perfectly. The row says "Yes". A matrix where the alternatives score
 *   zero everywhere reads as marketing and loses the argument it was built to
 *   win — a coach who uses Trello daily knows the table is wrong and stops
 *   believing the rest of it.
 *
 *   The Coglin column used to carry "In the alpha" / "This season" per row. It
 *   now reads as one column, because splitting it turned a comparison table
 *   into a progress report and answered a question nobody scanning it had asked.
 *   `capabilities.ts` still knows the difference and the drift guard still runs.
 */
import { MATRIX, FIT_COPY } from './capabilities';
import { cn } from '@/lib/utils';

export function FitMatrix() {
  return (
    <>
      {/* Wide content in its own scroll container — the page body must never
          scroll sideways on a phone in a pit. */}
      <div className="border-border overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          <thead>
            <tr className="border-border bg-card border-b">
              <th scope="col" className="u-eyebrow p-3 text-left">
                The season's actual work
              </th>
              <th scope="col" className="u-eyebrow p-3 text-left">Coglin</th>
              <th scope="col" className="u-eyebrow p-3 text-left">Trello / Monday</th>
              <th scope="col" className="u-eyebrow p-3 text-left">Docs + Drive</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((c) => (
              <tr key={c.key} className="border-border border-b last:border-0">
                <th scope="row" className="p-3 text-left font-normal">
                  {c.job}
                </th>
                <td className="text-primary-ink p-3 font-semibold">Yes</td>
                <td className={cn('p-3', FIT_COPY[c.pm].tone)}>{FIT_COPY[c.pm].label}</td>
                <td className={cn('p-3', FIT_COPY[c.docs].tone)}>
                  {FIT_COPY[c.docs].label}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
        Coglin is in a private alpha for the 2026-27 season and parts of it are still
        landing. Ask us where anything stands and you will get a straight answer.
      </p>
    </>
  );
}

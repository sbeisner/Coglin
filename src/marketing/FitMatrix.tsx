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
 *   THREE STATES FOR US, NOT TWO. "In the alpha" and "This season" are
 *   different claims, and the second one is not a tick.
 */
import { MATRIX, FIT_COPY, STATUS_COPY } from './capabilities';
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
                <td className={cn('p-3', STATUS_COPY[c.status].tone)}>
                  {STATUS_COPY[c.status].label}
                </td>
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
        <strong className={STATUS_COPY.now.tone}>{STATUS_COPY.now.label}</strong> means
        you can use it today. <em>This season</em> means it is planned for 2026-27 and
        does not exist yet. We would rather say so than give you a tick and let you
        find out in January.
      </p>
    </>
  );
}

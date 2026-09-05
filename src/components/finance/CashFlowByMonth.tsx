/**
 * The season's shape: money in, money out, and what is actually left.
 *
 * Four things this deliberately is NOT:
 *
 *   - Not a smooth line. A team books 40-120 lines a season and they arrive in
 *     lumps — registration in September, a sponsor cheque in November. The
 *     running balance is drawn as a STEP because that is what it is: it changes
 *     only when a transaction lands. A curve through those points would invite
 *     reading a slope that is an artifact of two events.
 *   - Not weekly. A nine-month season is 36 mostly-empty weekly columns and
 *     nine monthly ones, and nine fit a phone.
 *   - No forecast line. Projecting a burn rate from five lumpy months is
 *     modelling, and a dotted extension would assert a confidence the data does
 *     not support — StatTile's "decoration pretending to be data" objection.
 *     The arithmetic sentence underneath says the same thing and stays
 *     checkable by the reader.
 *   - No second y-axis. Income above the baseline and spend below it means
 *     DIRECTION carries the sign, so hue is a redundant second channel rather
 *     than the only one, and one honest scale spans all three series.
 *
 * The invariant: the last balance point equals the Balance tile above it,
 * reached by different arithmetic. Pinned in worker/routes/finance.test.ts.
 */
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatCents, formatMonthAbbr, formatMonthTitle, monthOf } from '@/lib/format';
import type { FinanceBucket } from '@/types';

const config = {
  income_cents: { label: 'In', color: 'var(--chart-1-ink)' },
  spend_cents: { label: 'Out', color: 'var(--chart-2)' },
  balance_cents: { label: 'Balance', color: 'var(--foreground)' },
} satisfies ChartConfig;

/** Whole dollars for axis ticks. Cents on an axis is noise — the figures that
 *  need cents are in the tooltip and the table. */
function axisDollars(cents: number): string {
  return (cents / 100).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });
}

/**
 * The sentence the chart exists to earn. Plain arithmetic, not a projection —
 * "fundraise now, not in March" is the decision, and the reader can check it.
 */
function burnSentence(buckets: FinanceBucket[], now: number): string {
  const out = buckets.reduce((sum, b) => sum + b.expense_cents, 0);
  const active = buckets.filter((b) => b.line_count > 0).length;
  const left = buckets[buckets.length - 1]?.balance_cents ?? 0;

  const here = monthOf(now);
  const ahead = buckets.filter(
    (b) => b.y > here.y || (b.y === here.y && b.m > here.m),
  ).length;

  const spent = `${formatCents(out)} out over ${active} ${active === 1 ? 'month' : 'months'}.`;
  const remaining =
    ahead > 0
      ? `${formatCents(left)} left, ${ahead} ${ahead === 1 ? 'month' : 'months'} of season to go.`
      : `${formatCents(left)} left.`;
  return `${spent} ${remaining}`;
}

export function CashFlowByMonth({
  buckets,
  now,
}: {
  buckets: FinanceBucket[];
  now: number;
}) {
  const data = buckets.map((b) => ({
    ...b,
    label: formatMonthAbbr(b),
    title: formatMonthTitle(b),
    // Spend is stored negative so it draws downward from the baseline.
    spend_cents: -b.expense_cents,
  }));

  const last = buckets[buckets.length - 1];

  return (
    <section className="space-y-2">
      <h3 className="u-eyebrow">The season so far</h3>

      <div className="bg-card border-border space-y-3 rounded-lg border p-4">
        {/* 2:1 on a phone rather than 16:9, with a floor: at 375px the aspect
            alone gives a 155px frame and the bars get too short to compare. */}
        <ChartContainer
          config={config}
          role="img"
          aria-label={`Money in and out by month, with the running balance. ${formatCents(
            last?.balance_cents ?? 0,
          )} at ${last ? formatMonthTitle(last) : 'the end of the season'}.`}
          className="aspect-[2/1] max-h-[340px] min-h-[220px] w-full md:aspect-video"
        >
          <ComposedChart
            accessibilityLayer
            data={data}
            margin={{ left: 4, right: 4, top: 8, bottom: 0 }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              interval={0}
              tickMargin={6}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={64}
              tickFormatter={axisDollars}
            />
            {/* Zero is the reference the bars hang off, so it is drawn rather
                than implied. */}
            <ReferenceLine y={0} stroke="var(--border)" />
            <ChartTooltip
              content={
                <ChartTooltipContent
                  labelKey="title"
                  formatter={(value, name) => {
                    const label = config[name as keyof typeof config]?.label ?? name;
                    return `${label}: ${formatCents(Math.abs(Number(value)))}`;
                  }}
                />
              }
            />
            {/* NOTHING here animates, and that is a correctness call rather
                than a taste one.
             
                Recharts drives its reveal on a requestAnimationFrame timeline,
                and both marks render as good as nothing at frame zero: a Bar
                grows from height 0 and Rectangle draws nothing at 0, while a
                Line is clipped by a stroke-dasharray that starts at ~3% of the
                path. So anywhere rAF is stalled or throttled — a tab first
                rendered while backgrounded, a throttled renderer — the axes and
                the labels draw and the DATA does not. Measured here: the line
                sat at `stroke-dasharray: 26.58px 968.95px` on a 969px path and
                the bars produced zero rectangles.
             
                CSS cannot fix this (index.css's prefers-reduced-motion block
                only zeroes CSS durations) and there is no global Recharts
                switch, so it is off per series. A chart whose data appears only
                if an animation completes is not worth the animation. */}
            <Bar
              dataKey="income_cents"
              fill="var(--color-income_cents)"
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />
            <Bar
              dataKey="spend_cents"
              fill="var(--color-spend_cents)"
              radius={[0, 0, 2, 2]}
              isAnimationActive={false}
            />
            {/* The thing you actually read gets the highest-contrast ink, and
                it is the only line in the drawing. */}
            <Line
              type="step"
              dataKey="balance_cents"
              stroke="var(--color-balance_cents)"
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
          </ComposedChart>
        </ChartContainer>

        <p className="text-muted-foreground text-xs">{burnSentence(buckets, now)}</p>

        {/* A real table rather than an sr-only one: a coach writing a Sustain
            narrative wants these numbers too, so hiding them from sighted users
            would be a worse answer for the same markup. */}
        <details className="text-xs">
          <summary className="text-muted-foreground cursor-pointer">
            Read the numbers
          </summary>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-left">
              <thead className="text-muted-foreground">
                <tr>
                  <th scope="col" className="py-1 pr-4 font-medium">Month</th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">In</th>
                  <th scope="col" className="py-1 pr-4 text-right font-medium">Out</th>
                  <th scope="col" className="py-1 text-right font-medium">Balance</th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {data.map((b) => (
                  <tr key={`${b.y}-${b.m}`}>
                    <th scope="row" className="py-1 pr-4 font-normal">{b.title}</th>
                    <td className="tabular py-1 pr-4 text-right font-mono">
                      {formatCents(b.income_cents)}
                    </td>
                    <td className="tabular py-1 pr-4 text-right font-mono">
                      {formatCents(b.expense_cents)}
                    </td>
                    <td className="tabular py-1 text-right font-mono">
                      {formatCents(b.balance_cents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </div>
    </section>
  );
}

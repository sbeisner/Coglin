/**
 * Where the money went.
 *
 * Sorted horizontal bars, because the question is "is travel bigger than
 * parts" — a rank-and-magnitude comparison. Deliberately not a pie: seven
 * slices force angle estimation, and a pie has nowhere to put the line count,
 * which is the thing that turns "travel is big" into "travel is four lines,
 * and here they are".
 *
 * ONE colour, not seven. Per-category hue would be redundant with the label
 * sitting beside it, and there are seven expense categories against five chart
 * tokens — so a hue map would have to repeat, which asserts that two categories
 * are the same kind of thing. chart-2 (alliance blue) rather than
 * --destructive, because spending is not an alarm, and rather than --primary,
 * because goblin green means progress-toward-a-goal everywhere else in this app
 * and spend is not progress.
 */
import { Bar, BarChart, LabelList, XAxis, YAxis } from 'recharts';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart';
import { formatCents } from '@/lib/format';
import { EXPENSE_CATEGORIES, type CategoryTotal } from '@/types';

const LABELS = new Map<string, string>(
  EXPENSE_CATEGORIES.map((c) => [c.id, c.label]),
);

const config = {
  total_cents: { label: 'Spent', color: 'var(--chart-2)' },
} satisfies ChartConfig;

/** Row height and padding, so the frame grows with the data instead of
 *  squashing seven bars into a 16:9 box on a phone. */
const ROW = 34;
const PADDING = 16;

export function SpendByCategory({ rows }: { rows: CategoryTotal[] }) {
  const data = rows.map((row) => ({
    ...row,
    label: LABELS.get(row.category) ?? row.category,
  }));
  const total = rows.reduce((sum, row) => sum + row.total_cents, 0);

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="u-eyebrow">Where the money went</h3>
        <span className="tabular text-muted-foreground font-mono text-xs">
          {formatCents(total)} total
        </span>
      </div>

      <div className="bg-card border-border rounded-lg border p-4">
        <ChartContainer
          config={config}
          role="img"
          aria-label={`Spending by category. ${data
            .map((d) => `${d.label} ${formatCents(d.total_cents)}`)
            .join(', ')}.`}
          className="aspect-auto w-full"
          style={{ height: data.length * ROW + PADDING }}
        >
          <BarChart
            accessibilityLayer
            data={data}
            layout="vertical"
            margin={{ left: 0, right: 64, top: 0, bottom: 0 }}
          >
            {/* The value axis carries no ticks: every bar is labelled with its
                own figure, so an axis would be a second, vaguer copy. */}
            <XAxis type="number" dataKey="total_cents" hide />
            <YAxis
              type="category"
              dataKey="label"
              tickLine={false}
              axisLine={false}
              width={92}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent
                  formatter={(value, _name, item) => {
                    const lines = (item?.payload as CategoryTotal | undefined)
                      ?.line_count;
                    return `${formatCents(Number(value))} · ${lines} ${
                      lines === 1 ? 'line' : 'lines'
                    }`;
                  }}
                />
              }
            />
            {/* Bright fill plus an ink stroke: chart-2 clears 3:1 on both
                themes, and the stroke keeps the shape defined if the palette
                is ever reskinned to something lighter. See index.css. */}
            {/* Never animated: a Recharts bar grows from height 0 on a
                requestAnimationFrame timeline and renders nothing at 0, so a
                stalled rAF would leave this chart an empty frame with labels.
                See CashFlowByMonth for the full argument. */}
            <Bar
              dataKey="total_cents"
              fill="var(--color-total_cents)"
              stroke="var(--color-total_cents)"
              radius={2}
              isAnimationActive={false}
            >
              <LabelList
                dataKey="total_cents"
                position="right"
                className="tabular fill-foreground font-mono"
                fontSize={11}
                formatter={(value) => formatCents(Number(value))}
              />
            </Bar>
          </BarChart>
        </ChartContainer>
      </div>
    </section>
  );
}

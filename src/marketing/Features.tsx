/**
 * Everything Coglin does, in one list.
 *
 * It used to be two, split into "Working today" and "Planned this season" with
 * counts against each. That was over-cautious for an early product where
 * nothing is gated behind payment: it
 * made the product read as more unfinished than it is.
 *
 * The `status` field still exists and `capabilities.ts` is still the one place
 * that knows what ships — the screenshots key off it, and the drift guard still
 * fails if copy claims something the app marks a stub. This page just stops
 * leading with it.
 */
import { CallToAction, PageIntro, Section, Wrap } from './parts';
import { CAPABILITIES } from './capabilities';
import { Screenshot } from './Screenshot';

// Shipped first, then the rest. Same list, no headings between them: a reader
// scanning it sees the product, not a progress report.
const ORDERED = [
  ...CAPABILITIES.filter((c) => c.status === 'now'),
  ...CAPABILITIES.filter((c) => c.status === 'soon'),
];

function CapabilityCard({ capability }: { capability: (typeof CAPABILITIES)[number] }) {
  return (
    <div className="border-border bg-card rounded-lg border p-5">
      <h3 className="u-display text-base leading-tight">{capability.job}</h3>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {capability.detail}
      </p>
      {/* Only shipped capabilities carry a screenshot, and only because only
          shipped ones can be photographed. That is the point. */}
      {capability.screenshot && (
        <Screenshot name={capability.screenshot} className="mt-4" />
      )}
    </div>
  );
}

export default function Features() {
  return (
    <>
      <PageIntro
        eyebrow="Features"
        title="What Coglin does"
        lede={
          <>
            Boards, meetings and notes are the daily surface. The award tracking,
            outreach totals and budget are what a general project tool has never
            given an FTC team, and they are what the season gets judged on.
          </>
        }
      />

      <Section>
        <div className="grid gap-4 sm:grid-cols-2">
          {ORDERED.map((c) => (
            <CapabilityCard key={c.key} capability={c} />
          ))}
        </div>
      </Section>

      <Section title="Deliberately not building">
        <Wrap className="px-0">
          <ul className="text-muted-foreground max-w-2xl space-y-3 text-sm leading-relaxed">
            <li>
              Scouting and match analytics. FTCScout already does it, does it free,
              and analysing other teams' matches is a different job from running
              your own season.
            </li>
            <li>
              Chat. Discord won that argument years ago and your team is already
              there.
            </li>
            <li>
              CAD file hosting. OnShape stays the source of truth. We keep the
              renders and screenshots you end up putting in a portfolio.
            </li>
          </ul>
        </Wrap>
      </Section>

      <CallToAction />
    </>
  );
}

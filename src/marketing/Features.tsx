/**
 * Everything Coglin does, with its status attached to each item.
 *
 * Rendered from `capabilities.ts` rather than written as prose, so a feature
 * cannot be described here as working while the app still marks its screen a
 * stub. That is the whole reason the data lives in one module — see its header.
 */
import { CallToAction, PageIntro, Section, Wrap } from './parts';
import { CAPABILITIES, STATUS_COPY } from './capabilities';
import { Screenshot } from './Screenshot';
import { cn } from '@/lib/utils';

const SHIPPED = CAPABILITIES.filter((c) => c.status === 'now');
const PLANNED = CAPABILITIES.filter((c) => c.status === 'soon');

function CapabilityCard({ capability }: { capability: (typeof CAPABILITIES)[number] }) {
  const status = STATUS_COPY[capability.status];
  return (
    <div className="border-border bg-card rounded-lg border p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="u-display text-base leading-tight">{capability.job}</h3>
        <span className={cn('text-xs', status.tone)}>{status.label}</span>
      </div>
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
        title="What Coglin does, and what it does not do yet"
        lede={
          <>
            Two lists rather than one with ticks against it. The first group works in
            the alpha today. The second is planned for the 2026-27 season and does
            not exist yet, which is the reason you get to set the price.
          </>
        }
      />

      <Section title={`Working today (${SHIPPED.length})`}>
        <div className="grid gap-4 sm:grid-cols-2">
          {SHIPPED.map((c) => (
            <CapabilityCard key={c.key} capability={c} />
          ))}
        </div>
      </Section>

      <Section title={`Planned this season (${PLANNED.length})`}>
        <div className="grid gap-4 sm:grid-cols-2">
          {PLANNED.map((c) => (
            <CapabilityCard key={c.key} capability={c} />
          ))}
        </div>
      </Section>

      <Section title="Deliberately not building">
        <Wrap className="px-0">
          <ul className="text-muted-foreground max-w-2xl space-y-3 text-sm leading-relaxed">
            <li>
              Scouting and match analytics. FTCScout already does it, does it free,
              and it belongs to the robot side of the season anyway.
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

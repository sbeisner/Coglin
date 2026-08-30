/**
 * The award-by-award page — the argument the whole product rests on.
 *
 * Straight from plan §2, which reads the 2025-26 Competition Manual §6 and the
 * Judging Process Guide. Each award names the evidence a team must actually
 * produce, then the Coglin capabilities that produce it, with their real status
 * attached. An award whose supporting features are all `This season` says so
 * plainly rather than showing an empty row.
 *
 * No FIRST or FTC logos, and the award names are used descriptively — nominative
 * use, per plan §4. This page is the one most likely to drift toward looking
 * official; it must not.
 */
import { CallToAction, PageIntro, Wrap } from './parts';
import { capabilitiesForAward, STATUS_COPY, type AwardKey } from './capabilities';
import { cn } from '@/lib/utils';

const AWARDS: { key: AwardKey; name: string; note: string; evidence: string }[] = [
  {
    key: 'inspire',
    name: 'Inspire',
    note: '60 / 30 / 15 advancement points',
    evidence:
      'Contender for Think, plus at least one machine award and at least one team-attribute award. The whole season in one submission.',
  },
  {
    key: 'think',
    name: 'Think',
    note: 'Portfolio required',
    evidence:
      'Engineering process, lessons learned, trade-offs and the maths behind them — documented as the work happened, not reconstructed afterwards.',
  },
  {
    key: 'connect',
    name: 'Connect',
    note: '',
    evidence:
      'A written team plan with skill goals and the steps toward them, plus documented connections to the STEM community.',
  },
  {
    key: 'reach',
    name: 'Reach',
    note: 'New for 2025-26',
    evidence:
      'Outreach objectives, and documented recruitment of other teams, coaches and mentors — with the numbers to back it.',
  },
  {
    key: 'sustain',
    name: 'Sustain',
    note: 'New for 2025-26',
    evidence:
      'A finance, season and sustainability plan — and, explicitly required, documentation that shows progress against it.',
  },
  {
    key: 'control',
    name: 'Control',
    note: 'Portfolio required',
    evidence:
      'Sensors, autonomous behaviour and software documented in the portfolio. Source code is not submitted.',
  },
  {
    key: 'innovate',
    name: 'Innovate',
    note: '',
    evidence:
      'A creative, robust design element, with risk mitigation documented and the iterations that got you there.',
  },
  {
    key: 'design',
    name: 'Design',
    note: '',
    evidence:
      'An elegant, maintainable machine with a documented design basis — why this, and what it replaced.',
  },
];

export default function Awards() {
  return (
    <>
      <PageIntro
        eyebrow="Awards"
        title="What judges ask for, and what produces it"
        lede={
          <>
            Taken from the Competition Manual §6 and the Judging Process Guide. The
            engineering notebook is now optional and the portfolio is the only
            required document — one cover plus at most fifteen pages, current-season
            work only. Almost all of this is documentation, and almost none of it has
            tooling.
          </>
        }
      />

      <Wrap className="space-y-4 pb-4">
        {AWARDS.map((award) => {
          const caps = capabilitiesForAward(award.key);
          return (
            <section
              key={award.key}
              className="border-border bg-card rounded-lg border p-5"
            >
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="u-display text-lg leading-tight">{award.name}</h2>
                {award.note && (
                  <span className="text-muted-foreground text-xs">{award.note}</span>
                )}
              </div>
              <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
                {award.evidence}
              </p>

              {caps.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-2">
                  {caps.map((c) => (
                    <li
                      key={c.key}
                      className="border-border flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-xs"
                    >
                      <span>{c.job}</span>
                      <span className={cn(STATUS_COPY[c.status].tone)}>
                        {STATUS_COPY[c.status].label}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </Wrap>

      <Wrap className="pb-4">
        <p className="text-muted-foreground max-w-2xl text-xs leading-relaxed">
          Award names and criteria are described here to explain what the software is
          for. Coglin is unofficial, uses no <i>FIRST</i>® marks or logos, and has no
          relationship with the organisation that runs the programme.
        </p>
      </Wrap>

      <CallToAction />
    </>
  );
}

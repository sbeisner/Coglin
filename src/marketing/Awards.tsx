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
      "You need to be in contention for Think, plus one machine award and one team-attribute award. It is the whole season judged at once.",
  },
  {
    key: 'think',
    name: 'Think',
    note: 'Portfolio required',
    evidence:
      "Your engineering process, the trade-offs, the maths, and what you learned when something failed. Judges can tell the difference between notes kept as you went and notes written the week before.",
  },
  {
    key: 'connect',
    name: 'Connect',
    note: '',
    evidence:
      "A written team plan with real skill goals and the steps you took toward them, plus evidence of who you actually connected with in the STEM community.",
  },
  {
    key: 'reach',
    name: 'Reach',
    note: 'New for 2025-26',
    evidence:
      "Outreach objectives you set out in advance, evidence you recruited other teams and mentors, and the numbers behind both.",
  },
  {
    key: 'sustain',
    name: 'Sustain',
    note: 'New for 2025-26',
    evidence:
      "A finance and season plan, and then the harder part: documentation showing you made progress against it. The Manual asks for that in so many words.",
  },
  {
    key: 'control',
    name: 'Control',
    note: 'Portfolio required',
    evidence:
      "Sensors, autonomous routines and how the software works, written up in the portfolio. You do not submit source code.",
  },
  {
    key: 'innovate',
    name: 'Innovate',
    note: '',
    evidence:
      "One creative design element that survives contact with a competition floor, plus the iterations behind it and what you did about the risks.",
  },
  {
    key: 'design',
    name: 'Design',
    note: '',
    evidence:
      "A machine somebody could maintain, with a written design basis: why this version, and what it replaced.",
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
            Taken from Competition Manual §6 and the Judging Process Guide. The
            engineering notebook is optional now, so the portfolio is the only
            document you have to hand over: a cover plus fifteen pages, current
            season only. Nearly all of this is paperwork, and hardly any of it has
            software built for it.
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
          The award names appear here to explain what the software is for. Coglin is
          unofficial, uses no <i>FIRST</i>® marks or logos, and has no relationship
          with the organisation that runs the programme.
        </p>
      </Wrap>

      <CallToAction />
    </>
  );
}

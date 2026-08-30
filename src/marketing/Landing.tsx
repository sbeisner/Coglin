/**
 * The front door.
 *
 * This page exists because `/` used to redirect anonymous visitors straight to
 * `/login`. lilithforge.com has linked here as "Enter Coglin →" the whole time,
 * so the public face of the product was a password field.
 *
 * The argument it makes is plan §1's, and it is a real one: the 2025-26 rule
 * change made first-place Inspire worth 60 advancement points against 40 for
 * winning the event outright. That award is decided by documentation almost
 * nobody has tooling for. Lead with the number, because it is the thing a coach
 * has already noticed and has no answer to.
 */
import { Link } from 'react-router';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CallToAction, Section, Wrap } from './parts';
import { FitMatrix } from './FitMatrix';
import { CAPABILITIES } from './capabilities';

const SHIPPED = CAPABILITIES.filter((c) => c.status === 'now');

export default function Landing() {
  return (
    <>
      <Wrap className="pt-14 pb-10 md:pt-20">
        <div className="u-eyebrow">Season operations for FTC teams</div>
        <h1 className="u-display mt-4 max-w-3xl text-3xl leading-[1.1] md:text-5xl">
          The robot is two pages of the portfolio.
          <span className="text-muted-foreground"> Run the other thirteen.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-base leading-relaxed md:text-lg">
          First-place Inspire is worth{' '}
          <strong className="font-semibold">60 advancement points</strong>. Winning
          the event outright is worth 40. You win Inspire with fifteen portfolio
          pages, an outreach record, and a season of decisions nobody thought to
          write down at the time.
        </p>
        <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
          Coglin keeps all of that in one place. It runs boards for build,
          programming and CAD the way any project tool would. It also tracks your
          award evidence, plans the portfolio, and totals up the outreach, arranged
          the way the judges want to see it.
        </p>

        <div className="mt-8 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link to="/features">
              See what it does <ArrowRight className="ml-1.5 size-4" aria-hidden />
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link to="/pricing">Pay what you think is fair</Link>
          </Button>
        </div>
      </Wrap>

      {/* The honest bit, placed early rather than buried. A private alpha that
          reads as a finished product is the fastest way to lose a coach who
          signs up and finds three empty screens. */}
      <Wrap className="pb-10">
        <div className="border-border rounded-lg border border-dashed p-5">
          <h2 className="u-display text-base leading-tight">
            It's a private alpha, and it's unfinished
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
            It's being written during a live season by a coach, for the team he
            coaches. {SHIPPED.length} of the pieces below work today and the rest
            arrive across 2026-27. Every page here tells you which is which, and
            you set the price for as long as that's true.
          </p>
        </div>
      </Wrap>

      <Section title="What a season actually demands">
        <FitMatrix />
      </Section>

      <Section title="Built around what the judges read">
        <div className="grid gap-4 sm:grid-cols-2">
          {SHIPPED.slice(0, 4).map((c) => (
            <div key={c.key} className="border-border bg-card rounded-lg border p-5">
              <h3 className="u-display text-base leading-tight">{c.job}</h3>
              <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {c.detail}
              </p>
            </div>
          ))}
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link to="/features">All features</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/awards">Award by award</Link>
          </Button>
        </div>
      </Section>

      <CallToAction />
    </>
  );
}

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
          Under the points-based advancement model, first-place Inspire is worth{' '}
          <strong className="font-semibold">60 points</strong> — winning the event
          itself is worth 40. That award is won in fifteen portfolio pages, an
          outreach log, and a season of decisions nobody wrote down.
        </p>
        <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed">
          Coglin holds all of it. Boards for build, programming and CAD like any
          project tool — plus the layer nothing else has: award evidence, portfolio
          planning, outreach rollups and meeting history, mapped to what judges
          actually ask for.
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
            It is a private alpha, and it is unfinished
          </h2>
          <p className="text-muted-foreground mt-2 max-w-2xl text-sm leading-relaxed">
            Coglin is being built during a live season, by a coach, alongside a real
            team running a real portfolio. {SHIPPED.length} of the pieces below work
            today; the rest land across 2026-27. Every page on this site says which
            is which, and you set the price while that is still true.
          </p>
        </div>
      </Wrap>

      <Section title="What a season actually demands">
        <FitMatrix />
      </Section>

      <Section title="Built around the awards, not around the robot">
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

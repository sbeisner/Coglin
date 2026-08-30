/**
 * Layout primitives shared by the marketing pages.
 *
 * Small on purpose. These exist so six pages agree on measure, rhythm and
 * heading scale without a page-level template that invites divergence — not to
 * become a second component library alongside `components/ui`.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Standard page width. 5xl matches the shell header so nothing shifts. */
export function Wrap({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('mx-auto w-full max-w-5xl px-4', className)}>{children}</div>;
}

/** The top of a non-landing page: eyebrow, title, one paragraph of lede. */
export function PageIntro({
  eyebrow,
  title,
  lede,
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
}) {
  return (
    <Wrap className="pt-12 pb-8 md:pt-16">
      <div className="u-eyebrow">{eyebrow}</div>
      <h1 className="u-display mt-3 max-w-3xl text-3xl leading-tight md:text-4xl">
        {title}
      </h1>
      <p className="text-muted-foreground mt-4 max-w-2xl leading-relaxed">{lede}</p>
    </Wrap>
  );
}

export function Section({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Wrap className={cn('py-8', className)}>
      {title && <h2 className="u-display mb-5 text-xl leading-tight md:text-2xl">{title}</h2>}
      {children}
    </Wrap>
  );
}

/**
 * The closing call to action, repeated at the foot of every page.
 *
 * Honest about the gate: signup needs an access code during the alpha, and
 * finding that out only after filling in a form is the small insult that
 * `Signup.tsx` already goes out of its way to avoid.
 */
export function CallToAction() {
  return (
    <Wrap className="pt-8 pb-4">
      <div className="border-border bg-card rounded-lg border p-6 md:p-8">
        <h2 className="u-display text-xl leading-tight md:text-2xl">
          Run the whole season, not just the robot.
        </h2>
        <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-relaxed">
          Coglin is in a private alpha for the 2026-27 season — you need an access
          code from us to create a team. Pricing is whatever you think is fair while
          it is still being built.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <a href="mailto:admin@lilithforge.com?subject=Coglin%20alpha%20access">
              Ask for an access code
            </a>
          </Button>
          <Button asChild variant="outline">
            <Link to="/pricing">See pricing</Link>
          </Button>
        </div>
      </div>
    </Wrap>
  );
}

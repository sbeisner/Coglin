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
 * Signup is open, so this sends people to the form rather than to an inbox.
 * It used to say "Ask for an access code", which is a strange thing to put
 * under a pricing page.
 */
export function CallToAction() {
  return (
    <Wrap className="pt-8 pb-4">
      <div className="border-border bg-card rounded-lg border p-6 md:p-8">
        <h2 className="u-display text-xl leading-tight md:text-2xl">
          Run the whole season in one place.
        </h2>
        <p className="text-muted-foreground mt-3 max-w-xl text-sm leading-relaxed">
          Set up your team, invite your students, and start logging the season.
          While Coglin is still being built you decide what it is worth paying,
          and nothing is locked behind what you choose.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link to="/signup">Create your team</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/pricing">See pricing</Link>
          </Button>
        </div>
      </div>
    </Wrap>
  );
}

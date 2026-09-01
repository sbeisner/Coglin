/**
 * The terms of service.
 *
 * Same discipline as Privacy.tsx: nothing asserted that the product does not
 * do, and the register is the FAQ's — plain sentences, awkward answers given
 * awkwardly. Two rules carried over from the pricing page apply with extra
 * force here because terms are commitments:
 *
 *  1. NO PROMISES ABOUT PRICE AFTER THE ALPHA (see Pricing.tsx header). The
 *     terms say what a purchase buys today and that future pricing is
 *     undecided, and stop there.
 *
 *  2. `capabilities.ts` remains the single source for what ships. The terms
 *     must not promise features; the alpha section exists to say the opposite.
 *
 * The governing-law placeholder is deliberate: the entity name and state are
 * Steven's to confirm before this ships, and inventing them here would be
 * worse than the gap. Grep for GOVERNING_LAW_TODO.
 *
 * Update LAST_UPDATED whenever the substance changes, not for typo fixes.
 */
import { Link } from 'react-router';
import { PageIntro, Section, Wrap } from './parts';
import { FirstMark } from './MarketingShell';

const LAST_UPDATED = 'August 30, 2026';

const CONTACT = (
  <a
    className="text-foreground underline underline-offset-4"
    href="mailto:admin@lilithforge.com?subject=Coglin%20terms"
  >
    admin@lilithforge.com
  </a>
);

function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed [&+&]:mt-3">
      {children}
    </p>
  );
}

export default function Terms() {
  return (
    <>
      <PageIntro
        eyebrow="Terms"
        title="The agreement, in plain language"
        lede={
          <>
            These are the terms for using Coglin. They are short because the
            arrangement is simple: you run your team's season on the software, we
            keep the software running, and money changes hands the way the{' '}
            <Link to="/pricing" className="text-foreground underline underline-offset-4">
              pricing page
            </Link>{' '}
            says it does. Last updated {LAST_UPDATED}.
          </>
        }
      />

      <Section title="Who can use Coglin">
        <P>
          A team account is created by an adult — a coach or mentor — and that
          adult is responsible for the team's use of the service. Students do
          not sign themselves up; the coach provisions their accounts, and by
          doing so is telling us the roster is theirs to manage and that the
          paperwork a youth robotics team runs on — including the signed{' '}
          <FirstMark /> consent and release forms — actually exists. Coglin is
          for FTC teams; if you are using it for something else it will probably
          still work, but nothing here was designed for it.
        </P>
      </Section>

      <Section title="Your account">
        <P>
          Keep your password to yourself and tell us if you think an account has
          been compromised. A coach can reset a student's access at any time, and
          coaches control what students can see and do inside the team. We may
          suspend an account that is attacking the service or other people's
          data; we will tell you if we do.
        </P>
      </Section>

      <Section title="What a purchase buys">
        <P>
          A payment during the alpha buys access for your team for the current
          season, at a price you chose. It is one payment — not a subscription,
          nothing renews, and no card details are stored with us. During the
          alpha, paying is not what unlocks the product: nothing is gated behind
          it, which also means not paying takes nothing away.
        </P>
        <P>
          If you paid and regret it, ask at {CONTACT} and we will refund it. No
          form, no argument. What Coglin will cost after the alpha has not been
          decided, and whatever we decide will be announced before it applies to
          anyone — nobody who paid during the alpha gets billed a difference
          afterwards.
        </P>
      </Section>

      <Section title="Your content">
        <P>
          Everything your team puts in — notes, tasks, photos, the lot — stays
          yours. You give us permission to store it, back it up and show it to
          your team, which is the minimum the service needs to function, and
          nothing past that — the privacy policy spells out who touches it and
          why. You are responsible for having the right to upload what you
          upload, which for photos of students means the consent process
          described in the{' '}
          <Link to="/privacy" className="text-foreground underline underline-offset-4">
            privacy policy
          </Link>
          .
        </P>
      </Section>

      <Section title="What you agree not to do">
        <P>
          Don't attack the service or try to get at other teams' data. Don't
          upload anything illegal, or content about a student you have no right
          to hold. Don't resell access. Don't use Coglin to harass anyone —
          including your own roster; it is a team tool, and coaches set the
          tone. Break these and we may suspend the team account, after telling
          the coach why.
        </P>
      </Section>

      <Section title="The alpha, stated honestly">
        <P>
          Coglin is being built during the season you are using it in. Parts of
          the interface exist that do not work yet, the{' '}
          <Link to="/features" className="text-foreground underline underline-offset-4">
            features page
          </Link>{' '}
          says which, and anything described as coming is a plan rather than a
          promise. We do not offer an uptime guarantee. What we do promise: your
          data is backed up nightly, we do not wipe it between releases, and if
          we ever decided to shut Coglin down we would say so months ahead and
          get every team's data out first.
        </P>
      </Section>

      <Section title="Liability, in proportion">
        <P>
          The service is provided as-is, and our liability to you is capped at
          what your team paid us in the last twelve months. That is the standard
          clause, but here it is also the honest one: this is season-management
          software sold for less than an event fee, and it would be strange to
          pretend it carries enterprise indemnities. Nothing in these terms
          limits liability that the law does not allow to be limited.
        </P>
      </Section>

      <Section title="Not affiliated with FIRST">
        <P>
          Coglin has no license from, endorsement by, or relationship with{' '}
          <FirstMark />. The program is named on this site only to say who the
          software is for. Using Coglin does not satisfy, replace, or interact
          with any obligation your team has to <FirstMark /> — your registration,
          consent forms and competition paperwork are between you and them.
        </P>
      </Section>

      <Section title="Governing law">
        <P>
          {/* GOVERNING_LAW_TODO: entity name and state to be confirmed before ship. */}
          These terms are between you and Lilith Forge and are governed by the
          laws of [STATE], without regard to conflict-of-law rules. If a dispute
          cannot be sorted out by email — and we would genuinely rather sort it
          out by email — it belongs in the courts of [STATE].
        </P>
      </Section>

      <Section title="When these terms change">
        <P>
          If the terms change in a way that matters, coaches get an email before
          the change takes effect and the date at the top moves. Continuing to
          use Coglin after that is acceptance; if you disagree with a change,
          ask us to export your data and close the account, and we will.
        </P>
      </Section>

      <Wrap className="pt-4 pb-8">
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Questions about any of this: {CONTACT}.
        </p>
      </Wrap>
    </>
  );
}

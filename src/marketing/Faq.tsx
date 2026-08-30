/**
 * The questions a coach asks before putting a season into somebody's software,
 * and the ones a parent or a principal asks afterwards.
 *
 * Two rules for anything added here:
 *
 *  1. NO PROMISES ABOUT PRICE AFTER THE ALPHA. An earlier version said Coglin
 *     "will list at $149 a season". That number lives in an internal plan and
 *     has never been decided in public; printing it on a marketing page turns a
 *     working assumption into a commitment we would have to honour or explain.
 *     Say what it costs now, say the rest is undecided, and leave it there.
 *
 *  2. ANSWER THE AWKWARD ONES AWKWARDLY. The COPPA answer admits we cannot
 *     collect a parent's consent, and the export answer admits there is no
 *     button. A FAQ that only contains flattering answers is not read as a FAQ.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CallToAction, PageIntro, Wrap } from './parts';

const QA: { q: string; a: ReactNode }[] = [
  {
    q: 'Is this official? Is it endorsed by FIRST?',
    a: (
      <>
        No, and we're not trying to be. There is no licence, no endorsement and
        no relationship with <i>FIRST</i>® at all, and we're not asking for one. You
        won't find their logo anywhere in the product. Team numbers get
        checked by hand against the public event pages, because the terms on the
        official API rule out commercial use.
      </>
    ),
  },
  {
    q: 'My students are under 13. How does that work?',
    a: (
      <>
        <p>
          Coaches create the accounts. Students never sign up themselves and never
          give us an email address. They log in with the team number, a handle and
          a password, and all we keep is the handle and a display name.
        </p>
        <p className="mt-3">
          Photos are stricter. Before a picture can be attached to a student, an
          adult has to record by name that the signed consent form exists. Take
          the consent away and the photo comes down in the same action.
        </p>
        <p className="mt-3">
          The limit is worth saying plainly: we can't collect a parent's consent on
          your behalf. A tickbox on a website isn't consent, and we're not going
          to dress it up as one.
        </p>
      </>
    ),
  },
  {
    q: 'What actually works right now?',
    a: (
      <>
        Boards, meetings, notes, attendance, the roster, the media library and the
        portfolio planner. The award tracker, the outreach log and the budget pages
        are in the nav but don't do anything yet. The{' '}
        <Link to="/features" className="text-foreground underline underline-offset-4">
          features page
        </Link>{' '}
        keeps those two lists apart, and so does every table on this site.
      </>
    ),
  },
  {
    q: 'Why do I get to choose the price?',
    a: (
      <>
        Because you'd be paying for something half built, and we'd rather find out
        what that's worth to you than guess at it. The suggestion is $12
        a seat for the season, so $144 for a team of twelve. Pay less if that's what the budget
        allows. It is a purchase either way rather than a donation,
        and not paying doesn't lock you out of anything during the alpha.
      </>
    ),
  },
  {
    q: 'What will it cost after the alpha?',
    a: (
      <>
        We haven't decided. It won't stay pay-what-you-want forever and it won't be
        free, but the shape of it is still open, and anything we told you today
        would be a guess dressed up as a plan. Whatever we land on
        gets announced before it applies to anybody, and nobody who paid during the
        alpha will be billed a difference afterwards.
      </>
    ),
  },
  {
    q: 'Is it priced per seat, then?',
    a: (
      <>
        Only as a way of working out a number against a roster you already know.
        Charging per seat for real would be a nuisance on a school purchase order,
        and rosters change halfway through a season anyway.
      </>
    ),
  },
  {
    q: 'Our school can only pay by purchase order.',
    a: (
      <>
        Email{' '}
        <a
          className="text-foreground underline underline-offset-4"
          href="mailto:admin@lilithforge.com?subject=Coglin%20purchase%20order"
        >
          admin@lilithforge.com
        </a>{' '}
        and we will invoice you. Card checkout is the part that's automated so far. Invoicing is a person answering email, which is fine at this size.
      </>
    ),
  },
  {
    q: 'What happens to our data after the season?',
    a: (
      <>
        It stays where it is. Next September you'll still have last year's
        outreach log, the portfolio work, the decision logs and the returning
        members. That is most of the reason to keep a season in one place instead
        of five.
      </>
    ),
  },
  {
    q: 'Can I get our data out?',
    a: (
      <>
        Ask and we will export it for you. There's no self-serve export button
        yet.
      </>
    ),
  },
  {
    q: 'How do I get in?',
    a: (
      <>
        You need an access code for the 2026-27 season. Email{' '}
        <a
          className="text-foreground underline underline-offset-4"
          href="mailto:admin@lilithforge.com?subject=Coglin%20alpha%20access"
        >
          admin@lilithforge.com
        </a>{' '}
        with your team number.
      </>
    ),
  },
];

export default function Faq() {
  return (
    <>
      <PageIntro
        eyebrow="FAQ"
        title="Questions worth asking before you trust it with a season"
        lede="Including the ones with uncomfortable answers, which are usually the ones worth reading."
      />

      <Wrap className="pb-4">
        <dl className="max-w-3xl space-y-7">
          {QA.map((item) => (
            <div key={item.q}>
              <dt className="u-display text-base leading-tight">{item.q}</dt>
              <dd className="text-muted-foreground mt-2 text-sm leading-relaxed">
                {item.a}
              </dd>
            </div>
          ))}
        </dl>
      </Wrap>

      <CallToAction />
    </>
  );
}

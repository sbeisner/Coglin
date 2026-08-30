/**
 * The questions a coach actually asks before putting a team's season in
 * somebody's software — and the ones a parent or a principal asks afterwards.
 *
 * Answered plainly, including the ones with awkward answers: it is unofficial,
 * it is unfinished, and a coach cannot use it to collect a parent's consent.
 * Softening any of those would be the kind of thing that gets found out in
 * February.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { CallToAction, PageIntro, Wrap } from './parts';

const QA: { q: string; a: ReactNode }[] = [
  {
    q: 'Is this official? Is it endorsed by FIRST?',
    a: (
      <>
        No, and it never will be. Coglin is unofficial by design — no <i>FIRST</i>®
        logos, no licensing arrangement, no endorsement, and we are not seeking one.
        Team numbers are checked by hand against public event data rather than
        through the official API, whose terms bar commercial use. Nothing here is
        affiliated with the organisation that runs the programme.
      </>
    ),
  },
  {
    q: 'My students are under 13. How does that work?',
    a: (
      <>
        Students never sign themselves up and never need an email address. A coach
        creates each account, and a student signs in with the team number, a handle
        and a password. We hold a display name and a handle, and nothing else.
        Photographs are gated: a named adult has to record that the signed consent
        and release form exists before an image can be attached to a student, and
        withdrawing that consent takes the photo down in the same action. Coglin
        cannot obtain verifiable parental consent and does not pretend to — a
        checkbox in a web app is not that.
      </>
    ),
  },
  {
    q: 'What actually works right now?',
    a: (
      <>
        Boards, meetings and notes, attendance, the media library, the roster and the
        portfolio planner. The award tracker, the outreach log and the budget are
        routed and visible but produce nothing yet. The{' '}
        <Link to="/features" className="text-foreground underline underline-offset-4">
          features page
        </Link>{' '}
        splits the two lists, and every table on this site marks which is which.
      </>
    ),
  },
  {
    q: 'Why do I get to choose the price?',
    a: (
      <>
        Because the product is unfinished. It will list at $149 a season once it is
        done; until the award tracker and outreach rollups ship, the teams running a
        season on it are better placed to price it than we are. We recommend $12 per
        seat per season — $144 for a twelve-person team. It is a real purchase at a
        price you set, not a donation, and paying nothing during the alpha does not
        lock you out of anything.
      </>
    ),
  },
  {
    q: 'Is it per seat, then?',
    a: (
      <>
        Only as a way to size the number against a roster you already know. The real
        pricing when it launches is flat per team, per season — per-seat billing is
        hostile to a school purchase order, and rosters change mid-season anyway.
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
        and we will invoice you. Card checkout is what is automated so far; invoicing
        is a person, which at alpha scale is fine.
      </>
    ),
  },
  {
    q: 'What happens to our data after the season?',
    a: (
      <>
        It stays. The whole point of putting a season in one place is that next
        September you still have it — the outreach log, the portfolio history, the
        decision logs, the returning members. A season that evaporates in June would
        make the tool worth less than the spreadsheet it replaced.
      </>
    ),
  },
  {
    q: 'Can I get my data out?',
    a: (
      <>
        Yes — ask and we will export it. A self-serve export is on the list and is
        not built yet, which is the honest answer rather than the reassuring one.
      </>
    ),
  },
  {
    q: 'How do I get in?',
    a: (
      <>
        Coglin is invite-only for the 2026-27 season, so creating a team needs an
        access code. Email{' '}
        <a
          className="text-foreground underline underline-offset-4"
          href="mailto:admin@lilithforge.com?subject=Coglin%20alpha%20access"
        >
          admin@lilithforge.com
        </a>{' '}
        and tell us your team number.
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

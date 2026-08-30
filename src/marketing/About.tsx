/**
 * Who is building this and why.
 *
 * Written in first person on purpose. A one-person studio using the corporate
 * "we" about a tool built in a school shop is the tell that makes a coach close
 * the tab, and the honest version is also the more persuasive one here: the
 * person writing the software is in the pit on Saturday.
 *
 * Nothing on this page may promise what Coglin will cost after the alpha. See
 * the header of Faq.tsx.
 */
import { Link } from 'react-router';
import { CallToAction, PageIntro, Section, Wrap } from './parts';

export default function About() {
  return (
    <>
      <PageIntro
        eyebrow="About"
        title="Built in a shop, during a season, by someone doing the same job"
        lede="Coglin comes from Lilith Forge, a small studio that also makes Inkubus and Cronus. It's a very short list of people."
      />

      <Section title="Why it exists">
        <div className="text-muted-foreground max-w-2xl space-y-4 text-sm leading-relaxed">
          <p>
            Most teams run the season out of a Drive folder, a board of some kind
            and a Discord server. That mostly works. Then March arrives, somebody
            has to write fifteen portfolio pages, and the question is why the
            intake got redesigned back in October. Nobody wrote it down, so the
            team spends a week reconstructing a decision they made in twenty
            minutes.
          </p>
          <p>
            The scoring has moved too. First-place Inspire is worth 60 advancement
            points and winning the event outright is worth 40. Inspire is decided
            almost entirely on documentation: the portfolio, the outreach record, a
            sustainability plan you can actually show progress against, and an
            interview where somebody asks you to explain a choice from six months
            ago.
          </p>
          <p>
            Coglin is meant to hold all of it. The build boards and the award
            evidence are the same product, because they are the same season, and
            splitting them across five tools is how the connection between what
            you did and what you can show gets lost.
          </p>
          <p>
            Scouting and match analytics are the one thing we stay out of. That is
            a different problem, other people solve it well, and it is free.
          </p>
        </div>
      </Section>

      <Section title="Alpha in a live season">
        <div className="text-muted-foreground max-w-2xl space-y-4 text-sm leading-relaxed">
          <p>
            One team runs their whole 2026-27 season on it, and I'm in the room every week,
            because I coach them. Their data is real from the first day
            and doesn't get wiped between releases.
          </p>
          <p>
            That's why this site keeps labouring the point about what does and
            doesn't work yet. A feature that lands in January still helps a team in
            January. A feature you were promised in September that never arrives
            has cost them a season they don't get to run again.
          </p>
        </div>
      </Section>

      <Section title="Unofficial, permanently">
        <div className="text-muted-foreground max-w-2xl space-y-4 text-sm leading-relaxed">
          <p>
            No licence, no endorsement, and no conversation with <i>FIRST</i>®
            about having either. Their marks and logos appear nowhere in the product or on
            this site, and the programme is named here only to say who the software
            is for. Team numbers are checked by hand rather than through the
            official API, whose terms rule out commercial use.
          </p>
          <p>
            None of that is going to change. We would rather be obviously
            unofficial than accidentally look like we have some blessing we do
            not have.
          </p>
        </div>
      </Section>

      <Wrap className="pb-4">
        <p className="text-muted-foreground text-sm leading-relaxed">
          Questions, or want in?{' '}
          <a
            className="text-foreground underline underline-offset-4"
            href="mailto:admin@lilithforge.com?subject=Coglin"
          >
            admin@lilithforge.com
          </a>
          . Or read the{' '}
          <Link to="/faq" className="text-foreground underline underline-offset-4">
            FAQ
          </Link>
          .
        </p>
      </Wrap>

      <CallToAction />
    </>
  );
}

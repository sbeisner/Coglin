/**
 * Who is building this and why, in the register the rest of the site uses —
 * plain, specific, and honest about scale. A one-person studio claiming the
 * voice of a company is the tell that makes a coach close the tab.
 */
import { Link } from 'react-router';
import { CallToAction, PageIntro, Section, Wrap } from './parts';

export default function About() {
  return (
    <>
      <PageIntro
        eyebrow="About"
        title="Built in a shop, during a season, by someone doing the same job"
        lede="Coglin is made by Lilith Forge, a small studio that also builds Inkubus and Cronus. It is not a startup and it is not venture-funded."
      />

      <Section title="Why it exists">
        <div className="text-muted-foreground max-w-2xl space-y-4 text-sm leading-relaxed">
          <p>
            Every tool an FTC team uses today is either robot-side — scouting apps,
            event data — or completely generic: Trello, Notion, a Drive folder and a
            Discord server, stitched together each September and abandoned each June.
            The judged season lives in scattered documents.
          </p>
          <p>
            Meanwhile the advancement model has moved. First-place Inspire is worth
            60 points against 40 for winning the event, and Inspire is decided almost
            entirely by documentation: a fifteen-page portfolio, an outreach record,
            a sustainability plan with evidence of progress, and an interview that
            assumes you can remember why you made a decision in October.
          </p>
          <p>
            Coglin is the operating system for that half of the season. It is not
            trying to replace the scouting app, and it is not trying to be Notion.
          </p>
        </div>
      </Section>

      <Section title="Alpha in a live season">
        <div className="text-muted-foreground max-w-2xl space-y-4 text-sm leading-relaxed">
          <p>
            One real team runs the whole 2026-27 season on Coglin, with the developer
            in the room every week — a coach building the tool for the team he
            coaches. Their data is production data from day one and never gets wiped.
          </p>
          <p>
            That is why this site is so insistent about what does and does not work
            yet. A feature that ships in January is genuinely useful to a team in
            January; a feature described as shipped in September and absent in
            January has cost that team a season they cannot redo.
          </p>
        </div>
      </Section>

      <Section title="Unofficial, permanently">
        <div className="text-muted-foreground max-w-2xl space-y-4 text-sm leading-relaxed">
          <p>
            Coglin has no relationship with the organisation that runs the programme
            and is not pursuing one. No <i>FIRST</i>® marks or logos appear anywhere
            in the product or on this site, the name is used only descriptively, and
            team verification is done by hand rather than through the official API,
            whose terms bar commercial use.
          </p>
          <p>
            Being unofficial is not a risk. Ever <em>looking</em> official would be.
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

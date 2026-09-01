/**
 * The privacy policy.
 *
 * One rule governs every sentence here: NOTHING MAY BE ASSERTED THAT THE CODE
 * DOES NOT DO. This page is written against the actual schema and worker code —
 * the cookie name from `worker/lib/session.ts`, the consent gate from
 * `migrations/0004_roster_photos.sql`, the backup retention from
 * `worker/backup.ts` — and a change to any of those is a change to this page in
 * the same commit. A policy that drifts from the software is worse than no
 * policy, because it converts an engineering gap into a broken promise.
 *
 * The register is the FAQ's, not a template's: say what we hold, say what we
 * don't, and state the limits plainly (no self-serve export, no ability to
 * collect parental consent) rather than papering over them. "We value your
 * privacy" and its relatives are banned.
 *
 * Update LAST_UPDATED whenever the substance changes, not for typo fixes.
 */
import { PageIntro, Section, Wrap } from './parts';
import { FirstMark } from './MarketingShell';

const LAST_UPDATED = 'August 30, 2026';

const CONTACT = (
  <a
    className="text-foreground underline underline-offset-4"
    href="mailto:admin@lilithforge.com?subject=Coglin%20privacy"
  >
    admin@lilithforge.com
  </a>
);

/** Body copy inside a Section. Matches the measure and tone of About/FAQ. */
function P({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed [&+&]:mt-3">
      {children}
    </p>
  );
}

function Li({ children }: { children: React.ReactNode }) {
  return <li className="text-muted-foreground max-w-2xl text-sm leading-relaxed">{children}</li>;
}

export default function Privacy() {
  return (
    <>
      <PageIntro
        eyebrow="Privacy"
        title="What Coglin knows about your team, and what it does with it"
        lede={
          <>
            The short version: we hold what your team puts in, we never collect a
            student's email address, nothing here is advertising-funded, and there
            is no analytics script watching you. The long version follows, and it
            is written to match what the software actually does. Last updated{' '}
            {LAST_UPDATED}.
          </>
        }
      />

      <Section title="Who we are">
        <P>
          Coglin is made by Lilith Forge, a small software studio, and runs at
          coglin.lilithforge.com. Anything in this policy is our responsibility,
          and the person who answers {CONTACT} is the person who wrote the
          software. Coglin is not affiliated with <FirstMark /> — see the note in
          the footer.
        </P>
      </Section>

      <Section title="What we collect about adults">
        <P>
          A coach or mentor signs up with a display name, an email address and a
          password. We store the name, the email and a hash of the password —
          never the password itself. That email is used to sign in, to answer you
          when you write to us, and for nothing else. There is no marketing list.
        </P>
      </Section>

      <Section title="What we collect about students">
        <P>
          As little as the product can function on, because FTC rosters include
          twelve-year-olds and we designed for the youngest member rather than
          the average one.
        </P>
        <ul className="mt-3 max-w-2xl list-disc space-y-2 pl-5">
          <Li>
            Students never sign themselves up and are never asked for an email
            address. A coach creates each account, and the student signs in with
            the team number, a handle and a password.
          </Li>
          <Li>
            What we hold about a student: the handle, a display name, which
            sub-teams they are on, and their attendance at meetings. We do not
            ask for or store a date of birth.
          </Li>
          <Li>
            Invitation emails, when a coach sends one, go through our email
            provider and the address is discarded — it is not written to our
            database.
          </Li>
        </ul>
      </Section>

      <Section title="Photos of students">
        <P>
          Stricter rules than everything else, on purpose. A photo cannot be
          attached to a student's roster entry until an adult on the team records,
          by name, that the signed <FirstMark /> consent and release form exists
          on paper. Remove that consent and the photo comes down in the same
          action. When a member leaves the roster, their photo is deleted — a
          nightly job enforces it rather than trusting anyone to remember.
        </P>
        <P>
          Every uploaded image has its metadata stripped before it is stored,
          because phone photos carry GPS coordinates and a picture taken at a
          student's home should not quietly publish where they live. And we will
          never run face recognition or build biometric data of any kind from
          team photos.
        </P>
      </Section>

      <Section title="What your team puts in">
        <P>
          The product is a record of your season, so the record is the data:
          tasks and their decision logs, meeting agendas and notes, attendance,
          portfolio evidence, uploaded photos and CAD renders, and bug reports
          written from inside the app. It belongs to your team. We read it when
          you ask us to help with something and otherwise leave it alone. Nobody
          buys it, nobody else gets it, and no machine-learning model is trained
          on it.
        </P>
      </Section>

      <Section title="Cookies and tracking">
        <P>
          One cookie, named <code className="text-foreground">coglin_session</code>,
          which keeps you signed in. It is HttpOnly and lasts thirty days,
          renewing while you keep using the site. One browser-storage key
          remembers whether you prefer dark mode. That is the complete list.
        </P>
        <P>
          There is no analytics of any kind — no Google Analytics, no session
          recording, no advertising pixels, nothing counting you. The emails we
          send contain no tracking images. The one bot-check on the site is
          Cloudflare Turnstile, and it loads only on the pricing page, only to
          protect the checkout endpoint.
        </P>
      </Section>

      <Section title="Who else touches the data">
        <P>
          Four companies, each for one job. We do not send your data anywhere
          else.
        </P>
        <ul className="mt-3 max-w-2xl list-disc space-y-2 pl-5">
          <Li>
            <strong className="text-foreground font-medium">Cloudflare</strong>{' '}
            hosts everything: the application, the database and the uploaded
            media. Like any host, Cloudflare's own infrastructure logs include
            the IP addresses of requests; Coglin itself never stores an IP
            address, including in bug reports.
          </Li>
          <Li>
            <strong className="text-foreground font-medium">Stripe</strong>{' '}
            handles payment. Card details go directly to Stripe and never touch
            Coglin; Stripe holds the billing email and address you give it at
            checkout. Our payment records are deliberately not linked to team
            accounts.
          </Li>
          <Li>
            <strong className="text-foreground font-medium">Resend</strong>{' '}
            delivers the email we send — invitations and account notices. The
            recipient address passes through and is not kept by us.
          </Li>
          <Li>
            <strong className="text-foreground font-medium">Zoho</strong> runs
            the mailbox behind {CONTACT}, so anything you email us lives there
            the way email does.
          </Li>
        </ul>
      </Section>

      <Section title="Backups and retention">
        <P>
          The database is backed up nightly and the most recent thirty backups
          are kept, so a deletion works its way out of the backups within about a
          month. Sessions expire after thirty days of inactivity. Roster photos
          are deleted when the member leaves, as above.
        </P>
        <P>
          Your team's season data is kept from season to season on purpose —
          next September you will still have last year's outreach log and
          portfolio work. That persistence is most of the reason the product
          exists, so we do not silently expire it. If you want it gone instead,
          the next section is for you.
        </P>
      </Section>

      <Section title="Seeing, exporting and deleting your data">
        <P>
          Email {CONTACT} and a person will do it. There is no self-serve export
          or delete button yet — that is a real gap, it is on the list, and until
          it ships the honest description of the mechanism is "a person answering
          email." Export
          requests get your team's data in a machine-readable form; deletion
          requests remove the team and everything under it, with the backup lag
          described above.
        </P>
        <P>
          A parent or guardian who wants to see or delete what Coglin holds about
          their child can use the same address. Expect us to verify the request
          with the team's coach, since the coach is who put the student on the
          roster.
        </P>
      </Section>

      <Section title="Students under 13">
        <P>
          Some FTC students are under thirteen, and Coglin is built on the
          assumption that any student might be: no student emails, no
          self-signup, no birthdates, minimal records, photos behind an adult's
          recorded consent. There is a limit here, and the FAQ says it too: we
          cannot collect a parent's consent on your behalf, and a checkbox on a
          website would not be consent anyway. The signed paper consent form your team
          already collects is the document that governs, and the coach is the
          adult who answers for the roster.
        </P>
      </Section>

      <Section title="When this policy changes">
        <P>
          If we change what we collect or who processes it, this page changes
          first and the date at the top moves. For anything that expands what we
          hold, coaches get an email before it takes effect — from the address
          above, with no tracking pixel in it.
        </P>
      </Section>

      <Wrap className="pt-4 pb-8">
        <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
          Questions this page didn't answer belong at {CONTACT}. You will get a
          straight answer, because the alternative is you not trusting the
          software with a season.
        </p>
      </Wrap>
    </>
  );
}

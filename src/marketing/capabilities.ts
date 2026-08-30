/**
 * What Coglin actually does today, and what it does not.
 *
 * THIS FILE IS THE ONLY PLACE THAT ANSWERS THAT QUESTION. The landing page, the
 * features page, the awards page and the pricing page's comparison table all
 * render from this array, so there is exactly one thing to update when a stub
 * fills in — and exactly one thing to lie in if we ever want to.
 *
 * Why that matters more here than in most codebases: a marketing site is a
 * standing invitation to describe planned work as real. Three of the sections
 * below have a nav entry, a route and a screen, and produce nothing —
 * `src/lib/nav.ts` marks them `stub: true` and `src/lib/api.ts` returns empty
 * arrays for them. A tick in a feature table is read as "this works", and a
 * coach who buys a season on the strength of an award tracker that does not
 * exist has been mis-sold, whatever the roadmap says.
 *
 * `capabilities.test.ts` enforces the half of this a test can reach: nothing
 * marked `now` may point at a nav entry still flagged as a stub. The other half
 * — that a `now` claim is honest about how WELL the thing works — is a
 * judgement, and the reason each entry carries its own prose rather than a
 * checkmark.
 *
 * Same argument `src/lib/api.ts:9-13` makes about sample data, pointed outward
 * at the people deciding whether to pay us.
 */

/** Coglin's own state for a capability. Two values, never three. */
export type Status = 'now' | 'soon';

/** How the alternatives a team would otherwise stitch together fare. */
export type Fit = 'yes' | 'partial' | 'manual' | 'no';

export type AwardKey =
  | 'inspire'
  | 'think'
  | 'connect'
  | 'reach'
  | 'sustain'
  | 'control'
  | 'innovate'
  | 'design';

export interface Capability {
  key: string;
  /** The job in the season, phrased as the work — not as a feature name. */
  job: string;
  status: Status;
  /**
   * The nav destination this capability corresponds to, when it has a screen.
   * The drift guard in capabilities.test.ts joins on this, so it must match
   * `NAV[].to` exactly.
   */
  navTo?: string;
  /** A general project tool: Trello, Monday, Jira, Asana. */
  pm: Fit;
  /** Google Docs, Sheets and Drive, which is what most teams actually use. */
  docs: Fit;
  /** Shown on /features. One or two sentences, concrete. */
  detail: string;
  /** Awards this feeds, per plan §2. Drives the /awards page. */
  awards: AwardKey[];
  /** Shown in the comparison table on / and /pricing. Keep it short. */
  inMatrix?: boolean;
}

export const CAPABILITIES: Capability[] = [
  {
    key: 'boards',
    job: 'Task boards per sub-team',
    status: 'now',
    navTo: '/app/boards',
    pm: 'yes',
    docs: 'no',
    inMatrix: true,
    detail:
      'Kanban for build, programming, CAD, outreach and business, with assignees and due dates. This is the part a general project tool already does well, and Coglin does not pretend otherwise — it is here so the rest of the season can hang off it.',
    awards: [],
  },
  {
    key: 'meetings',
    job: 'Meeting agendas, notes and attendance',
    status: 'now',
    navTo: '/app/meetings',
    pm: 'partial',
    docs: 'partial',
    inMatrix: true,
    detail:
      'Recurring meeting schedules, agendas, and rich notes that nest into documents. Attendance is one dropdown per person, because four controls per row on a phone in a cold shop means the roll never gets taken. With the engineering notebook now optional, this archive is the supplementary documentation judges ask about.',
    awards: ['sustain', 'inspire'],
  },
  {
    key: 'decision-log',
    job: 'Decision log on every task',
    status: 'now',
    navTo: '/app/boards',
    pm: 'no',
    docs: 'no',
    inMatrix: true,
    detail:
      'Every task carries an optional "what we tried, why we changed it" field. Think requires documented engineering process, trade-offs and lessons learned — this captures them at the moment of the work instead of reconstructing them from memory in March.',
    awards: ['think', 'innovate', 'design', 'inspire'],
  },
  {
    key: 'media',
    job: 'Photos and CAD renders, tagged and reusable',
    status: 'now',
    pm: 'partial',
    docs: 'manual',
    inMatrix: true,
    detail:
      'One team-wide library for photos, drawings and CAD screenshots. Tag by mechanism, event or date, then embed the same image in a task, a meeting note or a portfolio page instead of hunting through three camera rolls and a shared Drive folder.',
    awards: ['design', 'innovate', 'reach'],
  },
  {
    key: 'portfolio',
    job: 'Portfolio planner — 15 pages, owners, status',
    status: 'now',
    navTo: '/app/portfolio',
    pm: 'no',
    docs: 'manual',
    inMatrix: true,
    detail:
      'The portfolio is one cover plus at most fifteen pages, current-season work only. This plans them: page by page, who owns it, what state it is in, and which evidence from the season it pulls from. A planner, not a layout editor — teams still design in Canva or Slides.',
    awards: ['think', 'control', 'inspire'],
  },
  {
    key: 'accounts',
    job: 'Coach-provisioned student accounts',
    status: 'now',
    navTo: '/app/roster',
    pm: 'no',
    docs: 'no',
    inMatrix: true,
    detail:
      'Students are 12 to 18, and some are under 13. There is no student self-signup and no student email address: a coach creates the account, and a student signs in with the team number, a handle and a password. Photos need a coach to attest that the signed consent form exists before anything can be uploaded.',
    awards: [],
  },
  {
    key: 'awards',
    job: 'Award criteria from the Competition Manual',
    status: 'soon',
    navTo: '/app/awards',
    pm: 'no',
    docs: 'no',
    inMatrix: true,
    detail:
      'Per-award criteria checklists taken from Competition Manual §6, each item linkable to a task, an outreach entry or a photo, with a readiness bar per award and an Inspire view showing the Think + machine + team-attribute triad.',
    awards: ['inspire', 'think', 'connect', 'reach', 'sustain', 'control', 'innovate', 'design'],
  },
  {
    key: 'outreach',
    job: 'Outreach log with hours and people-reached rollups',
    status: 'soon',
    navTo: '/app/outreach',
    pm: 'no',
    docs: 'manual',
    inMatrix: true,
    detail:
      'Event, date, hours, people reached, photos and what the team learned — with the totals rolled up the way portfolios and interviews actually use them. Reach also wants documented recruitment of other teams, coaches and mentors.',
    awards: ['reach', 'connect', 'inspire'],
  },
  {
    key: 'budget',
    job: 'Budget and sponsors',
    status: 'soon',
    navTo: '/app/budget',
    pm: 'no',
    docs: 'manual',
    inMatrix: true,
    detail:
      'Income and expense lines, sponsors with tiers and thank-you status. Sustain is the award that explicitly requires progress-tracking documentation, not just a plan — this is that documentation.',
    awards: ['sustain'],
  },
  {
    key: 'calendar',
    job: 'The season on one calendar',
    status: 'soon',
    pm: 'partial',
    docs: 'manual',
    detail:
      'League meets, qualifiers, the portfolio print deadline and the FIRST Leadership nomination window, alongside the team’s own meetings. A month view of meetings ships today; the competition calendar does not.',
    awards: ['sustain'],
  },
];

/** The comparison table on / and /pricing. */
export const MATRIX = CAPABILITIES.filter((c) => c.inMatrix);

export function capabilitiesForAward(award: AwardKey): Capability[] {
  return CAPABILITIES.filter((c) => c.awards.includes(award));
}

export const SHIPPED_COUNT = CAPABILITIES.filter((c) => c.status === 'now').length;

/** Display copy, kept next to the data so the two cannot drift apart. */
export const STATUS_COPY: Record<Status, { label: string; tone: string }> = {
  now: { label: 'In the alpha', tone: 'text-primary-ink font-semibold' },
  soon: { label: 'This season', tone: 'text-muted-foreground italic' },
};

export const FIT_COPY: Record<Fit, { label: string; tone: string }> = {
  yes: { label: 'Yes', tone: 'text-foreground' },
  partial: { label: 'Sort of', tone: 'text-muted-foreground' },
  manual: { label: 'By hand', tone: 'text-muted-foreground' },
  no: { label: 'No', tone: 'text-muted-foreground' },
};

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
      "Kanban boards per sub-team, with assignees and due dates. Trello does this perfectly well and we're not going to pretend otherwise. It's here because the rest of the season needs something to hang off.",
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
      "Recurring schedules, agendas, and notes that nest into documents. Attendance is one dropdown per person, because four controls per row on a phone in a cold shop means the roll never actually gets taken. Now that the engineering notebook is optional, this archive is the supplementary documentation judges ask to see.",
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
      'Every task has an optional "what we tried, why we changed it" field. Think wants your engineering process and the trade-offs written down. This catches them the week they happen, rather than in March from memory.',
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
      "One library for photos, drawings and CAD screenshots. Tag them by mechanism or event, then drop the same image into a task, a meeting note or a portfolio page. The alternative is hunting through three camera rolls and somebody's Drive folder.",
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
      "The portfolio is a cover plus fifteen pages, current season only. This plans them page by page: who owns it, where it has got to, and what evidence it pulls from. It plans the pages. You still design them in Canva or Slides.",
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
      "Students are 12 to 18 and some are under 13, so they don't sign themselves up and we never ask for their email. A coach makes the account; the student logs in with the team number, a handle and a password. Before any photo goes up, an adult has to record by name that the signed consent form exists.",
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
      "Criteria checklists straight out of Competition Manual §6. Link each item to the task, outreach entry or photo that proves it, and get a readiness bar per award plus an Inspire view showing whether you have the Think, machine and team-attribute pieces covered.",
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
      "Event, date, hours, people reached, photos, and what the team took away from it. The totals roll up the way a portfolio and an interview actually want them. Reach also asks you to show you recruited other teams and mentors, so that gets logged too.",
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
      "Income and expense lines, plus sponsors with tiers and whether anyone has thanked them yet. Sustain asks for documentation showing progress against your plan, not only the plan. This is meant to be that documentation.",
    awards: ['sustain'],
  },
  {
    key: 'calendar',
    job: 'The season on one calendar',
    status: 'soon',
    pm: 'partial',
    docs: 'manual',
    detail:
      "League meets, qualifiers, the portfolio print deadline and the FIRST Leadership nomination window, sitting alongside your own meetings. The month view of meetings works today. The competition calendar does not.",
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

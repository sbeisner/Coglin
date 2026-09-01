/**
 * The data boundary.
 *
 * Every screen reads through this module and nothing else. The indirection paid
 * for itself in COG-006: team, season and roster moved from fixtures to real
 * `/api` calls below without a single component changing.
 *
 * Features that have not landed yet return **empty**, not sample data. A real
 * team signing up gets a blank canvas: a dashboard that invents 23 outreach
 * hours and 655 people reached is worse than one showing zero, because zero is
 * true and a coach can act on it. A banner saying "sample data" does not fix
 * that — the numbers still read as theirs at a glance, and the whole product is
 * asking to be trusted with a season that cannot be reconstructed.
 *
 *   REAL   getTeam, getCurrentSeason, listMembers, meetings, series
 *   EMPTY  boards, tasks, outreach, calendar, award criteria
 *
 * There is no demo-data mode and no `mock/fixtures` import, deliberately. The
 * first attempt kept the fixtures behind a build-time flag on the assumption
 * that dead-branch elimination would strip them; it did not. That module builds
 * its arrays through top-level calls, so Rollup cannot prove it side-effect
 * free and bundled the sample season anyway — a flag away from a real team's
 * dashboard. The only version of this that is actually safe is not importing
 * it. Verify with `npm run build && grep -r "Chesapeake" dist/`.
 *
 * There is no VITE_DEMO_DATA flag any more either; this comment described one
 * for a while after it was deleted. Sample data for the marketing screenshots
 * is seeded into a LOCAL DATABASE by `scripts/seed-demo.mjs` and photographed —
 * it never enters the bundle, which is the only arrangement that has ever held.
 *
 * Note there is no `team_id` parameter anywhere. The server derives the tenant
 * from the session's membership row (plan §6); a client that can name its own
 * team_id is a tenancy bug waiting to happen, so the shape of this API refuses
 * to offer one.
 */
import type {
  ActionItem,
  ActionStatus,
  AgendaItem,
  AttendanceRecord,
  AttendanceState,
  AwardCriterion,
  AwardKey,
  Board,
  BoardOp,
  CalendarEvent,
  CandidateSourceType,
  CandidateState,
  Meeting,
  NoteDoc,
  NoteDocSummary,
  OpenActionItem,
  MeetingKind,
  MeetingSeries,
  FinanceSummary,
  MeetingStatus,
  MeetingSummary,
  Member,
  OutreachEvent,
  PartOrder,
  PortfolioCandidate,
  ProspectStage,
  Season,
  Sponsor,
  SponsorProspect,
  SponsorshipCampaign,
  SponsorshipTier,
  Task,
  Team,
  Transaction,
  TransactionCategory,
  TransactionKind,
} from '@/types';

/** Small delay so loading states are real and get designed, not skipped. */
const LATENCY_MS = 180;

function resolve<T>(value: T): Promise<T> {
  return new Promise((r) => setTimeout(() => r(structuredClone(value)), LATENCY_MS));
}


/**
 * Thrown on a 401 so the shell can send the visitor back to the login screen
 * rather than rendering an error state at someone whose session simply aged
 * out. A 30-day sliding session makes this rare, but "rare" over a nine-month
 * season is still every user eventually.
 */
export class Unauthenticated extends Error {
  constructor() {
    super('unauthenticated');
    this.name = 'Unauthenticated';
  }
}

/**
 * Broadcast rather than redirect from here.
 *
 * A 401 can surface in any screen's data call, and the data layer has no
 * router. Firing an event lets SessionProvider — which owns the answer to "is
 * anyone signed in" — flip to anonymous, and the existing route gate does the
 * navigating. One place decides, and this module stays free of routing.
 */
export const SESSION_EXPIRED = 'coglin:session-expired';

function signalExpired(): void {
  window.dispatchEvent(new Event(SESSION_EXPIRED));
}

async function get<T>(path: string): Promise<T> {
  // no-store for the same reason as fetchSession: a cached 401 anywhere in this
  // path trips the session-expired signal and logs the user out of a session
  // that is still perfectly valid.
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
  });
  if (response.status === 401) {
    signalExpired();
    throw new Unauthenticated();
  }
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return (await response.json()) as T;
}

/**
 * Every write goes through here.
 *
 * Extracted from `createInvite` when meetings brought the count of hand-rolled
 * POSTs to four. The 401 branch is the reason it must be one function and not a
 * convention: a write that forgets to broadcast SESSION_EXPIRED leaves the user
 * staring at a generic failure on a screen that will never work again until
 * they reload.
 *
 * The thrown Error carries the server's machine-readable code (`invalid_kind`,
 * `too_many_occurrences`), which the calling component maps to copy. Codes, not
 * sentences, cross this boundary.
 */
async function send<T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    cache: 'no-store',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 401) {
    signalExpired();
    throw new Unauthenticated();
  }
  if (!response.ok) {
    const failure = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(failure.error ?? `request_failed_${response.status}`);
  }
  return (await response.json()) as T;
}

export function getTeam(): Promise<Team> {
  return get<Team>('/api/team');
}

export function updateTeam(patch: {
  name?: string;
  region?: string | null;
  timezone?: string;
}): Promise<Team> {
  return send<Team>('/api/team', 'PATCH', patch);
}

export function getCurrentSeason(): Promise<Season> {
  return get<Season>('/api/season/current');
}

export function listMembers(): Promise<Member[]> {
  return get<Member[]>('/api/members');
}

export interface InviteResult {
  ok: true;
  /** False when the mail failed; the link below is then the only way through. */
  sent: boolean;
  url: string;
  expires_at: number;
}

/**
 * Create an invite. `email` is passed to the server, mailed, and forgotten — it
 * is not persisted and not echoed back (see migrations/0002_invites.sql). The
 * returned `url` is what the coach can copy if the mail never lands.
 */
export async function createInvite(input: {
  email: string;
  display_name: string;
  role: 'mentor' | 'student' | 'viewer';
  sub_teams?: string[];
}): Promise<InviteResult> {
  const response = await fetch('/api/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(input),
  });
  if (response.status === 401) {
    signalExpired();
    throw new Unauthenticated();
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'invite_failed');
  }
  return (await response.json()) as InviteResult;
}

// ------------------------------------------------------------------ meetings

export function listMeetings(params?: {
  from?: number;
  to?: number;
  status?: MeetingStatus;
  limit?: number;
}): Promise<MeetingSummary[]> {
  const query = new URLSearchParams();
  if (params?.from !== undefined) query.set('from', String(params.from));
  if (params?.to !== undefined) query.set('to', String(params.to));
  if (params?.status) query.set('status', params.status);
  if (params?.limit !== undefined) query.set('limit', String(params.limit));
  const suffix = query.toString() ? `?${query}` : '';
  return get<{ meetings: MeetingSummary[] }>(`/api/meetings${suffix}`).then(
    (r) => r.meetings,
  );
}

/**
 * Everything the meeting screen renders, in one request.
 *
 * `candidates` is what lets the note editor draw its portfolio marks without a
 * second round trip — the flag lives in `portfolio_candidates`, not on the
 * block, so there is exactly one source of truth for whether something is
 * flagged.
 *
 * `action_items` is deliberately NOT here. They are coach-private and have their
 * own gated route (listMeetingActionItems); this payload is readable by every
 * member of the team. Adding the field back re-opens the leak.
 */
export interface MeetingDetail {
  meeting: Meeting;
  agenda: AgendaItem[];
  docs: NoteDocSummary[];
  attendance: AttendanceRecord[];
  candidates: PortfolioCandidate[];
  attendees: string[];
}

export function getMeeting(id: string): Promise<MeetingDetail> {
  return get<MeetingDetail>(`/api/meetings/${id}`);
}

export function createMeeting(input: {
  starts_at: number;
  title?: string;
  kind?: MeetingKind;
  location?: string | null;
  duration_minutes?: number;
}): Promise<Meeting> {
  return send<{ meeting: Meeting }>('/api/meetings', 'POST', input).then((r) => r.meeting);
}

export function updateMeeting(
  id: string,
  patch: Partial<
    Pick<Meeting, 'title' | 'starts_at' | 'ends_at' | 'location' | 'kind' | 'status'>
  >,
): Promise<Meeting> {
  return send<{ meeting: Meeting }>(`/api/meetings/${id}`, 'PATCH', patch).then(
    (r) => r.meeting,
  );
}

/** Cancel keeps the row and its notes. Deleting is a different, coach-only act. */
export function cancelMeeting(id: string, reason?: string): Promise<Meeting> {
  return send<{ meeting: Meeting }>(`/api/meetings/${id}/cancel`, 'POST', {
    reason,
  }).then((r) => r.meeting);
}

export function deleteMeeting(id: string, force = false): Promise<{ ok: true }> {
  return send<{ ok: true }>(
    `/api/meetings/${id}${force ? '?force=1' : ''}`,
    'DELETE',
  );
}

export interface SeriesResult {
  series: MeetingSeries;
  created: number;
  skipped: number;
  first_starts_at: number;
  last_starts_at: number;
}

export function createSeries(input: {
  title?: string;
  kind?: MeetingKind;
  location?: string | null;
  days_of_week: number[];
  start_minute: number;
  duration_minutes?: number;
  timezone?: string;
  starts_on?: number;
  until?: number;
}): Promise<SeriesResult> {
  return send<SeriesResult>('/api/series', 'POST', input);
}

export function listSeries(): Promise<MeetingSeries[]> {
  return get<{ series: MeetingSeries[] }>('/api/series').then((r) => r.series);
}

/**
 * Edit a rule. Future occurrences only — the server refuses any other scope,
 * because rewriting the start time of a meeting that already happened
 * desynchronises it from the notes taken that evening.
 */
export function updateSeries(
  id: string,
  patch: Partial<{
    title: string;
    kind: MeetingKind;
    location: string | null;
    days_of_week: number[];
    start_minute: number;
    duration_minutes: number;
    until: number;
  }>,
): Promise<{
  series: MeetingSeries;
  created: number;
  updated: number;
  cancelled: number;
  deleted: number;
}> {
  return send(`/api/series/${id}?apply=future_only`, 'PATCH', patch);
}

export function deleteSeries(id: string): Promise<{ ok: true; deleted: number }> {
  return send(`/api/series/${id}`, 'DELETE');
}

// --------------------------------------------------------------------- notes

/**
 * The season's whole document tree, flat, plus which documents are flagged.
 *
 * Flat with parent pointers rather than nested: nesting means two
 * representations of ordering — array order AND `position` — that can disagree,
 * and it leaves the client unable to reorder optimistically without re-nesting.
 * The tree build lives in lib/docTree.ts, where the drag code needs it anyway.
 *
 * Bodies are not included. Forty titles do not need forty documents of prose.
 */
export function listDocs(): Promise<{
  docs: NoteDocSummary[];
  flagged: string[];
}> {
  return get('/api/notes');
}

export function getDoc(docId: string): Promise<NoteDoc> {
  return get<{ doc: NoteDoc }>(`/api/notes/${docId}`).then((r) => r.doc);
}

/**
 * One row on the server. The polling seam for a second editor's changes, cheap
 * enough to ask constantly — though nothing calls it yet; the intended answer is
 * a websocket into the same reducer, not a poll.
 */
export function docRev(docId: string): Promise<{ rev: number; updated_at: number }> {
  return get(`/api/notes/${docId}/rev`);
}

/**
 * The client may pick the id, so a flag can attach to a page that has not
 * finished saving. A retried create returns the existing row rather than leaving
 * a ghost document in the sidebar.
 */
export function createDoc(input: {
  id?: string;
  title?: string;
  parent_doc_id?: string | null;
  meeting_id?: string | null;
  after_id?: string;
}): Promise<NoteDoc> {
  return send<{ doc: NoteDoc }>('/api/notes', 'POST', input).then((r) => r.doc);
}

/** Rename only. Deliberately not a content write — see routes/docs.ts. */
export function renameDoc(docId: string, title: string): Promise<NoteDoc> {
  return send<{ doc: NoteDoc }>(`/api/notes/${docId}`, 'PATCH', { title }).then(
    (r) => r.doc,
  );
}

/**
 * The keystroke path. An unchanged save costs nothing server-side and does not
 * burn a rev.
 *
 * `baseRev` is the `rev` you last saw. Send it and a save that would overwrite
 * somebody else throws `stale_content` — which must NOT be retried, because
 * retrying a stale write forever is the failure mode. Omit it only to accept
 * last-write-wins deliberately.
 */
export function putDocContent(
  docId: string,
  content: string,
  baseRev?: number,
): Promise<{ doc: NoteDoc; unchanged?: boolean }> {
  return send(`/api/notes/${docId}/content`, 'PUT', {
    content,
    ...(baseRev !== undefined ? { base_rev: baseRev } : {}),
  });
}

/**
 * Reparent, change meeting, reorder — one call, because they are one gesture.
 *
 * Dragging a document onto a page and dragging it onto a meeting are the same
 * action with different drop targets. When a parent is given the server forces
 * `meeting_id` to the parent's, so the caller never computes it.
 */
export function moveDoc(
  docId: string,
  input: {
    parent_doc_id?: string | null;
    meeting_id?: string | null;
    after_id?: string | null;
  },
): Promise<{ doc: NoteDoc; moved: number }> {
  return send(`/api/notes/${docId}/move`, 'POST', input);
}

/**
 * Soft delete, cascading to descendants.
 *
 * `deleted` is the exact id list, which restore takes back so a document that
 * had since been reparented elsewhere is not dragged along with it.
 * `candidate_orphaned` says a portfolio flag outlived its document.
 */
export function deleteDoc(docId: string): Promise<{
  ok: true;
  deleted: string[];
  candidate_orphaned: boolean;
}> {
  return send(`/api/notes/${docId}`, 'DELETE');
}

export function restoreDoc(docId: string, ids?: string[]): Promise<NoteDoc> {
  return send<{ doc: NoteDoc }>(`/api/notes/${docId}/restore`, 'POST', { ids }).then(
    (r) => r.doc,
  );
}

export function createAgendaItem(
  meetingId: string,
  input: { title: string; detail?: string; owner_member_id?: string; minutes_planned?: number },
): Promise<AgendaItem> {
  return send<{ item: AgendaItem }>(
    `/api/meetings/${meetingId}/agenda`,
    'POST',
    input,
  ).then((r) => r.item);
}

export function updateAgendaItem(
  meetingId: string,
  itemId: string,
  patch: { title?: string; detail?: string | null; done?: boolean },
): Promise<AgendaItem> {
  return send<{ item: AgendaItem }>(
    `/api/meetings/${meetingId}/agenda/${itemId}`,
    'PATCH',
    patch,
  ).then((r) => r.item);
}

export function deleteAgendaItem(
  meetingId: string,
  itemId: string,
): Promise<{ ok: true }> {
  return send(`/api/meetings/${meetingId}/agenda/${itemId}`, 'DELETE');
}

/**
 * Seeds a document from the agenda and marks the meeting under way. Idempotent.
 *
 * `doc_id` is the page to open, and it is null on a second press — the caller
 * already has the tree, which is what makes the button safe to hammer.
 */
export function startMeeting(meetingId: string): Promise<{
  meeting: Meeting;
  doc_id: string | null;
  docs: NoteDocSummary[];
}> {
  return send(`/api/meetings/${meetingId}/start`, 'POST');
}

// -------------------------------------------------------- portfolio candidates

/**
 * Flag something for the portfolio. Idempotent — re-flagging returns the row
 * that already exists, so a double tap reads as "yes, it worked".
 */
export function flagCandidate(input: {
  source_type: CandidateSourceType;
  source_id: string;
  suggested_award?: AwardKey | null;
  why?: string;
}): Promise<PortfolioCandidate> {
  return send<{ candidate: PortfolioCandidate }>(
    '/api/portfolio/candidates',
    'POST',
    input,
  ).then((r) => r.candidate);
}

/** Unflag by source, so a toggle does not need to know the candidate id. */
export function unflagCandidate(
  sourceType: CandidateSourceType,
  sourceId: string,
): Promise<{ ok: true }> {
  const query = new URLSearchParams({
    source_type: sourceType,
    source_id: sourceId,
  });
  return send(`/api/portfolio/candidates?${query}`, 'DELETE');
}

/**
 * A candidate plus enough of its source to be readable in March without
 * opening the meeting it came from.
 */
export interface HydratedCandidate extends PortfolioCandidate {
  preview: {
    id: string;
    kind?: string;
    text?: string;
    /** A note document's first 280 characters of plain text. */
    excerpt?: string;
    media_id?: string | null;
    meeting_id?: string | null;
    meeting_title?: string | null;
    meeting_starts_at?: number | null;
    title?: string;
    starts_at?: number;
    caption?: string | null;
  } | null;
  /** The source was deleted after being flagged; the flag deliberately survives. */
  source_deleted: boolean;
}

export function listCandidates(state?: CandidateState): Promise<HydratedCandidate[]> {
  const suffix = state ? `?state=${state}` : '';
  return get<{ candidates: HydratedCandidate[] }>(
    `/api/portfolio/candidates${suffix}`,
  ).then((r) => r.candidates);
}

export function updateCandidate(
  id: string,
  patch: {
    state?: CandidateState;
    suggested_award?: AwardKey | null;
    why?: string | null;
    placed_page_id?: string;
  },
): Promise<PortfolioCandidate> {
  return send<{ candidate: PortfolioCandidate }>(
    `/api/portfolio/candidates/${id}`,
    'PATCH',
    patch,
  ).then((r) => r.candidate);
}

// ---------------------------------------------------------- boards and tasks

export function listBoards(): Promise<Board[]> {
  return get<{ boards: Board[] }>('/api/boards').then((r) => r.boards);
}

export function listTasks(boardId?: string): Promise<Task[]> {
  const suffix = boardId ? `?board_id=${encodeURIComponent(boardId)}` : '';
  return get<{ tasks: Task[] }>(`/api/tasks${suffix}`).then((r) => r.tasks);
}

export function createBoard(input: { name: string; sub_team?: string | null }): Promise<Board> {
  return send<{ board: Board }>('/api/boards', 'POST', input).then((r) => r.board);
}

export function updateBoard(
  id: string,
  patch: { name?: string; sub_team?: string | null; position?: number },
): Promise<Board> {
  return send<{ board: Board }>(`/api/boards/${id}`, 'PATCH', patch).then((r) => r.board);
}

/**
 * Delete a board.
 *
 * Without `force` the server answers 409 `board_has_tasks` and reports how
 * many, so the UI can ask "delete 12 tasks with it?" instead of destroying a
 * sub-team's whole season on a mis-click.
 */
export function deleteBoard(id: string, force = false): Promise<{ ok: true }> {
  return send(`/api/boards/${id}${force ? '?force=1' : ''}`, 'DELETE');
}

/**
 * The board's revision, for polling.
 *
 * `count` is not redundant: MAX(updated_at) cannot see a deletion, so a card
 * removed while its neighbours were untouched leaves `rev` where it was. The
 * pair changes on every mutation; either alone does not.
 */
export function boardRev(id: string): Promise<{ rev: number; count: number }> {
  return get<{ rev: number; count: number }>(`/api/boards/${id}/rev`);
}


/**
 * The coach's own open items across the season, for the dashboard.
 *
 * Coach and mentor only — the server answers 403 to anyone else, which is why
 * the dashboard gates the CALL and not just the rendering.
 */
export function listActionItems(status?: ActionStatus): Promise<OpenActionItem[]> {
  const suffix = status ? `?status=${status}` : '';
  return get<{ action_items: OpenActionItem[] }>(`/api/action-items${suffix}`).then(
    (r) => r.action_items,
  );
}

/** One meeting's action items. Coach and mentor only. */
export function listMeetingActionItems(meetingId: string): Promise<ActionItem[]> {
  return get<{ action_items: ActionItem[] }>(
    `/api/meetings/${meetingId}/action-items`,
  ).then((r) => r.action_items);
}

export function createActionItem(
  meetingId: string,
  input: { text: string; due_at?: number | null },
): Promise<ActionItem> {
  return send<{ action_item: ActionItem }>(
    `/api/meetings/${meetingId}/action-items`,
    'POST',
    input,
  ).then((r) => r.action_item);
}

export function updateActionItem(
  meetingId: string,
  id: string,
  patch: { text?: string; status?: ActionStatus; due_at?: number | null },
): Promise<ActionItem> {
  return send<{ action_item: ActionItem }>(
    `/api/meetings/${meetingId}/action-items/${id}`,
    'PATCH',
    patch,
  ).then((r) => r.action_item);
}

export function deleteActionItem(
  meetingId: string,
  id: string,
): Promise<{ ok: true }> {
  return send(`/api/meetings/${meetingId}/action-items/${id}`, 'DELETE');
}

/** Turn a meeting's action item into a board task. Creates a board if needed. */
export function promoteActionItem(
  meetingId: string,
  actionItemId: string,
  boardId?: string,
): Promise<{ task: Task }> {
  return send(
    `/api/meetings/${meetingId}/action-items/${actionItemId}/promote`,
    'POST',
    { board_id: boardId },
  );
}

export function putAttendance(
  meetingId: string,
  entries: {
    member_id: string;
    /** null clears the entry rather than recording an absence. */
    state: AttendanceState | null;
    /** Required when state is 'other'; the server answers missing_detail without it. */
    note?: string;
  }[],
): Promise<{ attendance: AttendanceRecord[] }> {
  return send(`/api/meetings/${meetingId}/attendance`, 'PUT', { entries });
}

/**
 * Check yourself in. The server ignores the body entirely and uses the session's
 * own membership, so a student can never mark a friend present.
 */
export function checkInSelf(
  meetingId: string,
): Promise<{ ok: true; member_id: string; state: 'present' }> {
  return send(`/api/meetings/${meetingId}/attendance/self`, 'POST', {});
}

export function attendanceSummary(): Promise<{
  meetings_held: number;
  members: {
    member_id: string;
    display_name: string;
    present: number;
    absent: number;
    other: number;
  }[];
}> {
  return get('/api/attendance/summary');
}

// -------------------------------------------------------------- roster photos

/**
 * Record that the signed FIRST Consent and Release is on file for this student.
 *
 * Coglin cannot obtain verifiable parental consent and does not pretend to — a
 * named coach attests, at a known time, that the real paper form exists. The
 * upload below refuses until this has been called.
 */
export function recordPhotoConsent(memberId: string): Promise<{ ok: true }> {
  return send(`/api/members/${memberId}/photo-consent`, 'POST');
}

/** Withdraw consent. Takes the photo down in the same call. */
export function withdrawPhotoConsent(memberId: string): Promise<{ ok: true }> {
  return send(`/api/members/${memberId}/photo-consent`, 'DELETE');
}

export function deleteMemberPhoto(memberId: string): Promise<{ ok: true }> {
  return send(`/api/members/${memberId}/photo`, 'DELETE');
}

// -------------------------------------------------------------------- finance

/**
 * The season's ledger, receipts riding along. Readable by every role — a
 * viewer is a parent or a sponsor, and where the money went is exactly what a
 * sponsor is owed. Writes below are coach/mentor, enforced server-side.
 */
export function listTransactions(): Promise<Transaction[]> {
  return get<{ transactions: Transaction[] }>('/api/finance/transactions').then(
    (r) => r.transactions,
  );
}

export function createTransaction(input: {
  kind: TransactionKind;
  category: TransactionCategory;
  label: string;
  note?: string | null;
  amount_cents: number;
  occurred_at: number;
}): Promise<Transaction> {
  return send<{ transaction: Transaction }>(
    '/api/finance/transactions',
    'POST',
    input,
  ).then((r) => r.transaction);
}

export function updateTransaction(
  id: string,
  patch: {
    kind?: TransactionKind;
    category?: TransactionCategory;
    label?: string;
    note?: string | null;
    amount_cents?: number;
    occurred_at?: number;
  },
): Promise<Transaction> {
  return send<{ transaction: Transaction }>(
    `/api/finance/transactions/${id}`,
    'PATCH',
    patch,
  ).then((r) => r.transaction);
}

/** Removes the line and its receipts together — see the route's header. */
export function deleteTransaction(id: string): Promise<{ ok: true }> {
  return send(`/api/finance/transactions/${id}`, 'DELETE');
}

export function deleteReceipt(
  transactionId: string,
  mediaId: string,
): Promise<{ ok: true }> {
  return send(
    `/api/finance/transactions/${transactionId}/receipts/${mediaId}`,
    'DELETE',
  );
}

export function financeSummary(): Promise<FinanceSummary> {
  return get<FinanceSummary>('/api/finance/summary');
}

export function listPartOrders(): Promise<PartOrder[]> {
  return get<{ orders: PartOrder[] }>('/api/finance/orders').then((r) => r.orders);
}

export function createPartOrder(input: {
  item: string;
  description?: string | null;
  url?: string | null;
  vendor?: string | null;
  qty: number;
  unit_price_cents: number;
}): Promise<PartOrder> {
  return send<{ order: PartOrder }>('/api/finance/orders', 'POST', input).then(
    (r) => r.order,
  );
}

/** Editable only while pending — after a decision the row is what was decided on. */
export function updatePartOrder(
  id: string,
  patch: {
    item?: string;
    description?: string | null;
    url?: string | null;
    vendor?: string | null;
    qty?: number;
    unit_price_cents?: number;
  },
): Promise<PartOrder> {
  return send<{ order: PartOrder }>(`/api/finance/orders/${id}`, 'PATCH', patch).then(
    (r) => r.order,
  );
}

export function decidePartOrder(
  id: string,
  decision: 'approved' | 'denied',
  note?: string,
): Promise<PartOrder> {
  return send<{ order: PartOrder }>(`/api/finance/orders/${id}/decision`, 'POST', {
    decision,
    note,
  }).then((r) => r.order);
}

/** Books the expense line in the same batch — see the route's header. */
export function markOrderOrdered(id: string): Promise<PartOrder> {
  return send<{ order: PartOrder }>(`/api/finance/orders/${id}/ordered`, 'POST').then(
    (r) => r.order,
  );
}

export function markOrderReceived(id: string): Promise<PartOrder> {
  return send<{ order: PartOrder }>(`/api/finance/orders/${id}/received`, 'POST').then(
    (r) => r.order,
  );
}

export function cancelPartOrder(id: string): Promise<PartOrder> {
  return send<{ order: PartOrder }>(`/api/finance/orders/${id}/cancel`, 'POST').then(
    (r) => r.order,
  );
}

/** Grant or revoke the part-order approver flag. Coach/mentor only. */
export function setPurchaseApprover(
  memberId: string,
  isApprover: boolean,
): Promise<{ ok: true; is_purchase_approver: boolean }> {
  return send(`/api/members/${memberId}`, 'PATCH', {
    is_purchase_approver: isApprover,
  });
}

// --------------------------------------------------------------- sponsorship

/**
 * Campaigns with their tiers and money rollups. Readable by every role — the
 * sponsorship story is the part of the season a sponsor is most obviously owed.
 */
export function listCampaigns(): Promise<SponsorshipCampaign[]> {
  return get<{ campaigns: SponsorshipCampaign[] }>('/api/finance/campaigns').then(
    (r) => r.campaigns,
  );
}

/** The single read, which is the only one carrying the pitch body. */
export function getCampaign(id: string): Promise<SponsorshipCampaign> {
  return get<{ campaign: SponsorshipCampaign }>(`/api/finance/campaigns/${id}`).then(
    (r) => r.campaign,
  );
}

export function createCampaign(input: {
  name: string;
  goal_cents: number;
}): Promise<SponsorshipCampaign> {
  return send<{ campaign: SponsorshipCampaign }>(
    '/api/finance/campaigns',
    'POST',
    input,
  ).then((r) => r.campaign);
}

export function updateCampaign(
  id: string,
  patch: { name?: string; goal_cents?: number },
): Promise<SponsorshipCampaign> {
  return send<{ campaign: SponsorshipCampaign }>(
    `/api/finance/campaigns/${id}`,
    'PATCH',
    patch,
  ).then((r) => r.campaign);
}

/**
 * Save the pitch on a compare-and-swap.
 *
 * Returns just the new rev, which is the shape `pitchSyncAdapter` in
 * useDocSync.ts needs. A stale write throws `Error('stale_content')` — the code
 * the sync queue checks for to leave its retry loop.
 */
export function putCampaignPitch(
  id: string,
  content: string,
  baseRev?: number,
): Promise<{ rev: number; unchanged?: boolean }> {
  return send<{ campaign: SponsorshipCampaign; unchanged?: boolean }>(
    `/api/finance/campaigns/${id}/pitch`,
    'PUT',
    { content, base_rev: baseRev },
  ).then((r) => ({ rev: r.campaign.rev, unchanged: r.unchanged }));
}

/** Refused while the campaign still holds prospects or sponsors. */
export function deleteCampaign(id: string): Promise<{ ok: true }> {
  return send(`/api/finance/campaigns/${id}`, 'DELETE');
}

export function createTier(
  campaignId: string,
  input: { name: string; amount_cents: number; benefits?: string | null },
): Promise<SponsorshipTier> {
  return send<{ tier: SponsorshipTier }>(
    `/api/finance/campaigns/${campaignId}/tiers`,
    'POST',
    input,
  ).then((r) => r.tier);
}

export function updateTier(
  campaignId: string,
  tierId: string,
  patch: { name?: string; amount_cents?: number; benefits?: string | null },
): Promise<SponsorshipTier> {
  return send<{ tier: SponsorshipTier }>(
    `/api/finance/campaigns/${campaignId}/tiers/${tierId}`,
    'PATCH',
    patch,
  ).then((r) => r.tier);
}

/** Takes the full ordered id list — a partial one is refused as `stale_order`. */
export function reorderTiers(
  campaignId: string,
  ids: string[],
): Promise<SponsorshipTier[]> {
  return send<{ tiers: SponsorshipTier[] }>(
    `/api/finance/campaigns/${campaignId}/tiers/order`,
    'PUT',
    { ids },
  ).then((r) => r.tiers);
}

export function deleteTier(campaignId: string, tierId: string): Promise<{ ok: true }> {
  return send(`/api/finance/campaigns/${campaignId}/tiers/${tierId}`, 'DELETE');
}

export function listProspects(campaignId: string): Promise<SponsorProspect[]> {
  return get<{ prospects: SponsorProspect[] }>(
    `/api/finance/campaigns/${campaignId}/prospects`,
  ).then((r) => r.prospects);
}

export function createProspect(
  campaignId: string,
  input: {
    org_name: string;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    url?: string | null;
    note?: string | null;
    stage?: Exclude<ProspectStage, 'committed'>;
    pledged_cents?: number | null;
    tier_id?: string | null;
  },
): Promise<SponsorProspect> {
  return send<{ prospect: SponsorProspect }>(
    `/api/finance/campaigns/${campaignId}/prospects`,
    'POST',
    input,
  ).then((r) => r.prospect);
}

/** Frozen once committed — the server answers `already_committed`. */
export function updateProspect(
  id: string,
  patch: {
    org_name?: string;
    contact_name?: string | null;
    contact_email?: string | null;
    contact_phone?: string | null;
    url?: string | null;
    note?: string | null;
    stage?: Exclude<ProspectStage, 'committed'>;
    pledged_cents?: number | null;
    tier_id?: string | null;
  },
): Promise<SponsorProspect> {
  return send<{ prospect: SponsorProspect }>(
    `/api/finance/prospects/${id}`,
    'PATCH',
    patch,
  ).then((r) => r.prospect);
}

/**
 * They said yes. Creates the sponsor record and points the prospect at it;
 * a second press answers 409 rather than creating a second sponsor.
 *
 * This records a PROMISE. Money arriving is `recordSponsorPayment` below, which
 * is coach-and-mentor only.
 */
export function commitProspect(
  id: string,
  input: { name?: string; amount_cents?: number } = {},
): Promise<{ prospect: SponsorProspect; sponsor: Sponsor }> {
  return send(`/api/finance/prospects/${id}/commit`, 'POST', input);
}

export function deleteProspect(id: string): Promise<{ ok: true }> {
  return send(`/api/finance/prospects/${id}`, 'DELETE');
}

export function listSponsors(): Promise<Sponsor[]> {
  return get<{ sponsors: Sponsor[] }>('/api/finance/sponsors').then((r) => r.sponsors);
}

export function createSponsor(input: {
  name: string;
  amount_cents: number;
  campaign_id?: string | null;
  tier_id?: string | null;
}): Promise<Sponsor> {
  return send<{ sponsor: Sponsor }>('/api/finance/sponsors', 'POST', input).then(
    (r) => r.sponsor,
  );
}

export function updateSponsor(
  id: string,
  patch: { name?: string; amount_cents?: number; tier_id?: string | null },
): Promise<Sponsor> {
  return send<{ sponsor: Sponsor }>(`/api/finance/sponsors/${id}`, 'PATCH', patch).then(
    (r) => r.sponsor,
  );
}

export function setSponsorThanked(id: string, thanked: boolean): Promise<Sponsor> {
  return send<{ sponsor: Sponsor }>(`/api/finance/sponsors/${id}/thanked`, 'POST', {
    thanked,
  }).then((r) => r.sponsor);
}

/**
 * Book a sponsor payment on the ledger. Coach or mentor only — every other
 * sponsorship write records an intention; this one writes the book of record.
 *
 * Repeatable by design: a sponsor may pay in instalments.
 */
export function recordSponsorPayment(
  id: string,
  input: { amount_cents: number; occurred_at: number; note?: string | null },
): Promise<{ transaction: Transaction; paid_cents: number; payment_count: number }> {
  return send(`/api/finance/sponsors/${id}/payments`, 'POST', input);
}

/** Refused while ledger lines point at them (`sponsor_has_payments`). */
export function deleteSponsor(id: string): Promise<{ ok: true }> {
  return send(`/api/finance/sponsors/${id}`, 'DELETE');
}

// ------------------------------------------------------------ season purchase

/**
 * Start a Stripe Checkout Session for one season, at the price the buyer set
 * (COG-047).
 *
 * The one call in this module that works signed OUT — /pricing is public, so a
 * coach can buy before they have an account. Consequently there is no tenant
 * here and no team_id: `team_number` and `team_name` are self-reported strings
 * typed into a form, and the server never joins them to a real team. See the
 * header of migrations/0007_purchases.sql.
 *
 * `amount_cents` is a request, not an instruction. The server clamps it to
 * [$5, $2000] and the response echoes back what it actually used.
 */
export function startPurchase(input: {
  amount_cents: number;
  seat_count: number;
  team_number?: number;
  team_name?: string;
  turnstile_token?: string;
}): Promise<{ url: string; amount_cents: number }> {
  return send('/api/billing/checkout', 'POST', input);
}

// --------------------------------------------------------------------------
// Not built yet. Each returns nothing until its feature lands (COG-014
// outreach, COG-013 awards, COG-016 calendar), at which point the body becomes
// a `get()` call and the screens do not change.
// --------------------------------------------------------------------------

export function listOutreach(): Promise<OutreachEvent[]> {
  return resolve([]);
}

export function listCalendar(): Promise<CalendarEvent[]> {
  return resolve([]);
}

export function listAwardCriteria(): Promise<AwardCriterion[]> {
  return resolve([]);
}

/**
 * Board mutation — the single write path for everything on the board.
 *
 * The op shape is unchanged, so the Durable Object (COG-009) can still replay
 * this exact stream to a second viewer later without the write path moving.
 *
 * Takes an array as well as a single op, because reordering needs one genuinely
 * batched case: when the 1024-gap midpoints between two cards are used up, the
 * client renumbers that whole column at once and the server applies it in one
 * D1 batch. A half-applied renumber would look to everyone else like somebody
 * shuffled their board.
 *
 * No longer fire-and-forget. The response carries the board's authoritative
 * task list, which the caller adopts on success and rolls back to on failure —
 * `void`-ing this promise was hiding real 403s and 409s behind a card that
 * quietly sprang back on the next reload.
 */
export function mutateBoard(
  boardId: string,
  ops: BoardOp | BoardOp[],
): Promise<{ ok: true; tasks: Task[] }> {
  return send(`/api/boards/${boardId}/mutate`, 'POST', {
    ops: Array.isArray(ops) ? ops : [ops],
  });
}

// ---------------------------------------------------------------- bug reports

export interface BugReportResult {
  ok: true;
  /** Quotable in the alpha channel — the dialog shows the first eight. */
  id: string;
  /**
   * False when the mail to us did not go out. The row exists either way, and
   * the dialog says which happened rather than claiming success.
   */
  sent: boolean;
}

/**
 * File a bug from inside the app.
 *
 * The diagnostics come from lib/diagnostics.ts and are SHOWN TO THE REPORTER
 * before this is called. Nothing is collected silently, and nothing here is a
 * screenshot or a copy of the page — see migrations/0008_bug_reports.sql for
 * what is deliberately absent and why.
 *
 * Everything past `body` is advisory: the server whitelists what it stores and
 * stamps the environment itself, so a client that sends nothing still files a
 * usable report.
 */
export function submitBugReport(input: {
  body: string;
  kind?: 'bug' | 'confusing' | 'idea';
  route?: string;
  app_build?: string;
  user_agent?: string;
  viewport_w?: number;
  viewport_h?: number;
  dpr?: number;
  timezone?: string;
  language?: string;
  theme?: string;
  online?: boolean;
}): Promise<BugReportResult> {
  return send<BugReportResult>('/api/bug-reports', 'POST', input);
}

/**
 * Now, in epoch seconds.
 *
 * Real time, not the fixtures' pinned date — every "days until" and "overdue"
 * on screen is derived from this, and a hardcoded 2026 date made a live
 * dashboard confidently wrong about the season it was in. Demo mode keeps the
 * dashboard confidently wrong about the season it was in.
 */
export function now(): number {
  return Math.floor(Date.now() / 1000);
}

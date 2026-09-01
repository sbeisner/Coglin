/**
 * Domain types, mirroring migrations/0001_init.sql field-for-field.
 *
 * These deliberately use the DATABASE's names and shapes — snake_case columns,
 * epoch-SECONDS timestamps, json-as-string — rather than a prettier client
 * model. Mock fixtures that drift from the schema would quietly bake wrong
 * assumptions into every screen, and the whole point of the mock layer is that
 * Phase 1 can swap the transport without touching a single component.
 */

export type Role = 'coach' | 'mentor' | 'student' | 'viewer';

export type SubTeam =
  | 'build'
  | 'programming'
  | 'cad'
  | 'outreach'
  | 'portfolio'
  | 'business'
  | 'drive';

export const SUB_TEAMS: { id: SubTeam; label: string }[] = [
  { id: 'build', label: 'Build' },
  { id: 'programming', label: 'Programming' },
  { id: 'cad', label: 'CAD' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'business', label: 'Business' },
  { id: 'drive', label: 'Drive team' },
];

export type TaskStatus = 'todo' | 'doing' | 'blocked' | 'done';

export const TASK_COLUMNS: { id: TaskStatus; label: string }[] = [
  { id: 'todo', label: 'To do' },
  { id: 'doing', label: 'In progress' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'done', label: 'Done' },
];

export interface Team {
  id: string;
  team_number: number;
  name: string;
  region: string | null;
  /**
   * IANA zone. Every recurring meeting is resolved against it, so a wrong value
   * here materialises a whole season an hour off rather than failing.
   */
  timezone: string;
  created_at: number;
}

export interface Season {
  id: string;
  team_id: string;
  label: string;
  starts_at: number;
  ends_at: number;
  is_current: number;
}

export interface Member {
  id: string;
  team_id: string;
  role: Role;
  sub_teams: SubTeam[];
  display_name: string;
  handle: string | null;
  status: string;
  /**
   * Null when there is no photo, and always null for a viewer — a sponsor is
   * not handed pictures of other people's children. See 0004_roster_photos.sql.
   */
  photo_media_id: string | null;
  /**
   * Whether a coach has recorded that the signed FIRST Consent and Release is
   * on file. A photo cannot be attached until it is true. Deliberately a
   * boolean rather than the timestamp: the roster needs to know whether it may
   * hold a photo, not to publish when a form was signed.
   */
  photo_consent: boolean;
  /**
   * Whether this member may decide part orders. Coaches and mentors always
   * can regardless of this flag — it exists to extend approval to a student
   * treasurer. Mirrors is_purchase_approver in worker/lib/finance.ts.
   */
  is_purchase_approver: boolean;
  created_at: number;
}

/**
 * One student on one evening.
 *
 * `state` is the whole disposition. `other` carries its explanation in `note`
 * ("leaving early for dentist") and the Worker will not accept it without one.
 * `excused`, `arrived_late`, `left_early` and `minutes` were retired in
 * migrations/0005_attendance.sql, which has the reasoning.
 */
export type AttendanceState = 'present' | 'absent' | 'other';

export interface AttendanceRecord {
  id: string;
  member_id: string;
  state: AttendanceState;
  note: string | null;
  recorded_by: string | null;
  recorded_at: number;
}

/** open | done | dropped, mirroring ACTION_STATUSES in worker/lib/meetings.ts. */
export type ActionStatus = 'open' | 'done' | 'dropped';

/**
 * One line on a coach's private list for a meeting.
 *
 * "Pay registration." "Email Jamie's mum." "Follow up with John about his
 * behaviour at meetings." Not team tasks and not notes — one adult's own
 * responsibilities, some of them about a named student, which is why the routes
 * are coach-and-mentor only rather than merely hidden from students.
 *
 * `assignee_member_id` exists in the schema and is never written by the UI: the
 * only people who can READ this list are coaches and mentors, so assigning an
 * item to a student would create an assignment they can never see. The column is
 * kept for a future shared-action-items feature.
 */
export interface ActionItem {
  id: string;
  meeting_id: string;
  text: string;
  assignee_member_id: string | null;
  due_at: number | null;
  status: ActionStatus;
  task_id: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

/** An action item carrying its meeting, for the cross-season dashboard rollup. */
export interface OpenActionItem extends ActionItem {
  meeting_title: string;
  meeting_starts_at: number;
}

export interface Board {
  id: string;
  team_id: string;
  season_id: string;
  name: string;
  sub_team: SubTeam | null;
  position: number;
}

export interface Task {
  id: string;
  team_id: string;
  board_id: string;
  title: string;
  body: string | null;
  assignee_member_id: string | null;
  status: TaskStatus;
  due_at: number | null;
  position: number;
  /** "What we tried, why we changed it" — the Think award's raw material. */
  decision_log: string | null;
  created_at: number;
  updated_at: number;
}

// ------------------------------------------------------------------- finance

/** income | expense, mirroring TRANSACTION_KINDS in worker/lib/finance.ts. */
export type TransactionKind = 'income' | 'expense';

/**
 * Categories are per kind — the labels-first arrays below are what the
 * category <select> renders, filtered by the kind toggle. The server validates
 * the pair, so a mismatch is a 400 rather than a stored lie.
 */
export type ExpenseCategory =
  | 'parts'
  | 'tools'
  | 'registration'
  | 'travel'
  | 'outreach'
  | 'food'
  | 'other';

export type IncomeCategory =
  | 'sponsorship'
  | 'fundraising'
  | 'grant'
  | 'dues'
  | 'other';

export type TransactionCategory = ExpenseCategory | IncomeCategory;

export const EXPENSE_CATEGORIES: { id: ExpenseCategory; label: string }[] = [
  { id: 'parts', label: 'Parts' },
  { id: 'tools', label: 'Tools' },
  { id: 'registration', label: 'Registration' },
  { id: 'travel', label: 'Travel' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'food', label: 'Food' },
  { id: 'other', label: 'Other' },
];

export const INCOME_CATEGORIES: { id: IncomeCategory; label: string }[] = [
  { id: 'sponsorship', label: 'Sponsorship' },
  { id: 'fundraising', label: 'Fundraising' },
  { id: 'grant', label: 'Grant' },
  { id: 'dues', label: 'Dues' },
  { id: 'other', label: 'Other' },
];

/** A file evidencing a ledger line. `is_pdf` decides chip vs thumbnail. */
export interface Receipt {
  id: string;
  bytes: number;
  is_pdf: number;
}

/**
 * One movement of money. `amount_cents` is always positive — `kind` carries
 * the sign, so the client renders the minus rather than storing it.
 * `order_item` is provenance: non-null means a part order booked this line.
 */
export interface Transaction {
  id: string;
  kind: TransactionKind;
  category: TransactionCategory;
  label: string;
  note: string | null;
  amount_cents: number;
  occurred_at: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
  order_id: string | null;
  order_item: string | null;
  receipts: Receipt[];
}

/**
 * The status ladder, mirroring ORDER_STATUSES in worker/lib/finance.ts:
 * pending -> approved | denied, approved -> ordered -> received, and
 * pending/approved -> canceled.
 */
export type OrderStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'ordered'
  | 'received'
  | 'canceled';

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  denied: 'Denied',
  ordered: 'Ordered',
  received: 'Received',
  canceled: 'Canceled',
};

export interface PartOrder {
  id: string;
  item: string;
  description: string | null;
  url: string | null;
  vendor: string | null;
  qty: number;
  unit_price_cents: number;
  status: OrderStatus;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: number | null;
  decision_note: string | null;
  ordered_at: number | null;
  received_at: number | null;
  transaction_id: string | null;
  created_at: number;
  updated_at: number;
  /** Joined display names, so the queue reads without a roster lookup. */
  requested_by_name?: string | null;
  decided_by_name?: string | null;
}

export interface FinanceSummary {
  income_cents: number;
  expense_cents: number;
  pending_orders: number;
  pending_estimate_cents: number;
}

export interface OutreachEvent {
  id: string;
  team_id: string;
  season_id: string;
  title: string;
  occurred_at: number;
  hours: number;
  people_reached: number;
  what_we_learned: string | null;
  created_by: string | null;
  created_at: number;
}

export type CalendarKind =
  | 'meet'
  | 'qualifier'
  | 'championship'
  | 'deadline'
  | 'kickoff'
  | 'other';

export interface CalendarEvent {
  id: string;
  team_id: string;
  season_id: string;
  kind: CalendarKind;
  title: string;
  starts_at: number;
  ends_at: number | null;
}

export type MeetingKind =
  | 'build'
  | 'general'
  | 'outreach'
  | 'design_review'
  | 'business'
  | 'drive_practice'
  | 'competition'
  | 'other';

export const MEETING_KINDS: { id: MeetingKind; label: string }[] = [
  { id: 'build', label: 'Build' },
  { id: 'general', label: 'General' },
  { id: 'outreach', label: 'Outreach' },
  { id: 'design_review', label: 'Design review' },
  { id: 'business', label: 'Business' },
  { id: 'drive_practice', label: 'Drive practice' },
  { id: 'competition', label: 'Competition' },
  { id: 'other', label: 'Other' },
];

export type MeetingStatus = 'planned' | 'held' | 'cancelled';

export interface Meeting {
  id: string;
  team_id: string;
  season_id: string;
  title: string;
  starts_at: number;
  ends_at: number | null;
  location: string | null;
  kind: MeetingKind;
  status: MeetingStatus;
  series_id: string | null;
  /** The occurrence's local date as YYYYMMDD — its identity within a series. */
  series_slot: number | null;
  detached_at: number | null;
  started_at: number | null;
  ended_at: number | null;
  cancel_reason: string | null;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Counts the list endpoint computes so the index does not have to fetch a
 * meeting's contents to say whether it has any.
 */
export interface MeetingSummary extends Meeting {
  attendance_count: number;
  doc_count: number;
  flagged_count: number;
}

/**
 * A recurrence rule. Stored as parts rather than an epoch stride: `start_minute`
 * is minutes after LOCAL midnight, and `starts_on`/`until` are local dates as
 * YYYYMMDD. See worker/lib/tz.ts for why an epoch stride is wrong.
 */
export interface MeetingSeries {
  id: string;
  team_id: string;
  season_id: string;
  title: string;
  kind: MeetingKind;
  location: string | null;
  /** 0 = Sunday, matching Date#getDay. */
  days_of_week: number[];
  start_minute: number;
  duration_minutes: number;
  timezone: string;
  starts_on: number;
  until: number;
  created_at: number;
  updated_at: number;
}

/**
 * One note document.
 *
 * `content` is TipTap/ProseMirror JSON as a string — the editor's own format,
 * stored inert. `content_text` is the server's plain-text projection of it, which
 * is what search and portfolio excerpts read; the client never writes it.
 *
 * `rev` is the compare-and-swap token. Send back the one you last saw and a save
 * that would overwrite somebody else's answers 409 instead. It is a counter and
 * not a timestamp because timestamps here are whole seconds, and two people
 * typing in the same second is the case that matters.
 */
export interface NoteDoc {
  id: string;
  parent_doc_id: string | null;
  /** null means the document stands on its own rather than belonging to a meeting. */
  meeting_id: string | null;
  /** REAL, sparse. Dropping a document between two siblings is a one-row write. */
  position: number;
  title: string;
  content: string;
  content_text: string;
  rev: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * A document in the tree, without its body.
 *
 * The sidebar draws forty titles; shipping forty bodies to do it is the N+1's fat
 * cousin. `content_bytes` is what lets a row show that a page is still empty.
 */
export interface NoteDocSummary {
  id: string;
  parent_doc_id: string | null;
  meeting_id: string | null;
  position: number;
  title: string;
  content_bytes: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: number;
  updated_at: number;
  /** Joined, so the tree can group by meeting without a second request. */
  meeting_title?: string | null;
  meeting_starts_at?: number | null;
}

export interface AgendaItem {
  id: string;
  meeting_id: string;
  position: number;
  title: string;
  detail: string | null;
  owner_member_id: string | null;
  minutes_planned: number | null;
  sub_team: string | null;
  done: number;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export const WEEKDAYS: { id: number; short: string; label: string }[] = [
  { id: 0, short: 'S', label: 'Sunday' },
  { id: 1, short: 'M', label: 'Monday' },
  { id: 2, short: 'T', label: 'Tuesday' },
  { id: 3, short: 'W', label: 'Wednesday' },
  { id: 4, short: 'T', label: 'Thursday' },
  { id: 5, short: 'F', label: 'Friday' },
  { id: 6, short: 'S', label: 'Saturday' },
];

/**
 * A flag saying "this might belong in the portfolio", plus a judgement about it.
 *
 * Source-agnostic from the start so the Awards screen and the outreach log can
 * feed the same inbox later without a schema change. `note_doc` is the unit now:
 * flagging used to be per PARAGRAPH, which is why note blocks existed as rows at
 * all, and it is now per document. `meeting` covers a whole evening.
 *
 * This is the single source of truth for whether something is flagged; documents
 * carry no `flagged_at` of their own, so a mark cannot drift from its record.
 */
export type CandidateSourceType =
  | 'meeting'
  | 'note_doc'
  | 'media'
  | 'task'
  | 'outreach_event';

export type CandidateState = 'candidate' | 'shortlisted' | 'placed' | 'rejected';

export interface PortfolioCandidate {
  id: string;
  source_type: CandidateSourceType;
  source_id: string;
  suggested_award: AwardKey | null;
  why: string | null;
  state: CandidateState;
  placed_page_id: string | null;
  flagged_by: string | null;
  created_at: number;
}

/** The eight judged awards. Criteria come from the Competition Manual §6. */
export type AwardKey =
  | 'inspire'
  | 'think'
  | 'connect'
  | 'reach'
  | 'sustain'
  | 'innovate'
  | 'control'
  | 'design';

export type CriterionState = 'todo' | 'partial' | 'ready';

export interface AwardCriterion {
  id: string;
  team_id: string;
  season_id: string;
  award: AwardKey;
  criterion_key: string;
  state: CriterionState;
  notes: string | null;
}

/**
 * Board mutations use the same op shape the server will accept at
 * POST /api/boards/:id/mutate, so the Durable Object can later replay this
 * exact stream to subscribers without the client's write path changing.
 */
export type BoardOp =
  | { op: 'move_task'; task_id: string; status: TaskStatus; position: number }
  | { op: 'create_task'; task: Task }
  | { op: 'update_task'; task_id: string; patch: Partial<Task> }
  | { op: 'delete_task'; task_id: string };

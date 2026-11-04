import { useCallback, useEffect, useRef, useState } from 'react';
import * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { initials } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { AttendanceRecord, AttendanceState, Member } from '@/types';

/**
 * Taking the roll: one dropdown per person, and a sentence when it needs one.
 *
 * This replaced a three-state segmented control plus independent "arrived late"
 * and "left early" toggles. That shape could express more — twenty minutes late
 * AND gone before the end was one control each — and it lost anyway, because
 * four controls per row times fifteen students, on a phone, in a cold shop, is a
 * roll that does not get taken. `other` plus free text says "leaving early for
 * dentist" in one field, which is both less work and more informative than two
 * booleans ever were. migrations/0005_attendance.sql has the full argument.
 *
 * "All present" then adjust is still the interaction rather than fifteen
 * individual taps: everybody turning up is the common case, and the exceptions
 * are what a coach actually wants to spend attention on.
 */

/**
 * Present, Absent, Other — and Other last on purpose. The first two cover every
 * row on a normal evening; the third is where the reading happens.
 *
 * "Not marked" is the fourth option and it earns its place: the old segmented
 * control cleared a row by tapping its current state again, and a Select has no
 * equivalent gesture. Without it, a coach who mis-taps has no way to un-mark
 * somebody. Radix forbids the empty string as an item value, hence the sentinel.
 */
const NONE = '__none__';

const STATES: { id: AttendanceState; label: string }[] = [
  { id: 'present', label: 'Present' },
  { id: 'absent', label: 'Absent' },
  { id: 'other', label: 'Other' },
];

const LABEL: Record<AttendanceState, string> = {
  present: 'Present',
  absent: 'Absent',
  other: 'Other',
};

/** Codes cross the api boundary; the copy lives here. See lib/api.ts. */
const ERROR_COPY: Record<string, string> = {
  forbidden: 'Only coaches and mentors can take the roll.',
  missing_detail: 'Say what “Other” means for the highlighted person.',
  unknown_member:
    'Somebody on this list is no longer on the roster. Reload the page.',
  not_found: 'This meeting is gone. Reload the page.',
};

interface Draft {
  state: AttendanceState | null;
  note: string;
}

export function AttendancePanel({
  meetingId,
  members,
  attendance,
  canRecord,
  selfMemberId,
  onSaved,
}: {
  meetingId: string;
  members: Member[];
  attendance: AttendanceRecord[];
  /** Coaches and mentors take the roll; everyone else checks themselves in. */
  canRecord: boolean;
  selfMemberId: string;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Record<string, Draft>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invalidMemberId, setInvalidMemberId] = useState<string | null>(null);
  /** The row whose detail field should take focus, set when Other is chosen. */
  const focusNote = useRef<string | null>(null);

  /**
   * Re-seed whenever the server's copy changes, not only on mount.
   *
   * The bug this fixes: the draft used to be built in the useState initializer,
   * so after "Save roll" the parent refetched, `attendance` arrived with new
   * rows — and the panel went on rendering the pre-save draft forever. Two
   * coaches taking different halves of the room never saw each other's marks,
   * and a failed save left the screen showing marks that were never written.
   *
   * Re-seeding on every change is safe HERE, unlike the note editor, because
   * this panel has an explicit Save button and no debounce: there is no
   * in-flight write for a refetch to race. If autosave is ever added, this
   * becomes the problem Meeting.tsx describes and needs the same seed-once
   * treatment.
   */
  useEffect(() => {
    setDraft(
      Object.fromEntries(
        members.map((m) => {
          const record = attendance.find((a) => a.member_id === m.id);
          return [m.id, { state: record?.state ?? null, note: record?.note ?? '' }];
        }),
      ),
    );
  }, [members, attendance]);

  useEffect(() => {
    const id = focusNote.current;
    if (!id) return;
    focusNote.current = null;
    document.getElementById(`att-note-${id}`)?.focus();
  }, [draft]);

  const marked = members.filter((m) => draft[m.id]?.state != null).length;

  const setRow = useCallback((memberId: string, next: Partial<Draft>) => {
    setDraft((prev) => ({
      ...prev,
      [memberId]: { ...(prev[memberId] ?? { state: null, note: '' }), ...next },
    }));
  }, []);

  const save = useCallback(async () => {
    /**
     * Only the rows that differ from the server's copy.
     *
     * The old version sent every member on every save, including `state: null`
     * for anyone unmarked — and null means DELETE. That defeated the exact
     * guarantee PUT /attendance advertises ("members not named are left alone,
     * so two coaches marking different halves of the room do not erase each
     * other"): naming everyone made the second coach's save delete every row the
     * first had just created. It also billed D1 for fifteen writes to record two.
     */
    const entries = members
      .map((m) => ({
        member_id: m.id,
        next: draft[m.id] ?? { state: null, note: '' },
        prev: attendance.find((a) => a.member_id === m.id),
      }))
      .filter(
        ({ next, prev }) =>
          (next.state ?? null) !== (prev?.state ?? null) ||
          next.note !== (prev?.note ?? ''),
      )
      .map(({ member_id, next }) => ({
        member_id,
        state: next.state,
        // Only meaningful for `other`. Sending it otherwise would keep stale
        // prose attached to a row that is now a plain absence.
        note: next.state === 'other' ? next.note.trim() : undefined,
      }));

    if (entries.length === 0) {
      setError(null);
      return;
    }

    // The server enforces this too — a stale bundle must not be able to write an
    // unexplained `other` — but catching it here saves a round trip and can
    // point at the row, which a 400 can only do by member id.
    const missing = entries.find((e) => e.state === 'other' && !e.note);
    if (missing) {
      setInvalidMemberId(missing.member_id);
      setError('missing_detail');
      return;
    }

    setPending(true);
    setError(null);
    setInvalidMemberId(null);
    try {
      await api.putAttendance(meetingId, entries);
      onSaved();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(code);
      if (code === 'missing_detail') setInvalidMemberId(null);
    } finally {
      setPending(false);
    }
  }, [attendance, draft, meetingId, members, onSaved]);

  /**
   * Students who checked themselves in and have not been confirmed.
   *
   * Team points only score marks a coach or mentor recorded (see
   * worker/routes/points.ts), and `save` above sends only rows that changed, so
   * a self check-in the coach agrees with is never rewritten and never scores.
   * This is the explicit "yes, they were here". A row the coach has already
   * changed in the draft is left out: confirming it would overwrite the edit.
   */
  const unconfirmed = attendance.filter(
    (a) =>
      a.state === 'present' &&
      a.recorded_by === a.member_id &&
      (draft[a.member_id]?.state ?? 'present') === 'present',
  );
  const unconfirmedIds = new Set(unconfirmed.map((a) => a.member_id));

  const confirmCheckIns = useCallback(async () => {
    setPending(true);
    setError(null);
    setInvalidMemberId(null);
    try {
      await api.putAttendance(
        meetingId,
        unconfirmed.map((a) => ({ member_id: a.member_id, state: 'present' as const })),
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }, [meetingId, onSaved, unconfirmed]);

  const checkInSelf = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      await api.checkInSelf(meetingId);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }, [meetingId, onSaved]);

  // ------------------------------------------------------- the student's view
  if (!canRecord) {
    const mine = attendance.find((a) => a.member_id === selfMemberId);
    return (
      <div className="bg-card border-border rounded-lg border p-4">
        {mine ? (
          <p className="text-sm">
            You are marked{' '}
            <span className="font-medium">{LABEL[mine.state] ?? mine.state}</span>
            {/* The coach's own words about this evening, shown back to the
                student it is about. That is correct — it is their record — and it
                is exactly why the coach's action items are a separate, gated
                surface rather than another note field on this row. */}
            {mine.state === 'other' && mine.note ? <> — {mine.note}</> : null}.
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-muted-foreground text-sm">
              Not marked yet.
            </p>
            <Button size="sm" disabled={pending} onClick={() => void checkInSelf()}>
              {pending ? 'Saving…' : "I'm here"}
            </Button>
          </div>
        )}
        {error && (
          <p role="alert" className="text-destructive mt-3 text-sm">
            {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
          </p>
        )}
      </div>
    );
  }

  // --------------------------------------------------------- the coach's view
  return (
    <div className="bg-card border-border overflow-hidden rounded-lg border">
      <div className="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <p className="text-muted-foreground tabular font-mono text-xs">
          {marked} of {members.length} marked
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {unconfirmed.length > 0 && (
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => void confirmCheckIns()}
            >
              Confirm {unconfirmed.length} check-in{unconfirmed.length === 1 ? '' : 's'}
            </Button>
          )}
          {/* Deselecting two people beats tapping fifteen. Notes are left alone:
              this sets dispositions, it does not erase what somebody wrote. */}
          <Button
            size="xs"
            variant="outline"
            onClick={() =>
              setDraft((prev) =>
                Object.fromEntries(
                  members.map((m) => [
                    m.id,
                    { ...(prev[m.id] ?? { note: '' }), state: 'present' as const },
                  ]),
                ),
              )
            }
          >
            All present
          </Button>
          <Button size="xs" disabled={pending} onClick={() => void save()}>
            {pending ? 'Saving…' : 'Save roll'}
          </Button>
        </div>
      </div>

      <ul className="divide-border divide-y">
        {members.map((member) => {
          const row = draft[member.id] ?? { state: null, note: '' };
          const invalid = invalidMemberId === member.id;
          return (
            <li key={member.id} className="px-4 py-2.5">
              <div className="flex items-center gap-3">
                <Avatar className="size-8 shrink-0">
                  {member.photo_media_id && (
                    <AvatarImage src={`/media/${member.photo_media_id}`} alt="" />
                  )}
                  <AvatarFallback>{initials(member.display_name)}</AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm">
                  {member.display_name}
                  {unconfirmedIds.has(member.id) && (
                    <span className="text-muted-foreground ml-2 text-xs">
                      checked in
                    </span>
                  )}
                </span>
                <Select
                  value={row.state ?? NONE}
                  onValueChange={(value) => {
                    const next = value === NONE ? null : (value as AttendanceState);
                    // Choosing Other is a deliberate act whose next step is
                    // typing. Making them tap twice is the friction this whole
                    // change exists to remove.
                    if (next === 'other') focusNote.current = member.id;
                    setRow(member.id, { state: next });
                  }}
                >
                  {/* min-height clamps the primitive's h-8, so the 44px floor
                      holds on a phone — pit day, cold hands, gloves. */}
                  <SelectTrigger
                    aria-label={`${member.display_name}: attendance`}
                    className="min-h-11 w-32 shrink-0 md:min-h-8 md:w-36"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE} className="min-h-11 md:min-h-8">
                      Not marked
                    </SelectItem>
                    {STATES.map((state) => (
                      <SelectItem
                        key={state.id}
                        value={state.id}
                        className="min-h-11 md:min-h-8"
                      >
                        {state.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Below the row, not inline. At 375px an inline field would get
                  about 100px, which cannot hold "leaving early for dentist" —
                  the coach would be typing into a keyhole. Only the minority of
                  rows grow.

                  Input rather than Textarea: Textarea has field-sizing-content,
                  so the row would change height while typing and the list would
                  reflow under the coach's thumb. */}
              {row.state === 'other' && (
                <Input
                  id={`att-note-${member.id}`}
                  value={row.note}
                  maxLength={500}
                  aria-invalid={invalid}
                  aria-label={`${member.display_name}: what happened`}
                  placeholder="Leaving early for dentist"
                  onChange={(event) =>
                    setRow(member.id, { note: event.target.value })
                  }
                  className={cn(
                    'mt-2 min-h-11 md:min-h-9',
                    invalid && 'border-destructive',
                  )}
                />
              )}
            </li>
          );
        })}
      </ul>

      {error && (
        <p role="alert" className="text-destructive border-border border-t px-4 py-3 text-sm">
          {ERROR_COPY[error] ?? 'Could not save attendance. Try again.'}
        </p>
      )}
    </div>
  );
}

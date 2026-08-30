import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, BookmarkCheck, FileText, MapPin, NotebookPen } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { formatLongDate, formatTime, relativeDays } from '@/lib/format';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { AttendancePanel } from '@/components/meetings/AttendancePanel';
import { CoachActionItems } from '@/components/meetings/CoachActionItems';
import { MEETING_KINDS } from '@/types';

const KIND_LABEL = new Map(MEETING_KINDS.map((k) => [k.id, k.label]));

export default function Meeting() {
  const { meetingId } = useParams();
  const navigate = useNavigate();
  const [reloadKey, setReloadKey] = useState(0);
  const detail = useAsync(
    () => api.getMeeting(meetingId as string),
    [meetingId, reloadKey],
  );
  const members = useAsync(api.listMembers);
  const { member } = useSession();
  const canEdit = member.role !== 'viewer';
  const canManage = member.role === 'coach' || member.role === 'mentor';
  const now = api.now();

  const meetingFlagged = useMemo(
    () =>
      (detail.data?.candidates ?? []).some(
        (c) => c.source_type === 'meeting' && c.source_id === meetingId,
      ),
    [detail.data, meetingId],
  );
  const [wholeFlagged, setWholeFlagged] = useState(false);
  useEffect(() => setWholeFlagged(meetingFlagged), [meetingFlagged]);

  async function onToggleWholeMeeting() {
    const was = wholeFlagged;
    setWholeFlagged(!was);
    try {
      if (was) await api.unflagCandidate('meeting', meetingId as string);
      else
        await api.flagCandidate({
          source_type: 'meeting',
          source_id: meetingId as string,
        });
    } catch {
      setWholeFlagged(was);
    }
  }

  async function onStart() {
    const result = await api.startMeeting(meetingId as string);
    setReloadKey((k) => k + 1);
    // Straight into the page it just seeded. On a second press doc_id is null and
    // the caller is already looking at the tree, so staying put is correct.
    if (result.doc_id) navigate(`/app/notes/${result.doc_id}`);
  }

  /** A fresh page on this meeting, opened ready to type. */
  async function onTakeNotes() {
    const doc = await api.createDoc({
      meeting_id: meetingId as string,
      title: 'Notes',
    });
    navigate(`/app/notes/${doc.id}`);
  }


  if (detail.status === 'loading') {
    return (
      <div className="space-y-4 px-4 py-6 md:px-8">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40" />
      </div>
    );
  }

  if (detail.status === 'error' || !detail.data) {
    return (
      <div className="px-4 py-6 md:px-8">
        <EmptyState
          title="That meeting is not here."
          aside="It may have been deleted, or it belongs to another team."
          action={
            <Button variant="outline" size="sm" onClick={() => navigate('/app/meetings')}>
              Back to meetings
            </Button>
          }
        />
      </div>
    );
  }

  const { meeting, agenda, docs } = detail.data;
  const cancelled = meeting.status === 'cancelled';
  const started = meeting.started_at !== null;
  /* Documents carry their own flags in the notes screen; this counts what is
     flagged ABOUT this meeting, which is the meeting itself plus any of its pages. */
  const flaggedDocs = (detail.data.candidates ?? []).filter(
    (c) => c.source_type === 'note_doc',
  ).length;
  const flaggedCount = flaggedDocs + (wholeFlagged ? 1 : 0);

  return (
    <>
      <div className="border-border border-b px-4 py-5 md:px-8">
        <Link
          to="/app/meetings"
          className="text-muted-foreground focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 text-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Meetings
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="u-display text-heading text-2xl">{meeting.title}</h1>
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span>{formatLongDate(meeting.starts_at)}</span>
              <span className="tabular font-mono">
                {formatTime(meeting.starts_at)}
                {meeting.ends_at ? `–${formatTime(meeting.ends_at)}` : ''}
              </span>
              <span>{relativeDays(meeting.starts_at, now)}</span>
              {meeting.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden />
                  {meeting.location}
                </span>
              )}
              <Badge variant="secondary">{KIND_LABEL.get(meeting.kind)}</Badge>
              {cancelled && <Badge variant="outline">Cancelled</Badge>}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Zero renders nothing: "0 flagged" is a scolding, not information. */}
            {flaggedCount > 0 && (
              <Link
                to="/app/portfolio"
                className="text-primary-ink focus-visible:ring-ring inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 focus-visible:ring-2 focus-visible:outline-none"
              >
                <BookmarkCheck className="size-4" aria-hidden />
                <span className="tabular font-mono text-sm">{flaggedCount}</span>
                <span className="u-eyebrow">flagged</span>
              </Link>
            )}

            {canEdit && !started && !cancelled && (
              <Button size="sm" onClick={() => void onStart()}>
                Start meeting
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  More
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {canEdit && (
                  <DropdownMenuItem onSelect={() => void onToggleWholeMeeting()}>
                    {wholeFlagged
                      ? 'Remove portfolio flag'
                      : 'Flag this whole meeting'}
                  </DropdownMenuItem>
                )}
                {canManage && !cancelled && (
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={() =>
                      void api
                        .cancelMeeting(meeting.id)
                        .then(() => setReloadKey((k) => k + 1))
                    }
                  >
                    Cancel meeting
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="space-y-6 px-4 py-6 md:px-8">
        {agenda.length > 0 && (
          <section>
            <h2 className="u-eyebrow mb-3">Agenda</h2>
            <ul className="bg-card border-border divide-border divide-y rounded-lg border">
              {agenda.map((item) => (
                <li key={item.id} className="px-4 py-3 text-sm">
                  {item.title}
                  {item.minutes_planned && (
                    <span className="text-muted-foreground tabular ml-2 font-mono text-xs">
                      {item.minutes_planned}m
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h2 className="u-eyebrow mb-3">Who was here</h2>
          {members.data && (
            <AttendancePanel
              meetingId={meeting.id}
              members={members.data}
              attendance={detail.data.attendance}
              canRecord={canManage}
              selfMemberId={member.id}
              onSaved={() => setReloadKey((k) => k + 1)}
            />
          )}
        </section>

        {/* Coach-private. routes/records.ts enforces it; this is just not
            drawing a door. After attendance because the roll is time-sensitive —
            it gets taken at the start of the meeting — and a to-do list is not. */}
        {canManage && (
          <section>
            <h2 className="u-eyebrow mb-3">Coach to-do</h2>
            <CoachActionItems meetingId={meeting.id} />
          </section>
        )}

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="u-eyebrow">Documents</h2>
            {canEdit && !cancelled && (
              <Button
                size="xs"
                variant="outline"
                onClick={() => void onTakeNotes()}
              >
                <NotebookPen className="size-3.5" aria-hidden />
                Take notes
              </Button>
            )}
          </div>
          {/* The pages themselves live at /notes, which is where the editor and the
              tree are. This is the door, not a second editor: a meeting can have
              several documents now — the build team's and the finance team's — and
              one inline editor could only ever show one of them. */}
          {docs.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              {canEdit
                ? 'Nothing written down yet.'
                : 'Nobody has taken notes for this meeting.'}
            </p>
          ) : (
            <ul className="bg-card border-border divide-border divide-y rounded-lg border">
              {docs.map((doc) => (
                <li key={doc.id}>
                  <Link
                    to={`/app/notes/${doc.id}`}
                    className="focus-visible:ring-ring flex min-h-11 items-center gap-2 px-4 py-3 text-sm focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                    {doc.content_bytes <= 2 && (
                      <span className="text-muted-foreground text-xs">empty</span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

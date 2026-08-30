import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Bookmark } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { formatLongDate } from '@/lib/format';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { StatTile } from '@/components/StatTile';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { AwardKey, CandidateState } from '@/types';

/**
 * The candidates inbox.
 *
 * Modelled as an inbox rather than a list because the count is a number a
 * student can drive to zero. The portfolio planner (COG-017) is the other half
 * and does not exist yet; when it does, it reads exactly this list filtered to
 * `shortlisted` and grouped by award, so the better this works the less the
 * planner has to invent.
 *
 * Deliberately no "0 of 15 pages" tile. The planner is not built, and api.ts's
 * header is explicit about what inventing numbers does to a coach's trust in
 * every other figure on screen.
 */

const AWARDS: { id: AwardKey; label: string }[] = [
  { id: 'think', label: 'Think' },
  { id: 'connect', label: 'Connect' },
  { id: 'reach', label: 'Reach' },
  { id: 'sustain', label: 'Sustain' },
  { id: 'innovate', label: 'Innovate' },
  { id: 'control', label: 'Control' },
  { id: 'design', label: 'Design' },
  { id: 'inspire', label: 'Inspire' },
];

const KIND_LABEL: Record<string, string> = {
  heading: 'Heading',
  paragraph: 'Note',
  bullet: 'Note',
  decision: 'Decision',
  action: 'Action item',
  image: 'Photo',
};

const TABS: { id: CandidateState; label: string }[] = [
  { id: 'candidate', label: 'Inbox' },
  { id: 'shortlisted', label: 'Shortlist' },
  { id: 'rejected', label: 'Set aside' },
];

export default function Portfolio() {
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<CandidateState>('candidate');
  const all = useAsync(() => api.listCandidates(), [reloadKey]);
  const { member } = useSession();
  const canTriage = member.role !== 'viewer';

  const list = useMemo(() => all.data ?? [], [all.data]);
  const shown = useMemo(() => list.filter((c) => c.state === tab), [list, tab]);

  const counts = useMemo(
    () => ({
      total: list.length,
      photos: list.filter(
        (c) => c.preview?.kind === 'image' || c.source_type === 'media',
      ).length,
      /* This tile used to count `decision` blocks. That kind is gone with the block
         editor, and nothing else in the schema means "a decision" — so rather than
         showing a permanent zero, it counts what there now is: flagged pages. */
      documents: list.filter((c) => c.source_type === 'note_doc').length,
      pages: list.filter((c) => c.source_type === 'meeting').length,
    }),
    [list],
  );

  async function setState(id: string, state: CandidateState) {
    await api.updateCandidate(id, { state });
    setReloadKey((k) => k + 1);
  }

  async function setAward(id: string, award: AwardKey | null) {
    await api.updateCandidate(id, { suggested_award: award });
    setReloadKey((k) => k + 1);
  }

  return (
    <>
      <PageHeader eyebrow="Portfolio" title="Candidates" />

      <div className="space-y-6 px-4 py-6 md:px-8">
        <p className="text-muted-foreground max-w-2xl text-sm">
          Flagged now, chosen in March. Anything marked in a meeting lands here —
          sort out which award it belongs to when you have the whole season to
          look at.
        </p>

        <div className="grid grid-cols-2 gap-3 lg:max-w-2xl lg:grid-cols-4">
          <StatTile value={counts.total} label="Flagged" />
          <StatTile value={counts.photos} label="Photos" />
          <StatTile value={counts.documents} label="Documents" />
          <StatTile value={counts.pages} label="Whole meetings" />
        </div>

        <div className="border-border inline-flex rounded-md border p-0.5" role="tablist">
          {TABS.map((t) => {
            const n = list.filter((c) => c.state === t.id).length;
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={cn(
                  'focus-visible:ring-ring min-h-11 rounded px-4 text-sm font-medium focus-visible:ring-2 focus-visible:outline-none',
                  tab === t.id ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
              >
                {t.label}
                {n > 0 && (
                  <span className="tabular text-muted-foreground ml-1.5 font-mono text-xs">
                    {n}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {all.status === 'ready' && list.length === 0 ? (
          <EmptyState
            title="Nothing flagged yet."
            aside="In a meeting, tap the bookmark next to a paragraph, a photo or a decision. It takes one tap and you can decide what it is for later."
          />
        ) : all.status === 'loading' ? (
          <Skeleton className="h-64" />
        ) : shown.length === 0 ? (
          <EmptyState
            title={
              tab === 'candidate' ? 'Inbox clear.' : 'Nothing here yet.'
            }
            aside={
              tab === 'candidate'
                ? 'Everything flagged has been sorted. Coglin has nothing for you to do — enjoy it.'
                : undefined
            }
          />
        ) : (
          <ul className="space-y-3">
            {shown.map((candidate) => {
              const preview = candidate.preview;
              const meetingId = preview?.meeting_id;
              const when =
                preview?.meeting_starts_at ?? preview?.starts_at ?? candidate.created_at;
              const excerpt =
                candidate.source_type === 'meeting'
                  ? (preview?.title ?? 'A whole meeting')
                  : candidate.source_type === 'note_doc'
                    ? (preview?.excerpt ?? '')
                    : (preview?.text ?? preview?.caption ?? '');
              // A photo's media id comes through whether it was flagged as a
              // block in a meeting or straight from the library.
              const mediaId =
                preview?.media_id ??
                (candidate.source_type === 'media' ? preview?.id : null);
              const isPhoto = Boolean(mediaId);

              return (
                <li
                  key={candidate.id}
                  className="bg-card border-border rounded-lg border p-4"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Badge variant="secondary">
                      {candidate.source_type === 'meeting'
                        ? 'Whole meeting'
                        : candidate.source_type === 'note_doc'
                          ? (preview?.title ?? 'Document')
                          : (KIND_LABEL[preview?.kind ?? ''] ?? 'Note')}
                    </Badge>
                    <span className="text-muted-foreground tabular flex-1 font-mono text-xs">
                      {formatLongDate(when)}
                    </span>
                    {candidate.source_deleted && (
                      <Badge variant="outline">Source deleted</Badge>
                    )}
                  </div>

                  {isPhoto && !candidate.source_deleted && (
                    <img
                      src={`/media/${mediaId}`}
                      alt={excerpt || 'Flagged photo'}
                      // Small and contained: this is a card in a review queue,
                      // not the photo's own screen.
                      className="border-border mt-2 max-h-40 rounded-md border object-contain"
                    />
                  )}

                  {(!isPhoto || excerpt) && (
                    <p
                      className={cn(
                        'mt-2 text-sm',
                        !excerpt && 'text-muted-foreground italic',
                      )}
                    >
                      {excerpt || 'This was flagged before anything was typed into it.'}
                    </p>
                  )}

                  {/* The inbox earning its keep. An uncaptioned photo is one
                      nobody can place six months later, and this is the last
                      moment anyone still remembers what it was. */}
                  {isPhoto && !excerpt && !candidate.source_deleted && (
                    <p className="text-muted-foreground mt-2 text-xs italic">
                      No caption — add one while you still remember what this was.
                    </p>
                  )}

                  {/* The link back is what makes the inbox trustworthy: you can
                      always see what a fragment meant in context. A document goes to
                      the document — a standalone one has no meeting to open. */}
                  {candidate.source_type === 'note_doc' &&
                    !candidate.source_deleted && (
                      <Link
                        to={`/app/notes/${candidate.source_id}`}
                        className="text-primary-ink focus-visible:ring-ring mt-2 inline-flex min-h-11 items-center text-xs focus-visible:ring-2 focus-visible:outline-none"
                      >
                        {preview?.title ?? 'Open the document'} →
                      </Link>
                    )}
                  {candidate.source_type !== 'note_doc' && meetingId && (
                    <Link
                      to={`/app/meetings/${meetingId}`}
                      className="text-primary-ink focus-visible:ring-ring mt-2 inline-flex min-h-11 items-center text-xs focus-visible:ring-2 focus-visible:outline-none"
                    >
                      {preview?.meeting_title ?? 'Open the meeting'} →
                    </Link>
                  )}

                  {canTriage && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Select
                        value={candidate.suggested_award ?? 'none'}
                        onValueChange={(value) =>
                          void setAward(
                            candidate.id,
                            value === 'none' ? null : (value as AwardKey),
                          )
                        }
                      >
                        <SelectTrigger className="w-44" aria-label="Award">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Not sure yet</SelectItem>
                          {AWARDS.map((award) => (
                            <SelectItem key={award.id} value={award.id}>
                              {award.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {candidate.state !== 'shortlisted' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void setState(candidate.id, 'shortlisted')}
                        >
                          Keep
                        </Button>
                      )}
                      {candidate.state !== 'rejected' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void setState(candidate.id, 'rejected')}
                        >
                          Not this
                        </Button>
                      )}
                      {candidate.state !== 'candidate' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void setState(candidate.id, 'candidate')}
                        >
                          Back to inbox
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Bookmark className="size-3.5" aria-hidden />
          Setting something aside here does not remove the mark in the notes it
          came from.
        </p>
      </div>
    </>
  );
}

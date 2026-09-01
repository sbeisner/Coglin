/**
 * The pipeline: every business the team is working on, and how far it has got.
 *
 * Filter chips over one unfiltered list rather than a request per stage, the
 * same shape the portfolio triage inbox uses — the counts have to be right
 * across all stages anyway, so fetching everything once is both fewer requests
 * and less to keep consistent.
 *
 * Not a kanban board. Dragging cards between five columns on a phone is the
 * interaction this codebase keeps declining, and a stage dropdown says the same
 * thing in one tap.
 */
import { useCallback, useState } from 'react';
import { ExternalLink, Mail, Phone, Plus } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { formatCents, formatDate } from '@/lib/format';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { cn } from '@/lib/utils';
import { CommitDialog } from './CommitDialog';
import { ProspectDialog, type ProspectDialogState } from './ProspectDialog';
import {
  PROSPECT_STAGES,
  SETTABLE_STAGES,
  type ProspectStage,
  type SponsorProspect,
  type SponsorshipTier,
} from '@/types';

const ERROR_COPY: Record<string, string> = {
  already_committed: 'That one is already a sponsor. The list has been refreshed.',
  forbidden: 'Viewers cannot change the pipeline.',
  not_found: 'That prospect is already gone.',
};

const STAGE_CLASS: Record<ProspectStage, string> = {
  researching: 'border-border text-muted-foreground border',
  contacted: 'bg-accent text-accent-foreground',
  pitched: 'bg-primary/10 text-primary-ink',
  committed: 'bg-primary text-primary-foreground',
  declined: 'border-border text-muted-foreground border',
};

export function ProspectPipeline({
  campaignId,
  tiers,
  canEdit,
  reloadKey,
  onChanged,
}: {
  campaignId: string;
  tiers: SponsorshipTier[];
  canEdit: boolean;
  reloadKey: number;
  onChanged: () => void;
}) {
  const prospects = useAsync(
    () => api.listProspects(campaignId),
    [campaignId, reloadKey],
  );
  const [filter, setFilter] = useState<ProspectStage | 'all'>('all');
  const [dialog, setDialog] = useState<ProspectDialogState>(null);
  const [committing, setCommitting] = useState<SponsorProspect | null>(null);
  const [error, setError] = useState<string | null>(null);

  const act = useCallback(
    async (fn: () => Promise<unknown>) => {
      setError(null);
      try {
        await fn();
      } catch (err) {
        setError(err instanceof Error ? err.message : '');
      } finally {
        // Refresh either way: a 409 means this list is stale, and showing the
        // true state is the answer to "somebody got there first".
        onChanged();
      }
    },
    [onChanged],
  );

  const all = prospects.data ?? [];
  const counts = all.reduce<Partial<Record<ProspectStage, number>>>((acc, p) => {
    acc[p.stage] = (acc[p.stage] ?? 0) + 1;
    return acc;
  }, {});
  const shown = filter === 'all' ? all : all.filter((p) => p.stage === filter);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Chips, not tabs: they filter one list rather than switching panels,
            and the counts are the point of showing them all at once. */}
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by stage">
          <Chip
            label="All"
            count={all.length}
            active={filter === 'all'}
            onClick={() => setFilter('all')}
          />
          {PROSPECT_STAGES.map((stage) => (
            <Chip
              key={stage.id}
              label={stage.label}
              count={counts[stage.id] ?? 0}
              active={filter === stage.id}
              onClick={() => setFilter(stage.id)}
            />
          ))}
        </div>
        {canEdit && (
          <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
            <Plus className="size-4" aria-hidden />
            Add prospect
          </Button>
        )}
      </div>

      {prospects.status === 'loading' && <Skeleton className="h-40" />}

      {prospects.status === 'error' && (
        <p role="alert" className="text-destructive text-sm">
          Could not load the pipeline. Reload the page.
        </p>
      )}

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
        </p>
      )}

      {prospects.status === 'ready' && all.length === 0 && (
        <EmptyState
          title={canEdit ? 'Add the first business to approach.' : 'No prospects yet.'}
          aside="The hardware store that already sponsors the football team. The machine shop a parent works at. Write them down before somebody forgets who was going to call."
          action={
            canEdit ? (
              <Button size="sm" onClick={() => setDialog({ mode: 'create' })}>
                Add prospect
              </Button>
            ) : undefined
          }
        />
      )}

      {shown.length === 0 && all.length > 0 && (
        <p className="text-muted-foreground py-4 text-center text-sm">
          Nothing at that stage.
        </p>
      )}

      {shown.length > 0 && (
        <ul className="grid gap-2 lg:grid-cols-2">
          {shown.map((prospect) => (
            <ProspectCard
              key={prospect.id}
              prospect={prospect}
              tiers={tiers}
              canEdit={canEdit}
              onEdit={() => setDialog({ mode: 'edit', prospect })}
              onCommit={() => setCommitting(prospect)}
              onAct={act}
            />
          ))}
        </ul>
      )}

      <ProspectDialog
        state={dialog}
        campaignId={campaignId}
        tiers={tiers}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onChanged={onChanged}
      />
      <CommitDialog
        prospect={committing}
        tiers={tiers}
        onOpenChange={(open) => {
          if (!open) setCommitting(null);
        }}
        onChanged={onChanged}
      />
    </div>
  );
}

function Chip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'focus-visible:ring-ring min-h-11 rounded-md px-2.5 text-xs focus-visible:ring-2 focus-visible:outline-none md:min-h-8',
        active
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted text-muted-foreground hover:bg-accent',
      )}
    >
      {label} <span className="tabular font-mono">{count}</span>
    </button>
  );
}

function ProspectCard({
  prospect: p,
  tiers,
  canEdit,
  onEdit,
  onCommit,
  onAct,
}: {
  prospect: SponsorProspect;
  tiers: SponsorshipTier[];
  canEdit: boolean;
  onEdit: () => void;
  onCommit: () => void;
  onAct: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const committed = p.sponsor_id !== null;
  const tier = tiers.find((t) => t.id === p.tier_id);

  return (
    <li className="bg-card border-border space-y-2.5 rounded-lg border p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-medium">{p.org_name}</span>
            {p.url && (
              <a
                href={p.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Website for ${p.org_name}`}
                className="text-muted-foreground hover:text-primary-ink shrink-0"
              >
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
            <span
              className={cn(
                'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium',
                STAGE_CLASS[p.stage],
              )}
            >
              {PROSPECT_STAGES.find((s) => s.id === p.stage)?.label ?? p.stage}
            </span>
          </div>

          {/* Who to call. Tappable on a phone, which is where a student
              standing outside a shop actually needs it. */}
          {(p.contact_name || p.contact_email || p.contact_phone) && (
            <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {p.contact_name && <span>{p.contact_name}</span>}
              {p.contact_email && (
                <a
                  href={`mailto:${p.contact_email}`}
                  className="hover:text-foreground inline-flex items-center gap-1"
                >
                  <Mail className="size-3" aria-hidden />
                  {p.contact_email}
                </a>
              )}
              {p.contact_phone && (
                <a
                  href={`tel:${p.contact_phone}`}
                  className="hover:text-foreground inline-flex items-center gap-1"
                >
                  <Phone className="size-3" aria-hidden />
                  {p.contact_phone}
                </a>
              )}
            </div>
          )}

          {p.note && <p className="text-muted-foreground mt-1 text-xs">{p.note}</p>}

          <p className="text-muted-foreground mt-1 text-xs">
            {p.stage_changed_by_name && p.stage_changed_at
              ? `${p.stage_changed_by_name} · ${formatDate(p.stage_changed_at)}`
              : formatDate(p.created_at)}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {p.pledged_cents != null && (
            <div className="tabular font-mono text-sm">
              {formatCents(p.pledged_cents)}
            </div>
          )}
          {(tier || p.tier_name) && (
            <div className="text-muted-foreground mt-0.5 text-xs">
              {tier?.name ?? p.tier_name}
            </div>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          {committed ? (
            <span className="text-muted-foreground text-xs">
              On the sponsor list below.
            </span>
          ) : (
            <>
              <Select
                value={p.stage}
                onValueChange={(stage) =>
                  void onAct(() =>
                    api.updateProspect(p.id, {
                      stage: stage as Exclude<ProspectStage, 'committed'>,
                    }),
                  )
                }
              >
                <SelectTrigger
                  aria-label={`Stage for ${p.org_name}`}
                  className="min-h-11 w-36 md:min-h-9"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SETTABLE_STAGES.map((stage) => (
                    <SelectItem key={stage.id} value={stage.id}>
                      {stage.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={onCommit}>
                They said yes
              </Button>
              <Button size="sm" variant="ghost" onClick={onEdit}>
                Edit
              </Button>
              {confirmingDelete ? (
                <span className="flex items-center gap-2 text-xs">
                  Remove it?
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void onAct(() => api.deleteProspect(p.id))}
                  >
                    Remove
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Keep
                  </Button>
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={() => setConfirmingDelete(true)}
                >
                  Remove
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}

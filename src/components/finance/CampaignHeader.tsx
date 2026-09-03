/**
 * How the campaign is doing, in one bar.
 *
 * Two fills against the goal: what has actually arrived, and what has been
 * promised on top of it. A single "raised" bar would either overstate the
 * position (counting promises as money) or hide the pipeline's whole value
 * (ignoring them) — and the gap between the two is exactly what a team needs to
 * chase in February.
 */
import { useState } from 'react';
import * as api from '@/lib/api';
import { formatCents, parseDollars } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { SponsorshipCampaign } from '@/types';

export function CampaignHeader({
  campaign,
  canEdit,
  onChanged,
}: {
  campaign: SponsorshipCampaign;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(campaign.name);
  const [goal, setGoal] = useState((campaign.goal_cents / 100).toFixed(2));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goalCents = parseDollars(goal);
  const canSave = name.trim() !== '' && goalCents !== null;

  async function save() {
    if (!canSave || goalCents === null) return;
    setPending(true);
    setError(null);
    try {
      await api.updateCampaign(campaign.id, {
        name: name.trim(),
        goal_cents: goalCents,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  // Percentages of the goal, clamped so an over-target campaign does not
  // overflow its own bar. The pledged fill sits behind the raised one and
  // includes it, so the two are drawn as nested widths rather than stacked.
  const raisedPct = Math.min(
    100,
    campaign.goal_cents > 0 ? (campaign.raised_cents / campaign.goal_cents) * 100 : 0,
  );
  const pledgedPct = Math.min(
    100,
    campaign.goal_cents > 0 ? (campaign.pledged_cents / campaign.goal_cents) * 100 : 0,
  );

  return (
    <div className="space-y-3">
      {editing ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={name}
            maxLength={200}
            aria-label="Campaign name"
            onChange={(e) => setName(e.target.value)}
            className="min-h-11 min-w-48 flex-1 md:min-h-9"
          />
          <Input
            value={goal}
            inputMode="decimal"
            aria-label="Goal"
            onChange={(e) => setGoal(e.target.value)}
            className="tabular min-h-11 w-32 font-mono md:min-h-9"
          />
          <Button size="sm" disabled={pending || !canSave} onClick={() => void save()}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="u-display text-heading text-lg">{campaign.name}</h3>
          {canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                setName(campaign.name);
                setGoal((campaign.goal_cents / 100).toFixed(2));
                setEditing(true);
              }}
            >
              Edit name and goal
            </Button>
          )}
        </div>
      )}

      <div>
        <div className="bg-muted relative h-2.5 w-full overflow-hidden rounded-full">
          {/* Promised, including what has arrived. */}
          <div
            className="bg-primary/25 absolute inset-y-0 left-0"
            style={{ width: `${pledgedPct}%` }}
          />
          {/* Actually in the bank. */}
          <div
            className="bg-primary absolute inset-y-0 left-0"
            style={{ width: `${raisedPct}%` }}
          />
        </div>
        <div className="text-muted-foreground mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            <span className="tabular text-heading font-mono">
              {formatCents(campaign.raised_cents)}
            </span>{' '}
            received
          </span>
          <span>
            <span className="tabular font-mono">{formatCents(campaign.pledged_cents)}</span>{' '}
            promised
          </span>
          <span>
            <span className="tabular font-mono">{formatCents(campaign.goal_cents)}</span>{' '}
            goal
          </span>
        </div>
      </div>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          Could not save that. Try again.
        </p>
      )}
    </div>
  );
}

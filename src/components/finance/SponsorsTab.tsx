/**
 * The sponsor half of the Finance section.
 *
 * One campaign at a time, with three stacked sections under it — pipeline,
 * sponsors, pitch and tiers. Stacked rather than nested tabs: tabs inside tabs
 * is two rows of controls on a phone and a guess about which one you are in.
 *
 * COGLIN TRACKS, IT DOES NOT COLLECT. The empty state says so out loud, because
 * a screen with goals and tiers and payments on it could reasonably be mistaken
 * for a donation platform, and a coach should not discover the difference after
 * telling a sponsor to "pay through the app".
 */
import { useState } from 'react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { EmptyState } from '@/components/EmptyState';
import { Skeleton } from '@/components/Skeleton';
import { parseDollars } from '@/lib/format';
import { CampaignHeader } from './CampaignHeader';
import { PitchEditor } from './PitchEditor';
import { ProspectPipeline } from './ProspectPipeline';
import { SponsorsList } from './SponsorsList';
import { TierEditor } from './TierEditor';

const ERROR_COPY: Record<string, string> = {
  missing_name: 'Give the campaign a name.',
  invalid_goal: 'Set a fundraising goal over $0.',
  no_current_season: 'This team has no current season yet, so a campaign has nowhere to live.',
  too_many_campaigns: 'Ten campaigns is the limit for one season.',
  campaign_in_use:
    'This campaign has prospects or sponsors attached. Clear those first if you really mean to delete it.',
  forbidden: 'Viewers cannot change campaigns.',
};

export function SponsorsTab({
  canEdit,
  canRecordPayment,
  reloadKey,
  onChanged,
}: {
  /** Any non-viewer: students own the pipeline, the pitch and the tiers. */
  canEdit: boolean;
  /** Coach or mentor only — recording a payment writes the ledger. */
  canRecordPayment: boolean;
  reloadKey: number;
  onChanged: () => void;
}) {
  const campaigns = useAsync(api.listCampaigns, [reloadKey]);
  const sponsors = useAsync(api.listSponsors, [reloadKey]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Create-campaign form, shown only when there are none.
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [pending, setPending] = useState(false);

  const list = campaigns.data ?? [];
  // Selection falls back to the first campaign rather than being seeded in an
  // effect: the list can change under us (create, delete) and an effect would
  // race the refetch.
  const campaign = list.find((c) => c.id === selectedId) ?? list[0] ?? null;

  const goalCents = parseDollars(goal);
  const canCreate = name.trim() !== '' && goalCents !== null;

  async function create() {
    if (!canCreate || goalCents === null) return;
    setPending(true);
    setError(null);
    try {
      const created = await api.createCampaign({
        name: name.trim(),
        goal_cents: goalCents,
      });
      setSelectedId(created.id);
      setName('');
      setGoal('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : '');
    } finally {
      setPending(false);
    }
  }

  if (campaigns.status === 'loading') return <Skeleton className="h-64" />;

  if (campaigns.status === 'error') {
    return (
      <p role="alert" className="text-destructive text-sm">
        Could not load the campaigns. Reload the page.
      </p>
    );
  }

  if (!campaign) {
    return (
      <div className="space-y-4">
        <EmptyState
          title={
            canEdit
              ? 'Start a sponsorship campaign.'
              : 'No sponsorship campaign yet.'
          }
          aside="A goal, some tiers, and the pitch you send a local business. Sustain asks what your plan is and what progress you have made against it — this is where both live."
        />
        {/* The positioning line. Not decoration: a screen with goals, tiers and
            payments could be read as a donation platform, and it is not one. */}
        <p className="text-muted-foreground mx-auto max-w-md text-center text-xs">
          Coglin keeps track of pledges, payments and thank-yous. Cheques and
          transfers still go straight to your team&rsquo;s own account — no money
          moves through Coglin.
        </p>

        {canEdit && (
          <div className="border-border mx-auto max-w-md space-y-3 rounded-lg border p-4">
            <div className="space-y-1.5">
              <Label htmlFor="campaign-name">Campaign name</Label>
              <Input
                id="campaign-name"
                value={name}
                maxLength={200}
                placeholder="2026 season sponsorship drive"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="campaign-goal">Goal</Label>
              <Input
                id="campaign-goal"
                value={goal}
                inputMode="decimal"
                placeholder="2500.00"
                onChange={(e) => setGoal(e.target.value)}
                className="tabular font-mono"
              />
            </div>
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {ERROR_COPY[error] ?? 'Could not create that. Try again.'}
              </p>
            )}
            <Button disabled={pending || !canCreate} onClick={() => void create()}>
              {pending ? 'Creating…' : 'Create campaign'}
            </Button>
          </div>
        )}
      </div>
    );
  }

  const campaignSponsors = (sponsors.data ?? []).filter(
    (s) => s.campaign_id === campaign.id || s.campaign_id === null,
  );

  return (
    <div className="space-y-8">
      {list.length > 1 && (
        <div className="flex items-center gap-2">
          <Label htmlFor="campaign-picker" className="text-muted-foreground text-xs">
            Campaign
          </Label>
          <Select value={campaign.id} onValueChange={setSelectedId}>
            <SelectTrigger id="campaign-picker" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {list.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <CampaignHeader campaign={campaign} canEdit={canEdit} onChanged={onChanged} />

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {ERROR_COPY[error] ?? 'Could not save that. Try again.'}
        </p>
      )}

      <section>
        <h3 className="u-eyebrow mb-3">Pipeline</h3>
        <ProspectPipeline
          campaignId={campaign.id}
          tiers={campaign.tiers}
          canEdit={canEdit}
          reloadKey={reloadKey}
          onChanged={onChanged}
        />
      </section>

      <section>
        <h3 className="u-eyebrow mb-3">
          Sponsors{' '}
          <span className="tabular font-mono">{campaignSponsors.length}</span>
        </h3>
        {sponsors.status === 'loading' ? (
          <Skeleton className="h-24" />
        ) : (
          <SponsorsList
            sponsors={campaignSponsors}
            canEdit={canEdit}
            canRecordPayment={canRecordPayment}
            onChanged={onChanged}
          />
        )}
      </section>

      <section>
        <h3 className="u-eyebrow mb-3">Tiers</h3>
        <TierEditor
          campaignId={campaign.id}
          tiers={campaign.tiers}
          canEdit={canEdit}
          onChanged={onChanged}
        />
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h3 className="u-eyebrow">The pitch</h3>
          <span className="text-muted-foreground text-xs">
            What you send a business
          </span>
        </div>
        <PitchEditor campaignId={campaign.id} canEdit={canEdit} />
      </section>

      {canEdit && (
        <div className="border-border flex justify-end border-t pt-4">
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() =>
              void (async () => {
                setError(null);
                try {
                  await api.deleteCampaign(campaign.id);
                  setSelectedId(null);
                  onChanged();
                } catch (err) {
                  setError(err instanceof Error ? err.message : '');
                }
              })()
            }
          >
            Delete this campaign
          </Button>
        </div>
      )}
    </div>
  );
}

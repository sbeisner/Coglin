/**
 * Team name, region and time zone.
 *
 * `PATCH /api/team` and `api.updateTeam` have existed since COG-010 with no
 * screen behind them, so this is the first thing that calls them. The time zone
 * is the reason it matters rather than a nicety: every recurring meeting is a
 * wall-clock rule resolved against it, so a wrong value does not fail — it
 * materialises a whole season an hour off.
 */
import { useState, type FormEvent } from 'react';
import * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Team } from '@/types';

/**
 * A short list rather than a free-text field. Any IANA name is valid to the
 * server, but a typo here is exactly the failure described above, and FTC teams
 * are in the US.
 */
const ZONES = [
  { id: 'America/New_York', label: 'Eastern' },
  { id: 'America/Chicago', label: 'Central' },
  { id: 'America/Denver', label: 'Mountain' },
  { id: 'America/Phoenix', label: 'Arizona (no daylight saving)' },
  { id: 'America/Los_Angeles', label: 'Pacific' },
  { id: 'America/Anchorage', label: 'Alaska' },
  { id: 'Pacific/Honolulu', label: 'Hawaii' },
];

const ERROR_COPY: Record<string, string> = {
  forbidden: 'Only a coach can change the team details.',
  missing_name: 'The team needs a name.',
  invalid_timezone: 'That time zone was not recognised. Pick one from the list.',
};

export function TeamDetailsCard({
  team,
  onChanged,
}: {
  team: Team;
  onChanged: () => void;
}) {
  const [timezone, setTimezone] = useState(team.timezone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const region = String(data.get('region') ?? '').trim();

    setPending(true);
    setError(null);
    setDone(false);
    try {
      await api.updateTeam({
        name: String(data.get('name') ?? '').trim(),
        region: region === '' ? null : region,
        timezone,
      });
      setDone(true);
      onChanged();
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(ERROR_COPY[code] ?? 'Could not save that. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Team</CardTitle>
        <CardDescription>
          Everyone on the team sees these.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="max-w-sm space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="team-number">Team number</Label>
            {/* Read-only: it is the team's public identity and UNIQUE on the
                row, so offering an input would imply a re-key that does not
                exist. */}
            <Input
              id="team-number"
              value={team.team_number}
              readOnly
              disabled
              className="font-mono"
            />
            <p className="text-muted-foreground text-xs">
              If this is wrong, report a bug and we&rsquo;ll sort it out.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="name">Team name</Label>
            <Input id="name" name="name" defaultValue={team.name} required />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="region">Region</Label>
            <Input id="region" name="region" defaultValue={team.region ?? ''} />
            <p className="text-muted-foreground text-xs">
              Optional — for example Maryland.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="timezone">Time zone</Label>
            <Select
              value={timezone}
              disabled={pending}
              onValueChange={setTimezone}
            >
              <SelectTrigger id="timezone" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZONES.map((z) => (
                  <SelectItem key={z.id} value={z.id}>
                    {z.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">
              Meeting times are worked out in this zone.
            </p>
          </div>

          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          {done && !error && (
            <p role="status" className="text-muted-foreground text-sm">
              Saved.
            </p>
          )}

          <Button type="submit" className="min-h-11" disabled={pending}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

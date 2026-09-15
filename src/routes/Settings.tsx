/**
 * Your account, and — for a coach — the team's details.
 *
 * The screen exists because password recovery needed somewhere to put "change
 * your own password", and AppShell has referenced a Settings screen that did
 * not exist since COG-010 (the team-logo placeholder still points at it). The
 * team card wires `PATCH /api/team`, which had been shipped with no caller.
 */
import * as api from '@/lib/api';
import { useState } from 'react';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';
import { TeamDetailsCard } from '@/components/settings/TeamDetailsCard';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';

export default function Settings() {
  const { member: me } = useSession();
  const [reloadKey, setReloadKey] = useState(0);
  const isCoach = me.role === 'coach';
  // Only a coach renders the team card, so only a coach fetches it — a student
  // opening Settings should not pull a payload the screen will not show.
  const team = useAsync(
    () => (isCoach ? api.getTeam() : Promise.resolve(null)),
    [reloadKey, isCoach],
  );

  return (
    <>
      <PageHeader eyebrow="Your account" title="Settings" />

      <div className="space-y-6 px-4 py-6 md:px-8">
        <ChangePasswordCard />

        {isCoach &&
          (team.status === 'loading' ? (
            <Skeleton className="h-64 w-full" />
          ) : team.data ? (
            <TeamDetailsCard
              team={team.data}
              onChanged={() => setReloadKey((k) => k + 1)}
            />
          ) : null)}
      </div>
    </>
  );
}

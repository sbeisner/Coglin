import { useState } from 'react';
import { HandCoins } from 'lucide-react';
import * as api from '@/lib/api';
import { useAsync } from '@/lib/useAsync';
import { useSession } from '@/lib/session';
import { InviteDialog } from '@/components/InviteDialog';
import { RosterPhoto } from '@/components/RosterPhoto';
import { PageHeader } from '@/components/PageHeader';
import { Skeleton } from '@/components/Skeleton';
import { SUB_TEAMS, type Member, type Role } from '@/types';
import { cn } from '@/lib/utils';

const ROLE_LABEL: Record<Role, string> = {
  coach: 'Coach',
  mentor: 'Mentor',
  student: 'Student',
  viewer: 'Viewer',
};

export default function Roster() {
  // Bumping this refetches the roster after an invite is accepted or created,
  // rather than hand-patching local state with a member who does not exist yet.
  const [reloadKey, setReloadKey] = useState(0);
  const members = useAsync(api.listMembers, [reloadKey]);
  const { member: me } = useSession();
  const canInvite = me.role === 'coach' || me.role === 'mentor';
  const list = members.data ?? [];
  const students = list.filter((m) => m.role === 'student');
  const adults = list.filter((m) => m.role !== 'student');

  return (
    <>
      <PageHeader eyebrow="2026-27" title="Roster" />

      <div className="space-y-8 px-4 py-6 md:px-8">
        {canInvite && (
          <div className="flex justify-end">
            <InviteDialog onInvited={() => setReloadKey((k) => k + 1)} />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <Count
            n={students.length}
            label="Students"
            hint={`${15 - students.length} slots left of 15`}
          />
          <Count n={adults.length} label="Coaches & mentors" />
        </div>

        {/* The wording for the shield icon on each row. Coaches only, because a
            student cannot act on it and does not need to read a paragraph about
            consent paperwork to look up a teammate's handle. */}
        {canInvite && (
          <p className="text-muted-foreground max-w-2xl text-xs">
            Photos help put faces to names in September. Coglin will not hold a
            student&rsquo;s photo until you confirm their signed{' '}
            <i>FIRST</i> Consent and Release is on file — that is what the shield
            button records. Photos are visible to the team only, never to viewers,
            and are deleted when a member leaves the roster.
          </p>
        )}

        {members.status === 'loading' && <Skeleton className="h-48" />}

        {adults.length > 0 && (
          <section>
            <h2 className="u-eyebrow mb-3">Coaches & mentors</h2>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {adults.map((m) => (
                <MemberRow
                  key={m.id}
                  member={m}
                  canManage={canInvite}
                  onChanged={() => setReloadKey((k) => k + 1)}
                />
              ))}
            </ul>
          </section>
        )}

        {/* Grouped by sub-team, because that is how a coach actually thinks
            about the roster — who is on build tonight, not an alphabetical
            list of everyone. Students appear under each sub-team they serve. */}
        {SUB_TEAMS.map((st) => {
          const group = students.filter((m) => m.sub_teams.includes(st.id));
          if (group.length === 0) return null;
          return (
            <section key={st.id}>
              <h2 className="u-eyebrow mb-3">
                {st.label}{' '}
                <span className="tabular font-mono">{group.length}</span>
              </h2>
              <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((m) => (
                  <MemberRow
                  key={m.id}
                  member={m}
                  canManage={canInvite}
                  onChanged={() => setReloadKey((k) => k + 1)}
                />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}

function Count({
  n,
  label,
  hint,
}: {
  n: number;
  label: string;
  hint?: string;
}) {
  return (
    <div className="bg-card border-border rounded-lg border p-4">
      <div className="tabular u-display font-mono text-2xl leading-none">
        {n}
      </div>
      <div className="u-eyebrow mt-2">{label}</div>
      {hint && <div className="text-muted-foreground mt-1 text-xs">{hint}</div>}
    </div>
  );
}

function MemberRow({
  member,
  canManage,
  onChanged,
}: {
  member: Member;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [savingApprover, setSavingApprover] = useState(false);

  async function toggleApprover() {
    setSavingApprover(true);
    try {
      await api.setPurchaseApprover(member.id, !member.is_purchase_approver);
      onChanged();
    } catch {
      // The reload below never fires, so the button simply stays as it was —
      // an unchanged toggle is the honest report of a failed toggle.
    } finally {
      setSavingApprover(false);
    }
  }

  return (
    <li className="bg-card border-border flex items-center gap-3 rounded-lg border px-3 py-2.5">
      {/* Photos exist so a coach can put faces to names in September. The
          consent gate lives inside this component, because the point at which
          somebody reaches for a camera is the point at which they should be
          asked whether the signed form is on file. */}
      <RosterPhoto member={member} canManage={canManage} onChanged={onChanged} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">
          {member.display_name}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {/* Students are provisioned by the coach and have a handle instead of
              an email — the COPPA model (plan §6) is visible right here. */}
          {member.handle ? (
            <span className="font-mono">@{member.handle}</span>
          ) : (
            ROLE_LABEL[member.role]
          )}
        </div>
      </div>
      {/* The part-order approver grant, students only: coaches and mentors
          approve regardless (worker/lib/finance.ts), and a viewer with the
          flag would still be refused — so the toggle is only offered where it
          means something. A coach flips it; everyone else just sees it. */}
      {member.role === 'student' &&
        (canManage ? (
          <button
            type="button"
            aria-pressed={member.is_purchase_approver}
            aria-label={
              member.is_purchase_approver
                ? `${member.display_name} can approve part orders — revoke`
                : `Let ${member.display_name} approve part orders`
            }
            title={
              member.is_purchase_approver
                ? 'Can approve part orders'
                : 'Grant part-order approval'
            }
            disabled={savingApprover}
            onClick={() => void toggleApprover()}
            className={cn(
              'focus-visible:ring-ring flex size-11 shrink-0 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:size-7',
              member.is_purchase_approver
                ? 'border-primary bg-primary/10 text-primary-ink border'
                : 'text-muted-foreground hover:text-primary-ink',
            )}
          >
            <HandCoins className="size-4" aria-hidden />
          </button>
        ) : (
          member.is_purchase_approver && (
            <span
              className="text-primary-ink shrink-0"
              title="Can approve part orders"
            >
              <HandCoins className="size-4" aria-hidden />
            </span>
          )
        ))}
      <span
        className={cn(
          'shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-medium',
          member.role === 'coach' && 'bg-primary text-primary-foreground',
          member.role === 'mentor' && 'bg-accent text-accent-foreground',
          member.role === 'student' && 'text-muted-foreground',
        )}
      >
        {ROLE_LABEL[member.role]}
      </span>
    </li>
  );
}

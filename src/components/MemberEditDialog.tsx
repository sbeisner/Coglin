/**
 * Change what a person is on the roster.
 *
 * Everything here was previously fixed at invite time and unchangeable
 * afterwards: PATCH /api/members/:id took one boolean and 400'd on anything
 * else. A coach who mis-ticked a sub-team, or a student who moved from Build to
 * CAD in November, had no way through at all.
 *
 * The server owns the one rule that matters — the last coach cannot be demoted
 * or removed, by anyone including themselves — so a stale bundle cannot talk its
 * way past it. The copy below exists to explain the 409 the moment it arrives,
 * not to prevent it. Standing down after appointing a successor is allowed, and
 * is the normal end of a coach's season.
 */
import { useEffect, useState } from 'react';
import * as api from '@/lib/api';
import { SubTeamPicker } from '@/components/SubTeamPicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Member, Role, SubTeam } from '@/types';

const ROLES: { id: Role; label: string }[] = [
  { id: 'student', label: 'Student' },
  { id: 'mentor', label: 'Mentor' },
  { id: 'coach', label: 'Coach' },
  { id: 'viewer', label: 'Viewer' },
];

const ERROR_COPY: Record<string, string> = {
  last_coach:
    'This is the team’s only coach. Make somebody else a coach first — a team with no coach cannot appoint one.',
  forbidden: 'Only a coach can change a role or remove somebody.',
  not_found: 'That person is no longer on the roster. Reload the page.',
};

export function MemberEditDialog({
  member,
  canChangeRole,
  onResetPassword,
  onOpenChange,
  onChanged,
}: {
  /** Null when closed. The dialog is derived from it, house convention. */
  member: Member | null;
  /** Coaches only. A mentor may still edit sub-teams. */
  canChangeRole: boolean;
  /**
   * Hands off to the reset dialog. Omitted when the viewer may not reset this
   * person — a mentor looking at a coach or another mentor, or anybody looking
   * at their own row, who wants Settings instead. The server enforces the same
   * rule; this only avoids offering a button that would come back 403.
   */
  onResetPassword?: (member: Member) => void;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}) {
  const [subTeams, setSubTeams] = useState<SubTeam[]>([]);
  const [role, setRole] = useState<Role>('student');
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on OPEN, keyed by who is being edited — the same sentinel pattern
  // TransactionDialog uses, and the one InviteDialog should have used.
  const entityKey = member?.id ?? 'closed';
  useEffect(() => {
    if (!member) return;
    setSubTeams(member.sub_teams as SubTeam[]);
    setRole(member.role);
    setConfirmingRemove(false);
    setError(null);
    setPending(false);
    // Keyed on the member, not the object: a roster refetch hands back a new
    // object for the same person and would otherwise wipe an in-progress edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey]);

  async function run(patch: Parameters<typeof api.updateMember>[1]) {
    if (!member) return;
    setPending(true);
    setError(null);
    try {
      await api.updateMember(member.id, patch);
      onChanged();
      onOpenChange(false);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(ERROR_COPY[code] ?? 'Could not save that. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{member?.display_name ?? 'Member'}</DialogTitle>
          <DialogDescription>
            Sub-teams decide where somebody shows up on the roster. Everyone can
            read every board either way.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <SubTeamPicker
            value={subTeams}
            disabled={pending}
            onChange={setSubTeams}
          />

          {canChangeRole && (
            <div className="space-y-1.5">
              <Label htmlFor="member-role">Role</Label>
              <Select
                value={role}
                disabled={pending}
                onValueChange={(v) => setRole(v as Role)}
              >
                <SelectTrigger id="member-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Not in the footer: that row is Save and Remove, and a reset is
              neither — it commits nothing here and hands off to its own
              dialog. */}
          {onResetPassword && member && (
            <div className="border-border space-y-1.5 border-t pt-4">
              <div className="text-muted-foreground u-eyebrow">Password</div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="min-h-11"
                disabled={pending}
                onClick={() => onResetPassword(member)}
              >
                Reset password
              </Button>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Sends a link so they can choose a new one. Their username and
                everything they&rsquo;ve worked on stay as they are.
              </p>
            </div>
          )}
        </div>

        {error && (
          <p role="alert" className="text-destructive mb-4 text-sm">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          {canChangeRole ? (
            confirmingRemove ? (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground text-sm">Remove?</span>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() => void run({ status: 'removed' })}
                >
                  Yes, remove
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmingRemove(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              /* Removal is a status flip, not a delete — and the nightly sweep
                 in routes/media.ts destroys a removed student's photo, which is
                 the behaviour that actually matters here. */
              <Button
                size="sm"
                variant="ghost"
                className="text-destructive"
                disabled={pending}
                onClick={() => setConfirmingRemove(true)}
              >
                Remove from roster
              </Button>
            )
          ) : (
            <span />
          )}

          {/* `role` is sent only when it actually changed, so that editing the
              sub-teams of the team's only coach is not refused as a demotion of
              the last coach. */}
          <Button
            disabled={pending}
            onClick={() =>
              void run({
                sub_teams: subTeams,
                ...(canChangeRole && role !== member?.role ? { role } : {}),
              })
            }
          >
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

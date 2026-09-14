/**
 * Create an invite.
 *
 * The email field is the only place in Coglin where a coach types an address,
 * and the copy has to be honest about what happens to it: it is used to send
 * one message and then discarded. That is not a reassurance written after the
 * fact — it is the actual behaviour (migrations/0002_invites.sql), and saying so
 * is what makes the "no resend button" answer make sense later.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Check, Copy } from 'lucide-react';
import * as api from '@/lib/api';
import { type Role, type SubTeam } from '@/types';
import { SubTeamPicker } from '@/components/SubTeamPicker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type InvitableRole = Extract<Role, 'mentor' | 'student' | 'viewer'>;

const ROLES: { id: InvitableRole; label: string }[] = [
  { id: 'student', label: 'Student' },
  { id: 'mentor', label: 'Mentor' },
  { id: 'viewer', label: 'Viewer' },
];

export function InviteDialog({ onInvited }: { onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [role, setRole] = useState<InvitableRole>('student');
  const [subTeams, setSubTeams] = useState<SubTeam[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.InviteResult | null>(null);

  /**
   * Clear the form when the dialog OPENS, not when it closes.
   *
   * Closing looked like the obvious place and was wrong. Radix only fires
   * onOpenChange when the user dismisses the dialog — X, Esc, the overlay — not
   * when a controlled consumer flips `open` itself, which is exactly what the
   * "Done" button on the success screen does. So Done left `result` set, and the
   * next "Invite someone" reopened straight onto the previous person's invite
   * link with no way back to the form. Resetting on open cannot be bypassed by
   * any close path, present or future.
   */
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setError(null);
    setSubTeams([]);
    setRole('student');
    setPending(false);
  }, [open]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    setPending(true);
    setError(null);
    try {
      const invite = await api.createInvite({
        email: String(data.get('email') ?? ''),
        display_name: String(data.get('display_name') ?? ''),
        role,
        sub_teams: subTeams,
      });
      setResult(invite);
      onInvited();
    } catch (err) {
      setError(
        err instanceof Error && err.message === 'too_many_pending_invites'
          ? 'There are too many invites waiting to be accepted. Wait for some to be used first.'
          : 'Could not create the invite. Try again.',
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Invite someone</Button>
      </DialogTrigger>
      <DialogContent>
        {result ? (
          <Sent result={result} onDone={() => setOpen(false)} />
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>Invite someone to the team</DialogTitle>
              <DialogDescription>
                They'll get an email with a link to choose their own username
                and password.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="space-y-1.5">
                <Label htmlFor="display_name">Name</Label>
                <Input id="display_name" name="display_name" required />
                <p className="text-muted-foreground text-xs">
                  How they'll appear on the roster.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Email to send the invite to</Label>
                <Input id="email" name="email" type="email" required />
                <p className="text-muted-foreground text-xs">
                  Used once to send the invite and then discarded — Coglin
                  doesn't store student email addresses. You'll get a copyable
                  link too, in case the email doesn't arrive.
                </p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="role">Role</Label>
                <Select
                  value={role}
                  onValueChange={(v) => setRole(v as InvitableRole)}
                >
                  <SelectTrigger id="role">
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

              {role === 'student' && (
                <SubTeamPicker value={subTeams} onChange={setSubTeams} />
              )}
            </div>

            {error && (
              <p role="alert" className="text-destructive mb-4 text-sm">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? 'Sending…' : 'Send invite'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The link is shown whether or not the mail went out. When it did, this is a
 * belt-and-braces fallback; when it didn't, it is the only way through — and a
 * coach should not have to notice which case they are in to get unstuck.
 */
function Sent({
  result,
  onDone,
}: {
  result: api.InviteResult;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {result.sent ? 'Invite sent' : 'Invite created — email failed'}
        </DialogTitle>
        <DialogDescription>
          {result.sent
            ? "If it doesn't turn up in a few minutes, check their spam folder or send them this link directly."
            : 'The email could not be delivered, but the invite is valid. Send them this link yourself.'}
        </DialogDescription>
      </DialogHeader>

      <div className="flex items-center gap-2 py-4">
        <Input readOnly value={result.url} className="font-mono text-xs" />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label="Copy invite link"
          onClick={() => {
            void navigator.clipboard.writeText(result.url);
            setCopied(true);
          }}
        >
          {copied ? (
            <Check className="size-4" aria-hidden />
          ) : (
            <Copy className="size-4" aria-hidden />
          )}
        </Button>
      </div>

      <DialogFooter>
        <Button type="button" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

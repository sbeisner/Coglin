/**
 * Send somebody on the roster a link to choose a new password.
 *
 * Its own dialog rather than a section of MemberEditDialog, for two reasons.
 * MemberEditDialog is shaped end to end as "stage some edits, save them, close"
 * — a result panel that replaces the body would have to suppress the Save and
 * Remove footer that is the entire point of that component. And the promise
 * made below, that the address is used once and not kept, is not believable
 * rendered inside a dialog whose visible verb is Save.
 *
 * Two shapes, decided by `member.has_email`:
 *
 *   no address on file (every student)  the coach types where the mail goes
 *   address on file (the founding coach) no input at all; the server uses it
 *
 * The second case has no field on purpose. Letting a coach type a destination
 * for an account that already has one would let them redirect a peer's reset to
 * themselves, and would double as an "is this their address" oracle. The server
 * enforces this too — the dialog just does not offer what would be refused.
 */
import { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { Member } from '@/types';

const ERROR_COPY: Record<string, string> = {
  forbidden: 'You can only reset a password for a student or a viewer.',
  not_found: 'That person is no longer on the roster. Reload the page.',
  invalid_email: 'That email address does not look right. Check it and try again.',
  cannot_reset_self: 'To change your own password, go to Settings.',
  too_many_resets:
    'A reset link for this person went out very recently. Wait a few minutes, then try again.',
};

export function ResetPasswordDialog({
  member,
  onOpenChange,
}: {
  /** Null when closed. The dialog is derived from it, house convention. */
  member: Member | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<api.ResetLinkResult | null>(null);

  // Reset on OPEN, keyed by who is being reset — the same sentinel pattern
  // MemberEditDialog uses, and for the reason InviteDialog documents.
  const entityKey = member?.id ?? 'closed';
  useEffect(() => {
    if (!member) return;
    setPending(false);
    setError(null);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey]);

  const needsEmail = member !== null && !member.has_email;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!member) return;
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();

    setPending(true);
    setError(null);
    try {
      setResult(
        await api.createMemberPasswordReset(
          member.id,
          needsEmail ? { email } : {},
        ),
      );
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(ERROR_COPY[code] ?? 'Could not send the reset link. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={member !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {result ? (
          <Result result={result} onDone={() => onOpenChange(false)} />
        ) : (
          <form onSubmit={onSubmit}>
            <DialogHeader>
              <DialogTitle>
                Reset password for {member?.display_name ?? 'this person'}
              </DialogTitle>
              <DialogDescription>
                {needsEmail
                  ? "They'll get an email with a link to choose a new password. Their username doesn't change, and nothing happens until they open the link."
                  : "Coglin will email a link to the address on their account. For privacy it isn't shown here."}
              </DialogDescription>
            </DialogHeader>

            {needsEmail && (
              <div className="space-y-1.5 py-4">
                <Label htmlFor="reset-email">Email to send the link to</Label>
                <Input
                  id="reset-email"
                  name="email"
                  type="email"
                  /* Not the coach's own address, so browser autofill offering
                     it in front of a room is a small leak. */
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  disabled={pending}
                />
                <p className="text-muted-foreground text-xs leading-relaxed">
                  A parent's address is fine. Coglin uses it once to send this
                  link and then forgets it — student email addresses are never
                  stored, so you'll type it again next time. You'll also get a
                  copyable link in case the email doesn't arrive.
                </p>
              </div>
            )}

            {error && (
              <p role="alert" className="text-destructive mb-4 text-sm">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button type="submit" className="min-h-11" disabled={pending}>
                {pending ? 'Sending…' : 'Send reset link'}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Result({
  result,
  onDone,
}: {
  result: api.ResetLinkResult;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {result.sent ? 'Reset link sent' : 'Link created — email failed'}
        </DialogTitle>
        <DialogDescription>
          {result.sent
            ? "If it doesn't turn up in a few minutes, check the spam folder."
            : 'The email could not be delivered, but the link works.'}
          {result.url
            ? ' You can also send them this link yourself.'
            : ' They can also use "Forgot password" on the sign-in page.'}
        </DialogDescription>
      </DialogHeader>

      {result.url && (
        <>
          <div className="flex items-center gap-2 py-4">
            <Input
              readOnly
              value={result.url}
              className="font-mono text-xs"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="size-11 shrink-0 md:size-9"
              aria-label="Copy reset link"
              onClick={() => {
                void navigator.clipboard.writeText(result.url!);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <Copy className="size-4" aria-hidden />
              )}
            </Button>
          </div>
          {/* InviteDialog's copy button announces nothing at all; a screen
              reader user gets no confirmation. */}
          <span aria-live="polite" className="sr-only">
            {copied ? 'Link copied' : ''}
          </span>

          <p className="text-muted-foreground text-xs leading-relaxed">
            The link works once and expires in an hour. Anyone who has it can
            set this person's password, so send it straight to them — not to a
            group chat.
          </p>
        </>
      )}

      <DialogFooter>
        <Button type="button" className="min-h-11" onClick={onDone}>
          Done
        </Button>
      </DialogFooter>
    </>
  );
}

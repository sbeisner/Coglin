/**
 * Choose a new password from a mailed link.
 *
 * Same anti-phishing posture as AcceptInvite, and it matters more here: "your
 * password has been reset, click to continue" is the most-imitated phishing
 * template there is. So the screen leads with what only a real reset could
 * know — the team number, the team name, the person's name, and their username
 * — before it asks for anything.
 *
 * The username is shown here and deliberately kept OUT of the email. A student
 * who forgot their password has usually forgotten their username too and has to
 * type it to sign in afterwards; putting it behind the token is what stops a
 * mistyped address from handing a stranger half a credential.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import * as api from '@/lib/api';
import { MIN_PASSWORD, passwordProblem } from '@/lib/password';
import { useAsync } from '@/lib/useAsync';
import { useSessionState } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/Skeleton';

const MESSAGES: Record<string, string> = {
  invalid_reset:
    'This link is no longer valid. It may have already been used, or it may be more than an hour old.',
  weak_password: `Passwords need at least ${MIN_PASSWORD} characters.`,
};

export default function ResetPassword() {
  const { token = '' } = useParams();
  const { refresh } = useSessionState();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useAsync(() => api.getPasswordReset(token), [token]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password') ?? '');
    const problem = passwordProblem(password, String(data.get('confirm') ?? ''));
    if (problem) {
      setError(problem);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await api.redeemPasswordReset(token, password);
      // The server already set the cookie. Refresh BEFORE navigating: going to
      // /app while the provider still says anonymous makes RequireSession bounce
      // straight back to /login, which reads as the reset having failed.
      await refresh();
      // `replace` so the back button does not land on this now-dead token and
      // show the "not valid" screen, which reads as a failure too.
      void navigate('/app', { replace: true });
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(MESSAGES[code] ?? 'Something went wrong. Try again.');
    } finally {
      setPending(false);
    }
  }

  if (preview.status === 'loading') {
    return (
      <Centered>
        <Skeleton className="h-48 w-full" />
      </Centered>
    );
  }

  // Missing, used and expired all land here — the API does not distinguish
  // them, so neither can this page.
  if (!preview.data) {
    return (
      <Centered>
        <h1 className="u-display mb-3 text-xl">This reset link isn't valid</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          It may have already been used, or it may be more than an hour old.
          Students: ask your coach to send a new one. Coaches and mentors: ask
          for a new link from the sign-in page.
        </p>
        <p className="mt-6 text-sm">
          <Link
            to="/login"
            className="text-foreground underline underline-offset-4"
          >
            Back to sign in
          </Link>
        </p>
      </Centered>
    );
  }

  const { team, display_name: displayName, handle } = preview.data;

  return (
    <Centered>
      <div className="mb-8">
        <div className="text-muted-foreground u-eyebrow mb-2">Reset password</div>
        <h1 className="u-display text-2xl leading-tight">
          Choose a new password
        </h1>
        {team && (
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            For <strong>{displayName}</strong> on{' '}
            <span className="tabular font-mono">{team.team_number}</span>{' '}
            {team.name}.
            {handle ? (
              <>
                {' '}
                You'll sign in with team number{' '}
                <span className="tabular font-mono">{team.team_number}</span> and
                the username <strong>{handle}</strong>.
              </>
            ) : (
              <> You'll sign in with the email on your account.</>
            )}
          </p>
        )}
      </div>

      {/* No outbound links in this state: the token is live and still in the
          address bar. */}
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
          />
          <p className="text-muted-foreground text-xs">
            At least {MIN_PASSWORD} characters.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm">Confirm new password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>

        <Button type="submit" className="min-h-11 w-full" disabled={pending}>
          {pending ? 'Saving…' : 'Set my password'}
        </Button>
      </form>

      <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
        Setting a new password signs you out everywhere else you're signed in.
      </p>

      {error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      )}
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

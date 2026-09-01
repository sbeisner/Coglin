/**
 * Redeem an invite link.
 *
 * The person here has just clicked a link in an email asking them to set a
 * password — the exact shape of a phishing page. So the screen leads with what
 * only a real invite could know: the team number, the team name, and the name
 * the coach typed for them. Ask for credentials first and it reads as a trap.
 */
import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useAsync } from '@/lib/useAsync';
import { useSessionState } from '@/lib/session';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/Skeleton';

interface InvitePreview {
  role: string;
  display_name: string;
  team: { team_number: number; name: string };
  expires_at: number;
}

const MIN_PASSWORD = 8;

export default function AcceptInvite() {
  const { token = '' } = useParams();
  const { refresh } = useSessionState();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preview = useAsync<InvitePreview | null>(async () => {
    const response = await fetch(`/api/invites/${encodeURIComponent(token)}`);
    if (!response.ok) return null;
    return (await response.json()) as InvitePreview;
  }, [token]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const password = String(data.get('password') ?? '');
    if (password !== String(data.get('confirm') ?? '')) {
      setError('The two passwords do not match.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({
            handle: String(data.get('handle') ?? ''),
            password,
          }),
        },
      );
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
        };
        setError(MESSAGES[body.error ?? ''] ?? 'Something went wrong. Try again.');
        return;
      }
      await refresh();
      void navigate('/app');
    } catch {
      setError('Could not reach Coglin. Check your connection.');
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

  // Missing, already used, and expired all land here — the API does not
  // distinguish them, so neither can this page.
  if (!preview.data) {
    return (
      <Centered>
        <h1 className="u-display mb-3 text-xl">This invite link isn't valid</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          It may have already been used, or it may have expired. Ask your coach
          to send a new one.
        </p>
      </Centered>
    );
  }

  const { team, display_name: displayName } = preview.data;

  return (
    <Centered>
      <div className="mb-8">
        <div className="text-muted-foreground u-eyebrow mb-2">You're invited</div>
        <h1 className="u-display text-2xl leading-tight">
          Join <span className="tabular font-mono">{team.team_number}</span>{' '}
          {team.name}
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Your coach set you up as <strong>{displayName}</strong>. Choose a
          username and password — you'll use these with the team number to sign
          in.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="handle">Username</Label>
          <Input
            id="handle"
            name="handle"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
          <p className="text-muted-foreground text-xs">
            Letters, numbers, dots, dashes and underscores. Your teammates will
            see it.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">Password</Label>
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
          <Label htmlFor="confirm">Confirm password</Label>
          <Input
            id="confirm"
            name="confirm"
            type="password"
            autoComplete="new-password"
            required
          />
        </div>

        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? 'Setting up…' : 'Create my account'}
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      )}
    </Centered>
  );
}

const MESSAGES: Record<string, string> = {
  handle_taken: 'Someone on your team already uses that username. Pick another.',
  invalid_handle:
    'Usernames are 3–24 characters: letters, numbers, dots, dashes, underscores.',
  weak_password: `Passwords need at least ${MIN_PASSWORD} characters.`,
  invalid_invite: 'This invite link is no longer valid. Ask your coach for a new one.',
};

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

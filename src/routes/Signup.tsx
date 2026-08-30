/**
 * Create a team and its first coach.
 *
 * This screen exists because the API endpoint alone is not a signup path — a
 * coach who lands on Coglin needs a door, not a curl command.
 *
 * The access code is asked for **first**, and deliberately so. Coglin is
 * invite-only during the alpha, and finding that out after typing a team
 * number, a team name, an email and a password is a small insult. Leading with
 * it sets the expectation honestly.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSessionState } from '@/lib/session';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';

const MIN_PASSWORD = 8;

/**
 * Server error codes to something a coach can act on. `forbidden` is the
 * interesting one: it means the code was wrong, but the endpoint returns the
 * same 403 when signup is closed entirely, so the copy has to cover both
 * without promising which.
 */
const MESSAGES: Record<string, string> = {
  forbidden:
    "That access code isn't valid. Coglin is invite-only during the alpha — check the code with whoever sent it.",
  already_exists:
    'An account or team already exists with those details. Try signing in instead.',
  invalid_email: 'That email address does not look right.',
  weak_password: `Passwords need at least ${MIN_PASSWORD} characters.`,
  missing_display_name: 'Please enter your name.',
  invalid_team_number: 'Team number should be digits only — for example 607.',
  missing_team_name: 'Please enter your team name.',
};

export default function Signup() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useSessionState();
  const navigate = useNavigate();

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
      const response = await fetch('/api/auth/coach-signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          code: String(data.get('code') ?? '').trim(),
          email: String(data.get('email') ?? ''),
          password,
          display_name: String(data.get('display_name') ?? ''),
          team_number: Number(data.get('team_number')),
          team_name: String(data.get('team_name') ?? ''),
          region: String(data.get('region') ?? '') || undefined,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(
          MESSAGES[body.error ?? ''] ?? 'Something went wrong. Try again in a moment.',
        );
        return;
      }

      // Signup opens a session, so a new coach lands straight on their empty
      // dashboard rather than being bounced to a login screen to retype what
      // they just chose.
      await refresh();
      void navigate('/app');
    } catch {
      setError('Could not reach Coglin. Check your connection.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="u-bar h-8 w-1.5 shrink-0" aria-hidden />
          <h1 className="u-display text-2xl leading-none">Coglin</h1>
        </div>

        <h2 className="u-display mb-2 text-xl leading-tight">Set up your team</h2>
        <p className="text-muted-foreground mb-8 text-sm leading-relaxed">
          This creates the team and your coach account. You'll add students
          afterwards by inviting them.
        </p>

        <form onSubmit={onSubmit} className="space-y-4">
          <Field
            name="code"
            label="Access code"
            required
            autoCapitalize="none"
            spellCheck={false}
            hint="Coglin is invite-only while it's in alpha."
          />

          <hr className="border-border" />

          <Field
            name="team_number"
            label="Team number"
            type="number"
            inputMode="numeric"
            required
            hint="Your FIRST Tech Challenge team number."
          />
          <Field name="team_name" label="Team name" required />
          <Field
            name="region"
            label="Region"
            hint="Optional — for example Maryland."
          />

          <hr className="border-border" />

          <Field
            name="display_name"
            label="Your name"
            autoComplete="name"
            required
            hint="How you'll appear on the roster."
          />
          <Field
            name="email"
            label="Your email"
            type="email"
            autoComplete="email"
            required
          />
          <Field
            name="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD}
            required
            hint={`At least ${MIN_PASSWORD} characters.`}
          />
          <Field
            name="confirm"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            required
          />

          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Setting up…' : 'Create my team'}
          </Button>
        </form>

        {error && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {error}
          </p>
        )}

        <p className="text-muted-foreground mt-8 text-sm">
          Already have an account?{' '}
          <Link to="/login" className="text-foreground underline underline-offset-4">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}

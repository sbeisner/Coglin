/**
 * Ask for a reset link.
 *
 * Only reaches accounts with an email on file, which is the coach who
 * registered the team. Students have no address by design (COPPA — see
 * migrations/0002_invites.sql), so the copy points them at their coach rather
 * than letting them submit a form that can never work for them.
 *
 * Every answer from this endpoint is the same 200, whether or not the address
 * has an account. The hedge in the success copy — "if there's an account" — is
 * therefore load-bearing, not vagueness: stating it plainly would give back the
 * account-existence answer the API deliberately withholds.
 */
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import * as api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const MESSAGES: Record<string, string> = {
  invalid_email: 'That email address does not look right.',
  too_many_requests:
    'Too many reset requests just now. Wait a few minutes and try again.',
};

export default function ForgotPassword() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = String(new FormData(e.currentTarget).get('email') ?? '').trim();

    setPending(true);
    setError(null);
    try {
      await api.requestPasswordReset(email);
      setSentTo(email);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(MESSAGES[code] ?? 'Something went wrong. Try again in a moment.');
    } finally {
      setPending(false);
    }
  }

  if (sentTo) {
    return (
      <Centered>
        <div role="status">
          <h1 className="u-display mb-3 text-2xl leading-tight">
            Check your email
          </h1>
          <p className="text-muted-foreground text-sm leading-relaxed">
            If there's a Coglin account for <strong>{sentTo}</strong>, a link to
            choose a new password is on its way. It works once and expires in an
            hour.
          </p>
          <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
            Nothing arrived? Check the spam folder, or try again with a
            different address — it's easy to sign up with a school address and
            then look for the mail somewhere else.
          </p>
        </div>
        <p className="mt-8 text-sm">
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

  return (
    <Centered>
      <div className="mb-8">
        <h1 className="u-display text-2xl leading-tight">
          Forgot your password
        </h1>
        <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
          Type the email you use to sign in. If there's a Coglin account with
          that address, we'll send a link to choose a new password.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            required
          />
        </div>
        <Button type="submit" className="min-h-11 w-full" disabled={pending}>
          {pending ? 'Sending…' : 'Send reset link'}
        </Button>
      </form>

      {error && (
        <p role="alert" className="text-destructive mt-4 text-sm">
          {error}
        </p>
      )}

      <p className="text-muted-foreground mt-8 text-xs leading-relaxed">
        Students sign in with a team number and username, not an email. Ask your
        coach to send you a reset link.
      </p>

      <p className="mt-3 text-sm">
        <Link to="/login" className="text-foreground underline underline-offset-4">
          Back to sign in
        </Link>
      </p>
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

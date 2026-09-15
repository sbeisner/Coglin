/**
 * Change the password you already know.
 *
 * Renders for everybody, students included: a student has no email but does
 * have a password, and the whole point of the recovery work is that they should
 * not need a coach for something they can do themselves.
 */
import { useState, type FormEvent } from 'react';
import * as api from '@/lib/api';
import { MIN_PASSWORD, passwordProblem } from '@/lib/password';
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

const ERROR_COPY: Record<string, string> = {
  invalid_password: 'That current password is not right. Check it and try again.',
  weak_password: `Passwords need at least ${MIN_PASSWORD} characters.`,
  password_unchanged:
    'Your new password is the same as the old one. Pick a different one.',
};

export function ChangePasswordCard() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // Bumped after a successful change so the browser drops the old field values
  // rather than leaving a password sitting in the DOM.
  const [formKey, setFormKey] = useState(0);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const next = String(data.get('new_password') ?? '');
    const problem = passwordProblem(next, String(data.get('confirm') ?? ''));
    if (problem) {
      setError(problem);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await api.changePassword({
        current_password: String(data.get('current_password') ?? ''),
        new_password: next,
      });
      setDone(true);
      setFormKey((k) => k + 1);
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      setError(ERROR_COPY[code] ?? 'Could not change your password. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Password</CardTitle>
        <CardDescription>
          Change the password you use to sign in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {done ? (
          <div role="status" className="space-y-4">
            <p className="text-sm">Password changed.</p>
            <Button
              type="button"
              variant="ghost"
              className="min-h-11"
              onClick={() => setDone(false)}
            >
              Change it again
            </Button>
          </div>
        ) : (
          <form key={formKey} onSubmit={onSubmit} className="max-w-sm space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="current_password">Current password</Label>
              <Input
                id="current_password"
                name="current_password"
                type="password"
                autoComplete="current-password"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new_password">New password</Label>
              <Input
                id="new_password"
                name="new_password"
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

            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}

            <Button type="submit" className="min-h-11" disabled={pending}>
              {pending ? 'Saving…' : 'Change password'}
            </Button>

            <p className="text-muted-foreground text-xs leading-relaxed">
              You&rsquo;ll stay signed in here. Anywhere else you&rsquo;re
              signed in — another phone, a school computer — gets signed out.
            </p>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

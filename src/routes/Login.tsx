/**
 * Sign in.
 *
 * Two credential shapes on one screen, because the team has both kinds of user
 * and a student should not have to work out which door is theirs. Students are
 * the default tab: there are up to 15 of them and one or two coaches, so the
 * common case is the one that opens.
 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useSessionState } from '@/lib/session';
import { Field } from '@/components/Field';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function Login() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { refresh } = useSessionState();
  const navigate = useNavigate();

  async function submit(body: Record<string, unknown>) {
    setPending(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        // The server answers 401 for both "no such account" and "wrong
        // password" on purpose; the copy here has to stay just as vague or it
        // gives back what the API withholds.
        setError(
          response.status === 401
            ? 'That combination did not match. Check and try again.'
            : 'Something went wrong. Try again in a moment.',
        );
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

  function onStudentSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void submit({
      team_number: Number(data.get('team_number')),
      handle: String(data.get('handle') ?? ''),
      password: String(data.get('password') ?? ''),
    });
  }

  function onAdultSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    void submit({
      email: String(data.get('email') ?? ''),
      password: String(data.get('password') ?? ''),
    });
  }

  return (
    <div className="bg-background flex min-h-dvh items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="u-bar h-8 w-1.5 shrink-0" aria-hidden />
          <h1 className="u-display text-2xl leading-none">Coglin</h1>
        </div>

        <Tabs defaultValue="student">
          <TabsList className="mb-6 w-full">
            <TabsTrigger value="student" className="flex-1">
              Student
            </TabsTrigger>
            <TabsTrigger value="adult" className="flex-1">
              Coach or mentor
            </TabsTrigger>
          </TabsList>

          <TabsContent value="student">
            <form onSubmit={onStudentSubmit} className="space-y-4">
              <Field
                name="team_number"
                label="Team number"
                type="number"
                inputMode="numeric"
                autoComplete="off"
                required
              />
              <Field
                name="handle"
                label="Username"
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                required
              />
              <Field
                name="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                required
              />
              <Submit pending={pending} />
            </form>
          </TabsContent>

          <TabsContent value="adult">
            <form onSubmit={onAdultSubmit} className="space-y-4">
              <Field
                name="email"
                label="Email"
                type="email"
                autoComplete="email"
                required
              />
              <Field
                name="password"
                label="Password"
                type="password"
                autoComplete="current-password"
                required
              />
              <Submit pending={pending} />
            </form>
          </TabsContent>
        </Tabs>

        {error && (
          <p role="alert" className="text-destructive mt-4 text-sm">
            {error}
          </p>
        )}

        <p className="text-muted-foreground mt-8 text-sm leading-relaxed">
          Setting up a new team?{' '}
          <Link
            to="/signup"
            className="text-foreground underline underline-offset-4"
          >
            Create a team
          </Link>
        </p>

        <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
          Students get an account from their coach. If you don't have one yet,
          ask them to send you an invite.
        </p>
      </div>
    </div>
  );
}

function Submit({ pending }: { pending: boolean }) {
  return (
    <Button type="submit" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  );
}

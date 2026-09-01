/**
 * Who is signed in, resolved once at boot.
 *
 * `GET /api/auth/me` answers with a 200 either way, so the provider has three
 * states rather than two: still asking, signed in, signed out. Rendering the
 * shell before the answer arrives would flash the app at a signed-out visitor,
 * and redirecting before it arrives would bounce a signed-in one to the login
 * screen on every refresh.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { SESSION_EXPIRED } from '@/lib/api';
import type { Role, SubTeam, Team } from '@/types';

export interface SessionMember {
  id: string;
  role: Role;
  display_name: string;
  handle: string | null;
  sub_teams: SubTeam[];
  /** Whether to offer the part-order approve buttons. The routes still decide. */
  is_purchase_approver: boolean;
}

export interface Session {
  user: { id: string; email: string | null };
  member: SessionMember;
  team: Pick<Team, 'id' | 'team_number' | 'name'>;
}

type State =
  | { status: 'loading'; session: null }
  | { status: 'authenticated'; session: Session }
  | { status: 'anonymous'; session: null };

const SessionContext = createContext<
  (State & { refresh: () => Promise<void> }) | null
>(null);

export async function fetchSession(): Promise<Session | null> {
  const response = await fetch('/api/auth/me', {
    credentials: 'same-origin',
    // Belt and braces with the Worker's no-store headers. This request decides
    // whether the user sees the app or the login screen, and a stale "not
    // signed in" answer strands them in a loop they cannot escape by retrying.
    // Cheap insurance against a proxy that ignores response headers.
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { authenticated: boolean } & Session;
  return body.authenticated ? body : null;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<State>({ status: 'loading', session: null });

  const refresh = useCallback(async () => {
    try {
      const session = await fetchSession();
      setState(
        session
          ? { status: 'authenticated', session }
          : { status: 'anonymous', session: null },
      );
    } catch {
      // A network failure is not a signed-out user, but there is nothing else
      // this component can do with it — the login screen at least offers a
      // retry, and a signed-in user's next action will re-resolve.
      setState({ status: 'anonymous', session: null });
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Any screen's data call that comes back 401 lands here (see api.ts). Going
  // straight to anonymous rather than re-asking /api/auth/me saves a round trip
  // whose answer is already known, and the route gate handles the redirect.
  useEffect(() => {
    const onExpired = () => setState({ status: 'anonymous', session: null });
    window.addEventListener(SESSION_EXPIRED, onExpired);
    return () => window.removeEventListener(SESSION_EXPIRED, onExpired);
  }, []);

  return (
    <SessionContext.Provider value={{ ...state, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSessionState() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSessionState must be used inside SessionProvider');
  return value;
}

/**
 * For components inside the authenticated shell, where the session is
 * guaranteed to exist because `RequireSession` already gated on it.
 */
export function useSession(): Session {
  const { session } = useSessionState();
  if (!session) throw new Error('useSession used outside an authenticated route');
  return session;
}

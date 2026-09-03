import { useEffect, useRef, useState } from 'react';

type State<T> =
  | { status: 'loading'; data: null; error: null }
  | { status: 'ready'; data: T; error: null }
  | { status: 'error'; data: null; error: Error };

/**
 * Minimal data-fetching hook for the mock layer.
 *
 * Not a cache and not a query library — Phase 1 will decide whether this app
 * needs one once there are real requests, real invalidation and real polling
 * (plan §8). Introducing TanStack Query now would be choosing an answer before
 * the question exists.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): State<T> {
  const [state, setState] = useState<State<T>>({
    status: 'loading',
    data: null,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    fn()
      .then((data) => {
        if (!cancelled) setState({ status: 'ready', data, error: null });
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setState({
            status: 'error',
            data: null,
            error: e instanceof Error ? e : new Error(String(e)),
          });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return state;
}

/**
 * The last value a `useAsync` actually returned, kept across refetches.
 *
 * `useAsync` deliberately resets to `loading` with `data: null` whenever its
 * deps change, which is right for navigating to a different thing and wrong for
 * reloading the SAME thing after a write. A screen that gates on
 * `status === 'loading'` and returns early will unmount its own subtree on
 * every mutation — taking open dialogs, filter chips and selections with it.
 * That bug shipped once (the sponsors tab collapsed after every edit) and this
 * exists so it does not ship twice.
 *
 * Writing to the ref during render is the standard previous-value idiom and is
 * safe because it is idempotent: the same render always stores the same value.
 *
 * Use it for the FIRST-LOAD test — `data === null && status === 'loading'` is a
 * genuine cold start; anything else is a refresh that should keep the screen up.
 */
export function useLastGood<T>(state: State<T>): T | null {
  const last = useRef<T | null>(null);
  if (state.data !== null) last.current = state.data;
  return state.data ?? last.current;
}

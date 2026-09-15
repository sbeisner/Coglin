/**
 * A per-machine guess at whether this browser is signed in, used only to decide
 * what to paint before the answer arrives.
 *
 * WHY
 *
 * The session cookie is HttpOnly (worker/lib/session.ts), which is correct and
 * means JavaScript cannot read it. So every page load begins knowing nothing and
 * resolves the truth from `GET /api/auth/me`. SessionProvider models that
 * honestly with three states, but the marketing header collapsed `loading` into
 * the signed-out branch, so a signed-in coach was shown "Sign in" and
 * "Create your team" — baked into the prerendered HTML, no less — until the
 * fetch landed. On a warm cache that flip is imperceptible. On a cold one it is
 * long enough to read the button and click it. That is the "it's random whether
 * I get login or open" half of the bug.
 *
 * HOW
 *
 * The prerendered markup is fixed at build time, so ANY boot-varying value read
 * during render is a hydration mismatch by construction. The way out is the one
 * src/lib/theme.ts already uses: put the varying bit on <html>, before paint,
 * OUTSIDE the React root, where hydration cannot see it, and let CSS choose
 * between two branches that are both always rendered. See the
 * .session-in-only / .session-out-only rules in src/index.css.
 *
 * THIS IS NOT AUTHENTICATION
 *
 * It is a display hint and nothing else. Note that this module deliberately
 * exports no way for a component to read it: `parseSessionHint` exists to be
 * tested, and the value only ever reaches CSS. RequireSession therefore cannot
 * consult it even by accident, and the server remains the only thing that
 * decides what anyone is allowed to see.
 */

export const SESSION_HINT_KEY = 'coglin.session-hint';

/**
 * Matches SESSION_TTL in worker/lib/session.ts (30 days).
 *
 * The expiry is not decoration. Without it, a coach who signed in once last
 * season is offered "Open Coglin" forever and bounced to /login every time they
 * take it — the same bug as before, just pointing the other way.
 */
export const SESSION_HINT_TTL_MS = 60 * 60 * 24 * 30 * 1000;

/** The stored form: `in:<absolute ms at which this guess goes stale>`. */
export function hintValue(now: number): string {
  return `in:${now + SESSION_HINT_TTL_MS}`;
}

/**
 * The reference implementation of the rule the boot script applies.
 *
 * Anything malformed, absent or past its expiry reads as "no hint", which the
 * CSS treats as signed out — the safe direction, since it offers a sign-in link
 * rather than a door that will not open.
 */
export function parseSessionHint(raw: string | null, now: number): 'in' | null {
  if (!raw || raw.slice(0, 3) !== 'in:') return null;
  const expires = Number(raw.slice(3));
  return Number.isFinite(expires) && expires > now ? 'in' : null;
}

/**
 * Show what we currently believe, without committing it to storage.
 *
 * Used when the answer is not definitive — a thrown fetch, say. The attribute
 * has to track the live state regardless of how we got there, because it is what
 * reveals the login form: leaving a stale "in" in place after resolving to
 * anonymous would hide the form behind the "Opening Coglin…" panel and strand
 * someone on a flaky connection at the one screen they need.
 */
export function reflectSessionHint(signedIn: boolean): void {
  const root = document.documentElement;
  if (signedIn) {
    root.dataset.sessionHint = 'in';
  } else {
    delete root.dataset.sessionHint;
  }
}

/**
 * Record what the server actually told us, and reflect it immediately.
 *
 * Presence means signed in; absence means signed out. That polarity is the same
 * choice theme.ts makes, and it matters here for a second reason: signing out
 * REMOVES the key rather than storing a negative, so a shared school laptop is
 * left with nothing about the last person to use it.
 *
 * Only for DEFINITIVE answers. `{"authenticated":false}` is evidence; a network
 * failure is not, and persisting one would reintroduce the signed-out flash on
 * the next load for somebody who was signed in the whole time.
 */
export function applySessionHint(signedIn: boolean, now = Date.now()): void {
  reflectSessionHint(signedIn);
  try {
    if (signedIn) {
      localStorage.setItem(SESSION_HINT_KEY, hintValue(now));
    } else {
      localStorage.removeItem(SESSION_HINT_KEY);
    }
  } catch {
    /* private mode — the guess just won't survive the tab */
  }
}

/**
 * Inlined verbatim into index.html. Kept here so the key and the rule have one
 * source of truth — if you edit this, copy it across. Dependency-free and tiny
 * on purpose: it runs before anything else on the page, and it has to.
 */
export const SESSION_HINT_BOOT_SCRIPT = `
try {
  var h = localStorage.getItem('${SESSION_HINT_KEY}');
  if (h && h.slice(0, 3) === 'in:' && Number(h.slice(3)) > Date.now())
    document.documentElement.dataset.sessionHint = 'in';
} catch (e) {}
`;

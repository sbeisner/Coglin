import { type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { AppShell } from '@/components/AppShell';
import { SessionProvider, useSessionState } from '@/lib/session';
import { MarketingShell } from '@/marketing/MarketingShell';
import Landing from '@/marketing/Landing';
import Features from '@/marketing/Features';
import Awards from '@/marketing/Awards';
import Faq from '@/marketing/Faq';
import About from '@/marketing/About';
import Pricing from '@/marketing/Pricing';
import Privacy from '@/marketing/Privacy';
import Terms from '@/marketing/Terms';
import NotFound from '@/marketing/NotFound';
import Dashboard from '@/routes/Dashboard';
import Boards from '@/routes/Boards';
import Roster from '@/routes/Roster';
import Outreach from '@/routes/Outreach';
import Meetings from '@/routes/Meetings';
import Meeting from '@/routes/Meeting';
import Portfolio from '@/routes/Portfolio';
import Finance from '@/routes/Finance';
import Notes from '@/routes/Notes';
import Placeholder from '@/routes/Placeholder';
import Debug from '@/routes/Debug';
import Login from '@/routes/Login';
import AcceptInvite from '@/routes/AcceptInvite';
import Signup from '@/routes/Signup';

// The theme is applied pre-paint by the inline script in index.html, so there
// is deliberately nothing to do here.

/**
 * Gate for everything inside the shell.
 *
 * Renders nothing while the session is still resolving. That blank frame is on
 * purpose: showing the shell first would flash a signed-out visitor the app,
 * and redirecting first would bounce a signed-in one to /login on every reload.
 */
function RequireSession() {
  const { status } = useSessionState();
  if (status === 'loading') return null;
  if (status === 'anonymous') return <Navigate to="/login" replace />;
  return <AppShell />;
}

/**
 * The mirror of RequireSession, for /login and /signup.
 *
 * Without it a signed-in user who navigates to the sign-in page — by habit, by
 * bookmark, or by hitting back — is shown a login form for the account they are
 * already using. There is no error and no way forward that looks different from
 * what they just did, so the honest reading is "it didn't work", and they try
 * again. Sending them to the app instead makes the state legible.
 */
function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const { status } = useSessionState();
  if (status === 'loading') return null;
  if (status === 'authenticated') return <Navigate to="/app" replace />;
  return <>{children}</>;
}

/**
 * Bookmarks from before the app moved under /app.
 *
 * The alpha team has been using this all season and has links saved to
 * `/boards` and `/meetings/<id>` — some of them pasted into their own team
 * Discord. Breaking those to tidy up the URL space would be a self-inflicted
 * support ticket during a competition season, so every old path forwards, query
 * string and all.
 *
 * Registered per-path rather than as a catch-all: an unrecognised URL should
 * reach the marketing 404, not be silently rewritten into the app where it will
 * 404 again one level deeper.
 */
function LegacyAppRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={`/app${pathname}${search}`} replace />;
}

/**
 * Every path that used to be an app screen.
 *
 * `/awards` is deliberately ABSENT. It is now the public award-breakdown page,
 * and the in-app tracker at /app/awards is still a stub (nav.ts marks it
 * `stub: true`, api.ts returns an empty array), so nobody has a bookmark to it
 * worth preserving. Adding it here would take the marketing page off the air.
 */
const LEGACY_APP_PATHS = [
  '/boards',
  '/roster',
  '/outreach',
  '/portfolio',
  '/budget',
  '/finance',
  '/calendar',
  '/debug',
  '/meetings',
  '/meetings/:meetingId',
  '/notes',
  '/notes/:docId',
];

/**
 * The route tree, with no router around it.
 *
 * Split out of main.tsx so the same tree can be mounted three ways: by the
 * browser under a BrowserRouter, and by scripts/prerender.mjs under a
 * StaticRouter to write real HTML for the marketing pages. Keeping one
 * definition is the whole point -- a second copy of the routes for the
 * prerenderer would drift the day somebody adds a page.
 */
export function App() {
  return (
    <SessionProvider>
            <Routes>
              {/* ---------- Public marketing ----------
                  The root is a landing page, not a login wall. lilithforge.com has
                  linked here as "Enter Coglin" since before there was anything to
                  enter, and sending a stranger straight to a password field is a
                  poor answer to that link. */}
              <Route element={<MarketingShell />}>
                <Route path="/" element={<Landing />} />
                <Route path="/features" element={<Features />} />
                <Route path="/awards" element={<Awards />} />
                <Route path="/pricing" element={<Pricing />} />
                <Route path="/faq" element={<Faq />} />
                <Route path="/about" element={<About />} />
                <Route path="/privacy" element={<Privacy />} />
                <Route path="/terms" element={<Terms />} />
                {/* Anything unrecognised is a marketing 404, because by this point
                    the app routes and the legacy redirects have both had their
                    chance. */}
                <Route path="*" element={<NotFound />} />
              </Route>

              {/* ---------- Public, but no marketing chrome ----------
                  A header offering "Pricing" and "Features" above a password field
                  is an invitation to wander off mid-sign-in. */}
              <Route
                path="/login"
                element={
                  <RedirectIfSignedIn>
                    <Login />
                  </RedirectIfSignedIn>
                }
              />
              <Route
                path="/signup"
                element={
                  <RedirectIfSignedIn>
                    <Signup />
                  </RedirectIfSignedIn>
                }
              />
              {/* Invite mail points at this path (worker/lib/email.ts builds
                  `${APP_BASE_URL}/invite/<token>`). It did not move and must not. */}
              <Route path="/invite/:token" element={<AcceptInvite />} />

              {/* The pricing page was /support for one afternoon before the framing
                  was corrected — it sells a product, it does not collect donations. */}
              <Route path="/support" element={<Navigate to="/pricing" replace />} />

              {/* ---------- The application ---------- */}
              <Route path="/app" element={<RequireSession />}>
                <Route index element={<Dashboard />} />
                <Route path="boards" element={<Boards />} />
                <Route path="outreach" element={<Outreach />} />
                <Route path="roster" element={<Roster />} />
                <Route path="awards" element={<Placeholder />} />
                <Route path="portfolio" element={<Portfolio />} />
                {/* /calendar was a stub; the calendar is now a view on /meetings.
                    A redirect rather than a deletion, because the catch-all below
                    renders Placeholder — so a stale bookmark would land on "not
                    built yet" for a feature that does exist. */}
                <Route
                  path="calendar"
                  element={<Navigate to="/app/meetings?view=calendar" replace />}
                />
                <Route path="finance" element={<Finance />} />
                {/* The section shipped as Finance; season-old bookmarks say
                    budget. Chains with '/budget' in LEGACY_APP_PATHS below. */}
                <Route path="budget" element={<Navigate to="/app/finance" replace />} />
                <Route path="meetings" element={<Meetings />} />
                {/* The app's first nested route. AppShell resolves its nav label by
                    prefix for this reason — an exact match leaves the mobile title
                    bar saying "Coglin" on the screen a student takes notes on. */}
                <Route path="meetings/:meetingId" element={<Meeting />} />
                <Route path="notes" element={<Notes />} />
                <Route path="notes/:docId" element={<Notes />} />
                <Route path="debug" element={<Debug />} />
                {/* Any unknown path under /app still renders the shell, which keeps
                    the not_found_handling SPA-fallback check meaningful. */}
                <Route path="*" element={<Placeholder />} />
              </Route>

              {/* ---------- Bookmarks from before the move ---------- */}
              {LEGACY_APP_PATHS.map((path) => (
                <Route key={path} path={path} element={<LegacyAppRedirect />} />
              ))}
            </Routes>
          </SessionProvider>
  );
}

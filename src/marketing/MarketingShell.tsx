/**
 * Chrome for every public page.
 *
 * Two things live here rather than on each page, because both are the kind that
 * get forgotten on the seventh page someone adds:
 *
 *  1. THE DISCLAIMER. Plan §4 commits Coglin to being unofficial permanently —
 *     no FIRST or FTC logos, `FIRST` styled capitalised and italic, and a
 *     non-affiliation notice on every marketing surface. "Everywhere and
 *     forever" is only true if it is structural, so it is in the footer of the
 *     shell and not in a page template someone copies.
 *
 *  2. THE SESSION-AWARE CTA. A coach who is already signed in should not be
 *     offered "Create your team" on the page their own app links to. The header
 *     asks the existing SessionProvider and offers "Open Coglin" instead.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Menu, X } from 'lucide-react';
import { useSessionState } from '@/lib/session';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PAGES, ORIGIN } from './seo';

const LINKS = [
  { to: '/features', label: 'Features' },
  { to: '/awards', label: 'Awards' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/faq', label: 'FAQ' },
  { to: '/about', label: 'About' },
];

/**
 * Keep <title> and the canonical link in step with client-side navigation.
 *
 * The prerendered HTML carries the right tags for the document the browser
 * loaded, which is what crawlers and link-preview scrapers read. But react-router
 * navigation swaps the view without touching <head>, so clicking Pricing from
 * Features left the tab, the history entry and any analytics still saying
 * "Features". Crawlers were fine; people were not.
 */
function useRouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const page = PAGES.find((p) => p.path === pathname);
    if (!page) return;
    document.title = page.title;
    const link = document.querySelector('link[rel="canonical"]');
    if (link) link.setAttribute('href', `${ORIGIN}${page.path}`);
    const desc = document.querySelector('meta[name="description"]');
    if (desc) desc.setAttribute('content', page.description);
  }, [pathname]);
}

export function MarketingShell() {
  useRouteMeta();
  const [open, setOpen] = useState(false);
  const { status } = useSessionState();
  const signedIn = status === 'authenticated';

  return (
    <div className="bg-background flex min-h-dvh flex-col">
      <a
        href="#main"
        className="bg-primary text-primary-foreground focus:ring-ring sr-only rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>

      <header className="border-border bg-background/95 sticky top-0 z-30 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-3 px-4 py-3">
          <Link to="/" className="flex shrink-0 items-center gap-2.5">
            <span className="cog-mark h-7 shrink-0" role="img" aria-label="" />
            <span className="u-display text-lg leading-none">Coglin</span>
          </Link>

          <nav className="ml-6 hidden gap-1 md:flex" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-md px-3 py-2 text-sm transition-colors',
                    isActive
                      ? 'text-foreground font-medium'
                      : 'text-muted-foreground hover:text-foreground',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <ThemeToggle />
            {signedIn ? (
              <Button asChild size="sm">
                <Link to="/app">Open Coglin</Link>
              </Button>
            ) : (
              <>
                <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
                  <Link to="/login">Sign in</Link>
                </Button>
                <Button asChild size="sm">
                  <Link to="/signup">Create your team</Link>
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              aria-label={open ? 'Close menu' : 'Open menu'}
              // text-foreground, not inherited: a bare <button> falls through
              // to the UA's `buttontext` colour (Tailwind v4 preflight does not
              // reset it), and this icon is drawn in currentColor — so the
              // hamburger disappears into the graphite header in dark mode.
              className="text-foreground hover:bg-accent focus-visible:ring-ring inline-flex size-10 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none md:hidden"
            >
              {open ? <X className="size-5" aria-hidden /> : <Menu className="size-5" aria-hidden />}
            </button>
          </div>
        </div>

        {open && (
          <nav className="border-border border-t px-4 py-2 md:hidden" aria-label="Main">
            {LINKS.map((l) => (
              <NavLink
                key={l.to}
                to={l.to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'block rounded-md px-3 py-2.5 text-sm',
                    isActive ? 'text-foreground font-medium' : 'text-muted-foreground',
                  )
                }
              >
                {l.label}
              </NavLink>
            ))}
            {!signedIn && (
              <NavLink
                to="/login"
                onClick={() => setOpen(false)}
                className="text-muted-foreground block rounded-md px-3 py-2.5 text-sm sm:hidden"
              >
                Sign in
              </NavLink>
            )}
          </nav>
        )}
      </header>

      <main id="main" className="flex-1">
        <Outlet />
      </main>

      <footer className="border-border mt-16 border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-5xl space-y-4 px-4 py-10 text-xs leading-relaxed">
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {LINKS.map((l) => (
              <Link key={l.to} to={l.to} className="hover:text-foreground">
                {l.label}
              </Link>
            ))}
            <a href="mailto:admin@lilithforge.com" className="hover:text-foreground">
              Contact
            </a>
          </div>

          {/* Plan §4. Not optional, not a page-level decision. */}
          <p className="max-w-2xl">
            Coglin is not affiliated with, endorsed by, or sponsored by{' '}
            <FirstMark />. <FirstMark /> and <FirstMark /> Tech Challenge are
            trademarks of For Inspiration and Recognition of Science and
            Technology, used here only to describe the teams this software is
            built for.
          </p>
          <p>
            A <a className="hover:text-foreground underline underline-offset-4" href="https://lilithforge.com">Lilith Forge</a> product.
          </p>
        </div>
      </footer>
    </div>
  );
}

/**
 * `FIRST` is styled capitalised and italic wherever it appears, followed by the
 * registered mark — trademark rules plan §4 commits to following strictly. A
 * component rather than a convention, so it cannot be got wrong by typing, and
 * so a future correction is one edit.
 */
export function FirstMark() {
  return (
    <>
      <i>FIRST</i>®
    </>
  );
}

import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { Bug, Menu } from 'lucide-react';
import { NAV } from '@/lib/nav';
import { useSession, useSessionState } from '@/lib/session';
import { ThemeToggle } from '@/components/ThemeToggle';
import { ReportBugDialog } from '@/components/ReportBugDialog';
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import type { Session } from '@/lib/session';
import { cn } from '@/lib/utils';

const PRIMARY = NAV.filter((n) => n.primary);

/**
 * The dashboard's path, and the reason it needs naming.
 *
 * Every app route is nested under it, so a NavLink pointing here prefix-matches
 * the whole product and the dashboard renders as active on every screen. It has
 * to opt out with `end`, in BOTH the sidebar and the mobile tab bar — a constant
 * rather than the literal twice, because the two call sites are 100 lines apart
 * and the bug is invisible until you look at a second screen.
 *
 * This did not bite when the dashboard was at `/`: react-router only treats a
 * prefix as a match when the next character is a separator, and for `/` the next
 * character of `/boards` is `b`. Moving to `/app` made `/app/boards` a genuine
 * segment match, which is correct behaviour and exactly what `end` is for.
 */
const APP_ROOT = '/app';

/**
 * The nav entry a path belongs to, matching by prefix rather than equality.
 *
 * Meetings introduced the app's first nested route. With an exact match
 * `/meetings/<id>` matches nothing, so a student taking notes on a phone sees
 * the shell titled "Coglin" — no error, just a screen that has forgotten what
 * it is. `/app` is special-cased because every app path starts with it — the
 * dashboard would otherwise match every screen in the product.
 */
function navItemFor(pathname: string) {
  return NAV.find((n) =>
    n.to === APP_ROOT
      ? pathname === APP_ROOT
      : pathname === n.to || pathname.startsWith(`${n.to}/`),
  );
}

/**
 * Sidebar at ≥768px, bottom tab bar below.
 *
 * Mobile is built here from the start rather than retrofitted: COG-022 requires
 * this to work on a phone in a competition pit, and a desktop-first shell would
 * have to be torn apart to get there.
 */
export function AppShell() {
  const [sheetOpen, setSheetOpen] = useState(false);
  // Owned here rather than inside SidebarFoot, which renders TWICE — once in
  // the desktop aside and once inside the mobile sheet. Local state there would
  // mean two dialogs, and the sheet's copy unmounts when the sheet closes,
  // which would take an open dialog with it.
  const [bugOpen, setBugOpen] = useState(false);
  const location = useLocation();
  const current = navItemFor(location.pathname);
  const { team } = useSession();

  return (
    <div className="bg-background min-h-dvh md:flex">
      {/* Skip link — the board has a lot of tab stops to wade through. */}
      <a
        href="#main"
        className="bg-primary text-primary-foreground focus:ring-ring sr-only rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:ring-2"
      >
        Skip to content
      </a>

      {/* ---------- Desktop sidebar ----------
          The ink slab. No right border: the surface change already draws the
          edge, and a hairline on top of it is a seam for its own sake. */}
      <aside className="bg-ink text-ink-foreground hidden w-60 shrink-0 flex-col md:sticky md:top-0 md:flex md:h-dvh">
        <TeamMark team={team} />
        <nav className="flex-1 overflow-y-auto px-2 py-1.5" aria-label="Main">
          <ul className="space-y-0.5">
            {NAV.map((item) => (
              <li key={item.to}>
                <SideLink item={item} />
              </li>
            ))}
          </ul>
        </nav>
        <SidebarFoot onReportBug={() => setBugOpen(true)} />
      </aside>

      {/* ---------- Mobile top bar ---------- */}
      <div className="bg-background/95 border-border sticky top-0 z-30 flex items-center gap-3 border-b px-4 py-3 backdrop-blur md:hidden">
        <span className="u-bar h-5 w-1.5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="u-display truncate text-base leading-none">
            {current?.label ?? 'Coglin'}
          </div>
          <div className="text-muted-foreground mt-1 truncate text-xs">
            <span className="tabular font-mono">{team.team_number}</span>{' '}
            {team.name}
          </div>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger
            className="hover:bg-accent focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-md focus-visible:ring-2 focus-visible:outline-none"
            aria-label="More"
          >
            <Menu className="size-5" aria-hidden />
          </SheetTrigger>
          {/* Same slab on a phone — the nav is the nav wherever it is drawn. */}
          <SheetContent
            side="right"
            className="bg-ink text-ink-foreground flex w-72 flex-col p-0"
          >
            <SheetTitle className="sr-only">Navigation</SheetTitle>
            <TeamMark team={team} />
            <nav className="flex-1 overflow-y-auto px-2 py-1.5" aria-label="All sections">
              <ul className="space-y-0.5">
                {NAV.map((item) => (
                  <li key={item.to}>
                    <SideLink item={item} onNavigate={() => setSheetOpen(false)} />
                  </li>
                ))}
              </ul>
            </nav>
            <SidebarFoot
              onReportBug={() => {
                // Close the sheet on the way out, so the dialog is not a
                // second layer stacked on the drawer's own.
                setSheetOpen(false);
                setBugOpen(true);
              }}
            />
          </SheetContent>
        </Sheet>
      </div>

      {/* ---------- Content ---------- */}
      <main id="main" className="min-w-0 flex-1 pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* ---------- Mobile tab bar ----------
          grid-cols-4 is load-bearing and matches PRIMARY exactly. A fifth
          primary nav item does not overflow this bar, it WRAPS to a second row
          — and <main>'s pb-20 is sized for one 56px row, so the extra row would
          silently sit on top of the bottom of every screen. If a fifth is ever
          needed, drive the column count from PRIMARY.length through a CSS
          variable rather than interpolating the class name, which Tailwind
          cannot see and will not emit. */}
      <nav
        className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 grid grid-cols-4 border-t backdrop-blur md:hidden"
        aria-label="Primary"
      >
        {PRIMARY.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === APP_ROOT}
            className={({ isActive }) =>
              cn(
                // 44px minimum touch target — pit day, cold hands, gloves.
                'focus-visible:ring-ring relative flex min-h-14 flex-col items-center justify-center gap-1 text-[11px] focus-visible:ring-2 focus-visible:outline-none',
                isActive ? 'text-foreground' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive && (
                  <span
                    className="u-bar absolute inset-x-3 top-0 h-[3px]"
                    aria-hidden
                  />
                )}
                <Icon className="size-5" aria-hidden />
                {label}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Rendered outside both the sidebar and the sheet — see the note on
          bugOpen above. Nothing about it is a floating action button: the tab
          bar above owns the bottom of a phone screen. */}
      <ReportBugDialog open={bugOpen} onOpenChange={setBugOpen} />
    </div>
  );
}

/**
 * Team identity. The number is set in mono and given more weight than the
 * name on purpose — in FTC the number IS the identity. Teams are announced,
 * queued, and scouted by number; the name is the nickname.
 */
function TeamMark({ team }: { team: Session['team'] }) {
  return (
    <div className="border-ink-border flex items-center gap-3 border-b px-4 py-4">
      {/* Slot for the team's own logo, which teams put on everything —
          shirts, pit banner, the robot. There is no column for it yet
          (COG-0xx, Settings), so it holds a brand bar at the right size
          rather than a broken image or a grey void. */}
      <span
        className="bg-ink-foreground/10 flex size-9 shrink-0 items-center justify-center rounded-md"
        title="Team logo — set in Settings"
        aria-hidden
      >
        <span className="u-bar-ink h-4 w-[3px]" />
      </span>
      <div className="min-w-0">
        <div className="tabular font-mono text-lg leading-none font-bold">
          {team.team_number}
        </div>
        <div className="text-ink-muted mt-1 truncate text-xs">{team.name}</div>
      </div>
    </div>
  );
}

/**
 * Product mark and theme control, pinned to the bottom of the slab.
 *
 * The mark is a mask tinted by the palette (`.cog-mark` in index.css), so it
 * stays correct if the slab or the brand colour is ever retuned — no second
 * asset, and no filter trickery to get dark artwork onto a dark surface.
 *
 * The bug button lives here rather than in a floating action button because
 * this component is rendered on BOTH surfaces — desktop sidebar and mobile
 * sheet — so one row covers both. A FAB would have to clear the tab bar, whose
 * grid-cols-4 and <main>'s pb-20 are already load-bearing (see above).
 */
function SidebarFoot({ onReportBug }: { onReportBug: () => void }) {
  const { member } = useSession();
  const { refresh } = useSessionState();

  async function signOut() {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'same-origin',
    });
    await refresh();
  }

  return (
    <>
      {/* Full-width row, not a small text button: this is the target a cold
          thumb finds in a pit, and min-h-11 is the 44px rule this file already
          applies to the tab bar. */}
      <button
        type="button"
        onClick={onReportBug}
        className="border-ink-border text-ink-subtle hover:bg-ink-foreground/6 hover:text-ink-foreground focus-visible:ring-ring flex min-h-11 w-full items-center gap-2 border-t px-3 py-2.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        <Bug className="size-3.5 shrink-0" aria-hidden />
        Report a bug
      </button>

      <div className="border-ink-border flex items-center justify-between gap-2 border-t px-3 py-2.5">
        <span className="text-ink-muted min-w-0 truncate text-xs">
          {member.display_name}
        </span>
        <button
          type="button"
          onClick={() => void signOut()}
          className="text-ink-subtle hover:text-ink-foreground focus-visible:ring-ring shrink-0 rounded px-1.5 py-1 text-xs focus-visible:ring-2 focus-visible:outline-none"
        >
          Sign out
        </button>
      </div>
      <div className="border-ink-border flex items-center justify-between border-t px-3 py-3">
        <span
          role="img"
          aria-label="Coglin"
          className="cog-mark block h-11"
        />
        <ThemeToggle />
      </div>
    </>
  );
}

function SideLink({
  item,
  onNavigate,
}: {
  item: (typeof NAV)[number];
  onNavigate?: () => void;
}) {
  const { to, label, icon: Icon, stub } = item;
  return (
    <NavLink
      to={to}
      end={to === APP_ROOT}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'focus-visible:ring-ring relative flex min-h-11 items-center gap-3 rounded-md pr-3 pl-4 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none',
          isActive
            ? 'bg-ink-foreground/10 text-ink-foreground font-medium'
            : 'text-ink-muted hover:bg-ink-foreground/6 hover:text-ink-foreground',
        )
      }
    >
      {({ isActive }) => (
        <>
          {/* A brand bar marks the active row — solid, not a hairline. */}
          {isActive && (
            <span
              className="u-bar-ink absolute top-1.5 bottom-1.5 left-0 w-1"
              aria-hidden
            />
          )}
          <Icon className="size-4 shrink-0" aria-hidden />
          <span className="truncate">{label}</span>
          {stub && (
            <span className="u-eyebrow text-ink-subtle ml-auto text-[10px] normal-case">
              soon
            </span>
          )}
        </>
      )}
    </NavLink>
  );
}

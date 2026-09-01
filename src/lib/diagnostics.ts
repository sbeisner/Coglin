/**
 * What a bug report carries besides what the reporter typed.
 *
 * Everything here is a fact about the browser session — where they were, what
 * they were running it on. Nothing here reads the page: no screenshot, no DOM,
 * no field values, no session data beyond what the server already knows from
 * the cookie. That boundary is the reason ReportBugDialog can show the reporter
 * the complete list before they send, and the reason the list has to stay short
 * enough to actually read. See migrations/0008_bug_reports.sql.
 *
 * No module-level `window` access: this module ends up in the prerender graph
 * via App.tsx -> AppShell.tsx -> ReportBugDialog.
 */
import { BUILD_ID } from '@/lib/build';
import { storedTheme } from '@/lib/theme';

export interface Diagnostics {
  route: string;
  app_build: string;
  user_agent: string;
  viewport_w: number;
  viewport_h: number;
  dpr: number;
  timezone: string;
  language: string;
  theme: string;
  online: boolean;
}

/**
 * Read at the moment the dialog opens, so what the reporter is shown is exactly
 * what gets sent. Keys match `api.submitBugReport`'s input on purpose — the
 * dialog spreads this object straight into the call.
 */
export function collectDiagnostics(route: string): Diagnostics {
  return {
    route,
    app_build: BUILD_ID,
    user_agent: navigator.userAgent,
    viewport_w: window.innerWidth,
    viewport_h: window.innerHeight,
    // Two decimals: enough to tell a 2x phone from a 2.75x one, not enough to
    // be another way of fingerprinting a device.
    dpr: Math.round(window.devicePixelRatio * 100) / 100,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    language: navigator.language,
    theme: storedTheme(),
    online: navigator.onLine,
  };
}

/** Label/value pairs for the disclosure in the dialog, in send order. */
export function diagnosticLines(d: Diagnostics): [label: string, value: string][] {
  return [
    ['Screen', d.route],
    ['Build', d.app_build],
    ['Window', `${d.viewport_w}×${d.viewport_h} @${d.dpr}x`],
    ['Browser', d.user_agent],
    ['Time zone', d.timezone],
    ['Theme', d.theme],
  ];
}

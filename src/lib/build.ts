/**
 * Which build is running in the browser, for bug reports.
 *
 * Replaced at build time by a `define` in BOTH vite.config.ts and
 * vite.ssr.config.ts. The `typeof` guard is not belt-and-braces — `typeof` on
 * an undeclared identifier is the one form that does not throw, so a missed
 * define degrades to a wrong label rather than a white screen. In `vite dev`
 * the define is present too, so this reads the working tree's sha.
 */
declare const __BUILD_ID__: string;

export const BUILD_ID: string =
  typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

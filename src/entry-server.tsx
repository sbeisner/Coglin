/**
 * Server entry, used only by scripts/prerender.mjs at build time.
 *
 * There is no runtime SSR: the Worker serves static files. This exists so the
 * marketing pages can be rendered once, at build, into real HTML — a crawler
 * and, more importantly, every link-preview scraper (Slack, Discord, iMessage,
 * LinkedIn) sees content instead of an empty <div id="root">. None of those run
 * JavaScript.
 *
 * Renders the same <App /> the browser mounts. StaticRouter supplies the
 * location that BrowserRouter normally reads from window.
 */
import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router';
import { App } from '@/App';

/**
 * Re-exported so scripts/prerender.mjs gets the route list from the same bundle
 * it renders with. Node cannot import a .ts file directly, and a second copy of
 * this list in the script would drift the day a page is added.
 */
export { PAGES, ORIGIN, SITE_NAME } from '@/marketing/seo';

export function render(url: string): string {
  return renderToString(
    <StrictMode>
      <StaticRouter location={url}>
        <App />
      </StaticRouter>
    </StrictMode>,
  );
}

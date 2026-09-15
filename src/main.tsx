import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { App } from '@/App';
import { PRERENDER } from '@/marketing/seo';

// The theme is applied pre-paint by the inline script in index.html, so there
// is deliberately nothing to do here.

const container = document.getElementById('root')!;
const tree = (
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

/**
 * Hydrate only where the markup we were served is markup for THIS route.
 *
 * The marketing routes and the two shell pages are prerendered to static HTML,
 * so crawlers and link previews get real content and a sign-in form paints
 * immediately; the app routes under /app and /invite/:token are not.
 *
 * The test used to be `container.firstElementChild`, which is wrong in a way
 * that is invisible locally: Cloudflare's `not_found_handling:
 * "single-page-application"` answers every unprerendered path with
 * dist/client/index.html — the prerendered LANDING page — so the container is
 * never empty and every such route hydrated against markup for a route the
 * router was not on. React mismatched the whole root, logged an error, threw the
 * markup away and client-rendered anyway — after the landing page had already
 * painted. That flash, followed by a blank frame, was most of what "clicking
 * login doesn't work" looked like.
 *
 * So: consult the same list the prerenderer walked. Clearing the container first
 * is the same outcome React would reach on its own, arrived at deliberately and
 * without the error.
 */
const path = window.location.pathname.replace(/(.)\/$/, '$1');
if (PRERENDER.some((page) => page.path === path)) {
  hydrateRoot(container, tree);
} else {
  container.replaceChildren();
  createRoot(container).render(tree);
}

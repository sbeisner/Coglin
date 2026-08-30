import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import { App } from '@/App';

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
 * Hydrate when the server sent markup, mount fresh when it did not.
 *
 * The marketing routes are prerendered to static HTML so crawlers and link
 * previews get real content; the app routes under /app are not, and arrive as
 * an empty shell. createRoot on prerendered markup would throw it away and
 * repaint, which is both slower and a visible flash on exactly the pages we
 * bothered to prerender.
 */
if (container.firstElementChild) {
  hydrateRoot(container, tree);
} else {
  createRoot(container).render(tree);
}

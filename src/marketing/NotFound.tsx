/**
 * Marketing 404.
 *
 * Reached only after the app routes and the legacy redirects in main.tsx have
 * both had their chance, so a stale bookmark from before the app moved under
 * /app never lands here.
 */
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Wrap } from './parts';

export default function NotFound() {
  return (
    <Wrap className="py-20">
      <div className="u-eyebrow">404</div>
      <h1 className="u-display mt-3 text-3xl leading-tight">
        Coglin has nothing at this address.
      </h1>
      <p className="text-muted-foreground mt-4 max-w-xl leading-relaxed">
        The link may be old, or we may have moved the page. The app now lives under{' '}
        <code className="font-mono text-sm">/app</code>.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Button asChild>
          <Link to="/">Back to the start</Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/app">Open Coglin</Link>
        </Button>
      </div>
    </Wrap>
  );
}

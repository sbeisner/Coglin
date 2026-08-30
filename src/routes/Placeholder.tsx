import { useLocation } from 'react-router';
import { NAV } from '@/lib/nav';
import { PageHeader } from '@/components/PageHeader';

/**
 * Routed-but-unbuilt sections. These exist so the whole information
 * architecture is visible and clickable while the alpha screens are the only
 * real ones — most of what makes a skeleton judgeable is being able to walk it.
 */
const NOTES: Record<string, string> = {
  '/app/awards':
    'Per-award criteria checklists from the Competition Manual §6, each item linked to evidence, with the Inspire triad view.',
  '/app/budget':
    'Income and expense lines, sponsor tiers and thank-you status — the progress tracking Sustain requires.',
};

export default function Placeholder() {
  const { pathname } = useLocation();
  const item = NAV.find((n) => n.to === pathname);

  return (
    <>
      <PageHeader eyebrow="Not built yet" title={item?.label ?? 'Coming soon'} />
      <div className="px-4 py-6 md:px-8">
        <div className="border-border max-w-xl rounded-lg border border-dashed px-5 py-8">
          <p className="text-sm">{NOTES[pathname] ?? 'Planned for a later phase.'}</p>
          <p className="text-muted-foreground mt-3 text-sm">
            The navigation is here so the shape of the season is visible from
            day one. This screen arrives with its phase.
          </p>
        </div>
      </div>
    </>
  );
}

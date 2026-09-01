/**
 * A screenshot of the real app, framed.
 *
 * Deliberately plain: a bordered card matching every other surface on the site,
 * no faux browser chrome and no perspective tilt. The rest of these pages spend
 * their time being careful about what is and is not built, and dressing the
 * evidence up would undercut that.
 *
 * `loading="lazy"` on everything below the first one, and explicit intrinsic
 * dimensions on all of them, because seven 2x PNGs arriving without reserved
 * boxes would shift the text under the reader as they land.
 */
import { SCREENS } from './screens';

export function Screenshot({
  name,
  priority = false,
  className,
}: {
  name: keyof typeof SCREENS | string;
  /** Set on the one above the fold, so it is not lazily loaded. */
  priority?: boolean;
  className?: string;
}) {
  const shot = SCREENS[name];
  if (!shot) return null;

  return (
    <figure className={className}>
      <div className="border-border bg-card overflow-hidden rounded-lg border">
        <img
          src={shot.src}
          alt={shot.alt}
          width={shot.w}
          height={shot.h}
          loading={priority ? 'eager' : 'lazy'}
          decoding="async"
          className="block h-auto w-full"
        />
      </div>
      <figcaption className="text-muted-foreground mt-2 text-xs leading-relaxed">
        {shot.caption}
      </figcaption>
    </figure>
  );
}

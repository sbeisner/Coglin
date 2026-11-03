import type { LiveStatus, Peer } from '@/lib/useLiveDoc';

/**
 * SaveIndicator's counterpart for a live page (COG-051): one quiet line saying
 * whether edits are reaching teammates, plus who else is here.
 *
 * There is no "Saving…" and no "Saved at": on a live page every keystroke goes
 * out as it is typed, and a timestamp ticking forward would be noise. What a
 * student needs to know is the one thing that can actually go wrong, which is
 * the connection, so that is the only state that raises its voice.
 */
export function LiveIndicator({
  status,
  peers,
}: {
  status: LiveStatus;
  peers: Peer[];
}) {
  if (status === 'offline') {
    return (
      <p
        role="alert"
        className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
      >
        Offline. Keep typing — your changes are kept on this device and sync
        when you reconnect.
      </p>
    );
  }

  if (status === 'unavailable') {
    return (
      <p
        role="alert"
        className="border-destructive/40 bg-destructive/10 text-destructive rounded-md border px-3 py-2 text-sm"
      >
        This page cannot be edited right now. It is shown read-only; reload to
        try again.
      </p>
    );
  }

  return (
    <div
      aria-live="polite"
      className="text-muted-foreground flex min-h-6 flex-wrap items-center gap-2 text-xs"
    >
      <span>{status === 'connecting' ? 'Connecting…' : 'Live'}</span>
      {status === 'live' && peers.length > 0 && (
        <>
          <span aria-hidden>·</span>
          <ul className="flex items-center gap-1" aria-label="Also editing">
            {peers.map((peer) => (
              <li
                key={peer.memberId}
                title={peer.name}
                className="flex h-6 items-center rounded-full px-2 text-[0.6875rem] font-medium text-white"
                style={{ backgroundColor: peer.color }}
              >
                {peer.name}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import type YProvider from 'y-partyserver/provider';
import type * as Y from 'yjs';

/**
 * The live write path for a note document (COG-051), and the counterpart of
 * useDocSync for teams whose notes are edited together.
 *
 * There is no save queue here, no rev and no conflict, because there is nothing
 * to conflict with: every keystroke is a Yjs update that merges with everyone
 * else's, and the server's NoteRoom (worker/noteRoom.ts) folds the result back
 * into D1. What is left for the browser is three jobs:
 *
 *   1. Hold the socket open, and say honestly when it is not.
 *   2. Tell everyone else who is here and where their caret is (awareness).
 *   3. Keep an offline copy, so notes typed on dead wifi survive a closed tab.
 *
 * THE Y.DOC ALWAYS STARTS EMPTY. The document arrives from the room. Loading
 * the fetched body into it locally is the classic way to make every paragraph
 * appear twice, which is why `ready` gates the editor until the first sync.
 *
 * THE OFFLINE COPY IS KEYED BY THE ROOM'S SEED, and only attached after that
 * first sync, because the seed is inside the synced document. If the room's
 * storage were ever lost and reseeded, its new seed means an old offline copy is
 * never opened, rather than merged in as a second set of the same paragraphs.
 * The cost: a page opened while offline cannot use its offline copy, which
 * matches the REST path, where the page could not open offline at all.
 */

export type LiveStatus =
  /** First connection, nothing synced yet. */
  | 'connecting'
  /** Synced and connected. Edits reach teammates as they are typed. */
  | 'live'
  /** Was connected, isn't now. Edits are kept and sync on reconnect. */
  | 'offline'
  /** The room refused us (it could not load this page). Read-only fallback. */
  | 'unavailable';

export interface Peer {
  clientId: number;
  memberId: string;
  name: string;
  color: string;
}

export interface LiveUser {
  memberId: string;
  name: string;
  color: string;
}

export function useLiveDoc(docId: string, enabled: boolean, user: LiveUser) {
  const [session, setSession] = useState<{
    doc: Y.Doc;
    provider: YProvider;
  } | null>(null);
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const [ready, setReady] = useState(false);
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;

    setStatus('connecting');
    setReady(false);
    setPeers([]);

    // Loaded here, not imported at the top: see the header of liveConnection.ts.
    void import('@/lib/liveConnection').then(({ openLiveDoc }) => {
      if (cancelled) return;
      const live = openLiveDoc(docId, user, {
        synced: () => {
          setReady(true);
          setStatus('live');
        },
        disconnected: () =>
          setStatus((current) =>
            current === 'unavailable' || current === 'connecting'
              ? current
              : 'offline',
          ),
        unavailable: () => setStatus('unavailable'),
        peers: setPeers,
      });
      dispose = live.dispose;
      setSession({ doc: live.doc, provider: live.provider });
    });

    return () => {
      cancelled = true;
      dispose?.();
      setSession(null);
    };
    // `user` is read once per connection: a name change mid-session is not worth
    // tearing the socket down for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docId, enabled]);

  return { session, status, ready, peers };
}

/**
 * A caret colour per member, stable across sessions and devices.
 *
 * Mid-saturation on purpose: the same hue has to read as a thin caret and as a
 * label background in both themes, and the label text is always white.
 */
const CARET_COLORS = [
  '#c2410c',
  '#0f766e',
  '#7c3aed',
  '#b91c1c',
  '#1d4ed8',
  '#a16207',
  '#be185d',
  '#15803d',
];

export function caretColor(memberId: string): string {
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash * 31 + memberId.charCodeAt(i)) | 0;
  }
  return CARET_COLORS[Math.abs(hash) % CARET_COLORS.length];
}

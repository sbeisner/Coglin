import * as encoding from 'lib0/encoding';
import { IndexeddbPersistence } from 'y-indexeddb';
import YProvider from 'y-partyserver/provider';
import { encodeAwarenessUpdate } from 'y-protocols/awareness';
import * as Y from 'yjs';
import type { LiveUser, Peer } from '@/lib/useLiveDoc';

/**
 * The connection half of useLiveDoc, in its own module so it loads on demand.
 * Yjs, the provider and y-indexeddb are ~34KB gzipped, and every screen but a
 * live note page would otherwise pay for them on first load. The editor chunk
 * imports the same Yjs, so Vite shares one copy between the two — which
 * matters, because two copies of Yjs break its constructor checks.
 */

/** Must match the room's ROOM_MAP in worker/noteRoom.ts. */
const ROOM_MAP = 'room';

export interface LiveCallbacks {
  synced: () => void;
  disconnected: () => void;
  unavailable: () => void;
  peers: (peers: Peer[]) => void;
}

export function openLiveDoc(docId: string, user: LiveUser, on: LiveCallbacks) {
  const doc = new Y.Doc();
  const provider = new YProvider(window.location.host, docId, doc, {
    prefix: `/api/notes/${docId}/live`,
    protocol: window.location.protocol === 'https:' ? 'wss' : 'ws',
  });
  let offline: IndexeddbPersistence | null = null;
  let disposed = false;

  /**
   * Answer the room's "who is here?" with OUR presence only.
   *
   * The room asks after it wakes from hibernation, having lost presence from
   * memory. The stock handler answers with every state this browser knows,
   * which makes the room think this socket owns teammates' presence too — and
   * when this tab closes, it would remove them for everyone.
   */
  provider.messageHandlers[3] = (encoder) => {
    encoding.writeVarUint(encoder, 1);
    encoding.writeVarUint8Array(
      encoder,
      encodeAwarenessUpdate(provider.awareness, [doc.clientID]),
    );
  };

  const onSync = (synced: boolean) => {
    if (!synced || disposed) return;
    on.synced();
    if (offline) return;
    const seed = doc.getMap<string>(ROOM_MAP).get('seed');
    if (seed) offline = new IndexeddbPersistence(`coglin:live-note:${docId}:${seed}`, doc);
  };

  const onStatus = ({ status: next }: { status: string }) => {
    if (disposed) return;
    if (next === 'connected') {
      // 'live' is set by the sync that follows, not here: connected but not yet
      // synced still means teammates' newest edits are not on screen.
      return;
    }
    if (next === 'disconnected') {
      on.disconnected();
    }
  };

  const onClose = (event: CloseEvent | null) => {
    // 1011 is the room saying it cannot load this page, and retrying will not
    // change that. Everything else is the network and is worth retrying.
    if (event?.code === 1011) {
      provider.shouldConnect = false;
      on.unavailable();
    }
  };

  const onAwareness = () => {
    const seen = new Map<string, Peer>();
    provider.awareness.getStates().forEach((state, clientId) => {
      if (clientId === doc.clientID) return;
      const peer = state.user as Omit<Peer, 'clientId'> | undefined;
      if (!peer?.memberId || peer.memberId === user.memberId) return;
      // One chip per person, however many tabs they have open.
      if (!seen.has(peer.memberId)) seen.set(peer.memberId, { ...peer, clientId });
    });
    on.peers([...seen.values()]);
  };

  provider.on('sync', onSync);
  provider.on('status', onStatus);
  provider.on('connection-close', onClose);
  provider.awareness.on('change', onAwareness);
  provider.awareness.setLocalStateField('user', {
    memberId: user.memberId,
    name: user.name,
    color: user.color,
  });

  const dispose = (): void => {
    disposed = true;
    provider.awareness.off('change', onAwareness);
    provider.off('sync', onSync);
    provider.off('status', onStatus);
    provider.off('connection-close', onClose);
    void offline?.destroy();
    provider.destroy();
    doc.destroy();
  };

  return { doc, provider, dispose };
}

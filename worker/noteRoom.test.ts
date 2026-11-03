import {
  createExecutionContext,
  env,
  evictDurableObject,
  runDurableObjectAlarm,
  runInDurableObject,
} from 'cloudflare:test';
import { Node as PMNode } from '@tiptap/pm/model';
import {
  updateYFragment,
  yXmlFragmentToProsemirrorJSON,
} from '@tiptap/y-tiptap';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { beforeAll, describe, expect, it } from 'vitest';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { docSchema } from '../shared/docSchema';
import worker from './index';
import { FRAGMENT, ROOM_MAP, roomName, type NoteRoom } from './noteRoom';
import {
  ORIGIN,
  call,
  callJson,
  inviteAndAccept,
  signUpCoach,
  stubResend,
  whoami,
} from './routes/_helpers';

beforeAll(() => {
  stubResend();
});

const LIVE = { LIVE_NOTES_TEAMS: '*' };

interface Doc {
  id: string;
  content: string;
  content_text: string;
  rev: number;
  updated_by: string | null;
  live?: boolean;
}

const paragraph = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const body = (...texts: string[]) =>
  JSON.stringify({ type: 'doc', content: texts.map(paragraph) });

async function makeDoc(cookie: string, content?: string): Promise<Doc> {
  const created = await callJson<{ doc: Doc }>('/api/notes', {
    method: 'POST',
    cookie,
    body: JSON.stringify({ title: 'Drivetrain' }),
  });
  expect(created.status).toBe(201);
  if (content === undefined) return created.body.doc;
  // Written through the REST path, i.e. before the team went live.
  const put = await callJson<{ doc: Doc }>(
    `/api/notes/${created.body.doc.id}/content`,
    { method: 'PUT', cookie, body: JSON.stringify({ content }) },
  );
  expect(put.status).toBe(200);
  return put.body.doc;
}

async function readDoc(cookie: string, docId: string): Promise<Doc> {
  const { body: result } = await callJson<{ doc: Doc }>(`/api/notes/${docId}`, {
    cookie,
    env: LIVE,
  });
  return result.doc;
}

/**
 * A minimal y-websocket client: enough of the sync protocol to hold a Y.Doc in
 * step with a room. Awareness messages are ignored.
 */
class Client {
  doc = new Y.Doc();
  synced: Promise<void>;
  closed: Promise<{ code: number; reason: string }>;
  private markSynced!: () => void;

  constructor(private ws: WebSocket) {
    this.synced = new Promise((resolve) => (this.markSynced = resolve));
    this.closed = new Promise((resolve) =>
      ws.addEventListener('close', (event) =>
        resolve({ code: event.code, reason: event.reason }),
      ),
    );
    ws.accept();
    // The test runtime hands binary frames over as Blobs, so reading is async;
    // the chain keeps messages applied in the order they arrived.
    let queue = Promise.resolve();
    ws.addEventListener('message', (event) => {
      if (typeof event.data === 'string') return;
      const data = event.data as ArrayBuffer | Blob;
      queue = queue.then(async () => {
        const bytes =
          data instanceof Blob ? await data.arrayBuffer() : data;
        this.receive(new Uint8Array(bytes));
      });
    });
    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin === this) return;
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, 0);
      syncProtocol.writeUpdate(encoder, update);
      ws.send(encoding.toUint8Array(encoder));
    });
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    ws.send(encoding.toUint8Array(encoder));
  }

  /** Every top-level message type received, in order. */
  received: number[] = [];

  private receive(message: Uint8Array): void {
    const decoder = decoding.createDecoder(message);
    const kind = decoding.readVarUint(decoder);
    this.received.push(kind);
    if (kind !== 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, 0);
    const type = syncProtocol.readSyncMessage(decoder, encoder, this.doc, this);
    if (encoding.length(encoder) > 1) this.ws.send(encoding.toUint8Array(encoder));
    if (type === syncProtocol.messageYjsSyncStep2) this.markSynced();
  }

  json(): { type: string; content?: unknown[] } {
    return yXmlFragmentToProsemirrorJSON(this.doc.getXmlFragment(FRAGMENT)) as {
      type: string;
      content?: unknown[];
    };
  }

  text(): string[] {
    return (this.json().content ?? []).map((node) =>
      JSON.stringify(node).replace(/.*"text":"([^"]*)".*/, '$1'),
    );
  }

  /** Make the document read `content`, the way the editor's binding would. */
  setContent(content: string): void {
    const pmDoc = PMNode.fromJSON(docSchema(), JSON.parse(content));
    this.doc.transact(() => {
      updateYFragment(this.doc, this.doc.getXmlFragment(FRAGMENT), pmDoc, {
        mapping: new Map(),
        isOMark: new Map(),
      });
    });
  }

  close(): void {
    this.ws.close(1000, 'done');
  }
}

async function connect(cookie: string, docId: string): Promise<Client> {
  const response = await call(`/api/notes/${docId}/live`, {
    cookie,
    env: LIVE,
    headers: { Upgrade: 'websocket' },
  });
  expect(response.status).toBe(101);
  const client = new Client(response.webSocket!);
  await client.synced;
  return client;
}

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function roomStub(teamId: string, docId: string) {
  return env.NOTE_ROOMS.get(env.NOTE_ROOMS.idFromName(roomName(teamId, docId)));
}

describe('live note rooms', () => {
  it('answers the live flag on a document read', async () => {
    const cookie = await signUpCoach(7100);
    const doc = await makeDoc(cookie);
    expect((await readDoc(cookie, doc.id)).live).toBe(true);
    const off = await callJson<{ doc: Doc }>(`/api/notes/${doc.id}`, { cookie });
    expect(off.body.doc.live).toBe(false);
  });

  it('turns away everything that is not a same-origin socket for a live team', async () => {
    const cookie = await signUpCoach(7101);
    const doc = await makeDoc(cookie);
    const path = `/api/notes/${doc.id}/live`;
    const upgrade = { Upgrade: 'websocket' };

    expect((await call(path, { cookie, env: LIVE })).status).toBe(426);
    expect((await call(path, { cookie, headers: upgrade })).status).toBe(404);
    expect((await call(path, { headers: upgrade, env: LIVE })).status).toBe(401);

    // call() always stamps our own Origin, so the cross-site one goes in raw.
    const request = new Request(`${ORIGIN}${path}`, {
      headers: { ...upgrade, Cookie: cookie, Origin: 'https://evil.example' },
    });
    const response = await worker.fetch(
      request,
      { ...env, ...LIVE },
      createExecutionContext(),
    );
    expect(response.status).toBe(403);
  });

  it('refuses a document from another team', async () => {
    const mine = await signUpCoach(7102);
    const theirs = await signUpCoach(7103);
    const doc = await makeDoc(theirs, body('their secret plan'));
    const response = await call(`/api/notes/${doc.id}/live`, {
      cookie: mine,
      env: LIVE,
      headers: { Upgrade: 'websocket' },
    });
    expect(response.status).toBe(404);
  });

  it('seeds the room from D1 exactly once, whoever connects first', async () => {
    const cookie = await signUpCoach(7104);
    const doc = await makeDoc(cookie, body('Gear ratio 20:1', 'Swap to mecanum'));

    const a = await connect(cookie, doc.id);
    const b = await connect(cookie, doc.id);
    expect(a.text()).toEqual(['Gear ratio 20:1', 'Swap to mecanum']);
    expect(b.text()).toEqual(['Gear ratio 20:1', 'Swap to mecanum']);
    expect(a.doc.getMap(ROOM_MAP).get('seed')).toBeTypeOf('string');
    a.close();
    b.close();
  });

  it('keeps every node type the editor can produce through seeding', async () => {
    const cookie = await signUpCoach(7105);
    const rich = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Build' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            {
              type: 'text',
              text: 'a link',
              marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
            },
          ],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: true },
              content: [paragraph('Order servos')],
            },
          ],
        },
        { type: 'mediaImage', attrs: { mediaId: 'img-1', width: 400, height: 300, alt: 'arm' } },
        { type: 'mediaFile', attrs: { mediaId: 'file-1', filename: 'arm_v3.step', size: 2048 } },
      ],
    };
    const doc = await makeDoc(cookie, JSON.stringify(rich));
    const client = await connect(cookie, doc.id);
    const seeded = JSON.stringify(client.json());
    for (const fragment of [
      '"level":2',
      '"type":"bold"',
      '"href":"https://example.com"',
      '"checked":true',
      '"mediaId":"img-1"',
      '"filename":"arm_v3.step"',
    ]) {
      expect(seeded).toContain(fragment);
    }
    client.close();
  });

  it('carries one student\'s typing to another', async () => {
    const cookie = await signUpCoach(7106);
    const student = await inviteAndAccept(cookie, { role: 'student', handle: 'ada7106' });
    const doc = await makeDoc(cookie, body('Agenda'));

    const coach = await connect(cookie, doc.id);
    const ada = await connect(student.cookie, doc.id);
    ada.setContent(body('Agenda', 'Ada was here'));
    await until(() => coach.text().length === 2);
    expect(coach.text()).toEqual(['Agenda', 'Ada was here']);
    coach.close();
    ada.close();
  });

  it('ignores edits from a viewer', async () => {
    const cookie = await signUpCoach(7107);
    const parent = await inviteAndAccept(cookie, { role: 'viewer', handle: 'pat7107' });
    const doc = await makeDoc(cookie, body('Read only, please'));

    const coach = await connect(cookie, doc.id);
    const viewer = await connect(parent.cookie, doc.id);
    expect(viewer.text()).toEqual(['Read only, please']);
    viewer.setContent(body('Defaced'));
    coach.setContent(body('Read only, please', 'Coach edit'));
    await until(() => coach.text().length === 2);
    await until(() => viewer.text().includes('Coach edit'));
    expect(coach.text()).toEqual(['Read only, please', 'Coach edit']);
    coach.close();
    viewer.close();
  });

  it('writes back to D1 on the alarm, credited to the last editor', async () => {
    const cookie = await signUpCoach(7108);
    const student = await inviteAndAccept(cookie, { role: 'student', handle: 'bo7108' });
    const { team_id: teamId } = await whoami(cookie);
    const { member_id: studentId } = await whoami(student.cookie);
    const doc = await makeDoc(cookie, body('Before'));

    const client = await connect(student.cookie, doc.id);
    client.setContent(body('Before', 'After'));

    const stub = roomStub(teamId, doc.id);
    await runInDurableObject(stub, async () => {}); // let the update land
    expect(await runDurableObjectAlarm(stub)).toBe(true);

    const saved = await readDoc(cookie, doc.id);
    expect(saved.content_text).toBe('Before After');
    expect(saved.rev).toBe(doc.rev + 1);
    expect(saved.updated_by).toBe(studentId);

    // Nothing changed since, so a second alarm (if any) writes nothing.
    await runDurableObjectAlarm(stub);
    expect((await readDoc(cookie, doc.id)).rev).toBe(saved.rev);
    client.close();
  });

  it('survives eviction: the next connection gets the edits back from storage', async () => {
    const cookie = await signUpCoach(7109);
    const { team_id: teamId } = await whoami(cookie);
    const doc = await makeDoc(cookie, body('One'));

    const first = await connect(cookie, doc.id);
    first.setContent(body('One', 'Two'));
    const stub = roomStub(teamId, doc.id);
    await runInDurableObject(stub, async () => {});
    first.close();
    // No alarm has run, so D1 still says "One". Only the room's storage has "Two".
    await evictDurableObject(stub, { webSockets: 'close' });

    const second = await connect(cookie, doc.id);
    expect(second.text()).toEqual(['One', 'Two']);
    second.close();
  });

  it('asks surviving sockets who is here after waking from hibernation', async () => {
    const cookie = await signUpCoach(7114);
    const { team_id: teamId } = await whoami(cookie);
    const doc = await makeDoc(cookie, body('Presence'));

    const stayed = await connect(cookie, doc.id);
    const stub = roomStub(teamId, doc.id);
    // Hibernate, not close: the socket survives, the room's memory does not.
    await evictDurableObject(stub);
    const joined = await connect(cookie, doc.id);

    await until(() => stayed.received.includes(3));
    expect(joined.received).not.toContain(3);
    stayed.close();
    joined.close();
  });

  it('applies a D1 change made behind its back as an edit, not a second copy', async () => {
    const cookie = await signUpCoach(7110);
    const { team_id: teamId } = await whoami(cookie);
    const doc = await makeDoc(cookie, body('Original'));

    const client = await connect(cookie, doc.id);
    client.close();

    // As if a REST save landed while the team was briefly not live.
    await env.DB.prepare(
      'UPDATE note_docs SET content = ?, rev = rev + 1 WHERE id = ?',
    )
      .bind(body('Original', 'Added over REST'), doc.id)
      .run();
    const stub = roomStub(teamId, doc.id);
    await evictDurableObject(stub, { webSockets: 'close' });

    const again = await connect(cookie, doc.id);
    expect(again.text()).toEqual(['Original', 'Added over REST']);
    again.close();
  });

  it('refuses a REST content save once the team is live', async () => {
    const cookie = await signUpCoach(7111);
    const doc = await makeDoc(cookie);
    const response = await callJson<{ error: string }>(
      `/api/notes/${doc.id}/content`,
      { method: 'PUT', cookie, env: LIVE, body: JSON.stringify({ content: body('x') }) },
    );
    expect(response.status).toBe(409);
    expect(response.body.error).toBe('live_doc');
  });

  it('does not resurrect a deleted page from a straggling alarm', async () => {
    const cookie = await signUpCoach(7112);
    const { team_id: teamId } = await whoami(cookie);
    const doc = await makeDoc(cookie, body('Doomed'));
    const client = await connect(cookie, doc.id);
    client.setContent(body('Doomed', 'edit'));
    const stub = roomStub(teamId, doc.id);
    await runInDurableObject(stub, async () => {});

    const deleted = await call(`/api/notes/${doc.id}`, { method: 'DELETE', cookie });
    expect(deleted.status).toBe(200);
    await runDurableObjectAlarm(stub);

    const row = await env.DB.prepare('SELECT content, deleted_at FROM note_docs WHERE id = ?')
      .bind(doc.id)
      .first<{ content: string; deleted_at: number | null }>();
    expect(row?.deleted_at).not.toBeNull();
    expect(row?.content).toBe(body('Doomed'));
    client.close();
  });

  it('refuses connections when D1 holds a body the schema cannot load', async () => {
    const cookie = await signUpCoach(7113);
    const doc = await makeDoc(cookie, body('fine'));
    await env.DB.prepare('UPDATE note_docs SET content = ?, rev = rev + 1 WHERE id = ?')
      .bind(JSON.stringify({ type: 'doc', content: [{ type: 'mystery' }] }), doc.id)
      .run();

    const response = await call(`/api/notes/${doc.id}/live`, {
      cookie,
      env: LIVE,
      headers: { Upgrade: 'websocket' },
    });
    const client = new Client(response.webSocket!);
    const closed = await client.closed;
    expect(closed.code).toBe(1011);

    const { team_id: teamId } = await whoami(cookie);
    const stub = roomStub(teamId, doc.id);
    await runInDurableObject(stub, (room: NoteRoom) => room.saveToD1());
    const row = await env.DB.prepare('SELECT content FROM note_docs WHERE id = ?')
      .bind(doc.id)
      .first<{ content: string }>();
    expect(row?.content).toContain('mystery');
  });
});

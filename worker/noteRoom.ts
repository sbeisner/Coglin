/**
 * A live note document: one Durable Object per page, holding the Yjs copy that
 * everybody editing it is connected to (COG-051).
 *
 * WHO OWNS WHAT. D1's note_docs.content stays the canonical body. Search reads
 * content_text, the nightly backup dumps D1, the tree reads content_bytes, and
 * none of them know this file exists. The Durable Object's own storage is a
 * WORKING copy: every Yjs update lands in it before anything else happens, and an
 * alarm folds the result back into D1 a few seconds later. Lose the storage and the
 * room reseeds from D1, minus at most those few seconds.
 *
 * SEEDING HAPPENS HERE AND NOWHERE ELSE. The well-known way to break a Yjs app is
 * to let each browser load the starting text into its own empty Y.Doc: two
 * browsers, two independent inserts of the same paragraphs, and after sync the
 * page reads twice. The client therefore always starts empty and receives the
 * document from this room.
 *
 * D1 MOVING UNDERNEATH. If note_docs.rev is not the rev this room last wrote,
 * somebody saved through the REST path — possible only while live notes were off
 * for the team, since PUT /:id/content refuses live teams. The room then edits its
 * Yjs copy to match D1 with updateYFragment, which is a diff, not a reseed, so a
 * browser holding the old state merges cleanly instead of duplicating.
 *
 * READ-ONLY is decided by the Worker route and arrives as a header on the upgrade
 * request; the room never trusts anything the socket itself says about who it is.
 */
import { Node as PMNode } from '@tiptap/pm/model';
import {
  updateYFragment,
  yXmlFragmentToProsemirrorJSON,
} from '@tiptap/y-tiptap';
import type { Connection, ConnectionContext } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';
import { docSchema } from '../shared/docSchema';
import { nowSeconds } from './lib/crypto';
import { parseContent } from './lib/notes';

/** The Yjs field TipTap's Collaboration extension binds to by default. */
export const FRAGMENT = 'default';
/** Room-level facts that travel inside the Yjs document. Only `seed`, today. */
export const ROOM_MAP = 'room';

/**
 * How long after the first unsaved keystroke the room writes D1. A throttle, not
 * a debounce: a student typing without pause still checkpoints every few seconds,
 * and D1 sees at most one write per room per interval.
 */
export const SAVE_DELAY_MS = 3000;

/** Fold the update log into one row once it gets this long. */
const COMPACT_AFTER = 200;

/** y-protocols' messageQueryAwareness (3), as the one-byte varint it encodes to. */
const QUERY_AWARENESS = new Uint8Array([3]);

/** Origin for transactions the room makes itself, so they are not attributed. */
const ROOM_ORIGIN = Symbol('room');

/** Headers the Worker route sets on the upgrade. Never read from the client. */
export const MEMBER_HEADER = 'x-coglin-member';
export const READ_ONLY_HEADER = 'x-coglin-read-only';

interface ConnState {
  memberId: string;
  readOnly: boolean;
}

/** `${teamId}:${docId}`. Team first so a room can never be addressed without it. */
export function roomName(teamId: string, docId: string): string {
  return `${teamId}:${docId}`;
}

/**
 * Typed against Cloudflare.Env rather than Bindings because partyserver's generic
 * is constrained to it; worker/env.d.ts makes the two the same thing.
 */
export class NoteRoom extends YServer<Cloudflare.Env> {
  static options = { hibernate: true };

  /**
   * y-partyserver's own debounced onSave is unused: its timer lives in memory and
   * dies with the isolate. Persistence here is the per-update log plus an alarm,
   * both of which survive eviction. The wait is as short as the library allows
   * (0 means "default") because a pending timer keeps the room out of
   * hibernation, and every second awake is billed.
   */
  static callbackOptions = { debounceWait: 1, debounceMaxWait: 1 };

  /**
   * Set when D1's body could not be turned into a Yjs document. The room then
   * refuses every connection and never saves, because the only thing worse than a
   * page that will not open is an empty page autosaved over the real one.
   */
  private broken = false;
  private saveScheduled = false;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS updates (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      data BLOB NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS meta (
      key   TEXT PRIMARY KEY,
      value TEXT
    )`);
  }

  private get ids(): { teamId: string; docId: string } {
    const [teamId, docId] = this.name.split(':');
    return { teamId, docId };
  }

  private meta(key: string): string | null {
    const row = this.ctx.storage.sql
      .exec<{ value: string | null }>('SELECT value FROM meta WHERE key = ?', key)
      .toArray()[0];
    return row?.value ?? null;
  }

  private setMeta(key: string, value: string | null): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      key,
      value,
    );
  }

  /** Replay the update log. Called by YServer.onStart, including after hibernation. */
  async onLoad(): Promise<Y.Doc> {
    const doc = new Y.Doc();
    const rows = this.ctx.storage.sql
      .exec<{ data: ArrayBuffer }>('SELECT data FROM updates ORDER BY id')
      .toArray();
    for (const row of rows) Y.applyUpdate(doc, new Uint8Array(row.data));
    return doc;
  }

  async onStart(): Promise<void> {
    await super.onStart();
    this.document.on('update', (update: Uint8Array, origin: unknown) => {
      this.persist(update, origin);
    });
    // Presence lives in memory, so a room waking from hibernation has forgotten
    // who is here — and y-partyserver's client never re-announces on its own.
    // Ask every socket that survived the nap; useLiveDoc answers for itself only.
    for (const conn of this.getConnections()) conn.send(QUERY_AWARENESS);
    try {
      await this.reconcileWithD1();
    } catch (err) {
      this.broken = true;
      console.error(`note room ${this.name} could not load from D1:`, err);
      for (const conn of this.getConnections()) {
        conn.close(1011, 'room_unavailable');
      }
    }
  }

  /**
   * Make the Yjs copy match D1 if D1 holds something this room did not write.
   * On a brand-new room that is the seeding step.
   */
  private async reconcileWithD1(): Promise<void> {
    const { teamId, docId } = this.ids;
    const row = await this.env.DB.prepare(
      `SELECT content, rev FROM note_docs
        WHERE id = ? AND team_id = ? AND deleted_at IS NULL`,
    )
      .bind(docId, teamId)
      .first<{ content: string; rev: number }>();
    if (!row) return;
    if (this.meta('saved_rev') === String(row.rev)) return;

    // Node.fromJSON throws on a node type the schema does not know. That is the
    // case `broken` exists for, so it is allowed to propagate.
    const pmDoc = PMNode.fromJSON(docSchema(), bodyOf(row.content));
    const fragment = this.document.getXmlFragment(FRAGMENT);
    this.document.transact(() => {
      updateYFragment(this.document, fragment, pmDoc, {
        mapping: new Map(),
        isOMark: new Map(),
      });
      // The lineage of this Yjs document. A browser keys its offline copy by it,
      // so if this room's storage is ever lost and reseeded, an old offline copy
      // is ignored rather than merged in as a second set of paragraphs.
      const room = this.document.getMap<string>(ROOM_MAP);
      if (!room.get('seed')) room.set('seed', crypto.randomUUID());
    }, ROOM_ORIGIN);

    // Recorded as what the Yjs copy serialises to, not row.content: the round
    // trip normalises attribute order and fills defaults, and comparing against
    // the raw column would make the first alarm rewrite an unchanged document.
    this.setMeta('saved_rev', String(row.rev));
    this.setMeta('saved_content', this.serialise());
  }

  /**
   * Written in the same turn the update arrives. The runtime's output gate holds
   * the broadcast to other sockets until this write is durable, so nobody is ever
   * shown an edit the room could still forget.
   */
  private persist(update: Uint8Array, origin: unknown): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO updates (data) VALUES (?)',
      update.slice().buffer,
    );
    const state = connState(origin);
    if (state) this.setMeta('last_editor', state.memberId);
    if (origin !== ROOM_ORIGIN) void this.scheduleSave();
  }

  private async scheduleSave(): Promise<void> {
    if (this.saveScheduled) return;
    this.saveScheduled = true;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + SAVE_DELAY_MS);
    }
  }

  async onAlarm(): Promise<void> {
    this.saveScheduled = false;
    await this.saveToD1();
  }

  /**
   * Fold the Yjs copy back into note_docs. A throw here makes the runtime retry
   * the alarm with backoff, which is the behaviour a D1 hiccup wants.
   */
  async saveToD1(): Promise<void> {
    if (this.broken) return;
    const content = this.serialise();
    if (content === this.meta('saved_content')) {
      this.compact();
      return;
    }

    const parsed = parseContent(content);
    if ('error' in parsed) {
      // Over the size or node limits. The edits are safe in this room's storage
      // and every connected browser; D1 keeps the last body that fit.
      console.error(`note room ${this.name} not saved: ${parsed.error}`);
      return;
    }

    const { teamId, docId } = this.ids;
    const row = await this.env.DB.prepare(
      `UPDATE note_docs
          SET content = ?, content_text = ?, rev = rev + 1,
              updated_by = COALESCE(?, updated_by), updated_at = ?
        WHERE id = ? AND team_id = ? AND deleted_at IS NULL
        RETURNING rev`,
    )
      .bind(
        content,
        parsed.text,
        this.meta('last_editor'),
        nowSeconds(),
        docId,
        teamId,
      )
      .first<{ rev: number }>();
    // A deleted page is not resurrected by a straggling alarm. Its room keeps the
    // edits, and a restore picks them up on the next save.
    if (!row) return;

    this.setMeta('saved_rev', String(row.rev));
    this.setMeta('saved_content', content);
    this.compact();
  }

  private serialise(): string {
    return JSON.stringify(
      yXmlFragmentToProsemirrorJSON(this.document.getXmlFragment(FRAGMENT)),
    );
  }

  private compact(): void {
    const sql = this.ctx.storage.sql;
    const { n } = sql
      .exec<{ n: number }>('SELECT COUNT(*) AS n FROM updates')
      .one();
    if (n < COMPACT_AFTER) return;
    const merged = Y.encodeStateAsUpdate(this.document);
    this.ctx.storage.transactionSync(() => {
      sql.exec('DELETE FROM updates');
      sql.exec('INSERT INTO updates (data) VALUES (?)', merged.slice().buffer);
    });
  }

  onConnect(conn: Connection, ctx: ConnectionContext): void {
    if (this.broken) {
      conn.close(1011, 'room_unavailable');
      return;
    }
    const headers = ctx.request.headers;
    conn.setState({
      memberId: headers.get(MEMBER_HEADER) ?? '',
      readOnly: headers.get(READ_ONLY_HEADER) !== '0',
    } satisfies ConnState);
    super.onConnect(conn, ctx);
  }

  /** Fails closed: a connection with no state from the Worker cannot write. */
  isReadOnly(conn: Connection): boolean {
    return connState(conn)?.readOnly ?? true;
  }
}

function connState(origin: unknown): ConnState | null {
  if (!origin || typeof origin !== 'object' || !('state' in origin)) {
    return null;
  }
  const state = (origin as Connection).state as ConnState | null;
  return state && typeof state.memberId === 'string' ? state : null;
}

/** The same forgiveness DocEditor's safeParse has: empty or corrupt is a blank page. */
function bodyOf(content: string): object {
  const empty = { type: 'doc', content: [{ type: 'paragraph' }] };
  if (!content) return empty;
  try {
    return JSON.parse(content) as object;
  } catch {
    return empty;
  }
}

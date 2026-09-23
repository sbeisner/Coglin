import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applySessionHint,
  SESSION_HINT_BOOT_SCRIPT,
  SESSION_HINT_KEY,
  SESSION_HINT_TTL_MS,
  hintValue,
  parseSessionHint,
} from './sessionHint';

const NOW = Date.UTC(2026, 8, 15);
const DAY = 24 * 60 * 60 * 1000;

describe('parseSessionHint', () => {
  it('accepts a live hint', () => {
    expect(parseSessionHint(`in:${NOW + DAY}`, NOW)).toBe('in');
  });

  /**
   * The case that matters most.
   *
   * Without an expiry, a coach who signed in once last season is offered
   * "Open Coglin" forever and bounced to /login every time they take it — the
   * bug this hint exists to fix, pointing the other way.
   */
  it('rejects a hint that has expired', () => {
    expect(parseSessionHint(`in:${NOW - 1}`, NOW)).toBeNull();
    expect(parseSessionHint(`in:${NOW}`, NOW)).toBeNull();
  });

  // Anything unreadable has to mean "no hint", which the CSS treats as signed
  // out: that direction offers a sign-in link rather than a door that won't open.
  it.each([null, '', 'in', 'in:', 'in:abc', 'out', 'out:9999999999999', 'IN:9999999999999'])(
    'rejects %j',
    (raw) => {
      expect(parseSessionHint(raw, NOW)).toBeNull();
    },
  );
});

describe('hintValue', () => {
  // Pinned to SESSION_TTL in worker/lib/session.ts. The worker constant is not
  // imported — a src test reaching into worker/ would be the wrong coupling —
  // so this asserts the literal instead, and names it for whoever changes one.
  it('expires on the same 30-day horizon as the session cookie', () => {
    expect(SESSION_HINT_TTL_MS).toBe(30 * DAY);
    expect(parseSessionHint(hintValue(NOW), NOW + 29 * DAY)).toBe('in');
    expect(parseSessionHint(hintValue(NOW), NOW + 31 * DAY)).toBeNull();
  });
});

/**
 * The boot script in index.html and parseSessionHint are two implementations of
 * one rule, which is the hazard theme.ts currently just lives with. Run the real
 * string against a fake localStorage and assert it agrees.
 */
describe('SESSION_HINT_BOOT_SCRIPT', () => {
  function runBootScript(stored: string | null, now: number): string | undefined {
    const dataset: Record<string, string> = {};
    const fn = new Function(
      'localStorage',
      'document',
      'Date',
      SESSION_HINT_BOOT_SCRIPT,
    );
    fn(
      { getItem: (k: string) => (k === SESSION_HINT_KEY ? stored : null) },
      { documentElement: { dataset } },
      { now: () => now },
    );
    return dataset.sessionHint;
  }

  it.each([
    [`in:${NOW + DAY}`, 'in'],
    [`in:${NOW - DAY}`, undefined],
    ['in:abc', undefined],
    ['out', undefined],
    [null, undefined],
  ])('agrees with parseSessionHint for %j', (stored, expected) => {
    expect(runBootScript(stored, NOW)).toBe(expected);
    // and the two really are saying the same thing
    expect(runBootScript(stored, NOW)).toBe(
      parseSessionHint(stored, NOW) === 'in' ? 'in' : undefined,
    );
  });

  it('references the same storage key the module owns', () => {
    expect(SESSION_HINT_BOOT_SCRIPT).toContain(SESSION_HINT_KEY);
  });
});

/**
 * applySessionHint runs on every session transition, including sign-out. A
 * localStorage that throws — Safari private mode, or site data blocked — must
 * not take the attribute update or the caller down with it.
 */
describe('applySessionHint', () => {
  const dataset: Record<string, string> = {};

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const k of Object.keys(dataset)) delete dataset[k];
  });

  function stub(storage: Partial<Storage>) {
    for (const k of Object.keys(dataset)) delete dataset[k];
    vi.stubGlobal('document', { documentElement: { dataset } });
    vi.stubGlobal('localStorage', storage);
  }

  it('sets and clears the attribute', () => {
    const store = new Map<string, string>();
    stub({
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });

    applySessionHint(true, NOW);
    expect(dataset.sessionHint).toBe('in');
    expect(parseSessionHint(store.get(SESSION_HINT_KEY) ?? null, NOW)).toBe('in');

    // Signing out REMOVES the key rather than storing a negative, so a shared
    // school laptop keeps nothing about the last person to use it.
    applySessionHint(false, NOW);
    expect(dataset.sessionHint).toBeUndefined();
    expect(store.has(SESSION_HINT_KEY)).toBe(false);
  });

  it('still updates the attribute when storage throws', () => {
    stub({
      setItem: () => {
        throw new Error('private mode');
      },
      removeItem: () => {
        throw new Error('private mode');
      },
    });

    expect(() => applySessionHint(true, NOW)).not.toThrow();
    expect(dataset.sessionHint).toBe('in');
    expect(() => applySessionHint(false, NOW)).not.toThrow();
    expect(dataset.sessionHint).toBeUndefined();
  });
});

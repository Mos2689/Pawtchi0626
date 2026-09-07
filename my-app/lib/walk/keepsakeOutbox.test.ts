/**
 * The queue that decides whether a photograph survives a walk with no signal.
 *
 * The assertion that matters most is the boring one: a failed drain must leave
 * the entry exactly where it found it. Everything else in this feature degrades
 * gracefully — a missing thumbnail, a missing pin, a missing caption — but an
 * entry dropped here is a photo the owner was told had been kept and that no
 * surface will ever show again.
 */

// AsyncStorage is a native module and the suite runs under testEnvironment:
// node, so it is stubbed with an in-memory map — the same shape
// lib/activity/todayCache.test.ts uses.
jest.mock('@react-native-async-storage/async-storage', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    default: {
      getItem: jest.fn(async (k: string) => store.get(k) ?? null),
      setItem: jest.fn(async (k: string, v: string) => void store.set(k, v)),
      removeItem: jest.fn(async (k: string) => void store.delete(k)),
      __store: store,
    },
  };
});

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  OUTBOX_MAX_ENTRIES,
  drainOutbox,
  enqueueOutbox,
  newOutboxId,
  normalizeOutbox,
  outboxLocalPaths,
  readOutbox,
  type KeepsakeOutboxEntry,
  type OutboxPorts,
} from './keepsakeOutbox';

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;

const NOW = Date.parse('2026-09-06T09:56:12.000Z');

function entry(over: Partial<KeepsakeOutboxEntry> = {}): KeepsakeOutboxEntry {
  return {
    id: 'e1',
    ownerId: 'owner',
    petId: 'pet',
    walkSessionId: 'walk',
    capturedAt: NOW,
    lat: null,
    lng: null,
    routeIndex: null,
    elapsedS: 120,
    mediaType: 'photo',
    source: 'camera',
    localPath: '1757152572000-abc123.jpg',
    localAssetId: null,
    width: 3024,
    height: 4032,
    placeKey: null,
    attempts: 0,
    queuedAt: NOW,
    ...over,
  };
}

/** Ports that record what they were asked to do. */
function ports(over: Partial<OutboxPorts> = {}): OutboxPorts & { inserted: unknown[] } {
  const inserted: unknown[] = [];
  return {
    inserted,
    insert: jest.fn(async (input) => {
      inserted.push(input);
      return { id: `row-${inserted.length}` };
    }),
    upload: jest.fn(async () => 'owner/row-1.jpg'),
    attach: jest.fn(async () => true),
    fileUri: jest.fn((name) => (name ? `file:///documents/keepsakes/${name}` : null)),
    ...over,
  };
}

beforeEach(() => store.clear());

describe('normalizeOutbox', () => {
  it('drops anything an older build might have written', () => {
    expect(normalizeOutbox([entry(), { id: 'no-owner' }, null, 'nope'])).toHaveLength(1);
  });

  it('is empty for anything that is not a list', () => {
    expect(normalizeOutbox(null)).toEqual([]);
    expect(normalizeOutbox({ id: 'e1' })).toEqual([]);
  });

  it('evicts the OLDEST when the queue overflows', () => {
    // Same rule as keepsakeBudget: recency is the best proxy for the photo
    // someone is about to go looking for.
    const many = Array.from({ length: 5 }, (_, i) =>
      entry({ id: `e${i}`, capturedAt: NOW + i }),
    );
    const kept = normalizeOutbox(many, 3);
    expect(kept.map((e) => e.id)).toEqual(['e2', 'e3', 'e4']);
  });

  it('leaves a queue inside the cap alone, in the order it was given', () => {
    const some = [entry({ id: 'b', capturedAt: NOW + 1 }), entry({ id: 'a', capturedAt: NOW })];
    expect(normalizeOutbox(some).map((e) => e.id)).toEqual(['b', 'a']);
  });
});

describe('newOutboxId', () => {
  it('does not collide for two photos in the same millisecond', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newOutboxId(NOW)));
    expect(ids.size).toBe(200);
  });
});

describe('outboxLocalPaths', () => {
  it('lists the files the sweep must not touch', () => {
    expect(outboxLocalPaths([entry({ localPath: 'a.jpg' }), entry({ localPath: null })])).toEqual([
      'a.jpg',
    ]);
  });
});

describe('enqueueOutbox', () => {
  it('survives a round trip through storage', async () => {
    await enqueueOutbox([entry()]);
    expect(await readOutbox()).toEqual([entry()]);
  });

  it('appends rather than replacing the queue', async () => {
    await enqueueOutbox([entry({ id: 'a' })]);
    await enqueueOutbox([entry({ id: 'b' })]);
    expect((await readOutbox()).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('replaces an entry re-queued under the same id', async () => {
    await enqueueOutbox([entry({ id: 'a', attempts: 0 })]);
    await enqueueOutbox([entry({ id: 'a', attempts: 3 })]);
    const queued = await readOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].attempts).toBe(3);
  });

  it('cannot grow without bound', async () => {
    await enqueueOutbox(
      Array.from({ length: OUTBOX_MAX_ENTRIES + 20 }, (_, i) =>
        entry({ id: `e${i}`, capturedAt: NOW + i }),
      ),
    );
    expect(await readOutbox()).toHaveLength(OUTBOX_MAX_ENTRIES);
  });

  it('reads an empty queue rather than throwing on corrupt storage', async () => {
    store.set('pawtchi.walk.keepsakeOutbox.v1', '{not json');
    expect(await readOutbox()).toEqual([]);
  });
});

describe('drainOutbox', () => {
  it('does nothing, cheaply, when there is nothing queued', async () => {
    const p = ports();
    expect(await drainOutbox(p)).toEqual({ sent: 0, kept: 0 });
    expect(p.insert).not.toHaveBeenCalled();
  });

  it('writes the row and empties the queue', async () => {
    await enqueueOutbox([entry()]);
    const p = ports();

    expect(await drainOutbox(p)).toEqual({ sent: 1, kept: 0 });
    expect(await readOutbox()).toEqual([]);
    expect(p.inserted[0]).toMatchObject({
      ownerId: 'owner',
      petId: 'pet',
      walkSessionId: 'walk',
      capturedAt: NOW,
      source: 'camera',
      localPath: '1757152572000-abc123.jpg',
    });
  });

  it('carries an imported photo through as an import', async () => {
    await enqueueOutbox([entry({ source: 'import', lat: 51.5, lng: -0.12, placeKey: 'k' })]);
    const p = ports();
    await drainOutbox(p);
    expect(p.inserted[0]).toMatchObject({ source: 'import', lat: 51.5, lng: -0.12 });
  });

  it('KEEPS an entry whose write failed, and counts the attempt', async () => {
    await enqueueOutbox([entry()]);
    const p = ports({ insert: jest.fn(async () => null) });

    expect(await drainOutbox(p)).toEqual({ sent: 0, kept: 1 });
    const queued = await readOutbox();
    expect(queued).toHaveLength(1);
    expect(queued[0].attempts).toBe(1);
  });

  it('retries the same entry on the next drain', async () => {
    await enqueueOutbox([entry()]);
    await drainOutbox(ports({ insert: jest.fn(async () => null) }));
    expect(await drainOutbox(ports())).toEqual({ sent: 1, kept: 0 });
    expect(await readOutbox()).toEqual([]);
  });

  it('sends what it can and keeps only what it could not', async () => {
    await enqueueOutbox([entry({ id: 'a' }), entry({ id: 'b' }), entry({ id: 'c' })]);
    let call = 0;
    const p = ports({
      insert: jest.fn(async () => {
        call += 1;
        return call === 2 ? null : { id: `row-${call}` };
      }),
    });

    expect(await drainOutbox(p)).toEqual({ sent: 2, kept: 1 });
    expect((await readOutbox()).map((e) => e.id)).toEqual(['b']);
  });

  it('uploads the thumbnail from OUR copy, resolved at drain time', async () => {
    // Never from a stored uri: the container path a capture was written to does
    // not survive an app update, which is the whole reason the entry holds a
    // bare filename.
    await enqueueOutbox([entry()]);
    const p = ports();
    await drainOutbox(p);

    expect(p.fileUri).toHaveBeenCalledWith('1757152572000-abc123.jpg');
    expect(p.upload).toHaveBeenCalledWith(
      expect.objectContaining({ uri: 'file:///documents/keepsakes/1757152572000-abc123.jpg' }),
    );
    expect(p.attach).toHaveBeenCalledWith('row-1', 'owner/row-1.jpg');
  });

  it('still writes the row when the file has vanished', async () => {
    // The time, the place and the walk are real facts about a real moment;
    // keepsakeResolve renders that as context rather than a gap.
    await enqueueOutbox([entry()]);
    const p = ports({ fileUri: jest.fn(() => null) });

    expect(await drainOutbox(p)).toEqual({ sent: 1, kept: 0 });
    expect(p.upload).not.toHaveBeenCalled();
  });

  it('does not re-queue a written row just because its thumbnail failed', async () => {
    // The row is what makes a keepsake findable; fetchPendingThumbnails is
    // already the mechanism that finishes the job later.
    await enqueueOutbox([entry()]);
    const p = ports({ upload: jest.fn(async () => null) });

    expect(await drainOutbox(p)).toEqual({ sent: 1, kept: 0 });
    expect(p.attach).not.toHaveBeenCalled();
  });
});

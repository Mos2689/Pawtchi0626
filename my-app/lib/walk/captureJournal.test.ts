/**
 * The journal is the only record of a photo between the shutter and the row.
 * What matters: nothing written is lost to a burst of captures, a restore finds
 * its walk's photos, and recovery attaches an entry to the right saved walk —
 * or to none, never the wrong one.
 */

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
  JOURNAL_MAX_ENTRIES,
  appendJournal,
  entriesForWalk,
  journalLocalPaths,
  journalToOutboxEntry,
  matchJournalToWalk,
  normalizeJournal,
  readJournal,
  removeFromJournal,
  removeWalkFromJournal,
  type CaptureJournalEntry,
} from './captureJournal';

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;

const WALK = 1_760_000_000_000;

function entry(over: Partial<CaptureJournalEntry> = {}): CaptureJournalEntry {
  return {
    mediaId: 'm1',
    ownerId: 'owner',
    petId: 'pet',
    walkStartedAt: WALK,
    capturedAt: WALK + 60_000,
    lat: -33.89,
    lng: 151.27,
    routeIndex: 4,
    elapsedS: 60,
    placeKey: 'pk',
    source: 'camera',
    localPath: '1760000060000-abc.jpg',
    cacheUri: null,
    width: 1536,
    height: 2048,
    journaledAt: WALK + 60_001,
    ...over,
  };
}

beforeEach(() => store.clear());

describe('normalizeJournal', () => {
  it('drops malformed entries and anything that is not a list', () => {
    expect(normalizeJournal(null)).toEqual([]);
    expect(normalizeJournal({})).toEqual([]);
    expect(normalizeJournal([entry(), { mediaId: 'x' }, 42, entry({ mediaId: 'm2', walkStartedAt: NaN })]))
      .toEqual([entry()]);
  });

  it('dedupes by mediaId, the later write winning', () => {
    const out = normalizeJournal([entry({ elapsedS: 1 }), entry({ elapsedS: 2 })]);
    expect(out).toHaveLength(1);
    expect(out[0].elapsedS).toBe(2);
  });

  it('defaults cacheUri for entries written before the field existed', () => {
    const { cacheUri: _drop, ...legacy } = entry();
    expect(normalizeJournal([legacy])[0].cacheUri).toBeNull();
  });

  it('trims to the cap oldest-first', () => {
    const many = Array.from({ length: JOURNAL_MAX_ENTRIES + 3 }, (_, i) =>
      entry({ mediaId: `m${i}`, capturedAt: WALK + i }));
    const out = normalizeJournal(many);
    expect(out).toHaveLength(JOURNAL_MAX_ENTRIES);
    expect(out[0].mediaId).toBe('m3');
  });
});

describe('entriesForWalk', () => {
  it('returns only this owner and this walk', () => {
    const all = [entry(), entry({ mediaId: 'm2', walkStartedAt: WALK + 1 }), entry({ mediaId: 'm3', ownerId: 'other' })];
    expect(entriesForWalk(all, 'owner', WALK).map((e) => e.mediaId)).toEqual(['m1']);
  });
});

describe('matchJournalToWalk', () => {
  it('matches the saved walk that started at the same moment', () => {
    const walks = [{ id: 'w-early', startedAt: WALK - 3_600_000 }, { id: 'w', startedAt: WALK + 400 }];
    expect(matchJournalToWalk(entry(), walks)?.id).toBe('w');
  });

  it('prefers the closer of two candidates inside the tolerance', () => {
    const walks = [{ id: 'far', startedAt: WALK + 1_900 }, { id: 'near', startedAt: WALK - 100 }];
    expect(matchJournalToWalk(entry(), walks)?.id).toBe('near');
  });

  it('matches nothing rather than the wrong walk', () => {
    expect(matchJournalToWalk(entry(), [{ id: 'other', startedAt: WALK + 5_000 }])).toBeNull();
    expect(matchJournalToWalk(entry(), [])).toBeNull();
  });
});

describe('journalToOutboxEntry', () => {
  it('carries the photo id and every fact the row needs', () => {
    const out = journalToOutboxEntry(entry(), 'session-1', 123);
    expect(out).toMatchObject({
      id: 'j-m1',
      mediaId: 'm1',
      walkSessionId: 'session-1',
      localPath: '1760000060000-abc.jpg',
      routeIndex: 4,
      mediaType: 'photo',
      localAssetId: null,
      attempts: 0,
      queuedAt: 123,
    });
  });
});

describe('journalLocalPaths', () => {
  it('protects every stored file, skipping entries without one', () => {
    expect(journalLocalPaths([entry(), entry({ mediaId: 'm2', localPath: null })])).toEqual(['1760000060000-abc.jpg']);
  });
});

describe('storage', () => {
  it('keeps every photo of a burst — appends never overwrite each other', async () => {
    await Promise.all(Array.from({ length: 12 }, (_, i) => appendJournal(entry({ mediaId: `b${i}`, capturedAt: WALK + i }))));
    expect((await readJournal()).map((e) => e.mediaId).sort()).toEqual(
      Array.from({ length: 12 }, (_, i) => `b${i}`).sort());
  });

  it('removes only what it is told to', async () => {
    await appendJournal(entry());
    await appendJournal(entry({ mediaId: 'm2' }));
    await removeFromJournal(['m1']);
    expect((await readJournal()).map((e) => e.mediaId)).toEqual(['m2']);
  });

  it('forgets a discarded walk and nothing else', async () => {
    await appendJournal(entry());
    await appendJournal(entry({ mediaId: 'm2', walkStartedAt: WALK + 99 }));
    await removeWalkFromJournal('owner', WALK);
    expect((await readJournal()).map((e) => e.mediaId)).toEqual(['m2']);
  });

  it('clears the key when the last entry goes', async () => {
    await appendJournal(entry());
    await removeFromJournal(['m1']);
    expect(store.size).toBe(0);
  });

  it('reads garbage as an empty journal rather than throwing', async () => {
    store.set('pawtchi.walk.captureJournal.v1', '{not json');
    expect(await readJournal()).toEqual([]);
  });
});

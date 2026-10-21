/**
 * Recovery may be late; it may not be wrong. A photo attaches to the walk it
 * was taken on or stays where it is — and a thumbnail that never uploaded gets
 * another chance from the original on this phone.
 */

// captureJournal imports AsyncStorage (a native module); recovery reaches it only
// through ports, so an inert stub is enough under the node environment.
jest.mock('@react-native-async-storage/async-storage', () => ({ __esModule: true, default: {} }));

import { recoverKeepsakes, rescueJournal, retryPendingThumbnails, type RecoveryPorts } from './keepsakeRecovery';
import type { CaptureJournalEntry } from './captureJournal';
import type { KeepsakeOutboxEntry } from './keepsakeOutbox';
import type { Keepsake } from './keepsake';

const WALK = 1_760_000_000_000;

function entry(over: Partial<CaptureJournalEntry> = {}): CaptureJournalEntry {
  return {
    mediaId: 'm1', ownerId: 'owner', petId: 'pet', walkStartedAt: WALK, capturedAt: WALK + 60_000,
    lat: null, lng: null, routeIndex: null, elapsedS: 60, placeKey: null, source: 'camera',
    localPath: 'a.jpg', cacheUri: null, width: 100, height: 200, journaledAt: WALK + 60_001, ...over,
  };
}

function keepsake(over: Partial<Keepsake> = {}): Keepsake {
  return {
    id: 'k1', walkSessionId: 'w', petId: 'pet', capturedAt: WALK, lat: null, lng: null, routeIndex: null,
    elapsedS: null, mediaType: 'photo', source: 'camera', localPath: 'a.jpg', localAssetId: null,
    width: 100, height: 200, thumbPath: null, thumbBlurhash: null, placeKey: null, caption: null,
    ...over,
  } as Keepsake;
}

function ports(over: Partial<RecoveryPorts> = {}) {
  const journal: CaptureJournalEntry[] = [entry()];
  const queued: KeepsakeOutboxEntry[] = [];
  const order: string[] = [];
  const p: RecoveryPorts = {
    readJournal: jest.fn(async () => journal.slice()),
    removeFromJournal: jest.fn(async (ids) => {
      order.push('remove');
      for (const id of ids) journal.splice(journal.findIndex((e) => e.mediaId === id), 1);
    }),
    enqueueOutbox: jest.fn(async (es) => { order.push('enqueue'); queued.push(...es); }),
    drainOutbox: jest.fn(async () => ({ sent: queued.length, kept: 0 })),
    fetchWalkStarts: jest.fn(async () => [{ id: 'w', startedAt: WALK + 300 }]),
    activeWalkStartedAt: jest.fn(async () => null),
    fetchPendingThumbnails: jest.fn(async () => []),
    fileUri: jest.fn((n) => (n ? `file:///${n}` : null)),
    upload: jest.fn(async () => 'owner/k1.jpg'),
    attach: jest.fn(async () => true),
    now: () => 5,
    ...over,
  };
  return { p, journal, queued, order };
}

describe('rescueJournal', () => {
  it('moves an entry to the outbox against the walk it was taken on', async () => {
    const { p, journal, queued, order } = ports();
    expect(await rescueJournal(p, 'owner')).toEqual({ rescued: 1, unmatched: 0 });
    expect(queued[0]).toMatchObject({ mediaId: 'm1', walkSessionId: 'w', localPath: 'a.jpg' });
    expect(journal).toHaveLength(0);
    expect(order).toEqual(['enqueue', 'remove']);
  });

  it('keeps an entry no saved walk matches', async () => {
    const { p, journal, queued } = ports({ fetchWalkStarts: jest.fn(async () => [{ id: 'other', startedAt: WALK + 60_000 }]) });
    expect(await rescueJournal(p, 'owner')).toEqual({ rescued: 0, unmatched: 1 });
    expect(queued).toHaveLength(0);
    expect(journal).toHaveLength(1);
  });

  it('touches nothing when the server cannot be asked', async () => {
    const { p, journal } = ports({ fetchWalkStarts: jest.fn(async () => null) });
    expect(await rescueJournal(p, 'owner')).toEqual({ rescued: 0, unmatched: 1 });
    expect(p.enqueueOutbox).not.toHaveBeenCalled();
    expect(journal).toHaveLength(1);
  });

  it('leaves the walk in progress to its own hook', async () => {
    const { p } = ports({ activeWalkStartedAt: jest.fn(async () => WALK) });
    expect(await rescueJournal(p, 'owner')).toEqual({ rescued: 0, unmatched: 0 });
    expect(p.fetchWalkStarts).not.toHaveBeenCalled();
  });

  it("ignores another account's entries on a shared phone", async () => {
    const { p } = ports();
    expect(await rescueJournal(p, 'someone-else')).toEqual({ rescued: 0, unmatched: 0 });
  });
});

describe('retryPendingThumbnails', () => {
  it('uploads from the original still on this phone', async () => {
    const { p } = ports({ fetchPendingThumbnails: jest.fn(async () => [keepsake()]) });
    expect(await retryPendingThumbnails(p, 'owner')).toEqual({ uploaded: 1, unrecoverable: 0 });
    expect(p.attach).toHaveBeenCalledWith('k1', 'owner/k1.jpg');
  });

  it('counts a row whose original is gone instead of failing', async () => {
    const { p } = ports({
      fetchPendingThumbnails: jest.fn(async () => [keepsake({ localPath: 'gone.jpg' })]),
      fileUri: jest.fn(() => null),
    });
    expect(await retryPendingThumbnails(p, 'owner')).toEqual({ uploaded: 0, unrecoverable: 1 });
    expect(p.upload).not.toHaveBeenCalled();
  });
});

describe('recoverKeepsakes', () => {
  it('rescues, drains and finishes thumbnails in one pass', async () => {
    const { p } = ports({ fetchPendingThumbnails: jest.fn(async () => [keepsake()]) });
    expect(await recoverKeepsakes(p, 'owner')).toEqual({
      rescued: 1, unmatched: 0, sent: 1, queued: 0, thumbsUploaded: 1, thumbsUnrecoverable: 0,
    });
  });

  it('never throws, whichever step fails', async () => {
    const boom = jest.fn(async () => { throw new Error('offline'); });
    const { p } = ports({ readJournal: boom, drainOutbox: boom, fetchPendingThumbnails: boom });
    await expect(recoverKeepsakes(p, 'owner')).resolves.toMatchObject({ rescued: 0, sent: 0, thumbsUploaded: 0 });
  });
});

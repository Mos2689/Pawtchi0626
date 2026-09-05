/**
 * The degradation ladder and rehydration.
 *
 * The ladder tests walk all three rungs plus the totality property — that no
 * keepsake, however broken, ever fails to resolve to something showable. The
 * rehydration tests are mostly about REFUSING to match: a wrong match puts a
 * stranger's photo in a dog's biography, which is far worse than falling back
 * to the thumbnail we already have.
 */

import {
  REHYDRATE_TOLERANCE_MS,
  matchAssetForKeepsake,
  resolveKeepsake,
  withLocalAsset,
  type AssetCandidate,
  type PhotoAccess,
} from './keepsakeResolve';
import type { Keepsake } from './keepsake';

function keepsake(overrides: Partial<Keepsake> = {}): Keepsake {
  return {
    id: 'k1',
    walkSessionId: 'w1',
    petId: 'p1',
    capturedAt: 1_700_000_000_000,
    lat: 51.5071,
    lng: -0.1657,
    routeIndex: 2,
    elapsedS: 120,
    mediaType: 'photo',
    source: 'camera',
    localPath: null,
    localAssetId: 'ph://ABC',
    width: 4032,
    height: 3024,
    thumbPath: 'thumbs/k1.jpg',
    thumbBlurhash: 'LKO2',
    placeKey: '103014_-332',
    caption: null,
    ...overrides,
  };
}

describe('resolveKeepsake — rung 1a, our own copy', () => {
  it('uses the owned file when it is really there', () => {
    const render = resolveKeepsake({
      keepsake: keepsake({ localPath: '1700-abc.jpg' }),
      ownedFileAvailable: true,
      localAvailable: false,
      access: 'denied',
    });
    expect(render).toEqual({ rung: 'original', source: 'owned', localAssetId: 'ph://ABC' });
  });

  it('prefers our copy over the library even when both are available', () => {
    const render = resolveKeepsake({
      keepsake: keepsake({ localPath: '1700-abc.jpg' }),
      ownedFileAvailable: true,
      localAvailable: true,
      access: 'granted',
    });
    expect(render).toMatchObject({ source: 'owned' });
  });

  it('needs no photo permission at all', () => {
    // The whole point: Android never gets READ_MEDIA_IMAGES, and this rung
    // still answers there.
    const render = resolveKeepsake({
      keepsake: keepsake({ localPath: '1700-abc.jpg', localAssetId: null }),
      ownedFileAvailable: true,
      localAvailable: false,
      access: 'denied',
    });
    expect(render).toMatchObject({ rung: 'original', source: 'owned', localAssetId: null });
  });

  it('does not trust a local_path whose file is gone — the reinstall case', () => {
    const render = resolveKeepsake({
      keepsake: keepsake({ localPath: '1700-abc.jpg' }),
      ownedFileAvailable: false,
      localAvailable: false,
      access: 'granted',
    });
    expect(render.rung).toBe('thumbnail');
  });
});

describe('resolveKeepsake — rung 1b, the camera-roll original', () => {
  it('uses the local original when it is really there', () => {
    const render = resolveKeepsake({
      keepsake: keepsake(),
      localAvailable: true,
      access: 'granted',
    });
    expect(render).toEqual({ rung: 'original', source: 'library', localAssetId: 'ph://ABC' });
  });

  it('works under limited access when the asset was among the chosen ones', () => {
    const render = resolveKeepsake({
      keepsake: keepsake(),
      localAvailable: true,
      access: 'limited',
    });
    expect(render.rung).toBe('original');
  });

  it('does not trust a stale id when the library did not return the asset', () => {
    // The post-migration case: the id is still on the row, and means nothing.
    const render = resolveKeepsake({
      keepsake: keepsake(),
      localAvailable: false,
      access: 'granted',
    });
    expect(render.rung).toBe('thumbnail');
  });
});

describe('resolveKeepsake — rung 2, the thumbnail', () => {
  it('falls back when the user deleted the original', () => {
    const render = resolveKeepsake({
      keepsake: keepsake({ localAssetId: null }),
      localAvailable: false,
      access: 'granted',
    });
    expect(render).toMatchObject({ rung: 'thumbnail', thumbPath: 'thumbs/k1.jpg' });
  });

  it('carries the blurhash through so the tile paints instantly', () => {
    const render = resolveKeepsake({
      keepsake: keepsake(),
      localAvailable: false,
      access: 'granted',
    });
    expect(render).toMatchObject({ blurhash: 'LKO2' });
  });

  it('does not claim the original is gone when we were never allowed to look', () => {
    const render = resolveKeepsake({
      keepsake: keepsake({ localAssetId: null }),
      localAvailable: false,
      access: 'denied',
    });
    expect(render).toMatchObject({ rung: 'thumbnail', originalElsewhere: true });
  });

  it('reports a genuinely deleted original as not elsewhere', () => {
    const render = resolveKeepsake({
      keepsake: keepsake({ localAssetId: null }),
      localAvailable: false,
      access: 'granted',
    });
    expect(render).toMatchObject({ originalElsewhere: false });
  });
});

describe('resolveKeepsake — rung 3, context only', () => {
  it('describes the moment when there is no image left at all', () => {
    const render = resolveKeepsake({
      keepsake: keepsake({ localAssetId: null, thumbPath: null }),
      localAvailable: false,
      access: 'granted',
    });
    expect(render).toEqual({ rung: 'context', elapsedS: 120, hasPin: true });
  });

  it('reports no pin when the coordinate never resolved', () => {
    const render = resolveKeepsake({
      keepsake: keepsake({ localAssetId: null, thumbPath: null, lat: null, lng: null }),
      localAvailable: false,
      access: 'granted',
    });
    expect(render).toMatchObject({ rung: 'context', hasPin: false });
  });
});

describe('resolveKeepsake — totality (rung 4: never a broken image)', () => {
  const accesses: PhotoAccess[] = ['granted', 'limited', 'denied'];

  it('always returns one of the three rungs, for every combination', () => {
    for (const access of accesses) {
      for (const ownedFileAvailable of [true, false]) {
        for (const localAvailable of [true, false]) {
          for (const localPath of ['1700-abc.jpg', null]) {
            for (const localAssetId of ['ph://ABC', null]) {
              for (const thumbPath of ['thumbs/k1.jpg', null]) {
                const render = resolveKeepsake({
                  keepsake: keepsake({ localPath, localAssetId, thumbPath }),
                  ownedFileAvailable,
                  localAvailable,
                  access,
                });
                expect(['original', 'thumbnail', 'context']).toContain(render.rung);
              }
            }
          }
        }
      }
    }
  });
});

describe('matchAssetForKeepsake', () => {
  const base = keepsake();
  const asset = (overrides: Partial<AssetCandidate> = {}): AssetCandidate => ({
    id: 'a1',
    creationTime: base.capturedAt,
    width: 4032,
    height: 3024,
    ...overrides,
  });

  it('re-finds the photo on a new device by capture time', () => {
    expect(matchAssetForKeepsake(base, [asset({ id: 'found' })])).toBe('found');
  });

  it('absorbs small clock differences between the app and the library', () => {
    const skewed = asset({ id: 'skewed', creationTime: base.capturedAt + 2000 });
    expect(matchAssetForKeepsake(base, [skewed])).toBe('skewed');
  });

  it('refuses a photo outside the tolerance', () => {
    const later = asset({ creationTime: base.capturedAt + REHYDRATE_TOLERANCE_MS + 1 });
    expect(matchAssetForKeepsake(base, [later])).toBeNull();
  });

  it('returns null when the library has nothing from that moment', () => {
    expect(matchAssetForKeepsake(base, [])).toBeNull();
  });

  it('uses dimensions to pick the right frame out of a burst', () => {
    const candidates = [
      asset({ id: 'portrait', width: 3024, height: 4032, creationTime: base.capturedAt }),
      asset({ id: 'landscape', width: 4032, height: 3024, creationTime: base.capturedAt + 1200 }),
    ];
    expect(matchAssetForKeepsake(base, candidates)).toBe('landscape');
  });

  it('prefers the closest time when dimensions cannot separate a burst', () => {
    const candidates = [
      asset({ id: 'near', creationTime: base.capturedAt + 500 }),
      asset({ id: 'far', creationTime: base.capturedAt + 2500 }),
    ];
    expect(matchAssetForKeepsake(base, candidates)).toBe('near');
  });

  it('refuses to guess between two indistinguishable candidates', () => {
    // Same dimensions, same distance either side — matching one would be a
    // coin flip with someone's memory.
    const candidates = [
      asset({ id: 'left', creationTime: base.capturedAt - 1000 }),
      asset({ id: 'right', creationTime: base.capturedAt + 1000 }),
    ];
    expect(matchAssetForKeepsake(base, candidates)).toBeNull();
  });

  it('still matches when the keepsake has no stored dimensions', () => {
    const noDims = keepsake({ width: null, height: null });
    expect(matchAssetForKeepsake(noDims, [asset({ id: 'only' })])).toBe('only');
  });

  it('ignores candidates with an unusable creation time', () => {
    expect(matchAssetForKeepsake(base, [asset({ creationTime: NaN })])).toBeNull();
  });
});

describe('withLocalAsset', () => {
  it('rebinds the id without disturbing the rest of the keepsake', () => {
    const original = keepsake();
    const rebound = withLocalAsset(original, 'ph://NEW');
    expect(rebound.localAssetId).toBe('ph://NEW');
    expect(rebound.thumbPath).toBe(original.thumbPath);
    expect(original.localAssetId).toBe('ph://ABC');
  });

  it('can clear the hint when rehydration found nothing', () => {
    expect(withLocalAsset(keepsake(), null).localAssetId).toBeNull();
  });
});

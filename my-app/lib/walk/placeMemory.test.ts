/**
 * Place memory gating.
 *
 * Most of these tests assert that the feature stays QUIET. That is the point:
 * the offer is only valuable while it is rare, and every gate here is the
 * difference between a gift and an alarm clock on a daily route.
 */

import {
  MAX_OFFERS_PER_WALK,
  MIN_ANCHOR_AGE_DAYS,
  PLACE_COOLDOWN_DAYS,
  canAnchor,
  evaluatePlaceMemory,
  findPlaceAnchors,
  type PlaceMemoryInput,
} from './placeMemory';
import type { Keepsake } from './keepsake';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-20T08:00:00.000Z');
const HERE = { lat: 51.5071, lng: -0.1657 };

function keepsake(overrides: Partial<Keepsake> = {}): Keepsake {
  return {
    id: 'k1',
    walkSessionId: 'w1',
    petId: 'p1',
    capturedAt: NOW - 60 * DAY_MS,
    lat: HERE.lat,
    lng: HERE.lng,
    routeIndex: 2,
    elapsedS: 120,
    mediaType: 'photo',
    source: 'camera',
    localPath: null,
    localAssetId: 'ph://ABC',
    width: 4032,
    height: 3024,
    thumbPath: 'thumbs/k1.jpg',
    thumbBlurhash: null,
    placeKey: '103014_-332',
    caption: null,
    ...overrides,
  };
}

function input(overrides: Partial<PlaceMemoryInput> = {}): PlaceMemoryInput {
  return {
    here: HERE,
    now: NOW,
    candidates: [keepsake()],
    lastPromptAt: null,
    offersThisWalk: 0,
    ...overrides,
  };
}

describe('canAnchor', () => {
  it('accepts a keepsake with a durable thumbnail', () => {
    expect(canAnchor(keepsake({ localAssetId: null }))).toBe(true);
  });

  it('refuses a metadata-only keepsake — a then/now needs an image', () => {
    expect(canAnchor(keepsake({ thumbPath: null, localAssetId: null }))).toBe(false);
  });

  // The anchor is a photo from another walk, rendered from a signed thumbnail
  // URL. Neither local copy can serve it, and accepting one lets an anchor that
  // resolves to nothing suppress the usable one behind it.
  it('refuses a camera-roll id with no thumbnail — that phone may be long gone', () => {
    expect(canAnchor(keepsake({ thumbPath: null }))).toBe(false);
  });

  it('refuses an owned file with no thumbnail — a reinstall takes it', () => {
    expect(
      canAnchor(keepsake({ thumbPath: null, localAssetId: null, localPath: '1700-a.jpg' })),
    ).toBe(false);
  });
});

describe('findPlaceAnchors', () => {
  it('keeps a keepsake at the same tree', () => {
    const anchors = findPlaceAnchors(input());
    expect(anchors).toHaveLength(1);
    expect(anchors[0].distanceM).toBeLessThan(5);
  });

  it('drops one a block away that shared a cell query', () => {
    const far = keepsake({ id: 'far', lat: 51.5090, lng: -0.1657 });
    expect(findPlaceAnchors(input({ candidates: [far] }))).toHaveLength(0);
  });

  it('drops keepsakes with no coordinate', () => {
    const noCoord = keepsake({ id: 'nc', lat: null, lng: null });
    expect(findPlaceAnchors(input({ candidates: [noCoord] }))).toHaveLength(0);
  });

  it('ignores a capture time in the future — clock skew is not a memory', () => {
    const future = keepsake({ id: 'f', capturedAt: NOW + 10 * DAY_MS });
    expect(findPlaceAnchors(input({ candidates: [future] }))).toHaveLength(0);
  });

  it('sorts oldest first', () => {
    const anchors = findPlaceAnchors(
      input({
        candidates: [
          keepsake({ id: 'recent', capturedAt: NOW - 30 * DAY_MS }),
          keepsake({ id: 'ancient', capturedAt: NOW - 300 * DAY_MS }),
          keepsake({ id: 'middle', capturedAt: NOW - 90 * DAY_MS }),
        ],
      }),
    );
    expect(anchors.map((a) => a.keepsake.id)).toEqual(['ancient', 'middle', 'recent']);
  });
});

describe('evaluatePlaceMemory', () => {
  it('offers the oldest anchor, because the delta is the point', () => {
    const offer = evaluatePlaceMemory(
      input({
        candidates: [
          keepsake({ id: 'recent', capturedAt: NOW - 30 * DAY_MS }),
          keepsake({ id: 'ancient', capturedAt: NOW - 300 * DAY_MS }),
        ],
      }),
    );
    expect(offer?.anchor.id).toBe('ancient');
    expect(offer?.ageDays).toBe(300);
    expect(offer?.visitCount).toBe(2);
  });

  it('never fires on the first-ever visit', () => {
    expect(evaluatePlaceMemory(input({ candidates: [] }))).toBeNull();
  });

  it('stays quiet when the only anchor is too recent to show change', () => {
    const fresh = keepsake({ capturedAt: NOW - (MIN_ANCHOR_AGE_DAYS - 1) * DAY_MS });
    expect(evaluatePlaceMemory(input({ candidates: [fresh] }))).toBeNull();
  });

  it('fires exactly at the age threshold', () => {
    const atThreshold = keepsake({ capturedAt: NOW - MIN_ANCHOR_AGE_DAYS * DAY_MS });
    expect(evaluatePlaceMemory(input({ candidates: [atThreshold] }))).not.toBeNull();
  });

  it('stays quiet inside the cooldown — the daily-route nagging guard', () => {
    const recentlyPrompted = input({
      lastPromptAt: NOW - (PLACE_COOLDOWN_DAYS - 1) * DAY_MS,
    });
    expect(evaluatePlaceMemory(recentlyPrompted)).toBeNull();
  });

  it('speaks again once the cooldown has passed', () => {
    const cooledDown = input({ lastPromptAt: NOW - PLACE_COOLDOWN_DAYS * DAY_MS });
    expect(evaluatePlaceMemory(cooledDown)).not.toBeNull();
  });

  it('offers at most once per walk', () => {
    expect(evaluatePlaceMemory(input({ offersThisWalk: MAX_OFFERS_PER_WALK }))).toBeNull();
  });

  it('will not anchor on a keepsake whose image is gone', () => {
    const lost = keepsake({ thumbPath: null, localAssetId: null });
    expect(evaluatePlaceMemory(input({ candidates: [lost] }))).toBeNull();
  });

  it('falls back to an older resolvable anchor when the oldest image is gone', () => {
    const offer = evaluatePlaceMemory(
      input({
        candidates: [
          keepsake({ id: 'gone', capturedAt: NOW - 300 * DAY_MS, thumbPath: null, localAssetId: null }),
          keepsake({ id: 'kept', capturedAt: NOW - 200 * DAY_MS }),
        ],
      }),
    );
    expect(offer?.anchor.id).toBe('kept');
  });

  it('counts distinct months, not raw visits', () => {
    const offer = evaluatePlaceMemory(
      input({
        candidates: [
          keepsake({ id: 'a', capturedAt: Date.parse('2026-03-01T08:00:00.000Z') }),
          keepsake({ id: 'b', capturedAt: Date.parse('2026-03-20T08:00:00.000Z') }),
          keepsake({ id: 'c', capturedAt: Date.parse('2026-05-02T08:00:00.000Z') }),
        ],
      }),
    );
    expect(offer?.visitCount).toBe(3);
    expect(offer?.distinctMonths).toBe(2);
  });

  it('ignores anchors from a nearby but different place', () => {
    const nextStreet = keepsake({ lat: 51.5090, lng: -0.1657, capturedAt: NOW - 300 * DAY_MS });
    expect(evaluatePlaceMemory(input({ candidates: [nextStreet] }))).toBeNull();
  });
});

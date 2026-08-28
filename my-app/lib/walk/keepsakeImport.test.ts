/**
 * Timestamp import.
 *
 * The tests that matter most are the refusals and the placement-honesty pair:
 * a photo with EXIF GPS gets a real coordinate, one without gets a pin but a
 * null coordinate. If an estimate ever leaked into lat/lng, place memory would
 * start recognising trees the dog never visited — and it would look completely
 * fine right up until it didn't.
 */

import {
  MAX_IMPORT_SUGGESTIONS,
  draftFromAsset,
  suggestImports,
  type ImportCandidate,
  type ImportContext,
} from './keepsakeImport';
import { IMPORT_GRACE_MS } from './keepsake';
import { placeKey } from './placeKey';

const START = Date.parse('2026-08-20T07:00:00.000Z');
const END = START + 30 * 60_000;

/** A short route heading north. */
const ROUTE = [
  { lat: 51.5070, lng: -0.1657 },
  { lat: 51.5072, lng: -0.1657 },
  { lat: 51.5074, lng: -0.1657 },
  { lat: 51.5076, lng: -0.1657 },
];

const CONTEXT: ImportContext = { startedAt: START, endedAt: END, route: ROUTE };

function asset(overrides: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    id: 'a1',
    creationTime: START + 10 * 60_000,
    width: 4032,
    height: 3024,
    ...overrides,
  };
}

describe('draftFromAsset — the window', () => {
  it('accepts a photo taken during the walk', () => {
    expect(draftFromAsset(asset(), CONTEXT)).not.toBeNull();
  });

  it('accepts the lead-clipping photo from just before Start', () => {
    const early = asset({ creationTime: START - 30_000 });
    expect(draftFromAsset(early, CONTEXT)).not.toBeNull();
  });

  it('refuses a photo from well before the walk', () => {
    const old = asset({ creationTime: START - IMPORT_GRACE_MS - 1 });
    expect(draftFromAsset(old, CONTEXT)).toBeNull();
  });

  it('refuses a photo from well after the walk', () => {
    const later = asset({ creationTime: END + IMPORT_GRACE_MS + 1 });
    expect(draftFromAsset(later, CONTEXT)).toBeNull();
  });

  it('refuses an asset with an unusable creation time', () => {
    expect(draftFromAsset(asset({ creationTime: NaN }), CONTEXT)).toBeNull();
  });
});

describe('draftFromAsset — placement honesty', () => {
  it('keeps the real coordinate when the camera recorded one', () => {
    const located = asset({ lat: 51.5072, lng: -0.1657 });
    const draft = draftFromAsset(located, CONTEXT);

    expect(draft?.lat).toBeCloseTo(51.5072);
    expect(draft?.lng).toBeCloseTo(-0.1657);
    expect(draft?.routeIndex).toBe(1);
    expect(draft?.placeKey).toBe(placeKey(51.5072, -0.1657));
    expect(draft?.positionEstimated).toBe(false);
  });

  it('estimates a pin from elapsed time but stores no coordinate', () => {
    // Halfway through the walk, no EXIF GPS.
    const draft = draftFromAsset(asset({ creationTime: START + 15 * 60_000 }), CONTEXT);

    expect(draft?.routeIndex).not.toBeNull();
    expect(draft?.positionEstimated).toBe(true);
    // The whole point: an estimate never becomes a coordinate...
    expect(draft?.lat).toBeNull();
    expect(draft?.lng).toBeNull();
    // ...and therefore never enters the place index.
    expect(draft?.placeKey).toBeNull();
  });

  it('refuses a located photo that was plainly somewhere else', () => {
    // Right time, wrong place — the photo of the kitchen, or one someone sent.
    const elsewhere = asset({ lat: 51.5072, lng: -0.1200 });
    expect(draftFromAsset(elsewhere, CONTEXT)).toBeNull();
  });

  it('still accepts a located photo when the walk recorded no route', () => {
    // Nothing to contradict it, so refusing would lose a real moment.
    const routeless: ImportContext = { ...CONTEXT, route: [] };
    const draft = draftFromAsset(asset({ lat: 51.5072, lng: -0.1657 }), routeless);
    expect(draft).not.toBeNull();
    expect(draft?.routeIndex).toBeNull();
  });

  it('records elapsed time into the walk', () => {
    const draft = draftFromAsset(asset({ creationTime: START + 300_000 }), CONTEXT);
    expect(draft?.elapsedS).toBe(300);
  });

  it('carries the media type through, defaulting to photo', () => {
    expect(draftFromAsset(asset(), CONTEXT)?.mediaType).toBe('photo');
    expect(draftFromAsset(asset({ mediaType: 'video' }), CONTEXT)?.mediaType).toBe('video');
  });
});

describe('suggestImports', () => {
  it('orders suggestions as they happened', () => {
    const drafts = suggestImports(
      [
        asset({ id: 'late', creationTime: START + 20 * 60_000 }),
        asset({ id: 'early', creationTime: START + 2 * 60_000 }),
        asset({ id: 'middle', creationTime: START + 10 * 60_000 }),
      ],
      CONTEXT,
    );
    expect(drafts.map((d) => d.localAssetId)).toEqual(['early', 'middle', 'late']);
  });

  it('skips assets the walk already holds', () => {
    // The in-app captures are saved to the library, so without this they would
    // come straight back as suggestions to re-import themselves.
    const drafts = suggestImports(
      [asset({ id: 'already' }), asset({ id: 'new', creationTime: START + 60_000 })],
      CONTEXT,
      ['already'],
    );
    expect(drafts.map((d) => d.localAssetId)).toEqual(['new']);
  });

  it('filters out everything outside the window', () => {
    const drafts = suggestImports(
      [
        asset({ id: 'yesterday', creationTime: START - 86_400_000 }),
        asset({ id: 'during', creationTime: START + 60_000 }),
        asset({ id: 'tomorrow', creationTime: END + 86_400_000 }),
      ],
      CONTEXT,
    );
    expect(drafts.map((d) => d.localAssetId)).toEqual(['during']);
  });

  it('caps the offer so the summary stays a glance, not a task', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      asset({ id: `a${i}`, creationTime: START + i * 10_000 }),
    );
    expect(suggestImports(many, CONTEXT)).toHaveLength(MAX_IMPORT_SUGGESTIONS);
  });

  it('keeps the earliest when it has to cap', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      asset({ id: `a${i}`, creationTime: START + i * 10_000 }),
    );
    expect(suggestImports(many, CONTEXT)[0].localAssetId).toBe('a0');
  });

  it('returns nothing for an empty library', () => {
    expect(suggestImports([], CONTEXT)).toEqual([]);
  });
});

/**
 * The two decisions that stand between a private photo and a shared album.
 *
 * Both are pure so they can be asserted without a network: publication is only
 * ever granted by the shutter-time choice, and a published moment is only ever
 * attached to a photo that really exists.
 */

import { capturesToSweep, clearCommunityMediaUrls, communityMediaUrls, selectSharedCaptures } from './communityMedia';
import { newClientId } from './walk/clientId';

// Hoisted above the import by jest; neither module is reached by the pure
// helpers under test, they are only on the path to them.
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

const mockCreateSignedUrls = jest.fn();
jest.mock('./supabase', () => ({
  supabase: { storage: { from: () => ({ createSignedUrls: mockCreateSignedUrls }) } },
}));

describe('selectSharedCaptures', () => {
  const captures = [
    { capturedAt: 1_000, uri: 'shared.jpg' },
    { capturedAt: 2_000, uri: 'personal.jpg' },
    { capturedAt: 3_000, uri: 'also-shared.jpg' },
  ];

  it('publishes only what was in Shared mode when the shutter was pressed', () => {
    const chosen = selectSharedCaptures(captures, new Set([1_000, 3_000]));
    expect(chosen.map(capture => capture.uri)).toEqual(['shared.jpg', 'also-shared.jpg']);
  });

  it('keeps a personal-only walk personal', () => {
    expect(selectSharedCaptures(captures, new Set())).toEqual([]);
  });
});

/**
 * `matchMediaRow` used to be tested here, and it is gone.
 *
 * It paired each capture to a `walk_media` row by timestamp, because the row
 * id was not known until the outbox had written it. That pairing was only ever
 * as good as the rows it was handed, and `readMediaRows` handed it one: the
 * poll returned as soon as the FIRST row landed, so every later capture found
 * nothing within tolerance and was dropped in silence.
 *
 * Measured across every trail walk in production — 8 walks, 14 photos — the
 * first shot published every time and the second and third never did.
 *
 * A capture now arrives already knowing its own row id, so there is nothing to
 * match and nothing to poll. The tests that would have caught this are the
 * id-threading ones in lib/walk/keepsake.test.ts, which pin the invariant that
 * actually matters: the id chosen at the shutter is the id the row is written
 * under.
 */

describe('newClientId', () => {
  it('is a v4-shaped uuid', () => {
    // Shape matters: this value goes into a UUID column, so a "good enough"
    // random string would be rejected by Postgres rather than by us.
    expect(newClientId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('does not repeat itself', () => {
    const ids = new Set(Array.from({ length: 2000 }, () => newClientId()));
    // Two photos on one walk sharing an id would mean one silently overwriting
    // the other through the upsert's conflict target.
    expect(ids.size).toBe(2000);
  });
});

/**
 * The cache exists to keep the URL STRING stable, not merely valid.
 *
 * `expo-image` keys on the URL, so a freshly signed string for a picture already
 * on screen is a cache miss: it downloads and decodes the same photo again. On
 * the live map that happened on every realtime event. These tests pin identity,
 * not just correctness — an assertion that the URL "works" would pass on exactly
 * the behaviour this replaced.
 */
describe('communityMediaUrls', () => {
  const signed = (paths: string[], run: number) => ({
    data: paths.map(path => ({ path, signedUrl: `https://cdn/${path}?token=run${run}` })),
    error: null,
  });

  let run = 0;
  let clock = 1_700_000_000_000;

  beforeEach(() => {
    clearCommunityMediaUrls();
    run = 0;
    clock = 1_700_000_000_000;
    jest.spyOn(Date, 'now').mockImplementation(() => clock);
    mockCreateSignedUrls.mockReset();
    mockCreateSignedUrls.mockImplementation(async (paths: string[]) => signed(paths, ++run));
  });

  afterEach(() => { jest.restoreAllMocks(); });

  it('signs on the first ask', async () => {
    expect(await communityMediaUrls(['a.jpg'])).toEqual({ 'a.jpg': 'https://cdn/a.jpg?token=run1' });
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('returns the SAME string next time, without a round trip', async () => {
    const first = await communityMediaUrls(['a.jpg', 'b.jpg']);
    const second = await communityMediaUrls(['a.jpg', 'b.jpg']);
    // Identity is the whole point: a different-but-valid URL would re-download.
    expect(second).toEqual(first);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('signs only the paths it does not already hold', async () => {
    await communityMediaUrls(['a.jpg']);
    const both = await communityMediaUrls(['a.jpg', 'b.jpg']);
    // A new photo landing on a live walk must not re-sign the twenty already
    // pinned to the map.
    expect(mockCreateSignedUrls).toHaveBeenNthCalledWith(2, ['b.jpg'], expect.any(Number));
    expect(both['a.jpg']).toBe('https://cdn/a.jpg?token=run1');
    expect(both['b.jpg']).toBe('https://cdn/b.jpg?token=run2');
  });

  it('re-signs before the signature expires, not after', async () => {
    await communityMediaUrls(['a.jpg']);
    // 55 minutes in: still valid, but inside the margin. A URL handed out now
    // would expire while somebody was still scrolling towards it.
    clock += 55 * 60_000;
    const refreshed = await communityMediaUrls(['a.jpg']);
    expect(refreshed['a.jpg']).toBe('https://cdn/a.jpg?token=run2');
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('still holds a URL that has plenty of life left', async () => {
    await communityMediaUrls(['a.jpg']);
    clock += 30 * 60_000;
    await communityMediaUrls(['a.jpg']);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
  });

  it('keeps what it holds when signing fails', async () => {
    await communityMediaUrls(['a.jpg']);
    mockCreateSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
    // Some pictures beats none: a failed signing for a NEW photo must not blank
    // the ones already on the map.
    const out = await communityMediaUrls(['a.jpg', 'b.jpg']);
    expect(out).toEqual({ 'a.jpg': 'https://cdn/a.jpg?token=run1' });
  });

  it('never signs nothing', async () => {
    expect(await communityMediaUrls([])).toEqual({});
    expect(await communityMediaUrls(['', ''])).toEqual({});
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it('forgets everything on sign-out', async () => {
    await communityMediaUrls(['a.jpg']);
    clearCommunityMediaUrls();
    await communityMediaUrls(['a.jpg']);
    // The next account on this device must not be handed a URL minted for the
    // previous one's pack.
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(2);
  });
});

describe('capturesToSweep (the finish-time backstop)', () => {
  const captures = [
    { capturedAt: 1, mediaId: 'published' },
    { capturedAt: 2, mediaId: 'failed' },
    { capturedAt: 3, mediaId: 'personal' },
    { capturedAt: 4, mediaId: 'never-started' },
  ];
  const shared = new Set([1, 2, 4]);

  it('skips only photos the server confirmed, so nothing uploads twice', () => {
    const swept = capturesToSweep(captures, shared, new Set(['published']));
    expect(swept.map(c => c.mediaId)).toEqual(['failed', 'never-started']);
  });

  it('never sweeps a personal-only photo', () => {
    expect(capturesToSweep(captures, shared).map(c => c.mediaId)).not.toContain('personal');
  });

  it('sweeps everything shared when nothing was confirmed — the offline walk', () => {
    expect(capturesToSweep(captures, shared).map(c => c.mediaId)).toEqual(['published', 'failed', 'never-started']);
  });
});

/**
 * The two decisions that stand between a private photo and a shared album.
 *
 * Both are pure so they can be asserted without a network: publication is only
 * ever granted by the shutter-time choice, and a published moment is only ever
 * attached to a photo that really exists.
 */

import { matchMediaRow, selectSharedCaptures } from './communityMedia';

// Hoisted above the import by jest; neither module is reached by the pure
// helpers under test, they are only on the path to them.
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('./supabase', () => ({ supabase: {} }));

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

describe('matchMediaRow', () => {
  it('pairs a capture with the row recorded for it', () => {
    const rows = [
      { id: 'a', captured_at: new Date(10_000).toISOString() },
      { id: 'b', captured_at: new Date(20_000).toISOString() },
    ];
    expect(matchMediaRow(rows, 20_400)?.id).toBe('b');
  });

  it('never lets one photo claim another taken nearby', () => {
    const rows = [
      { id: 'a', captured_at: new Date(10_000).toISOString() },
      { id: 'b', captured_at: new Date(10_800).toISOString() },
    ];
    expect(matchMediaRow(rows, 10_900)?.id).toBe('b');
    expect(matchMediaRow(rows, 10_100)?.id).toBe('a');
  });

  it('publishes nothing rather than guessing when no row is close enough', () => {
    const rows = [{ id: 'a', captured_at: new Date(10_000).toISOString() }];
    expect(matchMediaRow(rows, 30_000)).toBeNull();
  });

  it('ignores a row whose time cannot be read', () => {
    const rows = [{ id: 'broken', captured_at: 'not a date' }];
    expect(matchMediaRow(rows, 10_000)).toBeNull();
  });

  it('has nothing to match in an empty outbox', () => {
    expect(matchMediaRow([], 10_000)).toBeNull();
  });
});

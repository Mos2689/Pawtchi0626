// AsyncStorage is a native module; the suite runs under testEnvironment: node,
// so it is stubbed with a plain in-memory map here rather than added to the
// project-wide moduleNameMapper for one file.
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
import { isUsableSnapshot, readActivityDay, writeActivityDay } from './todayCache';

const TODAY = '2026-08-21';

function snapshot(over: Partial<Parameters<typeof writeActivityDay>[1]> = {}) {
  return {
    ymd: TODAY,
    activities: [{ id: 'a1', status: 'pending' }],
    foodScans: [],
    dailyLog: { water_ml: 250 },
    ...over,
  };
}

describe('isUsableSnapshot', () => {
  test('accepts an entry written for the day being viewed', () => {
    expect(isUsableSnapshot(snapshot(), TODAY)).toBe(true);
  });

  test("refuses yesterday's plan outright", () => {
    // The rule that matters: a stale day rendered as today would show walks
    // that are not scheduled and hide ones that are.
    expect(isUsableSnapshot(snapshot({ ymd: '2026-08-20' }), TODAY)).toBe(false);
  });

  test('refuses malformed or empty entries rather than trusting their shape', () => {
    expect(isUsableSnapshot(null, TODAY)).toBe(false);
    expect(isUsableSnapshot({}, TODAY)).toBe(false);
    expect(isUsableSnapshot({ ymd: TODAY }, TODAY)).toBe(false);
    expect(isUsableSnapshot({ ymd: TODAY, activities: 'nope', foodScans: [] }, TODAY)).toBe(false);
  });
});

describe('readActivityDay / writeActivityDay', () => {
  test('round-trips a day for the pet it was written for', async () => {
    await writeActivityDay('pet-1', snapshot());
    const read = await readActivityDay('pet-1', TODAY);
    expect(read).toMatchObject({ ymd: TODAY, dailyLog: { water_ml: 250 } });
    expect(read?.activities).toHaveLength(1);
  });

  test('one dog never reads another dog\'s plan', async () => {
    await writeActivityDay('pet-1', snapshot());
    expect(await readActivityDay('pet-2', TODAY)).toBeNull();
  });

  test('a cache written yesterday reads as a miss', async () => {
    await writeActivityDay('pet-3', snapshot({ ymd: '2026-08-20' }));
    expect(await readActivityDay('pet-3', TODAY)).toBeNull();
  });

  test('a miss is null, never a throw', async () => {
    expect(await readActivityDay('never-written', TODAY)).toBeNull();
  });

  test('unreadable storage degrades to a miss instead of breaking the screen', async () => {
    (AsyncStorage.getItem as jest.Mock).mockRejectedValueOnce(new Error('disk gone'));
    expect(await readActivityDay('pet-1', TODAY)).toBeNull();
  });

  test('a failed write is swallowed — it only costs one slow open', async () => {
    (AsyncStorage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    await expect(writeActivityDay('pet-1', snapshot())).resolves.toBeUndefined();
  });
});

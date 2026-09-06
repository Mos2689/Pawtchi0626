/**
 * The arrival prompt fires without being asked for, at a moment the owner is
 * standing somewhere real. That is a high bar, and these tests pin the ways it
 * could be cleared: a note that outlives its errand, one account seeing
 * another's destination, and a "you're here" shown to someone who is not.
 */

const mockStore = new Map<string, string>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: (k: string) => Promise.resolve(mockStore.has(k) ? mockStore.get(k)! : null),
  setItem: (k: string, v: string) => {
    mockStore.set(k, v);
    return Promise.resolve();
  },
  removeItem: (k: string) => {
    mockStore.delete(k);
    return Promise.resolve();
  },
}));

import {
  ARRIVAL_RADIUS_M,
  ARRIVAL_TTL_MS,
  armArrivalIntent,
  arrivalIntentKey,
  clearArrivalIntent,
  hasArrived,
  readArrivalIntent,
  type ArrivalIntent,
} from './arrivalIntent';

const USER_A = 'user-a';
const USER_B = 'user-b';
const T0 = 1_700_000_000_000;

/** Calangute Beach, near enough. */
const BEACH = { spotId: 'osm:way/1', name: 'Calangute Beach', lat: 15.5439, lng: 73.7553 };

const intentAt = (overrides: Partial<ArrivalIntent> = {}): ArrivalIntent => ({
  ...BEACH,
  armedAt: T0,
  ...overrides,
});

beforeEach(() => {
  mockStore.clear();
});

describe('armArrivalIntent', () => {
  it('round-trips the destination the owner asked directions to', async () => {
    await armArrivalIntent(USER_A, BEACH, T0);

    await expect(readArrivalIntent(USER_A, T0 + 1000)).resolves.toEqual(intentAt());
  });

  it('supersedes the previous note rather than queueing it', async () => {
    await armArrivalIntent(USER_A, BEACH, T0);
    await armArrivalIntent(
      USER_A,
      { spotId: 'osm:way/2', name: 'Anjuna Beach', lat: 15.5752, lng: 73.7401 },
      T0 + 60_000,
    );

    const stored = await readArrivalIntent(USER_A, T0 + 60_000);
    // An owner heading to Anjuna instead is not still heading to Calangute.
    expect(stored?.name).toBe('Anjuna Beach');
  });

  it('writes nothing without an account, so no key can be inherited later', async () => {
    await armArrivalIntent(null, BEACH, T0);

    expect([...mockStore.keys()]).toEqual([]);
  });

  it('keeps one owner’s destination off another owner’s device account', async () => {
    await armArrivalIntent(USER_A, BEACH, T0);

    await expect(readArrivalIntent(USER_B, T0)).resolves.toBeNull();
    expect(mockStore.has(arrivalIntentKey(USER_A))).toBe(true);
  });

  it('survives a storage failure without throwing at the call site', async () => {
    const storage = jest.requireMock('@react-native-async-storage/async-storage') as {
      setItem: (k: string, v: string) => Promise<void>;
    };
    const original = storage.setItem;
    storage.setItem = () => Promise.reject(new Error('disk full'));

    // The map app still has to open. Losing the prompt is the acceptable cost.
    await expect(armArrivalIntent(USER_A, BEACH, T0)).resolves.toBeUndefined();

    storage.setItem = original;
  });
});

describe('readArrivalIntent', () => {
  it('still holds at the last moment inside the window', async () => {
    await armArrivalIntent(USER_A, BEACH, T0);

    await expect(readArrivalIntent(USER_A, T0 + ARRIVAL_TTL_MS)).resolves.not.toBeNull();
  });

  it('forgets an errand that has been and gone', async () => {
    await armArrivalIntent(USER_A, BEACH, T0);

    await expect(readArrivalIntent(USER_A, T0 + ARRIVAL_TTL_MS + 1)).resolves.toBeNull();
  });

  it('deletes the expired note rather than leaving it to fail every read', async () => {
    await armArrivalIntent(USER_A, BEACH, T0);

    await readArrivalIntent(USER_A, T0 + ARRIVAL_TTL_MS + 1);

    expect(mockStore.has(arrivalIntentKey(USER_A))).toBe(false);
  });

  it('discards a note from the future, so a rolled-back clock cannot pin one', async () => {
    await armArrivalIntent(USER_A, BEACH, T0);

    await expect(readArrivalIntent(USER_A, T0 - 1)).resolves.toBeNull();
    expect(mockStore.has(arrivalIntentKey(USER_A))).toBe(false);
  });

  it('treats a half-written record as no record', async () => {
    mockStore.set(arrivalIntentKey(USER_A), JSON.stringify({ spotId: 'x', name: 'X' }));

    await expect(readArrivalIntent(USER_A, T0)).resolves.toBeNull();
    expect(mockStore.has(arrivalIntentKey(USER_A))).toBe(false);
  });

  it('treats unparseable storage as no record', async () => {
    mockStore.set(arrivalIntentKey(USER_A), 'not json');

    await expect(readArrivalIntent(USER_A, T0)).resolves.toBeNull();
  });

  it('returns nothing for a signed-out read', async () => {
    await expect(readArrivalIntent(null, T0)).resolves.toBeNull();
    await expect(readArrivalIntent(undefined, T0)).resolves.toBeNull();
  });
});

describe('clearArrivalIntent', () => {
  it('answers the note for one account and leaves the other alone', async () => {
    await armArrivalIntent(USER_A, BEACH, T0);
    await armArrivalIntent(USER_B, BEACH, T0);

    await clearArrivalIntent(USER_A);

    await expect(readArrivalIntent(USER_A, T0)).resolves.toBeNull();
    await expect(readArrivalIntent(USER_B, T0)).resolves.not.toBeNull();
  });
});

describe('hasArrived', () => {
  it('is true standing on the pin', () => {
    expect(hasArrived(intentAt(), { lat: BEACH.lat, lng: BEACH.lng })).toBe(true);
  });

  it('is true from the car park at the road end', () => {
    // ~200 m north of the pin — a beach's OSM node is rarely where anyone parks.
    expect(hasArrived(intentAt(), { lat: BEACH.lat + 0.0018, lng: BEACH.lng })).toBe(true);
  });

  it('is false from a kilometre away', () => {
    expect(hasArrived(intentAt(), { lat: BEACH.lat + 0.009, lng: BEACH.lng })).toBe(false);
  });

  it('is false with no position, rather than assuming the owner is there', () => {
    // The whole prompt rests on this: no fix means no claim about where anyone
    // is standing. Silence is the only correct output.
    expect(hasArrived(intentAt(), null)).toBe(false);
    expect(hasArrived(intentAt(), undefined)).toBe(false);
  });

  it('is false for a garbage fix', () => {
    expect(hasArrived(intentAt(), { lat: Number.NaN, lng: BEACH.lng })).toBe(false);
  });

  it('honours an explicit radius, so the default is not load-bearing in callers', () => {
    const justOutside = { lat: BEACH.lat + 0.0028, lng: BEACH.lng };

    expect(hasArrived(intentAt(), justOutside, ARRIVAL_RADIUS_M)).toBe(false);
    expect(hasArrived(intentAt(), justOutside, 1000)).toBe(true);
  });
});

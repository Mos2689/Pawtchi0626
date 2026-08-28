/**
 * The pending-celebration marker is per account: a reading earned by one
 * owner's dog must not be sitting there for the next account on the device, and
 * dismissing it must not clear anyone else's.
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

jest.mock('../supabase', () => ({ supabase: {} }));
jest.mock('../analytics', () => ({ track: jest.fn() }));
jest.mock('../../store/useActivePetStore', () => ({
  useActivePetStore: { getState: () => ({ activePet: null }), setState: jest.fn() },
}));

import {
  clearPendingWalksignCelebration,
  readPendingWalksignCelebration,
  walksignCelebrationKey,
  type PendingWalksignCelebration,
} from './walksignSync';

const OWNER_A = 'owner-a';
const OWNER_B = 'owner-b';

function celebration(petId: string): PendingWalksignCelebration {
  return {
    petId,
    event: 'confirmed',
    sign: 'the_explorer' as PendingWalksignCelebration['sign'],
    previousSign: null,
    validWalkCount: 5,
    at: new Date('2026-08-19T08:00:00.000Z').toISOString(),
  };
}

beforeEach(() => {
  mockStore.clear();
});

it('reads back only the signed-in owner’s pending celebration', async () => {
  mockStore.set(walksignCelebrationKey(OWNER_A), JSON.stringify(celebration('pet-a')));

  await expect(readPendingWalksignCelebration(OWNER_A)).resolves.toMatchObject({
    petId: 'pet-a',
  });
  await expect(readPendingWalksignCelebration(OWNER_B)).resolves.toBeNull();
  await expect(readPendingWalksignCelebration(null)).resolves.toBeNull();
});

it('ignores the pre-namespacing global key', async () => {
  mockStore.set('walksign:pending_celebration', JSON.stringify(celebration('pet-a')));

  await expect(readPendingWalksignCelebration(OWNER_A)).resolves.toBeNull();
});

it('clears one owner’s marker without touching the other’s', async () => {
  mockStore.set(walksignCelebrationKey(OWNER_A), JSON.stringify(celebration('pet-a')));
  mockStore.set(walksignCelebrationKey(OWNER_B), JSON.stringify(celebration('pet-b')));

  await clearPendingWalksignCelebration(OWNER_A);

  expect(mockStore.has(walksignCelebrationKey(OWNER_A))).toBe(false);
  expect(mockStore.has(walksignCelebrationKey(OWNER_B))).toBe(true);
});

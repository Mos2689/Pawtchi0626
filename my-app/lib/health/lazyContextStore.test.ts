/**
 * The pet context store's side of perf-lazy-pet-context, against the real
 * store: what gets saved after a fetch, and when a saved answer may paint.
 *
 * The rule under test is the one that keeps a stand-in from ever beating the
 * truth: a restore applies only while NOTHING real has arrived this session —
 * no fetch landed, no write made — and only for the active pet. It never
 * counts as a fetch, so the deferred one still runs.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { getLocalYMD } from '../dateUtils';
import { resetPerfFlagsForTests, setPerfFlagOverride } from '../perfFlags';
import { useActivePetStore, type Pet } from '../../store/useActivePetStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { clearContextSnapshot, flushContextSnapshotWrites, readContextSnapshot, saveContextSnapshot } from './lazyContext';

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

const mockRpc = jest.fn();
jest.mock('../supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

const disk = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;
const today = () => getLocalYMD(new Date());

const pet = {
  id: 'pet1',
  owner_id: 'u1',
  name: 'Sma',
  species: 'dog',
  current_weight_kg: 9,
  target_daily_calories: 800,
} as unknown as Pet;

/** What get_pet_dashboard returns, cut down to a quiet day with one meal. */
const dashboard = {
  today_log: { calories_consumed: 300, water_ml: 250, walks_count: 1, treats_consumed: 0 },
  today_scans: [],
  next_activity: null,
  today_activities: [],
  logs7: [],
  acts_this: [],
  acts_last: [],
  water7: [],
  weight2: [],
  treats7: [],
  treat_scans7: [],
  acts_intensity: [],
  food_last: [],
  logs28: [],
  weight_logs28: [],
};

const saved = (overrides: Partial<{ userId: string; petId: string; date: string }> = {}) => ({
  userId: 'u1',
  petId: 'pet1',
  date: today(),
  today: { todayCalories: 420, todayWater: 500 },
  trends: { weeklyDelta: -150, weightTrend: { latest: 9, previous: 9.2, direction: 'down' } },
  ...overrides,
});

beforeEach(async () => {
  clearContextSnapshot();
  await flushContextSnapshotWrites();
  disk.clear();
  resetPerfFlagsForTests();
  mockRpc.mockReset();
  mockRpc.mockResolvedValue({ data: dashboard, error: null });
  useActivePetStore.setState({ activePet: pet });
  usePetContextStore.getState().clearContext();
  usePetContextStore.setState({ dataVersion: 0 });
});

describe('restoreSnapshot', () => {
  it('paints the saved answer for the active pet, without counting as a fetch', async () => {
    saveContextSnapshot(saved());
    await flushContextSnapshotWrites();
    await expect(usePetContextStore.getState().restoreSnapshot('u1', 'pet1')).resolves.toBe(true);
    const state = usePetContextStore.getState();
    expect(state.todayCalories).toBe(420);
    expect(state.weeklyDelta).toBe(-150);
    expect(state.weightTrend?.direction).toBe('down');
    // Fields the snapshot did not carry fall back to the empty day, not to junk.
    expect(state.todayScans).toEqual([]);
    // Still stale, so the deferred fetch runs and replaces it.
    expect(state._todayFetchedAt).toBe(0);
    expect(state._trendsFetchedAt).toBe(0);
    expect(state._contextPetId).toBeNull();
  });

  it('never over a fetch that has already landed', async () => {
    saveContextSnapshot(saved());
    await flushContextSnapshotWrites();
    await usePetContextStore.getState().refreshToday('pet1', { force: true });
    expect(usePetContextStore.getState().todayCalories).toBe(300);
    await expect(usePetContextStore.getState().restoreSnapshot('u1', 'pet1')).resolves.toBe(false);
    expect(usePetContextStore.getState().todayCalories).toBe(300);
  });

  it('never over a write made this session — a meal logged before the disk answered', async () => {
    saveContextSnapshot(saved());
    await flushContextSnapshotWrites();
    usePetContextStore.getState().updateCalories(510);
    usePetContextStore.getState().invalidateContext();
    await expect(usePetContextStore.getState().restoreSnapshot('u1', 'pet1')).resolves.toBe(false);
    expect(usePetContextStore.getState().todayCalories).toBe(510);
  });

  it('never for a pet that is no longer the active one', async () => {
    saveContextSnapshot(saved());
    await flushContextSnapshotWrites();
    useActivePetStore.setState({ activePet: { ...pet, id: 'pet2' } as Pet });
    await expect(usePetContextStore.getState().restoreSnapshot('u1', 'pet1')).resolves.toBe(false);
  });

  it('nothing to restore is a quiet no', async () => {
    await expect(usePetContextStore.getState().restoreSnapshot('u1', 'pet1')).resolves.toBe(false);
    expect(usePetContextStore.getState().todayCalories).toBe(0);
  });
});

describe('saving after a fetch', () => {
  it('keeps the answer that landed, with the flag on', async () => {
    setPerfFlagOverride('lazyPetContext', true);
    await usePetContextStore.getState().refreshToday('pet1', { force: true });
    await flushContextSnapshotWrites();
    const kept = await readContextSnapshot({ userId: 'u1', petId: 'pet1', date: today() });
    expect(kept?.today.todayCalories).toBe(300);
    expect(kept?.today.todayWater).toBe(250);
  });

  it('writes nothing with the flag off — build 98 exactly', async () => {
    setPerfFlagOverride('lazyPetContext', false);
    await usePetContextStore.getState().refreshToday('pet1', { force: true });
    await flushContextSnapshotWrites();
    expect(disk.has('pet-context:snapshot:v1')).toBe(false);
  });

  it('never under another pet when the active pet changed mid-fetch', async () => {
    setPerfFlagOverride('lazyPetContext', true);
    const pending = usePetContextStore.getState().refreshToday('pet1', { force: true });
    useActivePetStore.setState({ activePet: { ...pet, id: 'pet2' } as Pet });
    await pending;
    await flushContextSnapshotWrites();
    expect(disk.has('pet-context:snapshot:v1')).toBe(false);
  });
});

afterAll(() => {
  resetPerfFlagsForTests();
});

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
import {
  MAX_RESTORE_AGE_MS,
  clearConnectSnapshot,
  loadConnectSnapshot,
  resetConnectSnapshotForTests,
  restoreConnectSnapshot,
  saveConnectPacks,
  saveConnectRoutes,
} from './connectSnapshot';

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;
const flush = () => new Promise(resolve => setImmediate(resolve));
const pack = (id: string) => ({ id, name: id, owner_id: 'u1', created_at: '', updated_at: '' }) as any;

beforeEach(() => {
  store.clear();
  resetConnectSnapshotForTests();
});

describe('connectSnapshot', () => {
  it('survives a restart: saved, then read back for the same user', async () => {
    saveConnectPacks('u1', [pack('a')], 1_000, 2_000);
    await flush();
    resetConnectSnapshotForTests(); // the process dies; the disk remains
    await loadConnectSnapshot();
    expect(restoreConnectSnapshot('u1', 3_000)?.packs.map(p => p.id)).toEqual(['a']);
  });

  it('never hands one account another account’s meetups', async () => {
    saveConnectPacks('u1', [pack('a')], 1_000, 2_000);
    expect(restoreConnectSnapshot('u2', 3_000)).toBeNull();
    expect(restoreConnectSnapshot(null, 3_000)).toBeNull();
  });

  it('refuses anything older than the restore limit', () => {
    saveConnectPacks('u1', [pack('a')], 1_000, 2_000);
    expect(restoreConnectSnapshot('u1', 2_000 + MAX_RESTORE_AGE_MS)).not.toBeNull();
    expect(restoreConnectSnapshot('u1', 2_000 + MAX_RESTORE_AGE_MS + 1)).toBeNull();
  });

  it('does not restore an empty list — "no meetups" is only ever the server’s claim', () => {
    saveConnectPacks('u1', [], 1_000, 2_000);
    expect(restoreConnectSnapshot('u1', 3_000)).toBeNull();
  });

  it('keeps routes only for trails still on the list', () => {
    saveConnectPacks('u1', [pack('a'), pack('b')], 1_000, 2_000);
    saveConnectRoutes('u1', { a: [{ lat: 1, lng: 2 }], z: [{ lat: 3, lng: 4 }] }, 1_000);
    expect(Object.keys(restoreConnectSnapshot('u1', 3_000)!.routes)).toEqual(['a']);
    saveConnectPacks('u1', [pack('b')], 1_000, 4_000);
    expect(restoreConnectSnapshot('u1', 5_000)!.routes).toEqual({});
  });

  it('clears memory and disk on sign-out', async () => {
    saveConnectPacks('u1', [pack('a')], 1_000, 2_000);
    await flush();
    clearConnectSnapshot(5_000);
    await flush();
    expect(restoreConnectSnapshot('u1', 6_000)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('refuses a save whose request began before the sign-out', async () => {
    clearConnectSnapshot(5_000);
    saveConnectPacks('u1', [pack('a')], 4_000, 6_000);
    await flush();
    expect(restoreConnectSnapshot('u1', 7_000)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('treats a corrupt slot as no slot', async () => {
    store.set('connect:snapshot:v1', '{not json');
    await loadConnectSnapshot();
    expect(restoreConnectSnapshot('u1', 1)).toBeNull();
  });
});

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
  PUSH_ENABLED_TTL_MS,
  RESYNC_AFTER_MS,
  clearNotifSync,
  markSynced,
  needsSync,
  readPushEnabled,
  rememberPushEnabled,
  resetNotifSyncForTests,
  shouldSync,
} from './notifSync';

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  store.clear();
  resetNotifSyncForTests();
});

describe('needsSync', () => {
  it('sends what was never sent', () => {
    expect(needsSync(null, 'a', 1)).toBe(true);
  });

  it('sends a changed value', () => {
    expect(needsSync({ value: 'a', at: 0 }, 'b', 1)).toBe(true);
  });

  it('skips an unchanged value inside the resync window', () => {
    expect(needsSync({ value: 'a', at: 0 }, 'a', RESYNC_AFTER_MS - 1)).toBe(false);
  });

  it('re-sends an unchanged value once the window has passed', () => {
    expect(needsSync({ value: 'a', at: 0 }, 'a', RESYNC_AFTER_MS)).toBe(true);
  });

  it('re-sends when the clock went backwards', () => {
    expect(needsSync({ value: 'a', at: 10_000 }, 'a', 5_000)).toBe(true);
  });
});

describe('the ledger', () => {
  it('skips a value the server accepted, and survives a restart', async () => {
    await markSynced('push_token', 'u1', 'T|ios|Australia/Sydney', 1_000);
    resetNotifSyncForTests(); // the process dies; the disk remains
    expect(await shouldSync('push_token', 'u1', 'T|ios|Australia/Sydney', 2_000)).toBe(false);
  });

  it('keeps users apart', async () => {
    await markSynced('push_token', 'u1', 'T', 1_000);
    expect(await shouldSync('push_token', 'u2', 'T', 2_000)).toBe(true);
  });

  it('keeps kinds apart', async () => {
    await markSynced('push_token', 'u1', 'granted', 1_000);
    expect(await shouldSync('notification_permission', 'u1', 'granted', 2_000)).toBe(true);
  });

  it('forgets everything on sign-out, so a returning user registers again', async () => {
    await markSynced('push_token', 'u1', 'T', 1_000);
    clearNotifSync();
    expect(await shouldSync('push_token', 'u1', 'T', 2_000)).toBe(true);
    resetNotifSyncForTests();
    expect(await shouldSync('push_token', 'u1', 'T', 3_000)).toBe(true);
  });

  it('does not let a write started before sign-out land after it', async () => {
    const pending = markSynced('push_token', 'u1', 'T', 1_000);
    clearNotifSync();
    await pending;
    expect(await shouldSync('push_token', 'u1', 'T', 2_000)).toBe(true);
  });

  it('answers yes when the disk holds garbage', async () => {
    store.set('notif-sync-ledger:v1', '{not json');
    expect(await shouldSync('push_token', 'u1', 'T', 1_000)).toBe(true);
  });

  it('drops malformed entries rather than trusting them', async () => {
    store.set('notif-sync-ledger:v1', JSON.stringify({ 'push_token:u1': { value: 'T', at: 'yesterday' } }));
    expect(await shouldSync('push_token', 'u1', 'T', 1_000)).toBe(true);
  });
});

describe('push_enabled memo', () => {
  it('reuses a fresh read for the same owner', () => {
    rememberPushEnabled('u1', false, 1_000);
    expect(readPushEnabled('u1', 1_000 + PUSH_ENABLED_TTL_MS)).toBe(false);
  });

  it('expires', () => {
    rememberPushEnabled('u1', true, 1_000);
    expect(readPushEnabled('u1', 1_001 + PUSH_ENABLED_TTL_MS)).toBeUndefined();
  });

  it('never answers for another owner', () => {
    rememberPushEnabled('u1', true, 1_000);
    expect(readPushEnabled('u2', 1_000)).toBeUndefined();
  });

  it('is forgotten on sign-out', () => {
    rememberPushEnabled('u1', true, 1_000);
    clearNotifSync();
    expect(readPushEnabled('u1', 1_000)).toBeUndefined();
  });
});

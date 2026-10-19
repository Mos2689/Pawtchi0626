// AsyncStorage is a native module; the suite runs under testEnvironment: node.
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
  announcementStateKey,
  normalizeState,
  readAnnouncementState,
  recordCompleted,
  recordDismissed,
  recordShown,
  resetAnnouncementState,
} from './announcementState';

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => store.clear());

describe('announcementState', () => {
  test('a new account has seen nothing', async () => {
    expect(await readAnnouncementState('u1')).toEqual({});
  });

  test('records a showing with its time', async () => {
    await recordShown('u1', 'connect', 1000);
    await recordShown('u1', 'connect', 2000);
    expect((await readAnnouncementState('u1')).connect).toEqual({
      shows: 2,
      dismissals: 0,
      completed: false,
      lastShownAt: 2000,
    });
  });

  test('records dismissals and completion without losing the show count', async () => {
    await recordShown('u1', 'connect', 1000);
    await recordDismissed('u1', 'connect');
    await recordCompleted('u1', 'connect');
    const r = (await readAnnouncementState('u1')).connect;
    expect(r).toMatchObject({ shows: 1, dismissals: 1, completed: true });
  });

  test('keeps accounts on one phone apart', async () => {
    await recordShown('u1', 'connect', 1000);
    expect(await readAnnouncementState('u2')).toEqual({});
  });

  test('keeps announcements apart', async () => {
    await recordShown('u1', 'a', 1000);
    await recordShown('u1', 'b', 2000);
    const s = await readAnnouncementState('u1');
    expect(s.a.shows).toBe(1);
    expect(s.b.shows).toBe(1);
  });

  test('corrupt JSON reads as never seen', async () => {
    store.set(announcementStateKey('u1'), '{not json');
    expect(await readAnnouncementState('u1')).toEqual({});
  });

  test('bad fields are repaired entry by entry', () => {
    expect(normalizeState({ a: { shows: -3, dismissals: 'x', completed: 'yes', lastShownAt: 'never' }, b: null })).toEqual({
      a: { shows: 0, dismissals: 0, completed: false, lastShownAt: null },
    });
    expect(normalizeState([1, 2])).toEqual({});
  });

  test('reset forgets the account', async () => {
    await recordShown('u1', 'connect', 1000);
    await resetAnnouncementState('u1');
    expect(await readAnnouncementState('u1')).toEqual({});
  });
});

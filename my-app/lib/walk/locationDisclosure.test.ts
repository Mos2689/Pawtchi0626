/**
 * The disclosure is a compliance gate, not a preference: every account has to
 * be shown it before location is collected for them. These tests pin the two
 * ways that can go wrong — one account's acknowledgement standing in for
 * another's, and a read that can't decide answering "already seen".
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
  getAllKeys: () => Promise.resolve([...mockStore.keys()]),
  multiRemove: (keys: string[]) => {
    keys.forEach(k => mockStore.delete(k));
    return Promise.resolve();
  },
}));

import {
  acknowledgeLocationDisclosure,
  hasAcknowledgedLocationDisclosure,
  locationDisclosureKey,
  resetLocationDisclosure,
} from './locationDisclosure';

const USER_A = 'user-a';
const USER_B = 'user-b';

beforeEach(() => {
  mockStore.clear();
});

describe('hasAcknowledgedLocationDisclosure', () => {
  it('is false for an account that has never seen it', async () => {
    await expect(hasAcknowledgedLocationDisclosure(USER_A)).resolves.toBe(false);
  });

  it('is true only for the account that accepted it', async () => {
    await acknowledgeLocationDisclosure(USER_A);

    await expect(hasAcknowledgedLocationDisclosure(USER_A)).resolves.toBe(true);
    // The bug this replaces: a second account on the same device inherited the
    // first owner's acknowledgement and never saw the disclosure at all.
    await expect(hasAcknowledgedLocationDisclosure(USER_B)).resolves.toBe(false);
  });

  it('does not honour the pre-namespacing global key', async () => {
    mockStore.set('walk:location_disclosure_ack', '1');

    await expect(hasAcknowledgedLocationDisclosure(USER_A)).resolves.toBe(false);
  });

  it('fails open with no signed-in account', async () => {
    await expect(hasAcknowledgedLocationDisclosure(null)).resolves.toBe(false);
    await expect(hasAcknowledgedLocationDisclosure(undefined)).resolves.toBe(false);
  });

  it('fails open when storage throws', async () => {
    await acknowledgeLocationDisclosure(USER_A);
    const storage = jest.requireMock('@react-native-async-storage/async-storage') as {
      getItem: (k: string) => Promise<string | null>;
    };
    const original = storage.getItem;
    storage.getItem = () => Promise.reject(new Error('boom'));

    await expect(hasAcknowledgedLocationDisclosure(USER_A)).resolves.toBe(false);

    storage.getItem = original;
  });
});

describe('acknowledgeLocationDisclosure', () => {
  it('writes nothing without an account, so no key can be inherited later', async () => {
    await acknowledgeLocationDisclosure(null);

    expect([...mockStore.keys()]).toEqual([]);
  });
});

describe('resetLocationDisclosure', () => {
  it('clears one account and leaves the other alone', async () => {
    await acknowledgeLocationDisclosure(USER_A);
    await acknowledgeLocationDisclosure(USER_B);

    await resetLocationDisclosure(USER_A);

    await expect(hasAcknowledgedLocationDisclosure(USER_A)).resolves.toBe(false);
    await expect(hasAcknowledgedLocationDisclosure(USER_B)).resolves.toBe(true);
  });

  it('sweeps every account plus the legacy global key when called bare', async () => {
    await acknowledgeLocationDisclosure(USER_A);
    await acknowledgeLocationDisclosure(USER_B);
    mockStore.set('walk:location_disclosure_ack', '1');
    mockStore.set('unrelated:key', 'keep');

    await resetLocationDisclosure();

    expect(mockStore.has(locationDisclosureKey(USER_A))).toBe(false);
    expect(mockStore.has(locationDisclosureKey(USER_B))).toBe(false);
    expect(mockStore.has('walk:location_disclosure_ack')).toBe(false);
    expect(mockStore.get('unrelated:key')).toBe('keep');
  });
});

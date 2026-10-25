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
  canCreateAccount,
  dogNameOrFallback,
  freshSignupDestination,
  isValidEmail,
  OPTIONAL_STEPS,
  passwordStrength,
  SIGNUP_STEPS,
  signupProgress,
  signupStepIndex,
  usernameFormat,
} from './signupFlow';
import {
  clearSignupDraft,
  getSignupDraft,
  hasSignupDraft,
  loadSignupDraft,
  normalizeDraft,
  resetSignupDraftMemoryForTests,
  saveSignupDraft,
  SIGNUP_DRAFT_KEY,
} from './signupDraft';
import { pointAlong, sampleRoute } from './routeGeometry';
import { fillCopy, signupCopy } from './copy';

const store = (AsyncStorage as unknown as { __store: Map<string, string> }).__store;

const draft = {
  name: 'Bruno',
  imageUri: 'file:///cache/bruno.jpg',
  breed: 'Cavoodle',
  ageYears: 3,
  firstDog: true,
  householdWalkers: 1,
  username: 'bruno_walks',
};

beforeEach(() => {
  store.clear();
  resetSignupDraftMemoryForTests();
});

describe('steps', () => {
  test('dog first, account last', () => {
    expect(SIGNUP_STEPS[0]).toBe('name');
    expect(SIGNUP_STEPS[SIGNUP_STEPS.length - 1]).toBe('account');
    expect(signupStepIndex('name')).toBe(1);
    expect(signupStepIndex('account')).toBe(SIGNUP_STEPS.length);
  });

  test('only the name and the account are required', () => {
    expect(OPTIONAL_STEPS.has('name')).toBe(false);
    expect(OPTIONAL_STEPS.has('account')).toBe(false);
    for (const s of ['photo', 'breed', 'age', 'first_dog', 'walkers'] as const) {
      expect(OPTIONAL_STEPS.has(s)).toBe(true);
    }
  });

  test('progress starts at 0 and never arrives before the account exists', () => {
    expect(signupProgress(0)).toBe(0);
    expect(signupProgress(SIGNUP_STEPS.length - 1)).toBeLessThan(1);
    expect(signupProgress(SIGNUP_STEPS.length)).toBe(1);
    expect(signupProgress(99)).toBe(1);
  });
});

describe('account rules', () => {
  test('email format', () => {
    expect(isValidEmail('jo@example.com')).toBe(true);
    expect(isValidEmail(' jo@example.com ')).toBe(true);
    expect(isValidEmail('jo@example')).toBe(false);
    expect(isValidEmail('jo example.com')).toBe(false);
  });

  test('username is optional, and only its format is checked here', () => {
    expect(usernameFormat('')).toBe('empty');
    expect(usernameFormat('bruno_walks')).toBe('ok');
    expect(usernameFormat('ab')).toBe('bad');
  });

  test('create needs a valid email, an 8+ password, and a username that is empty or well formed', () => {
    expect(canCreateAccount({ email: 'jo@example.com', password: '12345678', username: '' })).toBe(true);
    expect(canCreateAccount({ email: 'jo@example.com', password: '1234567', username: '' })).toBe(false);
    expect(canCreateAccount({ email: 'nope', password: '12345678', username: '' })).toBe(false);
    expect(canCreateAccount({ email: 'jo@example.com', password: '12345678', username: 'ab' })).toBe(false);
  });

  test('password strength grows with length and variety', () => {
    expect(passwordStrength('')).toBe(0);
    expect(passwordStrength('abcd')).toBeLessThan(passwordStrength('abcdefghijkl'));
    expect(passwordStrength('Abcdefghijk1!')).toBe(1);
  });

  test('headings never show an empty name', () => {
    expect(dogNameOrFallback('  ')).toBe('your dog');
    expect(dogNameOrFallback(' Bruno ')).toBe('Bruno');
  });
});

describe('fresh sign-up routing', () => {
  test('a draft goes to finish; none goes to the classic identity screen', () => {
    expect(freshSignupDestination(true)).toBe('/onboarding/finish');
    expect(freshSignupDestination(false)).toBe('/onboarding/identity');
  });
});

describe('signupDraft', () => {
  test('save puts it in memory for the gate and on disk for a restart', async () => {
    await saveSignupDraft(draft);
    expect(hasSignupDraft()).toBe(true);
    expect(JSON.parse(store.get(SIGNUP_DRAFT_KEY)!)).toEqual(draft);
  });

  test('load re-warms memory after a restart', async () => {
    store.set(SIGNUP_DRAFT_KEY, JSON.stringify(draft));
    expect(hasSignupDraft()).toBe(false);
    expect(await loadSignupDraft()).toEqual(draft);
    expect(hasSignupDraft()).toBe(true);
    expect(getSignupDraft()).toEqual(draft);
  });

  test('clear forgets both', async () => {
    await saveSignupDraft(draft);
    await clearSignupDraft();
    expect(hasSignupDraft()).toBe(false);
    expect(store.has(SIGNUP_DRAFT_KEY)).toBe(false);
  });

  test('corrupt or nameless drafts read as none', async () => {
    store.set(SIGNUP_DRAFT_KEY, '{oops');
    expect(await loadSignupDraft()).toBeNull();
    expect(normalizeDraft({ ...draft, name: '  ' })).toBeNull();
    expect(normalizeDraft([1])).toBeNull();
  });

  test('bad fields are dropped, not trusted', () => {
    expect(normalizeDraft({ name: 'Bruno', ageYears: 'three', firstDog: 'yes', imageUri: 4 })).toEqual({
      name: 'Bruno',
      imageUri: null,
      breed: null,
      ageYears: null,
      firstDog: null,
      householdWalkers: null,
      username: '',
    });
  });
});

describe('routeGeometry', () => {
  const route = sampleRoute(240, 26);

  test('starts and ends inside the padding', () => {
    expect(route.xs[0]).toBe(10);
    expect(route.xs[route.xs.length - 1]).toBe(230);
    expect(route.total).toBeGreaterThan(220);
    expect(route.d.startsWith('M 10 13')).toBe(true);
  });

  test('pointAlong walks from start to end', () => {
    const start = pointAlong(route.xs, route.ys, route.lengths, 0);
    const end = pointAlong(route.xs, route.ys, route.lengths, 1);
    const mid = pointAlong(route.xs, route.ys, route.lengths, 0.5);
    expect(start).toEqual({ x: route.xs[0], y: route.ys[0] });
    expect(end).toEqual({ x: route.xs[route.xs.length - 1], y: route.ys[route.ys.length - 1] });
    expect(mid.x).toBeGreaterThan(start.x);
    expect(mid.x).toBeLessThan(end.x);
  });

  test('clamps fractions outside 0–1', () => {
    expect(pointAlong(route.xs, route.ys, route.lengths, -1)).toEqual(
      pointAlong(route.xs, route.ys, route.lengths, 0),
    );
    expect(pointAlong(route.xs, route.ys, route.lengths, 2)).toEqual(
      pointAlong(route.xs, route.ys, route.lengths, 1),
    );
  });
});

describe('copy', () => {
  function strings(node: unknown): string[] {
    if (typeof node === 'string') return [node];
    if (node && typeof node === 'object') return Object.values(node).flatMap(strings);
    return [];
  }

  test('follows the copy spec', () => {
    for (const s of strings(signupCopy)) {
      expect(s).not.toMatch(/!/);
      expect(s.trim()).toBe(s);
    }
  });

  test('headings carry their end punctuation separately', () => {
    for (const section of Object.values(signupCopy)) {
      if (typeof section !== 'object') continue;
      for (const value of Object.values(section)) {
        if (value && typeof value === 'object' && 'title' in value) {
          expect(['.', '?']).toContain((value as { end: string }).end);
          expect((value as { title: string }).title).not.toMatch(/[.?]$/);
        }
      }
    }
  });

  test('fills the dog name and leaves unknown keys visible', () => {
    expect(fillCopy('What breed is {name}', { name: 'Bruno' })).toBe('What breed is Bruno');
    expect(fillCopy('Hi {who}', {})).toBe('Hi {who}');
  });
});

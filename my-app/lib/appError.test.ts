/**
 * appError — classifier + copy-catalog contract.
 *
 * The whole point of this module is that internal technology (models, APIs,
 * JSON, HTTP status codes) never reaches a user, and that every failure class
 * has calm, branded copy with a sensible next step. These tests lock both.
 */

// Isolate the pure classifier/copy from the analytics side effect.
jest.mock('./analytics', () => ({ track: jest.fn() }));

import {
  toAppError,
  fromEdgeBody,
  errorCopy,
  appError,
  isAppError,
  ALL_ERROR_KINDS,
  ALL_ERROR_CONTEXTS,
  ALL_AUTH_DETAIL_KEYS,
  type AppErrorKind,
  type ErrorContext,
} from './appError';

/** Anything that would betray internals if a user ever saw it. */
const LEAK = /gemini|\bapi\b|api key|json|\b[45]\d\d\b/i;

// Kinds whose primary action should be an immediate retry-style recovery.
const RETRYABLE_KINDS: AppErrorKind[] = [
  'offline', 'timeout', 'server', 'ai_unavailable', 'purchase', 'unknown',
];

describe('toAppError — edge error codes (the primary path)', () => {
  const cases: Array<[string, AppErrorKind]> = [
    ['invalid_input', 'validation'],
    ['image_too_large', 'validation'],
    ['unreadable_image', 'ai_unreadable'],
    ['ai_unavailable', 'ai_unavailable'],
    ['rate_limited', 'rate_limited'],
    ['auth_required', 'auth'],
    ['forbidden', 'not_found'],
    ['not_found', 'not_found'],
    ['server_error', 'server'],
  ];
  it.each(cases)('error_code %s → kind %s', (code, kind) => {
    expect(toAppError(new Error('anything'), { errorCode: code }).kind).toBe(kind);
  });

  it('an unknown error_code falls through to message classification', () => {
    // Not in the map → the explicit-code branch is skipped, message wins.
    expect(toAppError(new Error('Timed out after 8000ms'), { errorCode: 'bogus' }).kind)
      .toBe('timeout');
  });
});

describe('toAppError — message & shape classification', () => {
  it('withTimeout rejection → timeout', () => {
    expect(toAppError(new Error('Timed out after 8000ms')).kind).toBe('timeout');
  });

  it('network failures → offline', () => {
    expect(toAppError(new Error('Network request failed')).kind).toBe('offline');
    expect(toAppError(new TypeError('Failed to fetch')).kind).toBe('offline');
    const relay = new Error('boom');
    relay.name = 'FunctionsFetchError';
    expect(toAppError(relay).kind).toBe('offline');
  });

  it('Supabase auth error → auth + detailKey from code', () => {
    const e = new Error('Invalid login credentials');
    e.name = 'AuthApiError';
    (e as any).code = 'invalid_credentials';
    const appErr = toAppError(e);
    expect(appErr.kind).toBe('auth');
    expect(appErr.detailKey).toBe('invalid_credentials');
  });

  it('auth error without a code sniffs the message', () => {
    const e = new Error('User already registered');
    (e as any).__isAuthError = true;
    const appErr = toAppError(e);
    expect(appErr.kind).toBe('auth');
    expect(appErr.detailKey).toBe('user_already_exists');
  });

  it('edge invoke http error → server', () => {
    const e = new Error('non-2xx');
    e.name = 'FunctionsHttpError';
    expect(toAppError(e).kind).toBe('server');
  });

  it('PostgrestError (message + code) → server', () => {
    expect(toAppError({ message: 'duplicate key', code: '23505' }).kind).toBe('server');
  });

  it('unrecognised errors → unknown', () => {
    expect(toAppError(new Error('something odd')).kind).toBe('unknown');
    expect(toAppError('a bare string').kind).toBe('unknown');
    expect(toAppError(null).kind).toBe('unknown');
  });
});

describe('toAppError — legacy internals are scrubbed, never leaked', () => {
  const leaky = [
    'Failed to parse Gemini response as JSON',
    'Gemini API error: 503 - service unavailable',
    'GEMINI_API_KEY is not configured',
  ];
  it.each(leaky)('%s → ai_unavailable, and its copy names nothing internal', msg => {
    const appErr = toAppError(new Error(msg));
    expect(appErr.kind).toBe('ai_unavailable');
    const copy = errorCopy(appErr);
    expect(copy.title).not.toMatch(LEAK);
    expect(copy.message).not.toMatch(LEAK);
  });
});

describe('fromEdgeBody — 200-status failure bodies', () => {
  it('maps error_code to a kind', () => {
    expect(fromEdgeBody({ success: false, error_code: 'unreadable_image' })?.kind)
      .toBe('ai_unreadable');
  });
  it('a failure with no code defaults to server', () => {
    expect(fromEdgeBody({ success: false })?.kind).toBe('server');
  });
  it('a success body or non-object returns null (happy path untouched)', () => {
    expect(fromEdgeBody({ success: true })).toBeNull();
    expect(fromEdgeBody(null)).toBeNull();
    expect(fromEdgeBody('nope')).toBeNull();
  });
});

describe('errorCopy — catalog invariants', () => {
  const collect = (c: { title: string; message: string; actions: { label: string }[] }) =>
    [c.title, c.message, ...c.actions.map(a => a.label)];

  it('every kind has non-empty, leak-free copy with at least one action', () => {
    for (const kind of ALL_ERROR_KINDS) {
      const copy = errorCopy(appError(kind, 'tech detail'));
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.message.length).toBeGreaterThan(0);
      expect(copy.actions.length).toBeGreaterThan(0);
      for (const s of collect(copy)) expect(s).not.toMatch(LEAK);
    }
  });

  it('every kind × every context stays leak-free', () => {
    for (const context of ALL_ERROR_CONTEXTS as ErrorContext[]) {
      for (const kind of ALL_ERROR_KINDS) {
        const copy = errorCopy(appError(kind, 'tech'), { context, petName: 'Rex' });
        for (const s of collect(copy)) expect(s).not.toMatch(LEAK);
      }
    }
  });

  it('retryable kinds lead with a retry-style action', () => {
    for (const kind of RETRYABLE_KINDS) {
      const actions = errorCopy(appError(kind, 'tech')).actions.map(a => a.action);
      expect(actions).toContain('retry');
    }
  });

  it('an unreadable photo offers pick-again, not a blind retry', () => {
    const actions = errorCopy(appError('ai_unreadable', 'tech'), { context: 'food_scan' })
      .actions.map(a => a.action);
    expect(actions).toContain('pick_again');
    expect(actions).not.toContain('retry');
  });

  it('context overrides win over base copy', () => {
    const base = errorCopy(appError('ai_unavailable', 'tech'));
    const scan = errorCopy(appError('ai_unavailable', 'tech'), { context: 'vet_scan' });
    expect(scan.title).not.toBe(base.title);
  });

  it('every auth detail key resolves to specific, leak-free copy', () => {
    for (const key of ALL_AUTH_DETAIL_KEYS) {
      const copy = errorCopy(appError('auth', 'tech', key), { context: 'auth' });
      expect(copy.title.length).toBeGreaterThan(0);
      for (const s of collect(copy)) expect(s).not.toMatch(LEAK);
    }
  });

  it('petName is woven in where the copy calls for it', () => {
    const copy = errorCopy(appError('server', 'tech'), { context: 'pet_save', petName: 'Rex' });
    expect(copy.title).toContain('Rex');
  });
});

describe('isAppError', () => {
  it('recognises AppErrors and rejects native errors', () => {
    expect(isAppError(appError('server', 'tech'))).toBe(true);
    expect(isAppError(new Error('x'))).toBe(false);
    expect(isAppError(null)).toBe(false);
  });
});

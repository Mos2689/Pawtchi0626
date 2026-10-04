/**
 * Connect's half of the error contract: every failure from the 4 Oct live
 * walk — and every server code our own SQL raises — becomes a calm sentence,
 * and our own sentences survive untouched.
 */

jest.mock('./analytics', () => ({ track: jest.fn() }));

import {
  UserFacingError,
  describeError,
  errorCopy,
  isUserFacingError,
  rawErrorMessage,
  toAppError,
} from './appError';

/** Exactly what users saw, or would have, during the 4 Oct walk. */
const SEEN_ON_4_OCT = [
  'Timed out after 12000ms: loadOuting',
  'TypeError: Network request failed',
  'Could not query the database for the schema cache. Retrying.',
  'Timed out acquiring connection from connection pool.',
  'canceling statement due to statement timeout',
  'upstream connect error or disconnect/reset before headers',
];

/** Anything that would betray internals if a user saw it. */
const LEAK = /PGRST|schema|pool|statement|upstream|TypeError|ms\b|loadOuting|_denied|_required|\b[45]\d\d\b/i;

describe('toAppError — server stalls and our own codes', () => {
  it.each([
    ['Could not query the database for the schema cache. Retrying.', 'server'],
    ['Timed out acquiring connection from connection pool.', 'server'],
    ['canceling statement due to statement timeout', 'server'],
    ['{"code":"PGRST002"}', 'server'],
    ['TypeError: Network request failed', 'offline'],
    ['The network connection was lost.', 'offline'],
    ['Timed out after 12000ms: loadOuting', 'timeout'],
    ['pack_access_denied', 'not_found'],
    ['walk_access_denied', 'not_found'],
    ['invitation_not_available', 'not_found'],
    ['pack_host_required', 'permission'],
  ])('%s → %s', (message, kind) => {
    expect(toAppError(new Error(message)).kind).toBe(kind);
  });

  it('server stalls are retryable — they are the server\'s moment, not the owner\'s mistake', () => {
    expect(toAppError(new Error('Timed out acquiring connection from connection pool.')).retryable).toBe(true);
  });
});

describe('describeError', () => {
  it.each(SEEN_ON_4_OCT)('never shows "%s"', message => {
    for (const context of ['community_load', 'community_action'] as const) {
      const line = describeError(new Error(message), context);
      expect(line).not.toMatch(LEAK);
      expect(line.length).toBeGreaterThan(10);
    }
  });

  it('a non-Error throw still gets a sentence', () => {
    expect(describeError('boom', 'community_action')).toMatch(/\.$/);
    expect(describeError(undefined, 'community_load')).toMatch(/\.$/);
  });

  it('keeps our own sentences exactly as written', () => {
    expect(describeError(new UserFacingError('That username is already taken.'), 'community_action'))
      .toBe('That username is already taken.');
  });

  it('a load failure says the screen will keep trying; an action says to try again', () => {
    expect(describeError(new Error('Could not query the database for the schema cache. Retrying.'), 'community_load'))
      .toMatch(/keep trying/);
    expect(describeError(new TypeError('Network request failed'), 'community_action')).toMatch(/[Tt]ry again/);
  });

  it('a host-only action names the host, not Settings', () => {
    const copy = errorCopy(toAppError(new Error('pack_host_required')), { context: 'community_action' });
    expect(copy.message).toBe('Only the host can do that.');
    expect(copy.actions.map(action => action.action)).not.toContain('open_settings');
  });
});

describe('UserFacingError / rawErrorMessage', () => {
  it('is recognised, and plain errors are not', () => {
    expect(isUserFacingError(new UserFacingError('x'))).toBe(true);
    expect(isUserFacingError(new Error('x'))).toBe(false);
    expect(isUserFacingError('x')).toBe(false);
  });

  it('rawErrorMessage is for matching codes, and is empty for non-errors', () => {
    expect(rawErrorMessage(new Error('walk_not_attended'))).toBe('walk_not_attended');
    expect(rawErrorMessage({ message: 'x' })).toBe('');
  });
});

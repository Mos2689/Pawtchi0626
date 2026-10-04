/**
 * One quiet retry for idempotent writes — and never for a refusal, which is
 * an answer, not a failure.
 */

jest.mock('./analytics', () => ({ track: jest.fn() }));

import { UserFacingError, isTransientError } from './appError';
import { withRetry } from './withRetry';

describe('withRetry', () => {
  it('retries once and returns the second answer', async () => {
    const fn = jest.fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce('joined');
    await expect(withRetry(fn, { delayMs: 0, retryIf: isTransientError })).resolves.toBe('joined');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('never retries a refusal', async () => {
    const refusal = new UserFacingError('This walk has finished.');
    const fn = jest.fn().mockRejectedValue(refusal);
    await expect(withRetry(fn, { delayMs: 0, retryIf: isTransientError })).rejects.toBe(refusal);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reports the first failure when the retry fails too', async () => {
    const first = new Error('Timed out after 12000ms: join');
    const fn = jest.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(new Error('second'));
    await expect(withRetry(fn, { delayMs: 0, retryIf: isTransientError })).rejects.toBe(first);
  });

  it('without retryIf keeps its old behaviour: one retry for anything', async () => {
    const fn = jest.fn().mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(1);
    await expect(withRetry(fn, { delayMs: 0 })).resolves.toBe(1);
  });
});

describe('isTransientError', () => {
  it.each([
    [new TypeError('Network request failed'), true],
    [new Error('Timed out after 12000ms: loadOuting'), true],
    [new Error('Could not query the database for the schema cache. Retrying.'), true],
    [new UserFacingError('That username is already taken.'), false],
    [new Error('pack_access_denied'), false],
    [new Error('walk_closed'), false],
  ])('%s → %s', (error, transient) => {
    expect(isTransientError(error)).toBe(transient);
  });
});

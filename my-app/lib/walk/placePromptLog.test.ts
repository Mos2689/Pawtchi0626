/**
 * The place-prompt sweep.
 *
 * Only the pure half is tested here; the AsyncStorage read/write follows the
 * fire-and-forget convention of walkStorySync and has no logic worth pinning.
 */

import { placePromptKey, sweepPlacePromptLog } from './placePromptLog';
import { PLACE_COOLDOWN_DAYS } from './placeMemory';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-08-20T08:00:00.000Z');

describe('placePromptKey', () => {
  it('namespaces per account, so one user never suppresses another', () => {
    expect(placePromptKey('user-a')).not.toBe(placePromptKey('user-b'));
  });
});

describe('sweepPlacePromptLog', () => {
  it('keeps an entry still inside its cooldown', () => {
    const log = { tree: NOW - (PLACE_COOLDOWN_DAYS - 1) * DAY_MS };
    expect(sweepPlacePromptLog(log, NOW)).toEqual(log);
  });

  it('keeps an entry just past the cooldown — the sweep is deliberately lazy', () => {
    // Still within 2× the cooldown, so it survives. Sweeping exactly at the
    // boundary would buy nothing and make the log churn.
    const log = { tree: NOW - (PLACE_COOLDOWN_DAYS + 1) * DAY_MS };
    expect(sweepPlacePromptLog(log, NOW)).toEqual(log);
  });

  it('drops an entry too old to suppress anything', () => {
    const log = { tree: NOW - 3 * PLACE_COOLDOWN_DAYS * DAY_MS };
    expect(sweepPlacePromptLog(log, NOW)).toEqual({});
  });

  it('keeps the log from growing without bound on a daily route', () => {
    const log: Record<string, number> = {};
    for (let i = 0; i < 200; i++) log[`place_${i}`] = NOW - (i + 60) * DAY_MS;
    const swept = sweepPlacePromptLog(log, NOW);
    expect(Object.keys(swept).length).toBeLessThan(Object.keys(log).length);
  });

  it('does not mutate the log it was given', () => {
    const log = { tree: NOW - 3 * PLACE_COOLDOWN_DAYS * DAY_MS };
    sweepPlacePromptLog(log, NOW);
    expect(Object.keys(log)).toEqual(['tree']);
  });
});

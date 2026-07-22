/**
 * feedingActivityLink tests — uses a hand-rolled supabase mock matching the
 * builder chain (`from().select().eq().eq()...maybeSingle()` and
 * `from().update().eq()`).
 */

import { markNearestFeedingActivityComplete } from './feedingActivityLink';

type Result = { data: any; error: any };

interface FakeQuery {
  // Mutable chain — each call returns `this` until terminator.
  _terminator: Result;
  _updatePayload?: any;
  select: jest.Mock;
  eq: jest.Mock;
  ilike: jest.Mock;
  order: jest.Mock;
  limit: jest.Mock;
  maybeSingle: jest.Mock;
  update: jest.Mock;
}

let lookupResult: Result;
let updateResult: Result;
let updateCalls: any[];
let updateEqCalls: any[];

jest.mock('./supabase', () => {
  const makeQuery = (): FakeQuery => {
    const q: any = {};
    q.select = jest.fn(() => q);
    q.eq = jest.fn((col: string, val: any) => {
      if (q._mode === 'update') {
        updateEqCalls.push({ col, val });
      }
      return q;
    });
    q.ilike = jest.fn(() => q);
    q.order = jest.fn(() => q);
    q.limit = jest.fn(() => q);
    q.maybeSingle = jest.fn(() => Promise.resolve(lookupResult));
    q.update = jest.fn((payload: any) => {
      q._mode = 'update';
      updateCalls.push(payload);
      return q;
    });
    // For `update().eq().eq()` we need the chain to terminate as a promise.
    // Supabase update returns a thenable when awaited after the final .eq().
    q.then = (resolve: any) => resolve(updateResult);
    return q;
  };

  return {
    supabase: {
      from: jest.fn(() => makeQuery()),
    },
  };
});

beforeEach(() => {
  lookupResult = { data: null, error: null };
  updateResult = { data: null, error: null };
  updateCalls = [];
  updateEqCalls = [];
});

describe('markNearestFeedingActivityComplete', () => {
  test('snack/late slot is a no-op — returns null without DB call', async () => {
    const result = await markNearestFeedingActivityComplete({
      petId: 'pet-1',
      loggedAt: new Date('2026-06-23T22:30:00'),
      slot: 'late',
    });
    expect(result).toBeNull();
    expect(updateCalls).toHaveLength(0);
  });

  test('breakfast log finds and completes the breakfast feeding row', async () => {
    lookupResult = { data: { id: 'activity-42' }, error: null };
    const result = await markNearestFeedingActivityComplete({
      petId: 'pet-1',
      loggedAt: new Date('2026-06-23T07:30:00'),
      slot: 'breakfast',
    });
    expect(result).toBe('activity-42');
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].status).toBe('completed');
    expect(updateCalls[0].completed_at).toBeTruthy();
  });

  test('breakfast logged at noon still closes the morning card', async () => {
    lookupResult = { data: { id: 'activity-99' }, error: null };
    const result = await markNearestFeedingActivityComplete({
      petId: 'pet-1',
      loggedAt: new Date('2026-06-23T12:00:00'),
      slot: 'breakfast',
    });
    expect(result).toBe('activity-99');
  });

  test('no pending feeding for today → returns null', async () => {
    lookupResult = { data: null, error: null };
    const result = await markNearestFeedingActivityComplete({
      petId: 'pet-1',
      loggedAt: new Date('2026-06-23T08:00:00'),
      slot: 'breakfast',
    });
    expect(result).toBeNull();
    expect(updateCalls).toHaveLength(0);
  });

  test('lookup error returns null without attempting update', async () => {
    lookupResult = { data: null, error: { message: 'db down' } };
    const result = await markNearestFeedingActivityComplete({
      petId: 'pet-1',
      loggedAt: new Date('2026-06-23T08:00:00'),
      slot: 'dinner',
    });
    expect(result).toBeNull();
    expect(updateCalls).toHaveLength(0);
  });

  test('update error returns null', async () => {
    lookupResult = { data: { id: 'activity-7' }, error: null };
    updateResult = { data: null, error: { message: 'rls denied' } };
    const result = await markNearestFeedingActivityComplete({
      petId: 'pet-1',
      loggedAt: new Date('2026-06-23T18:30:00'),
      slot: 'dinner',
    });
    expect(result).toBeNull();
  });
});

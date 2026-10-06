/**
 * The receiver with the REAL clock module (liveClock.ts), not a fake clock:
 * a positions read must calibrate this phone, so walkers get an age label.
 */
import { LiveReceiver } from './liveReceiver';
import { reconcileClockNow, resetLiveClock, rpcWithClock } from './liveClock';
import type { LivePartyV2 } from './liveReconciler';

const ANA = '22222222-2222-4222-8222-222222222222';
const WALK = '33333333-3333-4333-8333-333333333333';
const ME = '11111111-1111-4111-8111-111111111111';

let answer: unknown = null;
jest.mock('../supabase', () => ({
  supabase: { rpc: jest.fn(async () => ({ data: answer, error: null })) },
}));

// Postgres jsonb renders timestamptz with microseconds and a +00:00 offset.
const pg = (ms: number) => new Date(ms).toISOString().replace('Z', '123+00:00');

describe('receiver + real clock', () => {
  beforeEach(() => resetLiveClock());

  it('calibrates from the positions read and shows a known age', async () => {
    const now = Date.now();
    answer = {
      status: 'ok',
      server_now: pg(now),
      rows: [{
        user_id: ANA, lat: -33.87, lng: 151.2, accuracy_m: 5, path: [{ lat: -33.87, lng: 151.2 }],
        heard_at: pg(now - 3_000), fix_at: pg(now - 4_000), live_gen: 1, seq: 3, route_version: 1,
      }],
      watermarks: [{ user_id: ANA, gen: 1 }],
    };
    const lists: LivePartyV2[][] = [];
    const receiver = new LiveReceiver({
      readPositions: () => rpcWithClock('live_walk_positions', { p_walk_id: WALK }),
      readTransport: async () => 'db',
      acquireLink: () => { throw new Error('no room on a db walk'); },
      clock: reconcileClockNow,
      mono: () => globalThis.performance?.now?.() ?? Date.now(),
      setTimer: () => 0,
      clearTimer: () => {},
      onParties: parties => lists.push(parties),
    }, WALK, ME);
    await receiver.refresh();
    expect(reconcileClockNow().offsetMs).not.toBeNull();
    const shown = lists[lists.length - 1];
    expect(shown).toHaveLength(1);
    expect(shown[0].age_known).toBe(true);
  });
});

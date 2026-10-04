/**
 * The request timer must be invisible to the requests it times, and must
 * never let a URL, id or query string leave the phone.
 */

import {
  API_TIMING_SESSION_CAP,
  endpointLabel,
  resetApiTimingForTests,
  timedFetch,
} from './apiTiming';
import { resetPerfFlagsForTests, setPerfFlagOverride } from './perfFlags';

// Hoisted above the imports by jest. The factory only reaches `mockCapture`
// when capture is called, by which point it exists.
const mockCapture = jest.fn();
jest.mock('./analytics', () => ({ posthog: { capture: (...args: unknown[]) => mockCapture(...args) } }));

const BASE = 'https://mbvpjbwukhypvmgeuyyw.supabase.co';
const UUID = '6f0c0b9e-3c1a-4b8e-9f3e-2d7a1c5e8b40';

function response(status: number, headers: Record<string, string> = {}): Response {
  return { status, headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } } as unknown as Response;
}

/** Sampled in (0 < rate) or out (0.99 ≥ rate), with a clock that advances 250 ms per read. */
function clock(random: number) {
  let t = 1_000;
  return { now: () => (t += 250), random: () => random };
}

beforeEach(() => {
  mockCapture.mockReset();
  resetApiTimingForTests();
  resetPerfFlagsForTests();
});

describe('endpointLabel', () => {
  it.each([
    [`${BASE}/rest/v1/activities?pet_id=eq.${UUID}&select=*`, 'rest/activities'],
    [`${BASE}/rest/v1/rpc/get_pet_dashboard`, 'rpc/get_pet_dashboard'],
    [`${BASE}/auth/v1/token?grant_type=refresh_token`, 'auth/token'],
    [`${BASE}/functions/v1/notify-dispatch`, 'fn/notify-dispatch'],
    [`${BASE}/functions/v1/${UUID}`, 'fn/?'],
    [`${BASE}/functions/v1/deadbeefcafe`, 'fn/?'],
    [`${BASE}/storage/v1/object/sign/community-walk-media`, 'storage/object/sign'],
    [`${BASE}/storage/v1/object/community-walk-media/${UUID}/${UUID}/${UUID}.jpg`, 'storage/object'],
    [`${BASE}/rest/v1/${UUID}`, 'rest/?'],
    [`${BASE}/graphql/v1`, 'other'],
    ['not a url', 'other'],
  ])('%s → %s', (url, label) => {
    expect(endpointLabel(url)).toBe(label);
  });

  it('never carries an id, whatever the path', () => {
    for (const url of [
      `${BASE}/rest/v1/pets?id=eq.${UUID}`,
      `${BASE}/storage/v1/object/public/avatars/${UUID}.png`,
      `${BASE}/rest/v1/rpc/community_outing?p_walk_id=${UUID}`,
    ]) {
      expect(endpointLabel(url)).not.toContain(UUID);
    }
  });
});

describe('timedFetch — a pure pass-through', () => {
  it('hands fetch exactly its arguments and returns exactly its answer', async () => {
    const answer = response(200);
    const base = jest.fn(async () => answer);
    const init = { method: 'POST', body: '{"p":1}' };
    const out = await timedFetch(base as unknown as typeof fetch, clock(0.99))(`${BASE}/rest/v1/rpc/x`, init);
    expect(out).toBe(answer);
    expect(base).toHaveBeenCalledWith(`${BASE}/rest/v1/rpc/x`, init);
  });

  it('re-throws exactly what fetch threw', async () => {
    const failure = new TypeError('Network request failed');
    const base = jest.fn(async () => { throw failure; });
    await expect(timedFetch(base as unknown as typeof fetch, clock(0))(`${BASE}/rest/v1/pets`)).rejects.toBe(failure);
  });

  it('a broken analytics client cannot break a request', async () => {
    setPerfFlagOverride('apiTiming', true);
    mockCapture.mockImplementation(() => { throw new Error('posthog down'); });
    const answer = response(200);
    await expect(timedFetch((async () => answer) as unknown as typeof fetch, clock(0))(`${BASE}/rest/v1/pets`)).resolves.toBe(answer);
  });
});

describe('timedFetch — what is reported', () => {
  const run = (random: number, url = `${BASE}/rest/v1/activities?pet_id=eq.${UUID}`) =>
    timedFetch((async () => response(200, { 'x-envoy-upstream-service-time': '180' })) as unknown as typeof fetch, clock(random))(url);

  it('nothing while the flag is off', async () => {
    await run(0);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('a sampled request, as names and numbers only', async () => {
    setPerfFlagOverride('apiTiming', true);
    await run(0);
    expect(mockCapture).toHaveBeenCalledWith('api_timing', {
      endpoint: 'rest/activities',
      method: 'GET',
      status: 200,
      ms: 250,
      server_ms: 180,
      inflight: 0,
      attempts: 1,
    });
    expect(JSON.stringify(mockCapture.mock.calls)).not.toContain(UUID);
  });

  it('not a request outside the sample', async () => {
    setPerfFlagOverride('apiTiming', true);
    await run(0.99);
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it('a failure as status 0', async () => {
    setPerfFlagOverride('apiTiming', true);
    const base = async () => { throw new Error('offline'); };
    await expect(timedFetch(base as unknown as typeof fetch, clock(0))(`${BASE}/rest/v1/pets`)).rejects.toThrow('offline');
    expect(mockCapture.mock.calls[0][1]).toMatchObject({ endpoint: 'rest/pets', status: 0, server_ms: null });
  });

  it('how many requests were already in the air', async () => {
    setPerfFlagOverride('apiTiming', true);
    let release!: () => void;
    const slow = new Promise<void>(resolve => { release = resolve; });
    const fetchOnce = timedFetch((async () => { await slow; return response(200); }) as unknown as typeof fetch, clock(0));
    const first = fetchOnce(`${BASE}/rest/v1/a`);
    const second = fetchOnce(`${BASE}/rest/v1/b`);
    release();
    await Promise.all([first, second]);
    expect(mockCapture.mock.calls.map(call => call[1].inflight).sort()).toEqual([0, 1]);
  });

  it('at most API_TIMING_SESSION_CAP per launch', async () => {
    setPerfFlagOverride('apiTiming', true);
    for (let i = 0; i < API_TIMING_SESSION_CAP + 10; i += 1) await run(0);
    expect(mockCapture).toHaveBeenCalledTimes(API_TIMING_SESSION_CAP);
  });
});

/**
 * The retrying fetch end to end, with a fake network: it must hand back
 * exactly what the last send produced, and send again only when allowed.
 */

import { RetryGovernor, MAX_RETRIES } from './retryPolicy';
import { parseFaults } from './faults';
import { resilientFetch, type ResilientFetchDeps } from './resilientFetch';

jest.mock('../analytics', () => ({ posthog: null }));

const BASE = 'https://mbvpjbwukhypvmgeuyyw.supabase.co';
const READ = `${BASE}/rest/v1/community_walks?id=eq.w1`;
const RPC_READ = `${BASE}/rest/v1/rpc/community_outing`;
const RPC_WRITE = `${BASE}/rest/v1/rpc/join_community_walk`;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const schemaCache = () => json(503, { code: 'PGRST002', message: 'Could not query the database for the schema cache. Retrying.' });
const ok = (body: unknown = [{ state: 'active' }]) => json(200, body);

function harness(answers: (Response | Error)[], overrides: Partial<ResilientFetchDeps> = {}, sendMs = 0) {
  let clock = 0;
  const sleeps: number[] = [];
  const base = jest.fn(async () => {
    clock += sendMs;
    const next = answers.shift();
    if (!next) throw new Error('no more answers');
    if (next instanceof Error) throw next;
    return next;
  });
  const fetchFn = resilientFetch(base as unknown as typeof fetch, {
    now: () => clock,
    random: () => 0.5,
    sleep: async ms => { sleeps.push(ms); clock += ms; },
    governor: new RetryGovernor(),
    retriesEnabled: () => true,
    faults: null,
    ...overrides,
  });
  return { fetchFn, base, sleeps };
}

describe('resilientFetch', () => {
  it('passes a success straight through, once', async () => {
    const answer = ok();
    const { fetchFn, base } = harness([answer]);
    await expect(fetchFn(READ)).resolves.toBe(answer);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('rides out the schema-cache 503 — even for a write, which never ran', async () => {
    const final = ok({});
    const { fetchFn, base, sleeps } = harness([schemaCache(), schemaCache(), final]);
    const init = { method: 'POST', body: '{"p_walk_id":"w1"}' };
    await expect(fetchFn(RPC_WRITE, init)).resolves.toBe(final);
    expect(base).toHaveBeenCalledTimes(3);
    expect(base).toHaveBeenNthCalledWith(3, RPC_WRITE, init);
    expect(sleeps).toEqual([400, 1200]);
  });

  it('retries a read through a dropped connection', async () => {
    const final = ok();
    const { fetchFn, base } = harness([new TypeError('Network request failed'), final]);
    await expect(fetchFn(RPC_READ, { method: 'POST', body: '{}' })).resolves.toBe(final);
    expect(base).toHaveBeenCalledTimes(2);
  });

  it('never repeats a write after a dropped connection — it may have landed', async () => {
    const dropped = new TypeError('Network request failed');
    const { fetchFn, base } = harness([dropped, ok()]);
    await expect(fetchFn(RPC_WRITE, { method: 'POST', body: '{}' })).rejects.toBe(dropped);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('hands back the last answer once the attempts run out', async () => {
    const answers = Array.from({ length: MAX_RETRIES + 1 }, () => json(504, {}));
    const last = answers[answers.length - 1];
    const { fetchFn, base } = harness(answers);
    await expect(fetchFn(READ)).resolves.toBe(last);
    expect(base).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it('stops at the time budget rather than outlasting the screen', async () => {
    // Each send takes 1 s; waits at random 1 are 520 and 1560 ms. The third
    // wait (3900 ms) would end at 8.98 s, past the 6 s budget.
    const { fetchFn, base } = harness([json(504, {}), json(504, {}), json(504, {}), ok()], { random: () => 1 }, 1_000);
    const response = await fetchFn(READ);
    expect(response.status).toBe(504);
    expect(base).toHaveBeenCalledTimes(3);
  });

  it('does nothing extra with ordinary answers', async () => {
    const notFound = json(404, { code: 'PGRST116' });
    const { fetchFn, base } = harness([notFound]);
    await expect(fetchFn(READ)).resolves.toBe(notFound);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('never retries an aborted request', async () => {
    const controller = new AbortController();
    controller.abort();
    const { fetchFn, base } = harness([json(503, { code: 'PGRST002' }), ok()]);
    const response = await fetchFn(READ, { signal: controller.signal });
    expect(response.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('obeys the kill switch', async () => {
    const { fetchFn, base } = harness([schemaCache(), ok()], { retriesEnabled: () => false });
    const response = await fetchFn(READ);
    expect(response.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('stands down while the server is struggling', async () => {
    const governor = new RetryGovernor();
    for (let i = 0; i < 10; i += 1) governor.noteFailure(0);
    const { fetchFn, base } = harness([schemaCache(), ok()], { governor });
    const response = await fetchFn(READ);
    expect(response.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('leaves auth alone entirely', async () => {
    const { fetchFn, base } = harness([schemaCache(), ok()]);
    const response = await fetchFn(`${BASE}/auth/v1/token?grant_type=refresh_token`, { method: 'POST' });
    expect(response.status).toBe(503);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('the caller can still read the body after the code was peeked', async () => {
    const { fetchFn } = harness([json(503, { code: 'P0001', message: 'x' })]);
    const response = await fetchFn(RPC_WRITE, { method: 'POST' });
    await expect(response.json()).resolves.toEqual({ code: 'P0001', message: 'x' });
  });
});

describe('development faults', () => {
  it('parses the plan and ignores nonsense', () => {
    expect(parseFaults('503:0.3,network:0.1,slow:0.2')).toEqual({ busy: 0.3, network: 0.1, slow: 0.2 });
    expect(parseFaults('')).toBeNull();
    expect(parseFaults('bogus:1')).toBeNull();
    expect(parseFaults('503:7')).toEqual({ busy: 1, network: 0, slow: 0 });
  });

  it('an injected 503 is retried like the real one', async () => {
    const final = ok();
    let rolls = 0;
    const { fetchFn, base } = harness([final], {
      faults: { busy: 0.5, network: 0, slow: 0 },
      // First roll injects the fault (0.1 < 0.5); later rolls (0.9) do not.
      random: () => (rolls++ === 0 ? 0.1 : 0.9),
    });
    await expect(fetchFn(READ)).resolves.toBe(final);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it('never fakes a failure for auth', async () => {
    const final = ok();
    const { fetchFn } = harness([final], { faults: { busy: 1, network: 0, slow: 0 } });
    await expect(fetchFn(`${BASE}/auth/v1/user`)).resolves.toBe(final);
  });
});

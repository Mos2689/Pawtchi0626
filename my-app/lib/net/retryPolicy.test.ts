/**
 * What may be sent twice. The matrix here is the safety argument for the
 * whole retry layer: a write is only ever repeated when the server provably
 * never ran it.
 */

import {
  MAX_RETRIES,
  READ_ONLY_RPCS,
  RetryGovernor,
  STORM_PAUSE_MS,
  STORM_THRESHOLD,
  isNetworkError,
  parseErrorCode,
  requestKind,
  retryDelayMs,
  shouldRetry,
} from './retryPolicy';

const BASE = 'https://mbvpjbwukhypvmgeuyyw.supabase.co';
const busy = (code: string | null) => ({ kind: 'status' as const, status: 503, code });

describe('requestKind', () => {
  it.each([
    ['GET', `${BASE}/rest/v1/community_walks?id=eq.x`, 'repeatable'],
    ['HEAD', `${BASE}/rest/v1/pets`, 'repeatable'],
    ['POST', `${BASE}/rest/v1/rpc/community_outing`, 'repeatable'],
    ['POST', `${BASE}/rest/v1/rpc/join_community_walk`, 'write'],
    ['POST', `${BASE}/rest/v1/rpc/claim_external_community_invite`, 'write'],
    ['POST', `${BASE}/rest/v1/community_live_locations`, 'write'],
    ['PATCH', `${BASE}/rest/v1/pets?id=eq.x`, 'write'],
    ['DELETE', `${BASE}/rest/v1/walk_media?id=eq.x`, 'write'],
    ['POST', `${BASE}/rest/v1/rpc/lookup_community_username`, 'write'],
    ['POST', `${BASE}/storage/v1/object/sign/community-walk-media`, 'repeatable'],
    ['POST', `${BASE}/storage/v1/object/community-walk-media/a/b.jpg`, 'excluded'],
    ['POST', `${BASE}/auth/v1/token?grant_type=refresh_token`, 'excluded'],
    ['POST', `${BASE}/functions/v1/gemini-proxy`, 'excluded'],
    ['GET', 'not a url', 'excluded'],
  ])('%s %s → %s', (method, url, kind) => {
    expect(requestKind(url, method)).toBe(kind);
  });

  it('a new RPC is a write until somebody lists it', () => {
    expect(requestKind(`${BASE}/rest/v1/rpc/some_future_function`, 'POST')).toBe('write');
  });

  it('never lists a function that can write', () => {
    // lookup_community_username is VOLATILE in production (checked 2026-10-04).
    expect(READ_ONLY_RPCS.has('lookup_community_username')).toBe(false);
  });
});

describe('shouldRetry', () => {
  it('repeats ANY request PostgREST never ran — the 4 Oct schema-cache 503', () => {
    expect(shouldRetry('write', busy('PGRST002'))).toBe(true);
    expect(shouldRetry('write', busy('PGRST003'))).toBe(true);
    expect(shouldRetry('repeatable', busy('PGRST002'))).toBe(true);
  });

  it('never repeats a write that may have run', () => {
    expect(shouldRetry('write', { kind: 'network' })).toBe(false);
    expect(shouldRetry('write', busy(null))).toBe(false);
    expect(shouldRetry('write', { kind: 'status', status: 504, code: null })).toBe(false);
    expect(shouldRetry('write', { kind: 'status', status: 500, code: '57014' })).toBe(false);
  });

  it('repeats a read after a dropped connection, a gateway error or a stall', () => {
    expect(shouldRetry('repeatable', { kind: 'network' })).toBe(true);
    for (const status of [502, 503, 504, 520, 522, 524, 544]) {
      expect(shouldRetry('repeatable', { kind: 'status', status, code: null })).toBe(true);
    }
    expect(shouldRetry('repeatable', { kind: 'status', status: 500, code: '57014' })).toBe(true);
  });

  it('never repeats an answer: client errors and ordinary server errors stand', () => {
    for (const status of [400, 401, 403, 404, 406, 409, 422, 429]) {
      expect(shouldRetry('repeatable', { kind: 'status', status, code: null })).toBe(false);
    }
    expect(shouldRetry('repeatable', { kind: 'status', status: 500, code: 'P0001' })).toBe(false);
  });

  it('never touches auth, edge functions or uploads', () => {
    expect(shouldRetry('excluded', busy('PGRST002'))).toBe(false);
    expect(shouldRetry('excluded', { kind: 'network' })).toBe(false);
  });
});

describe('parseErrorCode / isNetworkError', () => {
  it('reads PostgREST error bodies', () => {
    expect(parseErrorCode('{"code":"PGRST002","message":"Could not query the database for the schema cache. Retrying."}')).toBe('PGRST002');
    expect(parseErrorCode('{"code":"57014","message":"canceling statement due to statement timeout"}')).toBe('57014');
    expect(parseErrorCode('upstream PGRST003 gateway text')).toBe('PGRST003');
    expect(parseErrorCode('<html>bad gateway</html>')).toBeNull();
  });

  it('knows a dropped connection from everything else', () => {
    expect(isNetworkError(new TypeError('Network request failed'))).toBe(true);
    expect(isNetworkError(new Error('The network connection was lost.'))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('Aborted'), { name: 'AbortError' }))).toBe(false);
    expect(isNetworkError(new Error('pack_access_denied'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('backs off, inside ±30% jitter', () => {
    expect(retryDelayMs(1, 0)).toBe(280);
    expect(retryDelayMs(1, 1)).toBe(520);
    expect(retryDelayMs(2, 0.5)).toBe(1200);
    expect(retryDelayMs(3, 0.5)).toBe(3000);
    expect(retryDelayMs(MAX_RETRIES + 5, 0.5)).toBe(3000);
  });
});

describe('RetryGovernor', () => {
  it('stops retrying when failures pile up, then resumes', () => {
    const governor = new RetryGovernor();
    const t0 = 1_000_000;
    for (let i = 0; i < STORM_THRESHOLD - 1; i += 1) governor.noteFailure(t0 + i * 100);
    expect(governor.allows(t0 + 1_000)).toBe(true);
    governor.noteFailure(t0 + 1_000);
    expect(governor.allows(t0 + 1_001)).toBe(false);
    expect(governor.allows(t0 + 1_000 + STORM_PAUSE_MS)).toBe(true);
  });

  it('forgets failures older than the window', () => {
    const governor = new RetryGovernor();
    for (let i = 0; i < STORM_THRESHOLD - 1; i += 1) governor.noteFailure(i * 100);
    governor.noteFailure(60_000);
    expect(governor.allows(60_001)).toBe(true);
  });
});

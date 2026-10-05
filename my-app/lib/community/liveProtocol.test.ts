import {
  MAX_DELTA_POINTS,
  buildEndHint,
  buildPos,
  buildReq,
  buildSnap,
  parseLiveMessage,
  parseLiveRow,
  parsePositions,
  utf8Length,
  type PosPayload,
} from './liveProtocol';
import { encodePolyline } from './livePolyline';

const ANA = '11111111-1111-4111-8111-111111111111';
const BEN = '22222222-2222-4222-8222-222222222222';
// Exact at the polyline's 1e5 precision, so decoded points compare equal.
const pts = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ lat: (-3387000 + (from + i) * 10) / 1e5, lng: 151.2 }));

const pos = (overrides: Partial<PosPayload> = {}): PosPayload => ({
  ...buildPos({
    user: ANA,
    gen: 2,
    seq: 7,
    atServer: 1_760_000_000_000,
    fixAgeMs: 1200,
    lat: -33.87,
    lng: 151.2,
    obsAgeMs: 800,
    obsAccuracy: 6.27,
    pathIndex: 10,
    points: pts(3, 10),
  }),
  ...overrides,
});

describe('pos', () => {
  it('round-trips', () => {
    expect(parseLiveMessage('pos', pos())).toEqual({
      kind: 'pos',
      user: ANA,
      gen: 2,
      seq: 7,
      atServer: 1_760_000_000_000,
      fixAgeMs: 1200,
      lat: -33.87,
      lng: 151.2,
      obsAgeMs: 800,
      obsAccuracy: 6.3,
      pathIndex: 10,
      points: pts(3, 10),
      routeVersion: 13,
    });
  });

  it('accepts the empty delta (pts "", pi === rv)', () => {
    const empty = pos({ pi: 40, rv: 40, pts: '' });
    expect(parseLiveMessage('pos', empty)).toMatchObject({ pathIndex: 40, routeVersion: 40, points: [] });
  });

  it('accepts an uncalibrated sender (atS null) and missing observation data', () => {
    expect(parseLiveMessage('pos', pos({ atS: null, obAge: null, oa: null }))).toMatchObject({ atServer: null, obsAgeMs: null, obsAccuracy: null });
  });

  it('keeps the payload small', () => {
    const full = buildPos({
      user: ANA, gen: 1, seq: 1, atServer: Date.now(), fixAgeMs: 0, lat: -33.123456789, lng: 151.123456789,
      obsAgeMs: 0, obsAccuracy: 5, pathIndex: 0, points: pts(MAX_DELTA_POINTS),
    });
    expect(full.la).toBe(-33.123457);
    expect(utf8Length(JSON.stringify(full))).toBeLessThan(1024);
    expect(parseLiveMessage('pos', full)).not.toBeNull();
  });

  it.each([
    ['protocol version', { v: 1 }],
    ['sender id', { u: 'ana' }],
    ['generation 0', { gen: 0 }],
    ['fractional seq', { s: 1.5 }],
    ['seq past 2^31', { s: 2 ** 31 }],
    ['latitude', { la: 91 }],
    ['longitude', { lo: Number.NaN }],
    ['negative age', { fxAge: -1 }],
    ['age over 6 h', { fxAge: 6 * 3600_000 + 1 }],
    ['observation age', { obAge: -5 }],
    ['accuracy', { oa: -1 }],
    ['pi after rv', { pi: 14, rv: 13 }],
    ['points not matching rv − pi', { rv: 14 }],
    ['more than 20 points', { pi: 0, rv: 21, pts: encodePolyline(pts(21)) }],
    ['route index beyond the bound', { pi: 100_001, rv: 100_001, pts: '' }],
    ['malformed points', { pts: 'abc def' }],
  ])('refuses a bad %s', (_label, change) => {
    expect(parseLiveMessage('pos', { ...pos(), ...change })).toBeNull();
  });

  it('refuses a pos over 1 KB', () => {
    expect(parseLiveMessage('pos', { ...pos(), pad: 'x'.repeat(1100) })).toBeNull();
  });
});

describe('snap, req, endhint', () => {
  it('round-trips a snapshot', () => {
    const snap = buildSnap({ user: ANA, gen: 3, routeVersion: 250, points: pts(120) });
    expect(parseLiveMessage('snap', snap)).toEqual({ kind: 'snap', user: ANA, gen: 3, routeVersion: 250, points: pts(120) });
  });

  it('refuses a snapshot with more points than its route, or over 200', () => {
    expect(parseLiveMessage('snap', buildSnap({ user: ANA, gen: 3, routeVersion: 5, points: pts(6) }))).toBeNull();
    expect(parseLiveMessage('snap', buildSnap({ user: ANA, gen: 3, routeVersion: 500, points: pts(201) }))).toBeNull();
  });

  it('refuses anything over 4 KB', () => {
    expect(parseLiveMessage('snap', { ...buildSnap({ user: ANA, gen: 3, routeVersion: 1, points: pts(1) }), pad: 'x'.repeat(4100) })).toBeNull();
  });

  it('reads requests for everyone or for one walker', () => {
    expect(parseLiveMessage('req', buildReq(BEN, 'all'))).toEqual({ kind: 'req', user: BEN, want: 'all' });
    expect(parseLiveMessage('req', buildReq(BEN, ANA))).toEqual({ kind: 'req', user: BEN, want: ANA });
    expect(parseLiveMessage('req', buildReq(BEN, 'someone'))).toBeNull();
  });

  it('reads an end hint', () => {
    expect(parseLiveMessage('endhint', buildEndHint(ANA))).toEqual({ kind: 'endhint', user: ANA });
  });

  it('ignores unknown events and non-objects', () => {
    expect(parseLiveMessage('ping', buildEndHint(ANA))).toBeNull();
    expect(parseLiveMessage('pos', null)).toBeNull();
    expect(parseLiveMessage('pos', [1, 2])).toBeNull();
    expect(parseLiveMessage(undefined, buildEndHint(ANA))).toBeNull();
  });
});

describe('database rows', () => {
  const row = (overrides: Record<string, unknown> = {}) => ({
    walk_id: 'w', user_id: ANA, lat: -33.87, lng: 151.2, accuracy_m: 5,
    path: pts(3), recorded_at: '2026-10-04T08:00:00Z', heard_at: '2026-10-04T08:00:01.250Z',
    fix_at: '2026-10-04T08:00:00Z', obs_at: null, live_gen: 2, seq: 9, route_version: 3,
    ...overrides,
  });

  it('reads a v2 row on the server clock', () => {
    expect(parseLiveRow(row())).toEqual({
      user: ANA, lat: -33.87, lng: 151.2, accuracy: 5, path: pts(3),
      heardAt: Date.parse('2026-10-04T08:00:01.250Z'), fixAt: Date.parse('2026-10-04T08:00:00Z'),
      gen: 2, seq: 9, routeVersion: 3,
    });
  });

  it('reads a row from an older build as generation 0 with no fix time', () => {
    expect(parseLiveRow(row({ live_gen: null, seq: null, route_version: null, fix_at: null }))).toMatchObject({ gen: 0, seq: 0, routeVersion: null, fixAt: null });
  });

  it.each([
    ['user id', { user_id: 'x' }],
    ['heard_at', { heard_at: 'yesterday' }],
    ['fix_at', { fix_at: 'nope' }],
    ['generation without seq', { seq: null }],
    ['route version', { route_version: -1 }],
    ['path longer than its route', { route_version: 2 }],
    ['path over 200', { path: pts(201), route_version: 500 }],
    ['path point', { path: [{ lat: 'x', lng: 1 }] }],
  ])('refuses a bad %s', (_label, change) => {
    expect(parseLiveRow(row(change))).toBeNull();
  });

  it('reads the positions answer, dropping only the bad rows', () => {
    const answer = parsePositions({
      status: 'ok',
      server_now: '2026-10-04T08:00:05Z',
      rows: [row(), row({ user_id: 'bad' })],
      watermarks: [{ user_id: ANA, gen: 2 }, { user_id: BEN, gen: 4 }, { user_id: 'x', gen: 9 }],
    });
    expect(answer?.rows).toHaveLength(1);
    expect(answer?.watermarks).toEqual({ [ANA]: 2, [BEN]: 4 });
    expect(answer?.serverNow).toBe(Date.parse('2026-10-04T08:00:05Z'));
    expect(answer?.visible).toBe(true);
  });

  it('reads "not visible", and refuses a malformed answer', () => {
    expect(parsePositions({ status: 'not_visible', server_now: '2026-10-04T08:00:05Z', rows: [], watermarks: [] })?.visible).toBe(false);
    expect(parsePositions({ rows: [] })).toBeNull();
    expect(parsePositions('x')).toBeNull();
  });
});

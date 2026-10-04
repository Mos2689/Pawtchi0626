import { applyLivePartyChange, closeCheckDue, walkerColourOrder } from './liveRoster';

const row = (user_id: string, joined_at: string | null = null) => ({ user_id, joined_at });

describe('walkerColourOrder', () => {
  it('puts the viewer first, then the roster in joining order', () => {
    const roster = [row('c', '2026-10-01T07:20:00Z'), row('b', '2026-10-01T07:10:00Z')];
    expect(walkerColourOrder('a', roster, ['b', 'c', 'a'])).toEqual(['a', 'b', 'c']);
  });

  it('does not depend on the order positions arrive in', () => {
    const roster = [row('b', '2026-10-01T07:10:00Z'), row('c', '2026-10-01T07:20:00Z')];
    const first = walkerColourOrder('a', roster, ['c', 'b', 'a']);
    const second = walkerColourOrder('a', roster, ['a', 'b', 'c']);
    expect(first).toEqual(second);
  });

  it('keeps everyone else in place when somebody goes quiet', () => {
    const roster = [row('b', '2026-10-01T07:10:00Z'), row('c', '2026-10-01T07:20:00Z')];
    const all = walkerColourOrder('a', roster, ['a', 'b', 'c']);
    const withoutB = walkerColourOrder('a', roster, ['a', 'c']);
    expect(withoutB.indexOf('c')).toBe(all.indexOf('c'));
  });

  it('orders people who have not joined after those who have, by id', () => {
    const roster = [row('z'), row('y'), row('b', '2026-10-01T07:10:00Z')];
    expect(walkerColourOrder(null, roster, [])).toEqual(['b', 'y', 'z']);
  });

  it('breaks joining-time ties by id', () => {
    const at = '2026-10-01T07:10:00Z';
    expect(walkerColourOrder(null, [row('m', at), row('k', at)], [])).toEqual(['k', 'm']);
  });

  it('appends positions from people not on the roster, by id', () => {
    expect(walkerColourOrder('a', [row('b', '2026-10-01T07:10:00Z')], ['x', 'd', 'b'])).toEqual(['a', 'b', 'd', 'x']);
  });

  it('never lists anyone twice', () => {
    const order = walkerColourOrder('a', [row('a', '2026-10-01T07:00:00Z'), row('b')], ['a', 'b', 'b']);
    expect(order).toEqual(['a', 'b']);
  });

  it('survives an unparseable joining time', () => {
    expect(walkerColourOrder(null, [row('b', 'not a date'), row('a', '2026-10-01T07:00:00Z')], [])).toEqual(['a', 'b']);
  });
});

describe('applyLivePartyChange (perf-live-deltas)', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 4, 8, 0, s)).toISOString();
  const party = (user_id: string, s: number, path = [{ lat: 1, lng: 1 }]) => ({
    walk_id: 'w1', user_id, lat: -33.8 + s / 1e4, lng: 151.2, accuracy_m: 5, path, recorded_at: at(s),
  });
  const ana = party('ana', 10);
  const ben = party('ben', 20);
  const parties = [ben, ana];

  it('moves a walker forward, keeping everybody else as they were', () => {
    const next = applyLivePartyChange(parties, { eventType: 'UPDATE', new: { ...party('ana', 30), path: [{ lat: 2, lng: 2 }] } });
    expect(next.map(p => p.user_id)).toEqual(['ana', 'ben']);
    expect(next[0].path).toEqual([{ lat: 2, lng: 2 }]);
    expect(next[1]).toBe(ben);
  });

  it('never moves a dot backwards for a late event', () => {
    expect(applyLivePartyChange(parties, { eventType: 'UPDATE', new: party('ana', 5) })).toBe(parties);
  });

  it('keeps the path the change stream left out', () => {
    const later = party('ana', 40);
    const withoutPath = { walk_id: later.walk_id, user_id: later.user_id, lat: later.lat, lng: later.lng, accuracy_m: 5, recorded_at: later.recorded_at };
    const next = applyLivePartyChange(parties, { eventType: 'UPDATE', new: withoutPath });
    expect(next.find(p => p.user_id === 'ana')?.path).toEqual(ana.path);
  });

  it('adds a walker who starts sharing', () => {
    const next = applyLivePartyChange(parties, { eventType: 'INSERT', new: party('cy', 50) });
    expect(next.map(p => p.user_id)).toEqual(['cy', 'ben', 'ana']);
  });

  it('removes a walker on delete, and ignores a delete for nobody', () => {
    expect(applyLivePartyChange(parties, { eventType: 'DELETE', old: { user_id: 'ana' } }).map(p => p.user_id)).toEqual(['ben']);
    expect(applyLivePartyChange(parties, { eventType: 'DELETE', old: { user_id: 'zed' } })).toBe(parties);
  });

  it('returns the same array for anything it cannot use', () => {
    expect(applyLivePartyChange(parties, { eventType: 'UPDATE', new: { user_id: 'ana' } })).toBe(parties);
    expect(applyLivePartyChange(parties, { eventType: 'TRUNCATE', new: party('ana', 99) })).toBe(parties);
  });
});

describe('closeCheckDue', () => {
  it('checks every tick without the flag, or while realtime is down', () => {
    expect(closeCheckDue({ lighter: false, subscribed: true, lastCheckAt: 0, now: 1 })).toBe(true);
    expect(closeCheckDue({ lighter: true, subscribed: false, lastCheckAt: 0, now: 1 })).toBe(true);
  });

  it('with the flag and a live channel, every 30 seconds', () => {
    expect(closeCheckDue({ lighter: true, subscribed: true, lastCheckAt: 0, now: 29_999 })).toBe(false);
    expect(closeCheckDue({ lighter: true, subscribed: true, lastCheckAt: 0, now: 30_000 })).toBe(true);
  });
});

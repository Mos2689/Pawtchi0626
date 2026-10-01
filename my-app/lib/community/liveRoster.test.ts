import { walkerColourOrder } from './liveRoster';

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

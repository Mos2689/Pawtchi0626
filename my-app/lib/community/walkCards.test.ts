import { parseWalkCards, walkCardStats, type WalkCard } from './walkCards';

const W = '33333333-3333-4333-8333-333333333333';

describe('parseWalkCards', () => {
  it('reads a full row, numbers as strings included (NUMERIC arrives as text)', () => {
    const [card] = parseWalkCards([{
      walk_id: W, cover_path: 'p/a.jpg', photo_count: 3, walker_count: 2, distance_m: '2400.5', duration_s: 2700,
      routes: [[{ lat: -33.1, lng: 151.2 }, { lat: -33.2, lng: 151.3 }]],
    }]);
    expect(card).toEqual({
      walkId: W, coverPath: 'p/a.jpg', photoCount: 3, walkerCount: 2, distanceM: 2400.5, durationS: 2700,
      routes: [[{ lat: -33.1, lng: 151.2 }, { lat: -33.2, lng: 151.3 }]],
    });
  });

  it('drops bad routes and bad rows, never throws', () => {
    const cards = parseWalkCards([
      { walk_id: W, routes: [[{ lat: 'x', lng: 1 }], [{ lat: 1, lng: 1 }], 'nope'] },
      { nope: true },
      null,
    ]);
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ coverPath: null, photoCount: 0, distanceM: null, routes: [] });
    expect(parseWalkCards('garbage')).toEqual([]);
  });
});

describe('walkCardStats', () => {
  const card = (over: Partial<WalkCard>): WalkCard => ({
    walkId: W, coverPath: null, photoCount: 0, walkerCount: 0, distanceM: null, durationS: null, routes: [], ...over,
  });
  it('says the known parts', () => {
    expect(walkCardStats(card({ distanceM: 2400, durationS: 2700, walkerCount: 3 }))).toBe('2.4 km · 45 min · 3 walkers');
    expect(walkCardStats(card({ distanceM: 640, walkerCount: 1 }))).toBe('640 m · 1 walker');
    expect(walkCardStats(card({ durationS: 3600 * 1.5 }))).toBe('1 h 30 min');
    expect(walkCardStats(card({ durationS: 3600 }))).toBe('1 h');
  });
  it('is empty when nothing is known', () => {
    expect(walkCardStats(card({}))).toBe('');
    expect(walkCardStats(null)).toBe('');
  });
});

import { spreadMarkers } from './spreadMarkers';

/**
 * The claim these pin: people walking side by side never render as one stacked
 * face, and the layout does not jitter between refreshes.
 */

const MIN = 84;
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe('spreadMarkers', () => {
  it('leaves walkers who are already apart exactly where they are', () => {
    const out = spreadMarkers([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 400, y: 400 },
    ], MIN);
    expect(out.map(p => [p.x, p.y, p.displaced])).toEqual([
      [100, 100, false],
      [400, 400, false],
    ]);
  });

  it('separates two walkers on the same spot — the side-by-side case', () => {
    const out = spreadMarkers([
      { id: 'a', x: 200, y: 300 },
      { id: 'b', x: 201, y: 300 },
    ], MIN);
    expect(dist(out[0], out[1])).toBeCloseTo(MIN, 5);
    expect(out.every(p => p.displaced)).toBe(true);
  });

  it('places a pair left and right, the way people walk together', () => {
    const [a, b] = spreadMarkers([
      { id: 'a', x: 200, y: 300 },
      { id: 'b', x: 200, y: 300 },
    ], MIN);
    expect(a.y).toBeCloseTo(b.y, 5);
    expect(Math.abs(a.x - b.x)).toBeCloseTo(MIN, 5);
  });

  it('keeps every member of a larger group at least the minimum apart', () => {
    const out = spreadMarkers([
      { id: 'a', x: 300, y: 300 },
      { id: 'b', x: 302, y: 301 },
      { id: 'c', x: 299, y: 303 },
      { id: 'd', x: 301, y: 298 },
    ], MIN);
    for (let i = 0; i < out.length; i += 1) {
      for (let j = i + 1; j < out.length; j += 1) {
        expect(dist(out[i], out[j])).toBeGreaterThanOrEqual(MIN - 1e-6);
      }
    }
  });

  it('keeps the group centred on where the group actually is', () => {
    const out = spreadMarkers([
      { id: 'a', x: 300, y: 300 },
      { id: 'b', x: 310, y: 300 },
      { id: 'c', x: 305, y: 308 },
    ], MIN);
    const cx = out.reduce((s, p) => s + p.x, 0) / out.length;
    const cy = out.reduce((s, p) => s + p.y, 0) / out.length;
    expect(cx).toBeCloseTo((300 + 310 + 305) / 3, 5);
    expect(cy).toBeCloseTo((300 + 300 + 308) / 3, 5);
  });

  it('is stable across refreshes even when input order changes', () => {
    // Positions arrive every few seconds in no particular order. If slots
    // followed input order, people would visibly swap places on each update.
    const first = spreadMarkers([
      { id: 'maya', x: 200, y: 200 },
      { id: 'sam', x: 202, y: 201 },
    ], MIN);
    const second = spreadMarkers([
      { id: 'sam', x: 203, y: 200 },
      { id: 'maya', x: 201, y: 202 },
    ], MIN);
    const side = (list: typeof first, id: string) => Math.sign(list.find(p => p.id === id)!.x - 200);
    expect(side(first, 'maya')).toBe(side(second, 'maya'));
    expect(side(first, 'sam')).toBe(side(second, 'sam'));
  });

  it('reports where each walker really is', () => {
    const out = spreadMarkers([
      { id: 'a', x: 200, y: 300 },
      { id: 'b', x: 201, y: 300 },
    ], MIN);
    expect(out.find(p => p.id === 'a')!.anchor).toEqual({ x: 200, y: 300 });
    expect(out.find(p => p.id === 'b')!.anchor).toEqual({ x: 201, y: 300 });
  });

  it('chains a group through a middle walker', () => {
    // a and c are far apart but both close to b — they are one cluster, or b
    // would be spread against a and still sit on top of c.
    const out = spreadMarkers([
      { id: 'a', x: 100, y: 100 },
      { id: 'b', x: 160, y: 100 },
      { id: 'c', x: 220, y: 100 },
    ], MIN);
    expect(out.every(p => p.displaced)).toBe(true);
  });

  it('handles nothing, one walker, and non-finite input without throwing', () => {
    expect(spreadMarkers([], MIN)).toEqual([]);
    expect(spreadMarkers([{ id: 'a', x: 1, y: 2 }], MIN)[0].displaced).toBe(false);
    expect(spreadMarkers([{ id: 'a', x: NaN, y: 2 }, { id: 'b', x: 1, y: 1 }], MIN)).toHaveLength(1);
  });

  it('preserves the order it was given', () => {
    const out = spreadMarkers([
      { id: 'z', x: 200, y: 200 },
      { id: 'a', x: 200, y: 200 },
    ], MIN);
    expect(out.map(p => p.id)).toEqual(['z', 'a']);
  });
});

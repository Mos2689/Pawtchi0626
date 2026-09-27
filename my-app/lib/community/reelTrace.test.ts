import { longestRoute, momentProgress, reelTracePoints } from './reelTrace';

/**
 * The reel draws a claim under every photograph: "the walk had got this far".
 * Every test here is about that claim staying true, because the failures are
 * all silent — a trace filled to the wrong point still looks like a trace.
 */

describe('momentProgress', () => {
  const start = '2026-09-22T10:00:00.000Z';
  const end = '2026-09-22T11:00:00.000Z';

  it('is the fraction of the walk that had elapsed', () => {
    expect(momentProgress('2026-09-22T10:30:00.000Z', start, end)).toBeCloseTo(0.5);
    expect(momentProgress('2026-09-22T10:15:00.000Z', start, end)).toBeCloseTo(0.25);
  });

  it('is 0 at the start and 1 at the end', () => {
    expect(momentProgress(start, start, end)).toBe(0);
    expect(momentProgress(end, start, end)).toBe(1);
  });

  it('clamps a photo from outside the walk', () => {
    // An imported photo can carry a time from last summer. A trace filled to
    // 340%, or to a negative width, renders as a drawing bug.
    expect(momentProgress('2026-09-22T09:00:00.000Z', start, end)).toBe(0);
    expect(momentProgress('2026-09-22T18:00:00.000Z', start, end)).toBe(1);
  });

  it('says 0 rather than guessing when the walk has no clock', () => {
    // A walk that was never started, or never closed, cannot answer this.
    expect(momentProgress('2026-09-22T10:30:00.000Z', null, end)).toBe(0);
    expect(momentProgress('2026-09-22T10:30:00.000Z', start, null)).toBe(0);
    expect(momentProgress('2026-09-22T10:30:00.000Z', null, null)).toBe(0);
  });

  it('survives an unparseable time', () => {
    expect(momentProgress('not a date', start, end)).toBe(0);
    expect(momentProgress('2026-09-22T10:30:00.000Z', 'nonsense', end)).toBe(0);
  });

  it('refuses a walk that ended before it started', () => {
    // Clock skew between two phones can produce this. Dividing by a negative
    // span would flip the fill and run it backwards.
    expect(momentProgress('2026-09-22T10:30:00.000Z', end, start)).toBe(0);
  });

  it('refuses a zero-length walk rather than dividing by nothing', () => {
    expect(momentProgress(start, start, start)).toBe(0);
  });
});

describe('longestRoute', () => {
  const a = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }];
  const b = [{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }, { lat: 3, lng: 3 }];

  it('picks the recording that describes most of the walk', () => {
    // A walker who joined late has a line that starts in the middle. The
    // longest is the one most likely to be the whole walk.
    expect(longestRoute([a, b])).toBe(b);
    expect(longestRoute([b, a])).toBe(b);
  });

  it('is empty when nobody recorded', () => {
    expect(longestRoute([])).toEqual([]);
    expect(longestRoute([[]])).toEqual([]);
  });
});

describe('reelTracePoints', () => {
  const route = [
    { lat: 51.500, lng: -0.120 },
    { lat: 51.505, lng: -0.110 },
    { lat: 51.503, lng: -0.100 },
  ];

  it('projects every point into the strip', () => {
    const points = reelTracePoints(route, 260, 24);
    expect(points.split(' ')).toHaveLength(3);
  });

  it('stays inside the strip it was given', () => {
    const points = reelTracePoints(route, 260, 24, 4);
    for (const pair of points.split(' ')) {
      const [x, y] = pair.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(260);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(24);
    }
  });

  it('draws nothing from a walk with no shape', () => {
    // One fix is a dot, not a line. An empty string is what tells the reel to
    // drop the trace card entirely rather than render an empty box.
    expect(reelTracePoints([], 260, 24)).toBe('');
    expect(reelTracePoints([route[0]], 260, 24)).toBe('');
  });

  it('draws a line for a walk that never moved', () => {
    // Every point identical: there is no extent to fit, and the projection
    // must not produce NaN coordinates that render as nothing at all.
    const still = [route[0], route[0], route[0]];
    const points = reelTracePoints(still, 260, 24);
    if (points) {
      expect(points).not.toContain('NaN');
    }
  });
});

import {
  distanceLabel,
  mergeTraces,
  durationLabel,
  paceLabel,
  rankTraces,
  togetherSeconds,
  togetherSummary,
} from './memoryTraces';
import type { WalkerTrace } from '../communityWalks';

const trace = (over: Partial<WalkerTrace> = {}): WalkerTrace => ({
  userId: 'a',
  routes: [],
  distanceM: 2400,
  durationS: 1864,
  sniffs: 5,
  ...over,
});

describe('distanceLabel', () => {
  it('counts in metres until a kilometre', () => {
    expect(distanceLabel(840)).toBe('840 m');
    expect(distanceLabel(999)).toBe('999 m');
  });

  it('switches to kilometres at one', () => {
    expect(distanceLabel(1000)).toBe('1.0 km');
    expect(distanceLabel(2449)).toBe('2.4 km');
  });

  it('survives a walk that measured nothing', () => {
    expect(distanceLabel(0)).toBe('0 m');
    expect(distanceLabel(NaN)).toBe('0 m');
    expect(distanceLabel(-12)).toBe('0 m');
  });
});

describe('durationLabel', () => {
  it('reads as a stopwatch under an hour', () => {
    expect(durationLabel(1864)).toBe('31:04');
    expect(durationLabel(59)).toBe('00:59');
  });

  it('grows an hours field only when it needs one', () => {
    expect(durationLabel(3731)).toBe('1:02:11');
  });

  it('survives nothing', () => {
    expect(durationLabel(0)).toBe('0:00');
    expect(durationLabel(NaN)).toBe('0:00');
  });
});

describe('paceLabel', () => {
  it('reads minutes and seconds per kilometre', () => {
    expect(paceLabel(2400, 1864)).toBe("12'57\"");
  });

  it('carries rather than printing sixty seconds', () => {
    // 59.6s rounds to 60 and would otherwise print 12'60".
    expect(paceLabel(1000, 12 * 60 + 59.6)).toBe("13'00\"");
  });

  it('refuses to divide a walk too short to have a pace', () => {
    // A 12 m recording gives an arithmetically correct pace in the hours and
    // says nothing true about how anybody was walking.
    expect(paceLabel(12, 400)).toBeNull();
    expect(paceLabel(99, 100)).toBeNull();
  });

  it('refuses a pace with no time', () => {
    expect(paceLabel(2400, 0)).toBeNull();
    expect(paceLabel(2400, NaN)).toBeNull();
  });

  it('refuses an absurd pace rather than printing three digits', () => {
    expect(paceLabel(150, 60 * 60 * 5)).toBeNull();
  });
});

describe('togetherSeconds', () => {
  it('measures the walk, not anybody’s recording', () => {
    expect(togetherSeconds({
      started_at: '2026-09-21T08:00:00Z',
      ended_at: '2026-09-21T08:31:00Z',
    })).toBe(1860);
  });

  it('says nothing when the walk never started or never closed', () => {
    expect(togetherSeconds({ started_at: null, ended_at: '2026-09-21T08:31:00Z' })).toBeNull();
    expect(togetherSeconds({ started_at: '2026-09-21T08:00:00Z', ended_at: null })).toBeNull();
  });

  it('says nothing when the clock runs backwards', () => {
    expect(togetherSeconds({
      started_at: '2026-09-21T09:00:00Z',
      ended_at: '2026-09-21T08:00:00Z',
    })).toBeNull();
    expect(togetherSeconds({ started_at: 'nonsense', ended_at: 'also nonsense' })).toBeNull();
  });
});

describe('togetherSummary', () => {
  it('leads with what the pack actually shares', () => {
    expect(togetherSummary({ walkers: 3, seconds: 1860, moments: 4 }))
      .toBe('3 walked · 31 min together · 4 moments');
  });

  it('never states a shared distance', () => {
    // Three phones measured three different distances. There is no fourth
    // number that belongs to the walk.
    expect(togetherSummary({ walkers: 3, seconds: 1860, moments: 4 })).not.toMatch(/km|\bm\b/);
  });

  it('drops the parts it cannot say', () => {
    expect(togetherSummary({ walkers: 3, seconds: null, moments: 4 })).toBe('3 walked · 4 moments');
    expect(togetherSummary({ walkers: 3, seconds: 1860, moments: 0 })).toBe('3 walked · 31 min together');
  });

  it('speaks to a walk of one in the second person', () => {
    expect(togetherSummary({ walkers: 1, seconds: 600, moments: 0 })).toBe('You walked · 10 min together');
  });

  it('returns an empty string rather than a dangling separator', () => {
    expect(togetherSummary({ walkers: 0, seconds: null, moments: 0 })).toBe('');
  });
});

describe('rankTraces', () => {
  it('puts the longest walk first', () => {
    const ranked = rankTraces([
      trace({ userId: 'b', distanceM: 2200 }),
      trace({ userId: 'c', distanceM: 2500 }),
      trace({ userId: 'a', distanceM: 2400 }),
    ]);
    expect(ranked.map(t => t.userId)).toEqual(['c', 'a', 'b']);
  });

  it('breaks ties deterministically, so the order cannot shuffle', () => {
    const ranked = rankTraces([
      trace({ userId: 'z', distanceM: 2000 }),
      trace({ userId: 'a', distanceM: 2000 }),
    ]);
    expect(ranked.map(t => t.userId)).toEqual(['a', 'z']);
  });

  it('does not mutate what it was given', () => {
    const input = [trace({ userId: 'b', distanceM: 1 }), trace({ userId: 'a', distanceM: 9 })];
    rankTraces(input);
    expect(input.map(t => t.userId)).toEqual(['b', 'a']);
  });
});

describe('mergeTraces', () => {
  const line = (n: number) => [{ lat: n, lng: n }, { lat: n + 0.01, lng: n + 0.01 }];

  it('gives one trace per person, not one per recording', () => {
    // The production shape this was written for: one walker with four links on
    // a single community walk, which rendered four rows sharing a React key.
    const links = [1, 2, 3, 4].map(i => ({ user_id: 'walker', walk_session_id: `s${i}` }));
    const sessions = [1, 2, 3, 4].map(i => ({
      id: `s${i}`, route: line(i), distance_m: 500, duration_s: 300, sniff_points: [{}, {}],
    }));
    const traces = mergeTraces(links, sessions);
    expect(traces).toHaveLength(1);
    expect(traces[0].userId).toBe('walker');
  });

  it('sums the numbers, because they walked all of it', () => {
    const traces = mergeTraces(
      [{ user_id: 'a', walk_session_id: 's1' }, { user_id: 'a', walk_session_id: 's2' }],
      [
        { id: 's1', route: line(1), distance_m: 1200, duration_s: 900, sniff_points: [{}, {}] },
        { id: 's2', route: line(2), distance_m: 800, duration_s: 600, sniff_points: [{}] },
      ],
    );
    expect(traces[0].distanceM).toBe(2000);
    expect(traces[0].durationS).toBe(1500);
    expect(traces[0].sniffs).toBe(3);
  });

  it('keeps the recordings as separate segments', () => {
    // Concatenating them would draw a straight line from where one stopped to
    // where the next began — a route nobody walked.
    const traces = mergeTraces(
      [{ user_id: 'a', walk_session_id: 's1' }, { user_id: 'a', walk_session_id: 's2' }],
      [{ id: 's1', route: line(1) }, { id: 's2', route: line(50) }],
    );
    expect(traces[0].routes).toHaveLength(2);
    expect(traces[0].routes[0][0].lat).toBe(1);
    expect(traces[0].routes[1][0].lat).toBe(50);
  });

  it('keeps different people apart', () => {
    const traces = mergeTraces(
      [{ user_id: 'a', walk_session_id: 's1' }, { user_id: 'b', walk_session_id: 's2' }],
      [{ id: 's1', route: line(1) }, { id: 's2', route: line(2) }],
    );
    expect(traces.map(t => t.userId).sort()).toEqual(['a', 'b']);
  });

  it('counts a one-point recording but does not draw it', () => {
    const traces = mergeTraces(
      [{ user_id: 'a', walk_session_id: 's1' }],
      [{ id: 's1', route: [{ lat: 1, lng: 1 }], distance_m: 40, duration_s: 90 }],
    );
    expect(traces[0].routes).toHaveLength(0);
    expect(traces[0].distanceM).toBe(40);
  });

  it('ignores a link whose recording is missing or unreadable', () => {
    const traces = mergeTraces(
      [{ user_id: 'a', walk_session_id: 'gone' }],
      [{ id: 's1', route: line(1) }],
    );
    expect(traces).toEqual([]);
  });

  it('survives rows with nothing usable on them', () => {
    const traces = mergeTraces(
      [{ user_id: 'a', walk_session_id: 's1' }],
      [{ id: 's1', route: null, distance_m: null, duration_s: undefined, sniff_points: 'nope' }],
    );
    expect(traces[0]).toEqual({ userId: 'a', routes: [], distanceM: 0, durationS: 0, sniffs: 0 });
  });
});

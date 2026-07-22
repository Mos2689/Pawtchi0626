import {
  createSession,
  ingestPoint,
  checkAutoStop,
  finalizeSession,
  DEFAULT_SESSION_CONFIG,
  RawGpsPoint,
  WalkSessionState,
} from './walkSession';

const T0 = 1_800_000_000_000; // fixed epoch anchor
const LAT0 = 40.0;
const LNG0 = -74.0;
/** meters → degrees latitude (matches haversine within test tolerances) */
const M_PER_DEG_LAT = 110_574;

function pt(
  northM: number,
  tOffsetMs: number,
  accuracy: number | null = 5,
): RawGpsPoint {
  return {
    lat: LAT0 + northM / M_PER_DEG_LAT,
    lng: LNG0,
    accuracy,
    timestamp: T0 + tOffsetMs,
  };
}

function ingestAll(points: RawGpsPoint[], state?: WalkSessionState) {
  let s = state ?? createSession(T0);
  for (const p of points) s = ingestPoint(p === points[0] && !state ? s : s, p);
  return s;
}

/** Steady walk northward: one fix every 5s at `speedMps`. */
function walkTrace(durationS: number, speedMps: number, startOffsetMs = 0) {
  const points: RawGpsPoint[] = [];
  for (let t = 0; t <= durationS; t += 5) {
    points.push(pt(t * speedMps, startOffsetMs + t * 1000));
  }
  return points;
}

describe('walkSession — a real walk', () => {
  it('accumulates distance and moving time for a 20-minute walk', () => {
    const s = ingestAll(walkTrace(20 * 60, 1.4)); // 5 km/h
    expect(s.distanceM).toBeGreaterThan(1500);
    expect(s.distanceM).toBeLessThan(1800);
    expect(s.movingTimeMs).toBeGreaterThan(19 * 60_000);
    expect(s.status).toBe('active');
    expect(s.rejectedForAccuracy).toBe(0);
    expect(s.rejectedForSpeed).toBe(0);

    const summary = finalizeSession(s, T0 + 20 * 60_000, 'manual');
    expect(summary.avgMovingSpeedKmh).toBeGreaterThan(4.5);
    expect(summary.avgMovingSpeedKmh).toBeLessThan(5.5);
    expect(summary.durationS).toBe(20 * 60);
  });
});

describe('walkSession — GPS hygiene', () => {
  it('rejects low-accuracy fixes without moving the dog', () => {
    let s = createSession(T0);
    s = ingestPoint(s, pt(0, 0));
    s = ingestPoint(s, pt(500, 5_000, 80)); // 80m accuracy radius — junk
    s = ingestPoint(s, pt(700, 10_000, 50));
    expect(s.rejectedForAccuracy).toBe(2);
    expect(s.distanceM).toBe(0);
  });

  it('rejects vehicle-speed segments and counts them for the validator', () => {
    let s = createSession(T0);
    s = ingestPoint(s, pt(0, 0));
    // 100m in 5s = 72 km/h
    s = ingestPoint(s, pt(100, 5_000));
    expect(s.rejectedForSpeed).toBe(1);
    expect(s.distanceM).toBe(0);
  });

  it('treats sub-3m wobble as stillness, not steps', () => {
    let s = createSession(T0);
    s = ingestPoint(s, pt(0, 0));
    for (let i = 1; i <= 10; i++) {
      s = ingestPoint(s, pt(1, i * 5_000)); // 1m from anchor, repeatedly
    }
    expect(s.distanceM).toBe(0);
    expect(s.stationarySince).not.toBeNull();
  });

  it('caps the distance credited across a signal gap', () => {
    let s = createSession(T0);
    s = ingestPoint(s, pt(0, 0));
    // 300m jump after a 3-minute dropout, at plausible walking speed
    s = ingestPoint(s, pt(300, 180_000));
    expect(s.distanceM).toBe(DEFAULT_SESSION_CONFIG.maxSegmentDistanceM);
    expect(s.movingTimeMs).toBe(DEFAULT_SESSION_CONFIG.maxSegmentTimeMs);
  });
});

describe('walkSession — pause and stop', () => {
  function stationaryAfterWalk(stationaryS: number) {
    let s = ingestAll(walkTrace(6 * 60, 1.4)); // 6 min of walking
    const walkedM = 6 * 60 * 1.4;
    const base = 6 * 60_000;
    for (let t = 5; t <= stationaryS; t += 5) {
      s = ingestPoint(s, pt(walkedM, base + t * 1000));
    }
    return { s, endMs: T0 + base + stationaryS * 1000 };
  }

  it('auto-pauses after the sniff-stop window, and resumes on real departure', () => {
    const { s } = stationaryAfterWalk(5 * 60); // 5 min still > 4 min window
    expect(s.status).toBe('auto_paused');

    // Resume requires escaping the loiter radius — a 30m move is a departure,
    // drift-scale wobble is not.
    const walkedM = 6 * 60 * 1.4;
    const resumed = ingestPoint(s, pt(walkedM + 30, T0 + 12 * 60_000));
    expect(resumed.status).toBe('active');
    expect(resumed.stationarySince).toBeNull();
  });

  it('auto-stops after a long stationary spell', () => {
    const { s, endMs } = stationaryAfterWalk(10 * 60);
    const stop = checkAutoStop(s, endMs);
    expect(stop).toEqual({ shouldStop: true, reason: 'auto_stationary' });
  });

  it('does not auto-stop a walk in motion', () => {
    const s = ingestAll(walkTrace(10 * 60, 1.4));
    expect(checkAutoStop(s, T0 + 10 * 60_000).shouldStop).toBe(false);
  });

  it('auto-stops when the loop returns home and lingers', () => {
    // Out 400m…
    let s = ingestAll(walkTrace(5 * 60, 1.4));
    // …and back to the door
    const base = 5 * 60_000;
    const outM = 5 * 60 * 1.4;
    for (let t = 5; t <= 5 * 60; t += 5) {
      s = ingestPoint(s, pt(outM - t * 1.4, base + t * 1000));
    }
    // Linger at the door past the auto-pause window
    const backMs = base + 5 * 60_000;
    for (let t = 5; t <= 4.5 * 60; t += 5) {
      s = ingestPoint(s, pt(0, backMs + t * 1000));
    }
    const now = T0 + backMs + 4.5 * 60_000;
    const stop = checkAutoStop(s, now);
    expect(stop.shouldStop).toBe(true);
    expect(stop.reason).toBe('auto_home');
  });

  it('hard-caps a session left running', () => {
    const s = ingestAll(walkTrace(60, 1.4));
    const stop = checkAutoStop(s, T0 + DEFAULT_SESSION_CONFIG.hardCapMs);
    expect(stop).toEqual({ shouldStop: true, reason: 'time_cap' });
  });

  it('auto-stops a phone drifting on a shelf — loitering beats GPS drift', () => {
    // 6 min of real walking, then 12 min of indoor drift: accepted-looking
    // 8m hops (above the 3m jitter floor, below the speed gate) oscillating
    // around one spot. A naive stationary clock would reset on every hop and
    // never stop; the loiter anchor keeps the clock running.
    let s = ingestAll(walkTrace(6 * 60, 1.4));
    const walkedM = 6 * 60 * 1.4;
    const base = 6 * 60_000;
    for (let t = 5; t <= 12 * 60; t += 5) {
      const wobble = (t / 5) % 2 === 0 ? 8 : -8;
      s = ingestPoint(s, pt(walkedM + wobble, base + t * 1000));
    }
    expect(s.status).toBe('auto_paused');
    const stop = checkAutoStop(s, T0 + base + 12 * 60_000);
    expect(stop).toEqual({ shouldStop: true, reason: 'auto_stationary' });
  });

  it('never clips a brisk lap passing the front door', () => {
    // Out 400m, back past the door at full pace, and onward — the moment the
    // dog crosses the start geofence while moving must not end the walk.
    let s = ingestAll(walkTrace(5 * 60, 1.4));
    const outM = 5 * 60 * 1.4;
    const base = 5 * 60_000;
    // Return leg: all the way back to the door and 100m beyond.
    const returnS = Math.round((outM + 100) / 1.4);
    for (let t = 5; t <= returnS; t += 5) {
      const north = outM - t * 1.4;
      s = ingestPoint(s, pt(north, base + t * 1000));
      // Check at every fix near the door — none may stop the walk.
      if (Math.abs(north) <= DEFAULT_SESSION_CONFIG.homeRadiusM) {
        const stop = checkAutoStop(s, T0 + base + t * 1000);
        expect(stop.shouldStop).toBe(false);
      }
    }
  });
});

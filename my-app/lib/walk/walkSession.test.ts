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

// ── Sniff-episode detector ──────────────────────────────────────────────────
// Traces run at 2 m/s (10m strides): every stride escapes the ~7.5m adaptive
// radius (accuracy 5 → clamp(1.5×5, 6, 15) = 7.5), so the episode boundaries
// in these tests are exact — a stop's anchor is planted by the stride that
// arrives at it, and the next stride away closes it.

/** Walk northward at 2 m/s from `fromM`, one fix per 5s. Returns end pos. */
function stride(
  s: WalkSessionState,
  fromM: number,
  fromMs: number,
  durationS: number,
  accuracy: number | null = 5,
): { s: WalkSessionState; posM: number; tMs: number } {
  let cur = s;
  for (let t = 5; t <= durationS; t += 5) {
    cur = ingestPoint(cur, pt(fromM + t * 2, fromMs + t * 1000, accuracy));
  }
  return { s: cur, posM: fromM + durationS * 2, tMs: fromMs + durationS * 1000 };
}

/** Hold position (exact fixes) for `durationS`, one fix per 5s. */
function hold(
  s: WalkSessionState,
  atM: number,
  fromMs: number,
  durationS: number,
  accuracy: number | null = 5,
): { s: WalkSessionState; posM: number; tMs: number } {
  let cur = s;
  for (let t = 5; t <= durationS; t += 5) {
    cur = ingestPoint(cur, pt(atM, fromMs + t * 1000, accuracy));
  }
  return { s: cur, posM: atM, tMs: fromMs + durationS * 1000 };
}

describe('walkSession — sniff episodes', () => {
  it('records a stop at the 15s minimum once the dog departs', () => {
    let w = stride(createSessionWithFirstFix(), 0, 0, 60);
    w = hold(w.s, w.posM, w.tMs, 15);
    w = stride(w.s, w.posM, w.tMs, 30);

    expect(w.s.sniffPoints).toHaveLength(1);
    expect(w.s.sniffPoints[0].dwellS).toBeGreaterThanOrEqual(15);
  });

  it('records a 45s stop as one episode at its centroid with its dwell', () => {
    let w = stride(createSessionWithFirstFix(), 0, 0, 60);
    w = hold(w.s, w.posM, w.tMs, 45);
    const stopAtM = w.posM;
    w = stride(w.s, w.posM, w.tMs, 60);

    expect(w.s.sniffPoints).toHaveLength(1);
    const ep = w.s.sniffPoints[0];
    expect(ep.dwellS).toBeGreaterThanOrEqual(40);
    expect(ep.dwellS).toBeLessThanOrEqual(50);
    // Centroid sits at the stop (all fixes were exactly there).
    const northM = (ep.lat - LAT0) * M_PER_DEG_LAT;
    expect(Math.abs(northM - stopAtM)).toBeLessThan(3);
  });

  it('ignores a 10s stop and a steady walk entirely', () => {
    let w = stride(createSessionWithFirstFix(), 0, 0, 60);
    w = hold(w.s, w.posM, w.tMs, 10);
    w = stride(w.s, w.posM, w.tMs, 60);
    expect(w.s.sniffPoints).toHaveLength(0);
  });

  it('does not mint episodes from a slow amble', () => {
    // 0.7 m/s — 3.5m strides cross the radius every ~2-3 fixes.
    let s = createSessionWithFirstFix();
    for (let t = 5; t <= 300; t += 5) {
      s = ingestPoint(s, pt(t * 0.7, t * 1000));
    }
    expect(s.sniffPoints).toHaveLength(0);
  });

  it('holds one episode through GPS wobble around the spot', () => {
    // ±4m alternation: over the 3m jitter floor, inside the 7.5m radius.
    let w = stride(createSessionWithFirstFix(), 0, 0, 60);
    const at = w.posM;
    let s = w.s;
    for (let t = 5; t <= 45; t += 5) {
      s = ingestPoint(s, pt(at + (t % 10 === 0 ? 4 : 0), w.tMs + t * 1000));
    }
    const done = stride(s, at, w.tMs + 45_000, 60);
    expect(done.s.sniffPoints).toHaveLength(1);
    expect(done.s.sniffPoints[0].dwellS).toBeGreaterThanOrEqual(40);
  });

  it('suspends under degraded accuracy and recovers with it', () => {
    // Whole first leg at 25m accuracy (accepted, but median > 20 suspend).
    let w = stride(createSessionWithFirstFix(25), 0, 0, 60, 25);
    w = hold(w.s, w.posM, w.tMs, 60, 25);
    w = stride(w.s, w.posM, w.tMs, 60, 25);
    expect(w.s.sniffPoints).toHaveLength(0);

    // Accuracy recovers; the 9-fix median flips after 5 good fixes (25s of
    // walking), then a clean stop records again.
    w = stride(w.s, w.posM, w.tMs, 60, 5);
    w = hold(w.s, w.posM, w.tMs, 45, 5);
    w = stride(w.s, w.posM, w.tMs, 30, 5);
    expect(w.s.sniffPoints).toHaveLength(1);
  });

  it('merges a quick revisit of the same spot into one investigation', () => {
    let w = stride(createSessionWithFirstFix(), 0, 0, 30);
    const spot = w.posM;
    w = hold(w.s, spot, w.tMs, 40);
    // 10m away and straight back — a 10s detour.
    let s = ingestPoint(w.s, pt(spot + 10, w.tMs + 5_000));
    s = ingestPoint(s, pt(spot, w.tMs + 10_000));
    const back = hold(s, spot, w.tMs + 10_000, 35);
    const done = stride(back.s, spot, back.tMs, 30);

    expect(done.s.sniffPoints).toHaveLength(1);
    expect(done.s.sniffPoints[0].dwellS).toBeGreaterThanOrEqual(70);
  });

  it('records a 6-minute stop in BOTH ledgers — pause and episode', () => {
    let w = stride(createSessionWithFirstFix(), 0, 0, 30);
    w = hold(w.s, w.posM, w.tMs, 360);
    const done = stride(w.s, w.posM, w.tMs, 30);

    expect(done.s.pausePoints).toHaveLength(1);
    expect(done.s.sniffPoints).toHaveLength(1);
    expect(done.s.sniffPoints[0].dwellS).toBeGreaterThanOrEqual(350);
  });

  it('discards the still-open trailing episode at finalize', () => {
    let w = stride(createSessionWithFirstFix(), 0, 0, 60);
    w = hold(w.s, w.posM, w.tMs, 90); // arrived home, never departed
    const summary = finalizeSession(w.s, T0 + w.tMs, 'manual');
    expect(summary.sniffPoints).toHaveLength(0);
  });

  it('is deterministic — same trace, identical episodes', () => {
    const run = () => {
      let w = stride(createSessionWithFirstFix(), 0, 0, 60);
      w = hold(w.s, w.posM, w.tMs, 45);
      w = stride(w.s, w.posM, w.tMs, 60);
      return w.s.sniffPoints;
    };
    expect(run()).toEqual(run());
  });
});

/** A fresh session with its first fix at the origin already ingested. */
function createSessionWithFirstFix(accuracy: number | null = 5): WalkSessionState {
  return ingestPoint(createSession(T0), pt(0, 0, accuracy));
}

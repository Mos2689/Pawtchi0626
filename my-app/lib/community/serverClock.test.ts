import {
  CLOCK_SAMPLE_TTL_MS,
  addClockSample,
  clockEstimate,
  createServerClock,
  localToServer,
  observeClock,
  serverToLocal,
} from './serverClock';

// The phone's clock runs 5 minutes behind the server's.
const SKEW = 5 * 60_000;
const SERVER_T0 = 1_760_000_000_000;

/** A round trip that left at monotonic `mono` and took `rtt` ms, answered at its midpoint. */
function sample(clock = createServerClock(), mono = 1_000, rtt = 200, skew = SKEW) {
  const receivedWall = SERVER_T0 - skew + mono + rtt;
  return addClockSample(clock, {
    serverNow: SERVER_T0 + mono + rtt / 2,
    sentMono: mono,
    receivedMono: mono + rtt,
    receivedWall,
  });
}

describe('server clock estimate', () => {
  it('has no estimate until it has a sample', () => {
    expect(clockEstimate(createServerClock(), 0)).toBeNull();
  });

  it('places the server answer at the midpoint of the round trip', () => {
    const estimate = clockEstimate(sample(), 1_300);
    expect(estimate?.offsetMs).toBe(SKEW);
    expect(estimate?.rttMs).toBe(200);
  });

  it('trusts the sample with the shortest round trip', () => {
    // A slow, asymmetric answer (the server answered late in the trip) is off
    // by 900 ms; the quick one is exact.
    let clock = addClockSample(createServerClock(), {
      serverNow: SERVER_T0 + 1_000 + 1_900,
      sentMono: 1_000,
      receivedMono: 3_000,
      receivedWall: SERVER_T0 - SKEW + 3_000,
    });
    clock = sample(clock, 5_000, 100);
    expect(clockEstimate(clock, 5_200)?.offsetMs).toBe(SKEW);
  });

  it('keeps at most the newest five samples', () => {
    let clock = createServerClock();
    for (let i = 0; i < 8; i += 1) clock = sample(clock, 1_000 + i * 1_000, 300 + i);
    expect(clock.samples).toHaveLength(5);
    expect(clockEstimate(clock, 9_000)?.rttMs).toBe(303);
  });

  it('expires after 10 minutes without a sample', () => {
    const clock = sample(createServerClock(), 1_000, 200);
    expect(clockEstimate(clock, 1_200 + CLOCK_SAMPLE_TTL_MS - 1)).not.toBeNull();
    expect(clockEstimate(clock, 1_200 + CLOCK_SAMPLE_TTL_MS)).toBeNull();
  });

  it('drops old samples as new ones arrive', () => {
    let clock = sample(createServerClock(), 1_000, 50);
    clock = sample(clock, 1_000 + CLOCK_SAMPLE_TTL_MS + 5_000, 400);
    expect(clock.samples).toHaveLength(1);
    expect(clockEstimate(clock, 1_000 + CLOCK_SAMPLE_TTL_MS + 6_000)?.rttMs).toBe(400);
  });

  it('ignores a round trip that went backwards', () => {
    const clock = addClockSample(createServerClock(), { serverNow: SERVER_T0, sentMono: 10, receivedMono: 5, receivedWall: SERVER_T0 });
    expect(clock.samples).toHaveLength(0);
  });

  it('works whichever way the phone is wrong', () => {
    expect(clockEstimate(sample(createServerClock(), 1_000, 200, -SKEW), 1_300)?.offsetMs).toBe(-SKEW);
  });

  it('maps between the two clocks', () => {
    const estimate = { offsetMs: SKEW, rttMs: 100 };
    expect(serverToLocal(SERVER_T0, estimate)).toBe(SERVER_T0 - SKEW);
    expect(localToServer(SERVER_T0 - SKEW, estimate)).toBe(SERVER_T0);
  });
});

describe('local clock changes', () => {
  it('lets ordinary time pass', () => {
    let clock = sample();
    clock = observeClock(clock, clock.last!.wall + 60_000, clock.last!.mono + 60_100);
    expect(clock.epoch).toBe(0);
    expect(clock.samples).toHaveLength(1);
  });

  it('starts over, in a new epoch, when the wall clock jumps', () => {
    let clock = sample();
    clock = observeClock(clock, clock.last!.wall + 60_000 + 3_600_000, clock.last!.mono + 60_000);
    expect(clock.epoch).toBe(1);
    expect(clock.samples).toHaveLength(0);
    expect(clockEstimate(clock, clock.last!.mono)).toBeNull();
  });

  it('does the same after the phone slept (the monotonic clock paused)', () => {
    let clock = sample();
    clock = observeClock(clock, clock.last!.wall + 15 * 60_000, clock.last!.mono + 1_000);
    expect(clock.epoch).toBe(1);
  });
});

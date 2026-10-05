/**
 * Live Walk v2 — this phone's estimate of the server's clock.
 *
 * Phones disagree about the time, sometimes by minutes. Live walks need ages
 * that mean the same thing on every phone ("heard 40 s ago", "GPS 3 min old"),
 * so every time that crosses devices is expressed on the SERVER's clock, and
 * each phone keeps an estimate of the offset between its own clock and the
 * server's:
 *
 *   offset = serverTime − localTime        local = server − offset
 *
 * Samples come from RPC answers that carry `server_now` (live_walk_positions,
 * begin_live_session, publish_live_location). The answer was produced
 * somewhere inside the round trip, so the best guess is its midpoint, and the
 * sample with the SHORTEST round trip is the most trustworthy (least room for
 * the server's moment to be anywhere else).
 *
 * Lifetime — an estimate is never kept past the point it can be trusted:
 *   * only samples from the last 10 minutes count, newest 5 at most;
 *   * a jump in the local clock (the user or the network changing it, or the
 *     phone sleeping, which pauses the monotonic clock) of more than 2 s
 *     discards everything and starts a new EPOCH. Anything computed in local
 *     time under the old epoch is no longer comparable with "now".
 *
 * Pure: callers pass both clocks in (`wall` = Date.now(), `mono` = a
 * monotonic clock such as performance.now()).
 */

export const CLOCK_SAMPLE_TTL_MS = 10 * 60_000;
export const CLOCK_MAX_SAMPLES = 5;
export const CLOCK_JUMP_MS = 2_000;

export interface ClockSample {
  offsetMs: number;
  rttMs: number;
  takenAtMono: number;
}

export interface ServerClock {
  samples: readonly ClockSample[];
  /** Bumped whenever local time stops being continuous with what came before. */
  epoch: number;
  /** The last (wall, mono) pair seen, to notice the local clock jumping. */
  last: { wall: number; mono: number } | null;
}

export interface ClockEstimate {
  offsetMs: number;
  rttMs: number;
}

export function createServerClock(): ServerClock {
  return { samples: [], epoch: 0, last: null };
}

/**
 * Notice local-clock jumps. Call on every sample and every tick; it is cheap
 * and it is the only way a changed clock gets noticed.
 */
export function observeClock(clock: ServerClock, wall: number, mono: number): ServerClock {
  const last = clock.last;
  if (last) {
    const drift = (wall - last.wall) - (mono - last.mono);
    if (Math.abs(drift) > CLOCK_JUMP_MS) {
      return { samples: [], epoch: clock.epoch + 1, last: { wall, mono } };
    }
  }
  return { ...clock, last: { wall, mono } };
}

/**
 * Add one RPC answer. `sentMono`/`receivedMono` time the round trip on the
 * monotonic clock, so a wall-clock change mid-request cannot distort it.
 */
export function addClockSample(
  clock: ServerClock,
  input: { serverNow: number; sentMono: number; receivedMono: number; receivedWall: number },
): ServerClock {
  const rttMs = input.receivedMono - input.sentMono;
  if (!Number.isFinite(input.serverNow) || !Number.isFinite(rttMs) || rttMs < 0) return clock;
  const observed = observeClock(clock, input.receivedWall, input.receivedMono);
  const midpointWall = input.receivedWall - rttMs / 2;
  const sample: ClockSample = { offsetMs: input.serverNow - midpointWall, rttMs, takenAtMono: input.receivedMono };
  const kept = observed.samples.filter(s => input.receivedMono - s.takenAtMono < CLOCK_SAMPLE_TTL_MS);
  return { ...observed, samples: [...kept, sample].slice(-CLOCK_MAX_SAMPLES) };
}

/** The current estimate, or null when there is no sample young enough to trust. */
export function clockEstimate(clock: ServerClock, mono: number): ClockEstimate | null {
  let best: ClockSample | null = null;
  for (const sample of clock.samples) {
    if (mono - sample.takenAtMono >= CLOCK_SAMPLE_TTL_MS || mono < sample.takenAtMono) continue;
    if (!best || sample.rttMs < best.rttMs) best = sample;
  }
  return best ? { offsetMs: best.offsetMs, rttMs: best.rttMs } : null;
}

export const serverToLocal = (serverMs: number, estimate: ClockEstimate) => serverMs - estimate.offsetMs;
export const localToServer = (localMs: number, estimate: ClockEstimate) => localMs + estimate.offsetMs;

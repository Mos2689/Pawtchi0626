/**
 * Is a shared walk's memory ready to show — does it hold everyone who walked?
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * When the host closes a walk, every phone finishes its own leg and attaches
 * it on its own schedule: seconds apart, sometimes more on a slow connection.
 * The memory used to open the moment THIS phone's leg was in, so it showed one
 * walker's line and one walker's stats — a memory of half the walk, which read
 * as broken rather than as "still arriving" (device report, 2026-09-24).
 *
 * So the memory waits until every person who actually walked has their route
 * in it — but never for long. A phone that went offline, or a walk too short to
 * save, will never deliver, and one missing person must not hold everyone
 * else's memory hostage. Past `MEMORY_SETTLE_GRACE_MS` after the walk ended it
 * opens with what there is.
 *
 * A memory opened days later is far past the grace and is ready at once.
 */

/** How long after a walk ends the memory waits for stragglers. */
export const MEMORY_SETTLE_GRACE_MS = 60_000;

/** Attendance that means "was out walking", not merely invited or coming. */
const WALKED = new Set(['walking', 'finished']);

export interface MemoryReadinessInput {
  attendance: readonly { user_id: string; status: string }[];
  /** Everyone whose route is already in the memory. */
  traceUserIds: readonly string[];
  walkState: string | null | undefined;
  endedAt: string | null | undefined;
  now: number;
}

export interface MemoryReadiness {
  ready: boolean;
  /** People who walked. */
  expected: number;
  /** Of those, how many have a route in. */
  arrived: number;
  /** When the wait gives up, as epoch ms — null when there is nothing to wait for. */
  deadline: number | null;
}

export function memoryReadiness(input: MemoryReadinessInput): MemoryReadiness {
  const walkers = new Set(
    input.attendance.filter(row => WALKED.has(row.status)).map(row => row.user_id),
  );
  const traced = new Set(input.traceUserIds);
  // Someone with a route counts even if their attendance row lags behind — a
  // route is proof they walked.
  for (const id of traced) walkers.add(id);

  const expected = walkers.size;
  const arrived = [...walkers].filter(id => traced.has(id)).length;

  // Only a walk that has just CLOSED is worth waiting on. One still going is
  // shown as it stands; one without an end time cannot be timed out, so it is
  // shown rather than held forever.
  const ended = input.walkState === 'completed' || input.walkState === 'cancelled';
  const endedAt = input.endedAt ? Date.parse(input.endedAt) : NaN;
  if (!ended || !Number.isFinite(endedAt)) {
    return { ready: true, expected, arrived, deadline: null };
  }

  const deadline = endedAt + MEMORY_SETTLE_GRACE_MS;
  const everyoneIn = arrived >= expected;
  return {
    ready: everyoneIn || input.now >= deadline,
    expected,
    arrived,
    deadline: everyoneIn ? null : deadline,
  };
}

/** The loader's line while it waits: honest about how far along it is. */
export function memoryWaitingLine(readiness: MemoryReadiness): string {
  if (readiness.expected <= 1) return 'Putting the walk together.';
  return `${readiness.arrived} of ${readiness.expected} walks are in. It opens when everyone’s is.`;
}

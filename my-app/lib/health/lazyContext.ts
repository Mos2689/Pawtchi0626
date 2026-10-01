/**
 * The pet context, kept out of the launch burst (perf Train 2, behind
 * perf-lazy-pet-context).
 *
 * ── What this changes ───────────────────────────────────────────────────────
 *
 * Every launch fired `get_pet_dashboard` — the heaviest read in the app, ~1 s
 * of server time — in the same three seconds as ~20 other requests, on a
 * backend whose requests were measured queueing 0.5–2 s (2026-10-01). Home
 * displays none of its numbers; only the bell and one prompt read them.
 *
 * With the flag on, the launch's first fetch and Home's focus refresh wait
 * CONTEXT_DEFER_MS, so the burst clears first. The screens that show these
 * numbers (Health) still refresh the moment they open, and a pet switch still
 * fetches at once — a delay there would show one pet's numbers under another.
 *
 * ── Why the last answer is painted meanwhile ───────────────────────────────
 *
 * Not only for looks. Meal scans, the schedule auto-adjust and the weight-plan
 * regenerate read today's totals and the weight trend straight from the store
 * when they run; before any fetch lands those are zeros, and Gemini would be
 * told nothing has been eaten today. Painting the last answer — same user,
 * same pet, same LOCAL DATE, never another day's — makes the wait better than
 * build 98's, which showed zeros for the whole fetch.
 *
 * It is a stand-in, never the answer: restoring it does not count as a fetch
 * (the deferred one still runs), and it is refused once any fetch or any
 * write has landed this session. Cleared on sign-out with the rest of the
 * previous account's state; a save in flight across that clear is dropped.
 *
 * A plain timer, not InteractionManager: a perpetual animation can hold an
 * interaction handle open indefinitely, and the context must always load.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

/** Long enough for the launch burst (p90 18 requests in 3 s) to clear. */
export const CONTEXT_DEFER_MS = 3_000;

/** Run a context fetch after the launch burst. Returns a cancel. */
export function deferContextFetch(run: () => void, delayMs: number = CONTEXT_DEFER_MS): () => void {
  const timer = setTimeout(run, delayMs);
  return () => clearTimeout(timer);
}

const KEY = 'pet-context:snapshot:v1';

export interface ContextSnapshot {
  userId: string;
  petId: string;
  /** The local YMD the numbers were fetched for. */
  date: string;
  savedAt: number;
  /** TodayData fields — the store picks the ones it knows on the way back in. */
  today: Record<string, unknown>;
  /** TrendData fields, likewise. */
  trends: Record<string, unknown>;
}

/** Bumped by `clearContextSnapshot`, so a read or write begun before it cannot land after. */
let generation = 0;
/** Writes run one at a time, so the disk always ends on the newest. */
let writes: Promise<void> = Promise.resolve();

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

function isSnapshot(value: unknown): value is ContextSnapshot {
  if (!isRecord(value)) return false;
  return typeof value.userId === 'string'
    && typeof value.petId === 'string'
    && typeof value.date === 'string'
    && typeof value.savedAt === 'number'
    && isRecord(value.today)
    && isRecord(value.trends);
}

/** The saved answer for exactly this user, pet and local date — or null. */
export async function readContextSnapshot(want: {
  userId: string;
  petId: string;
  date: string;
}): Promise<ContextSnapshot | null> {
  const startedIn = generation;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (startedIn !== generation || !raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isSnapshot(parsed)) return null;
    if (parsed.userId !== want.userId || parsed.petId !== want.petId || parsed.date !== want.date) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Keep this answer for the next launch. Serialised now, written in order. */
export function saveContextSnapshot(snapshot: Omit<ContextSnapshot, 'savedAt'>, now: number = Date.now()): void {
  const startedIn = generation;
  let value: string;
  try {
    value = JSON.stringify({ ...snapshot, savedAt: now });
  } catch {
    return;
  }
  writes = writes.then(async () => {
    if (startedIn !== generation) return;
    try {
      await AsyncStorage.setItem(KEY, value);
    } catch {
      // Best effort: the next launch simply fetches without a head start.
    }
  });
}

/** Sign-out: forget it, and refuse anything that was already on its way. */
export function clearContextSnapshot(): void {
  generation += 1;
  writes = writes.then(async () => {
    try {
      await AsyncStorage.removeItem(KEY);
    } catch {
      // Nothing to do; a stale slot is still refused by its user id.
    }
  });
}

/** Tests only: wait for queued writes. */
export function flushContextSnapshotWrites(): Promise<void> {
  return writes;
}

/**
 * Deadlines for the optional work between "stop recording" and "walk saved".
 *
 * `endWalk` stops GPS, then asked two network questions before the walk could
 * even be queued: place names for the start/end pills (reverse geocoding) and
 * "is this the owner's first valid walk?" (an analytics check). Neither had a
 * time limit and the Supabase client has no global fetch timeout, so on a bad
 * connection the Finish button — and the host-closed hand-off to the memory —
 * could wait indefinitely on something the walk does not need.
 *
 * Both already have an honest fallback: labels are null offline (the pills stay
 * hidden), and a first-walk check that cannot answer is treated as "no", which
 * the check itself already does on error ("fails closed"). The deadline only
 * makes a slow answer take the same path as a failed one.
 */

import { withTimeout } from '../withTimeout';
import type { WalkLabels } from './geoLabels';

/** Place names are a nicety; four seconds is long enough for a real answer. */
export const LABELS_DEADLINE_MS = 4_000;

/** One indexed count; three seconds or it is treated as unknown. */
export const FIRST_WALK_DEADLINE_MS = 3_000;

export const NO_LABELS: WalkLabels = {
  startLabel: null,
  endLabel: null,
  farthestLabel: null,
  isLoop: false,
};

/** `work`, or `fallback` if it fails or takes longer than `ms`. Never throws. */
export async function orFallback<T>(work: PromiseLike<T>, ms: number, fallback: T): Promise<T> {
  try {
    return await withTimeout(work, ms);
  } catch {
    return fallback;
  }
}

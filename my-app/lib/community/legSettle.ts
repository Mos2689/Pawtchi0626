/**
 * When this phone's leg of a Trail walk has reached the pack's memory.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * Finishing a Trail walk is two jobs in sequence: the recorder saves the walk
 * (`endWalk`), and only then does TrailRecording attach it to the outing
 * (`linkPersonalWalk` and friends). The memory screen reads the result of the
 * second job — and when the host closes the walk, a member is sent to that
 * screen at once, before either job has run. Loaded immediately, their own
 * route is simply missing from the walk they just did.
 *
 * So the memory waits on this: a promise per outing that TrailRecording opens
 * when the leg starts finishing and settles when the attach work is done —
 * succeeded or failed, because the memory should show what there is rather
 * than wait on a network that is not coming back. Callers always bound the
 * wait with a timeout as well.
 *
 * Module state, not a store: nothing renders from it, and it is meaningful only
 * for the life of the process — a cold start has no leg in flight to wait for.
 */

const settling = new Map<string, Promise<void>>();
const resolvers = new Map<string, () => void>();

/** A leg of `walkId` has started finishing on this phone. Idempotent. */
export function beginLegSettle(walkId: string): void {
  if (resolvers.has(walkId)) return;
  let resolve!: () => void;
  settling.set(walkId, new Promise<void>(done => { resolve = done; }));
  resolvers.set(walkId, resolve);
}

/** The leg's attach work is over, whatever its outcome. Safe to call unopened. */
export function settleLeg(walkId: string): void {
  const resolve = resolvers.get(walkId);
  resolvers.delete(walkId);
  if (resolve) resolve();
  else settling.set(walkId, Promise.resolve());
}

/**
 * Resolves once this phone's leg of `walkId` is attached — at once if none was
 * ever in flight, which is every memory opened from a list.
 */
export function legSettled(walkId: string): Promise<void> {
  return settling.get(walkId) ?? Promise.resolve();
}

/** Test seam. */
export function resetLegSettle(): void {
  for (const resolve of resolvers.values()) resolve();
  settling.clear();
  resolvers.clear();
}

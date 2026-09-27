/**
 * Following the host when they close a Trail walk.
 *
 * Ending the walk is the host's alone (see [[trail-host-authority]]). When they
 * do, every member still recording is finished with them and taken to the
 * memory. These are the two decisions behind that, kept pure so they can be
 * pinned by tests; TrailRecording does the wiring.
 */

/** The slice of a `community_walks` row the decision needs. */
export interface ClosableWalk {
  state?: string | null;
}

/**
 * Whether this phone should finish its recording because the walk closed.
 *
 * `isHost` is the TRAIL's host — `isTrailHost(pack, userId)`, the pack owner —
 * never the walk's `organizer_id`: ownership is the durable fact, and a walk a
 * member once organised is still closed by the owner (see
 * [[trail-host-authority]]).
 *
 * Never on the host's own phone: the host closed it from the live screen,
 * which already finishes their recording and routes them itself. Following
 * their own close as well would race that flow and greet them with "the host
 * finished the walk". An unknown host (`null`) is not followed either — the
 * next foreground check asks again — because guessing "member" is exactly
 * how the host would be sent that sentence.
 */
export function shouldFollowHostClose(
  walk: ClosableWalk | null | undefined,
  isHost: boolean | null,
): boolean {
  if (!walk || isHost !== false) return false;
  return walk.state === 'completed' || walk.state === 'cancelled';
}

/** Where a member lands when the host closes the walk. */
export function hostClosedMemoryHref(walkId: string): string {
  return `/community/walk/${walkId}/memory?finished=1&by=host`;
}

/**
 * Replace the live map rather than stack the memory on it — the walk it shows
 * is over. From anywhere else, push, so back returns to where they were.
 */
export function shouldReplaceForMemory(pathname: string | null | undefined, walkId: string): boolean {
  return pathname === `/community/walk/${walkId}/live`;
}

/**
 * walkStartIntent — a one-shot, in-memory "the user asked to start a walk" flag.
 *
 * Why this exists: a walk must begin ONLY from an explicit user gesture (tapping
 * a Walk / Track button), never from the `/walk` screen merely mounting. Without
 * this gate, any remount of `/walk` — route restoration on relaunch, a remount
 * after finishing, a navigation replay — silently started a NEW walk (the real
 * cause of the "tracking auto-starts on reopen / after finish" bug; the OS
 * record model itself was fine).
 *
 * The flag is deliberately module-level and NOT persisted/serialized: it is set
 * synchronously by the button handler immediately before navigating to `/walk`,
 * and consumed once by the screen on mount. An unarmed mount never starts.
 */

/**
 * Somewhere the owner said they were heading, set alongside the intent.
 *
 * Pawtchi does not navigate and this is not a route — it is a note. The walk
 * screen draws the place on the map and says how far off it still is, and that
 * is the whole of it: no turn-by-turn, no rerouting, no arrival that changes
 * how the walk is recorded. A walk to a park that ends in the other direction
 * is still a perfectly good walk, and nothing here is allowed to imply
 * otherwise.
 */
export interface WalkDestination {
  /** The spot's id, so the screen can be sure it is talking about one place. */
  id: string;
  /** Already resolved for display — the walk screen never re-derives a name. */
  name: string;
  lat: number;
  lng: number;
  /**
   * The device-centred Home coordinate at the moment "Walk here" was tapped.
   * It lets the suggested path start loading before the walk's first accepted
   * background GPS fix. Presentation only; walk tracking never reads it.
   */
  origin?: { lat: number; lng: number };
}

let armed = false;
let destination: WalkDestination | null = null;

/**
 * Call right before navigating to `/walk` to begin a walk.
 *
 * The optional destination rides along rather than living in a route param
 * because the arming flag already IS the handoff, and splitting the two would
 * let a destination survive a start that never happened.
 *
 * It defaults to null rather than being left alone on purpose: every plain
 * `armWalkStart()` in the app therefore CLEARS any destination left behind by a
 * "walk here" the owner backed out of. Arming is the only way a walk begins, so
 * that is the one place the clearing has to happen for it to be complete.
 */
export function armWalkStart(to: WalkDestination | null = null): void {
  armed = true;
  destination = to;
}

/**
 * Read the destination once and forget it.
 *
 * Consumed rather than merely read, so a later unarmed mount cannot inherit a
 * heading from a walk that has already been and gone. Deliberately not
 * persisted: if the screen is torn down mid-walk the chip is simply gone, which
 * costs a nicety and nothing else — persisting it would mean a stale
 * destination outliving the walk it belonged to.
 */
export function takeWalkDestination(): WalkDestination | null {
  const taken = destination;
  destination = null;
  return taken;
}

/** True while a user-initiated start is pending (does not consume). */
export function isWalkStartArmed(): boolean {
  return armed;
}

/** Clear the intent once it's been acted on. */
export function disarmWalkStart(): void {
  armed = false;
}

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

let armed = false;

/** Call right before navigating to `/walk` to begin a walk. */
export function armWalkStart(): void {
  armed = true;
}

/** True while a user-initiated start is pending (does not consume). */
export function isWalkStartArmed(): boolean {
  return armed;
}

/** Clear the intent once it's been acted on. */
export function disarmWalkStart(): void {
  armed = false;
}

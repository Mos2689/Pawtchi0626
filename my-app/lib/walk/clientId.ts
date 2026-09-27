/**
 * Client-generated row ids, for writes that have to be safe to repeat.
 *
 * ── Why the client names the row ───────────────────────────────────────────
 *
 * A server default (`gen_random_uuid()`) is fine right up until the same write
 * can happen twice, or has to be referenced before it lands. Both are true
 * here:
 *
 *   - A walk saves from a queue that retries. Two attempts must produce one
 *     row, which means the id has to come from the thing being retried.
 *   - A walk photo is published to its trail the moment the shutter fires, but
 *     its `walk_media` row cannot exist until the walk ends — `walk_media`
 *     requires a `walk_session_id`, and there is no session until then. The
 *     only way both rows can agree on an identity is for the identity to be
 *     decided first, on the device, at capture time.
 *
 * `generateWalkSessionId` has done exactly this for walk sessions since
 * 20260707000003. This module is that function, moved somewhere its name does
 * not imply it is only for sessions, plus the same thing for media.
 *
 * ── Not cryptographic, and that is deliberate ──────────────────────────────
 *
 * `Math.random()` is not a CSPRNG. It does not need to be: these ids are not
 * secrets, they grant nothing, and every table they are written to is guarded
 * by RLS that checks the caller rather than the id. What matters is collision
 * resistance across one device's own rows, and 122 random bits is far past
 * that. Reaching for expo-crypto here would add a native dependency to a pure
 * module that the whole walk pipeline imports.
 */

/** RFC-4122-shaped v4 id. */
export function newClientId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

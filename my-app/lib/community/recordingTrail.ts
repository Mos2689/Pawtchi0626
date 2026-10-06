/**
 * Which meetup the recorder is working for right now.
 *
 * TrailRecording keeps the trail one beat longer than the walk store does: the
 * store clears `marker` the moment a walk reaches its summary, and the finish
 * work (linking the walk, sweeping photos) still needs to know which meetup it
 * belonged to. So the trail is remembered through `saving` and `summary`.
 *
 * It must be forgotten the moment a NEW walk starts. A trail walk ends on the
 * memory, never on the solo summary, so the store sits in `summary` until the
 * next start — and the next start goes `summary` → `starting` without passing
 * `idle`. While `starting`, `marker` is still empty (the permission prompt
 * comes first), so the remembered trail used to stand in for the new walk:
 * the old meetup's close follower woke up, saw it had ended, and finished the
 * walk that was only just starting, sending the member to the OLD memory
 * (device report, 2026-10-06).
 */

import type { WalkPhase } from '../../store/useWalkStore';

export function recordingTrail<T>(markerTrail: T | null | undefined, phase: WalkPhase, remembered: T | null): T | null {
  if (markerTrail) return markerTrail;
  // At rest, or a new walk on its way: nothing from before applies.
  if (phase === 'idle' || phase === 'starting') return null;
  return remembered;
}

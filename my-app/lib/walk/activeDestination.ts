/**
 * The destination belongs to the active walk's presentation, not its tracker.
 *
 * This tiny in-memory handoff survives a navigation remount (Walk → Home →
 * Walk) but deliberately does not survive a process restart. It cannot start,
 * stop, resume, finish, or persist a walk; the walk id is only a stale-data
 * guard so one walk can never inherit another walk's destination.
 */

import type { WalkDestination } from './walkStartIntent';

type ActiveDestination = {
  walkId: string;
  destination: WalkDestination;
};

let active: ActiveDestination | null = null;

export function rememberActiveDestination(
  walkId: string,
  destination: WalkDestination,
): void {
  active = { walkId, destination };
}

export function readActiveDestination(walkId: string | null | undefined): WalkDestination | null {
  return walkId && active?.walkId === walkId ? active.destination : null;
}

export function clearActiveDestination(walkId?: string | null): void {
  if (!walkId || active?.walkId === walkId) active = null;
}

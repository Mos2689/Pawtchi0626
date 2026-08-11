import { WALK_TRACKING_ENABLED } from '../constants/features';
import { useActivePetStore } from '../store/useActivePetStore';

/**
 * THE single decision for whether the tracked-walk feature is visible right
 * now: the release flag AND a dog is the active pet. Walks are a dogs-only
 * feature — a cat profile must never see the Home walk card, the Activity-tab
 * dock / "Walk" label, the tracking indicator, the Paw Prints surfaces, or the
 * /walk route. Centralizing it here means every entry point makes the identical
 * call; the species gate can never drift between screens.
 *
 * Note this is intentionally separate from the store-level tracking teardown
 * (recoverOrphanedWalk / hardStopTracking / the reconciler), which stay purely
 * flag-driven: if a user switches from a dog mid-walk to a cat, tracking must
 * still be stopped, not merely hidden.
 */
export function useWalkEnabled(): boolean {
  const species = useActivePetStore(s => s.activePet?.species);
  return WALK_TRACKING_ENABLED && species === 'dog';
}

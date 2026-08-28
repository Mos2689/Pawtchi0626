import React, { useEffect } from 'react';

import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import { usePawPrintStore } from '../../store/usePawPrintStore';
import { useActivePetStore } from '../../store/useActivePetStore';
import { MilestoneCard } from './MilestoneCard';
import { PawPrintShareModal } from './PawPrintShareModal';
import { haptic } from '../../lib/haptics';
import { track } from '../../lib/analytics';

/**
 * Consumes the milestone celebration queue — mounted on Home so the moment
 * lands after the walk is fully wrapped, never mid-walk or over the summary
 * choreography. One heartbeat per card (Living Paw rules), the share sheet
 * IS the celebration, and closing it advances the queue; a long walk that
 * crossed two rungs celebrates them one at a time.
 */
export function MilestoneCelebration() {
  const pending = usePawPrintStore((s) => s.pendingMilestones);
  const firstWalkMonth = usePawPrintStore((s) => s.firstWalkMonth);
  const dismiss = usePawPrintStore((s) => s.dismissMilestone);
  const activePet = useActivePetStore((s) => s.activePet);
  const walkEnabled = useWalkEnabled(); // dogs-only feature

  const def = pending[0] ?? null;

  useEffect(() => {
    if (def) haptic.success();
  }, [def?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!walkEnabled || !def || !activePet) return null;

  return (
    <PawPrintShareModal
      visible
      source="milestone"
      onClose={() => {
        track('pawprint_milestone_celebrated', { milestone_id: def.id });
        dismiss();
      }}
    >
      <MilestoneCard
        def={def}
        petName={activePet.name?.trim() || 'My dog'}
        petGender={activePet.gender ?? null}
        firstWalkMonth={firstWalkMonth}
        width={300}
      />
    </PawPrintShareModal>
  );
}

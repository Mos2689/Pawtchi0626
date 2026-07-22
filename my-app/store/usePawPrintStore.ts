import { create } from 'zustand';

import type { MilestoneDef, WalkTotals } from '../lib/pawPrints';

/**
 * Paw Prints session state — the bridge between walk sync (which detects
 * newly crossed milestones in the background) and whichever surface is
 * frontmost to celebrate them (post-walk summary, or Home as catch-up).
 *
 * `pendingMilestones` is a queue: one long walk can cross several rungs and
 * each gets its own celebration beat, one at a time. Deliberately in-memory —
 * the DB rows in pet_milestones are the durable record; an award that misses
 * its celebration (app killed) still lives in the gallery forever.
 */
interface PawPrintState {
  pendingMilestones: MilestoneDef[];
  /** First-walk month name — grounds the milestone card's sub-line. */
  firstWalkMonth: string | null;
  /** Latest aggregate totals — the gallery goal-gradient reads these. */
  totals: WalkTotals | null;

  enqueueMilestones: (defs: MilestoneDef[]) => void;
  /** Pop the milestone just celebrated. */
  dismissMilestone: () => void;
  setTotals: (totals: WalkTotals) => void;
}

export const usePawPrintStore = create<PawPrintState>((set) => ({
  pendingMilestones: [],
  firstWalkMonth: null,
  totals: null,

  enqueueMilestones: (defs) =>
    set((s) => ({
      // Dedupe against anything already queued — award detection re-runs
      // freely (walk sync + gallery open) and must never double-celebrate.
      pendingMilestones: [
        ...s.pendingMilestones,
        ...defs.filter((d) => !s.pendingMilestones.some((p) => p.id === d.id)),
      ],
    })),
  dismissMilestone: () => set((s) => ({ pendingMilestones: s.pendingMilestones.slice(1) })),
  setTotals: (totals) => set({ totals, firstWalkMonth: totals.firstWalkMonth }),
}));

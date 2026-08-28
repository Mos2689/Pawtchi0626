import { create } from 'zustand';

import type { MilestoneDef, WalkTotals } from '../lib/pawPrints';
import type { MomentTemplateId } from '../lib/momentTemplates';

/**
 * Paw Prints session state — the bridge between walk sync (which detects
 * newly crossed milestones in the background) and whichever surface is
 * frontmost to celebrate them (post-walk summary, or Home as catch-up).
 *
 * `pendingMilestones` is a queue: one long walk can cross several rungs and
 * each gets its own celebration beat, one at a time. Deliberately in-memory —
 * the DB rows in pet_milestones are the durable record; an award that misses
 * its celebration (app killed) still lives in the gallery forever.
 *
 * `pendingTemplateUnlocks` is the sibling queue for the earned share-card
 * library: same dedupe rules, celebrated after milestones (Home mounts the
 * milestone consumer above the template consumer, and each shows only when
 * the other queue is idle via the store's ordering).
 */
export interface PendingTemplateUnlock {
  templateId: MomentTemplateId;
  /** The walk whose sync crossed the gate — the celebration renders it.
   *  Null on catch-up (walks synced while the app was dead). */
  walkSessionId: string | null;
}

interface PawPrintState {
  pendingMilestones: MilestoneDef[];
  pendingTemplateUnlocks: PendingTemplateUnlock[];
  /** First-walk month name — grounds the milestone card's sub-line. */
  firstWalkMonth: string | null;
  /** Latest aggregate totals — the gallery goal-gradient reads these. */
  totals: WalkTotals | null;

  enqueueMilestones: (defs: MilestoneDef[]) => void;
  /** Pop the milestone just celebrated. */
  dismissMilestone: () => void;
  enqueueTemplateUnlocks: (unlocks: PendingTemplateUnlock[]) => void;
  /** Pop the template unlock just celebrated. */
  dismissTemplateUnlock: () => void;
  setTotals: (totals: WalkTotals) => void;
  /**
   * Wipes everything for the signed-out user. Named to match clearPet /
   * clearStreak / clearContext, and called from the same one place they are
   * (`clearAllUserState` in providers/AuthProvider.tsx).
   *
   * Nothing here is derived: `pendingMilestones` and `pendingTemplateUnlocks`
   * are pushed in by walk sync and only leave when a celebration consumes them,
   * so without this the next account on the device was shown the previous
   * owner's milestone — "your 10th walk together" for a dog it had never met.
   * `totals` and `firstWalkMonth` are the same story on the gallery.
   */
  clearPawPrints: () => void;
}

export const usePawPrintStore = create<PawPrintState>((set) => ({
  pendingMilestones: [],
  pendingTemplateUnlocks: [],
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
  enqueueTemplateUnlocks: (unlocks) =>
    set((s) => ({
      pendingTemplateUnlocks: [
        ...s.pendingTemplateUnlocks,
        ...unlocks.filter(
          (u) => !s.pendingTemplateUnlocks.some((p) => p.templateId === u.templateId),
        ),
      ],
    })),
  dismissTemplateUnlock: () =>
    set((s) => ({ pendingTemplateUnlocks: s.pendingTemplateUnlocks.slice(1) })),
  setTotals: (totals) => set({ totals, firstWalkMonth: totals.firstWalkMonth }),
  clearPawPrints: () =>
    set({
      pendingMilestones: [],
      pendingTemplateUnlocks: [],
      firstWalkMonth: null,
      totals: null,
    }),
}));

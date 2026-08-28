/**
 * Paw Prints sync — the supabase side of the milestone/recap engine.
 *
 * Award detection is re-entrant by design: it runs after every valid walk
 * sync AND on gallery open (catch-up for walks synced while the app was
 * dead). The unique index on pet_milestones (pet_id, milestone_id) makes the
 * insert path idempotent, and the pre-read awarded set means only genuinely
 * new rungs reach the celebration queue.
 */

import { supabase } from './supabase';
import { track } from './analytics';
import {
  aggregateWalks,
  detectCrossedMilestones,
  MilestoneDef,
  PawPrintWalk,
  WalkTotals,
} from './pawPrints';
import {
  detectTemplateUnlocks,
  MomentTemplateDef,
  templateAwardId,
} from './momentTemplates';
import { resolveSniffStops } from './momentCard';
import { usePawPrintStore } from '../store/usePawPrintStore';

/** Row shape of the aggregate query — route deliberately NOT selected
 *  (a few hundred KB across an archive; totals never need it). */
interface WalkAggRow {
  id: string;
  started_at: string;
  distance_m: number;
  duration_s: number;
  pause_points: unknown[] | null;
  sniff_points: unknown[] | null;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
}

function mapRow(row: WalkAggRow): PawPrintWalk {
  return {
    id: row.id,
    startedAt: row.started_at,
    distanceM: Number(row.distance_m) || 0,
    durationS: row.duration_s ?? 0,
    // Episodes when the row has them; legacy rows fall back to pause count.
    sniffCount: resolveSniffStops(row.sniff_points, (row.pause_points ?? []) as { lat: number; lng: number }[]).length,
    startLabel: row.start_label,
    endLabel: row.end_label,
    farthestLabel: row.farthest_label,
  };
}

/** Every valid walk for the pet, lightweight columns only, oldest first. */
export async function fetchValidWalks(petId: string): Promise<PawPrintWalk[]> {
  const { data, error } = await supabase
    .from('walk_sessions')
    .select('id, started_at, distance_m, duration_s, pause_points, sniff_points, start_label, end_label, farthest_label')
    .eq('pet_id', petId)
    .eq('validation_verdict', 'valid')
    .order('started_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as WalkAggRow[]).map(mapRow);
}

export interface AwardCheckResult {
  totals: WalkTotals;
  /** Rungs crossed for the first time by this check. */
  newAwards: MilestoneDef[];
  /** Share-card templates whose gate this check crossed for the first time. */
  newTemplateUnlocks: MomentTemplateDef[];
}

/**
 * Aggregate the archive, persist any newly crossed milestones AND template
 * gates, and return them. Both ladders share the pet_milestones table with
 * disjoint id spaces (rung ids vs `template_*`), so one idempotent upsert
 * covers everything; a retry or race can never double-award.
 */
export async function checkAndAwardMilestones(
  petId: string,
  ownerId: string,
  walkSessionId?: string | null,
): Promise<AwardCheckResult> {
  const walks = await fetchValidWalks(petId);
  const totals = aggregateWalks(walks);

  const { data: awardedRows, error: awardedErr } = await supabase
    .from('pet_milestones')
    .select('milestone_id')
    .eq('pet_id', petId);
  if (awardedErr) throw awardedErr;

  const awarded = (awardedRows ?? []).map((r) => r.milestone_id as string);
  const crossed = detectCrossedMilestones(totals, awarded);
  const templates = detectTemplateUnlocks(totals.walkCount, awarded);
  if (crossed.length === 0 && templates.length === 0) {
    return { totals, newAwards: [], newTemplateUnlocks: [] };
  }

  const rows = [
    ...crossed.map((m) => m.id),
    ...templates.map((t) => templateAwardId(t.id)),
  ].map((milestoneId) => ({
    owner_id: ownerId,
    pet_id: petId,
    milestone_id: milestoneId,
    walk_session_id: walkSessionId ?? null,
  }));
  const { error: insertErr } = await supabase.from('pet_milestones').upsert(rows, {
    onConflict: 'pet_id,milestone_id',
    ignoreDuplicates: true,
  });
  if (insertErr) throw insertErr;

  for (const m of crossed) {
    track('pawprint_milestone_reached', {
      milestone_id: m.id,
      family: m.family,
      threshold: m.threshold,
    });
  }
  for (const t of templates) {
    track('template_unlocked', {
      template: t.id,
      unlock_at_walks: t.unlockAtWalks,
      walk_count: totals.walkCount,
    });
  }
  return { totals, newAwards: crossed, newTemplateUnlocks: templates };
}

/**
 * Fire-and-forget entry point for walk sync and surface catch-ups: detect,
 * persist, and queue celebrations + totals into the store. Never throws —
 * a failed check just runs again after the next walk.
 */
export async function evaluatePawPrints(
  petId: string,
  ownerId: string,
  walkSessionId?: string | null,
): Promise<void> {
  try {
    const { totals, newAwards, newTemplateUnlocks } = await checkAndAwardMilestones(
      petId,
      ownerId,
      walkSessionId,
    );
    const store = usePawPrintStore.getState();
    store.setTotals(totals);
    if (newAwards.length > 0) store.enqueueMilestones(newAwards);
    if (newTemplateUnlocks.length > 0) {
      // Catch-up dampener: with no fresh walk in hand (gallery open after
      // walks synced in the background), a long history could cross several
      // gates at once — celebrate only the highest; the library quietly
      // holds the rest. A live walk sync celebrates everything it crossed.
      const toCelebrate = walkSessionId
        ? newTemplateUnlocks
        : newTemplateUnlocks.slice(-1);
      store.enqueueTemplateUnlocks(
        toCelebrate.map((t) => ({
          templateId: t.id,
          walkSessionId: walkSessionId ?? null,
        })),
      );
    }
  } catch {
    // Next sync or gallery open retries; the DB idempotency makes that free.
  }
}

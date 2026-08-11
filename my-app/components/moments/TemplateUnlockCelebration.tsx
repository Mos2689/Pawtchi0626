/**
 * TemplateUnlockCelebration — consumes the template-unlock queue on Home,
 * beside (and after) MilestoneCelebration: while milestones are still
 * celebrating, this renders nothing, so a walk that crossed both a rung and
 * a gate celebrates them in order, one modal at a time.
 *
 * The celebration IS the reward in use: the qualifying walk rendered in the
 * newly earned template, share as the primary action. The gate number never
 * appears — the card is the news. Catch-up unlocks (walk synced while the
 * app was dead) render the pet's most recent valid walk instead.
 */

import React, { useEffect, useState } from 'react';

import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import { usePawPrintStore } from '../../store/usePawPrintStore';
import { useActivePetStore } from '../../store/useActivePetStore';
import { supabase } from '../../lib/supabase';
import { getTemplateDef, templateUnlockLine } from '../../lib/momentTemplates';
import { resolveSniffStops } from '../../lib/momentCard';
import { haptic } from '../../lib/haptics';
import { track } from '../../lib/analytics';
import { PawPrintShareModal } from '../pawprints/PawPrintShareModal';
import { TemplateRenderer } from './TemplateRenderer';
import type { GeoPoint } from '../../lib/walk/geo';

interface CelebrationWalk {
  id: string;
  started_at: string;
  duration_s: number;
  moving_time_s: number;
  distance_m: number;
  route: GeoPoint[] | null;
  pause_points: GeoPoint[] | null;
  sniff_points: unknown[] | null;
  start_label: string | null;
  end_label: string | null;
  farthest_label: string | null;
}

const WALK_COLUMNS =
  'id, started_at, duration_s, moving_time_s, distance_m, route, pause_points, sniff_points, start_label, end_label, farthest_label';

export function TemplateUnlockCelebration() {
  const pendingMilestones = usePawPrintStore((s) => s.pendingMilestones);
  const pending = usePawPrintStore((s) => s.pendingTemplateUnlocks);
  const dismiss = usePawPrintStore((s) => s.dismissTemplateUnlock);
  const activePet = useActivePetStore((s) => s.activePet);
  const walkEnabled = useWalkEnabled(); // dogs-only feature

  const unlock = pending[0] ?? null;
  const milestonesBusy = pendingMilestones.length > 0;
  const [walk, setWalk] = useState<CelebrationWalk | null>(null);

  // Fetch the walk to wear the new card: the qualifying session, or the
  // latest valid walk on catch-up. A miss dequeues silently — the template
  // is already in the library; the picker will show it on the next share.
  useEffect(() => {
    if (!unlock || !activePet?.id || milestonesBusy) return;
    let cancelled = false;
    (async () => {
      const base = supabase.from('walk_sessions').select(WALK_COLUMNS);
      const { data } = unlock.walkSessionId
        ? await base.eq('id', unlock.walkSessionId).maybeSingle()
        : await base
            .eq('pet_id', activePet.id)
            .eq('validation_verdict', 'valid')
            .order('started_at', { ascending: false })
            .limit(1)
            .maybeSingle();
      if (cancelled) return;
      if (data) setWalk(data as CelebrationWalk);
      else dismiss();
    })();
    return () => {
      cancelled = true;
    };
  }, [unlock?.templateId, unlock?.walkSessionId, activePet?.id, milestonesBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (unlock && walk && !milestonesBusy) haptic.success();
  }, [unlock?.templateId, walk?.id, milestonesBusy]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!walkEnabled || !unlock || !activePet || milestonesBusy || !walk) return null;

  const def = getTemplateDef(unlock.templateId);

  return (
    <PawPrintShareModal
      visible
      source="template_unlock"
      template={def.id}
      eyebrow="New card"
      subline={templateUnlockLine(def)}
      onClose={() => {
        track('template_unlock_celebrated', { template: def.id });
        setWalk(null);
        dismiss();
      }}
    >
      <TemplateRenderer
        templateId={def.id}
        petName={activePet.name?.trim() || 'My dog'}
        petGender={activePet.gender ?? null}
        startedAt={new Date(walk.started_at).getTime()}
        route={walk.route ?? []}
        sniffStops={resolveSniffStops(walk.sniff_points, walk.pause_points)}
        labels={{
          startLabel: walk.start_label,
          endLabel: walk.end_label,
          farthestLabel: walk.farthest_label,
          // Same inference the gallery uses: loops labelled their farthest point.
          isLoop: Boolean(walk.farthest_label),
        }}
        stats={{
          durationS: walk.duration_s,
          movingTimeS: walk.moving_time_s,
          distanceM: Number(walk.distance_m) || 0,
        }}
        sessionId={walk.id}
        // 9:16 stays modest so card + eyebrow + subline + actions fit the
        // smallest screens the app supports.
        width={def.aspect === '9:16' ? 240 : 290}
      />
    </PawPrintShareModal>
  );
}

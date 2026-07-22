/**
 * /walk — the tracked-walk experience, one route across three phases:
 *
 *   tracking → full-bleed live map (Apple Maps on iOS, MapLibre + OSM on
 *              Android) with a yellow polyline growing behind the user, a
 *              floating header, and a Strava-style navy card at the bottom
 *              with timer, distance, kcal so far, and the Finish button.
 *   saving   → beat of quiet while the buffer is replayed and synced.
 *   summary  → ONE heartbeat, confetti, measured stats, the completed route
 *              framed on the same map, and what happened to the plan.
 *
 * Leaving this screen mid-walk is safe: tracking lives in the foreground
 * service + store, not here. Re-entering just re-attaches the UI.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Redirect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialIcons } from '@expo/vector-icons';
import Reanimated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { color, font, motion, radius, shadow, space, type } from '../constants/design';
import { BreathingPaw } from '../components/BreathingPaw';
import { PawShower } from '../components/PawShower';
import { MomentShareModal } from '../components/MomentShareModal';
import WalkMap from '../components/walk/WalkMap';
import { useWalkStore } from '../store/useWalkStore';
import { useActivePetStore } from '../store/useActivePetStore';
import { useStreakStore } from '../store/useStreakStore';
import { useAuth } from '../providers/AuthProvider';
import { estimateActivityBurn } from '../lib/activityBurn';
import { deriveDogWalkProfile, intensityForPace } from '../lib/walk/dogCalibration';
import { WALK_TRACKING_ENABLED } from '../constants/features';

function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// Gate wrapper, not an in-body early return: the inner screen auto-starts a
// walk from a mount effect, so with walks disabled it must never mount. This
// also closes the pawtchi://walk deep link — the route redirects to Activity.
export default function WalkScreen() {
  if (!WALK_TRACKING_ENABLED) return <Redirect href="/(tabs)/activity" />;
  return <WalkScreenInner />;
}

function WalkScreenInner() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const activePet = useActivePetStore(s => s.activePet);

  const phase = useWalkStore(s => s.phase);
  const marker = useWalkStore(s => s.marker);
  const session = useWalkStore(s => s.session);
  const capReached = useWalkStore(s => s.capReached);
  const lastResult = useWalkStore(s => s.lastResult);
  const startWalk = useWalkStore(s => s.startWalk);
  const endWalk = useWalkStore(s => s.endWalk);
  const tick = useWalkStore(s => s.tick);
  const dismissSummary = useWalkStore(s => s.dismissSummary);

  const [now, setNow] = useState(Date.now());
  const [denied, setDenied] = useState<string | null>(null);
  const [milestoneKm, setMilestoneKm] = useState(0);
  const startedRef = useRef(false);
  const celebratedKmRef = useRef(0);

  // Arriving with no walk in flight and no summary to show → start one.
  useEffect(() => {
    if (startedRef.current) return;
    if (phase === 'idle' && !lastResult && activePet && user?.id) {
      startedRef.current = true;
      startWalk(activePet, user.id).then(result => {
        if (result === 'denied') {
          setDenied('Location access is off, so this walk can’t be measured.');
        } else if (result === 'services_off') {
          setDenied('Location services are turned off on this phone.');
        }
      });
    }
  }, [phase, lastResult, activePet, user?.id, startWalk]);

  // 1s clock for the timer; the store's auto-stop poll rides every 5th beat.
  useEffect(() => {
    if (phase !== 'tracking') return;
    let beats = 0;
    const id = setInterval(() => {
      setNow(Date.now());
      beats += 1;
      if (beats % 5 === 0) tick();
    }, 1000);
    return () => clearInterval(id);
  }, [phase, tick]);

  // Kilometre milestones — a light haptic and a chip, never an interruption.
  const kmDone = Math.floor((session?.distanceM ?? 0) / 1000);
  useEffect(() => {
    if (phase !== 'tracking') return;
    if (kmDone > 0 && kmDone > celebratedKmRef.current) {
      celebratedKmRef.current = kmDone;
      setMilestoneKm(kmDone);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    }
  }, [kmDone, phase]);

  // Summary arrival: haptic success — the single completion heartbeat.
  useEffect(() => {
    if (phase === 'summary' && lastResult) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [phase, lastResult]);

  const petName = marker?.petName ?? lastResult?.petName ?? activePet?.name ?? 'your dog';

  // ── Permission fallback — the manual flow is always there ──
  if (denied) {
    return (
      <View style={[styles.deniedScreen, { paddingTop: insets.top + space.xl }]}>
        <Text style={styles.eyebrow}>TRACKED WALK</Text>
        <View style={styles.centerFill}>
          <MaterialIcons name="location-off" size={40} color={color.slateFaint} />
          <Text style={styles.deniedTitle}>{denied}</Text>
          <Text style={styles.deniedBody}>
            You can allow location in Settings, or mark the walk done from the
            Activity tab like before.
          </Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.back()}>
            <Text style={styles.primaryBtnText}>Back</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ── Summary ──
  if (phase === 'summary' && lastResult) {
    return (
      <WalkSummaryView
        petName={petName}
        onDone={() => {
          dismissSummary();
          router.back();
        }}
      />
    );
  }

  // ── Saving beat ──
  if (phase === 'saving') {
    return (
      <View style={[styles.deniedScreen, styles.centerFill]}>
        <BreathingPaw size={34} workingColor={color.navy} />
        <Text style={styles.savingText}>Saving {petName}&rsquo;s walk</Text>
      </View>
    );
  }

  // ── Live tracking (also covers 'starting' / GPS acquisition) ──
  const acquiring = phase === 'starting' || !session || session.acceptedCount === 0;
  const paused = session?.status === 'auto_paused';
  const elapsed = marker ? now - marker.startedAt : 0;
  const km = (session?.distanceM ?? 0) / 1000;

  // Live kcal — same dog-calibrated math the summary and Home card use, so
  // the number never jumps when the walk ends. Based on MOVING time: standing
  // still, sniff breaks, and speed-gated car segments must not tick the
  // burn — the number only grows while the dog is actually covering ground.
  const movingMin = Math.round((session?.movingTimeMs ?? 0) / 60_000);
  const movingH = (session?.movingTimeMs ?? 0) / 3_600_000;
  const avgSpeed = movingH > 0 ? km / movingH : 0;
  const liveKcal =
    marker && activePet?.current_weight_kg
      ? Math.round(
          estimateActivityBurn(
            'walk',
            intensityForPace(avgSpeed, marker.profile),
            movingMin,
            activePet.current_weight_kg,
          ),
        )
      : 0;

  const currentPosition = session?.lastAccepted
    ? { lat: session.lastAccepted.lat, lng: session.lastAccepted.lng }
    : null;

  return (
    <View style={styles.liveRoot}>
      {/* Full-bleed basemap */}
      <WalkMap
        mode="live"
        path={session?.path ?? []}
        currentPosition={currentPosition}
        paused={!!paused}
        style={StyleSheet.absoluteFillObject as any}
      />

      {/* Floating top header */}
      <View style={[styles.headerOverlay, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <View style={styles.headerChip}>
          <Text style={styles.eyebrow}>TRACKED WALK</Text>
          <Text style={styles.petName} numberOfLines={1}>{petName}</Text>
        </View>
      </View>

      {/* Sniff-break strip — glanceable pause state */}
      {paused && (
        <View style={[styles.pausedStrip, { top: insets.top + space.sm + 64 }]}>
          <Text style={styles.pausedStripText}>Sniff break — timer keeps going</Text>
        </View>
      )}

      {/* Milestone chip */}
      {milestoneKm > 0 && (
        <Reanimated.View
          entering={FadeInDown.duration(motion.duration.base)}
          style={[styles.milestoneChip, { top: insets.top + space.sm + 64 + (paused ? 38 : 0) }]}
        >
          <Text style={styles.milestoneChipText}>
            {milestoneKm} km with {petName}
          </Text>
        </Reanimated.View>
      )}

      {/* Cap notice (uncommon) */}
      {capReached && (
        <View style={[styles.capChip, { top: insets.top + space.sm + 64 + (paused ? 38 : 0) + (milestoneKm > 0 ? 38 : 0) }]}>
          <Text style={styles.capChipText}>
            Gentle daily limit reached — heading home is a good idea.
          </Text>
        </View>
      )}

      {/* Bottom stats + Finish card */}
      <View style={[styles.bottomCard, { paddingBottom: insets.bottom + space.lg }]}>
        <View style={styles.statusLine}>
          <BreathingPaw size={14} workingColor={color.navy} />
          <Text style={styles.statusLineText}>
            {acquiring
              ? 'Finding GPS — hold on a moment'
              : paused
                ? 'Paused with the sniffs — resumes on the next step'
                : 'Tracking — ends on its own at home'}
          </Text>
        </View>

        <Text style={styles.timer}>{formatElapsed(elapsed)}</Text>
        <Text style={styles.timerLabel}>TIME</Text>

        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{km.toFixed(2)}</Text>
            <Text style={styles.statLabel}>DISTANCE (KM)</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>{liveKcal > 0 ? liveKcal : '—'}</Text>
            <Text style={styles.statLabel}>KCAL SO FAR</Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.finishBtn}
          onPress={() => endWalk('manual')}
          activeOpacity={0.9}
        >
          <MaterialIcons name="flag" size={18} color={color.navy} />
          <Text style={styles.finishBtnText}>Finish walk</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.minimizeBtn} onPress={() => router.back()}>
          <Text style={styles.minimizeBtnText}>Keep tracking in the background</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function WalkSummaryView({ petName, onDone }: { petName: string; onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const lastResult = useWalkStore(s => s.lastResult);
  const activePet = useActivePetStore(s => s.activePet);
  const lastEarnEvent = useStreakStore(s => s.lastEarnEvent);

  const result = lastResult!;
  const { summary, verdict, sync, route, labels } = result;

  // ── Paw Moment share card ──
  // Only a clean, measured walk becomes a card: the verdict gate keeps
  // drives, stubs, and GPS junk off Instagram wearing the Pawtchi mark. The
  // editor itself lives in MomentShareModal (shared with the Home feed).
  const canShare = verdict.verdict === 'valid' && route.length >= 2;
  const [shareOpen, setShareOpen] = useState(false);

  // Elapsed minutes for display (matches the timeline row), moving minutes
  // for kcal — a stationary session shows its duration but burns ~nothing.
  const minutes = Math.max(1, Math.round(summary.durationS / 60));
  const activeMinutes = Math.round(summary.movingTimeS / 60);
  const km = summary.distanceM / 1000;

  const isLoop = labels.isLoop;
  const startLabel = labels.startLabel;
  const trailingLabel = isLoop ? labels.farthestLabel : labels.endLabel;
  const showLabels = Boolean(startLabel || trailingLabel);

  const kcal = useMemo(() => {
    if (!activePet?.current_weight_kg) return 0;
    const profile = deriveDogWalkProfile({
      species: activePet.species,
      breed: activePet.breed ?? null,
      ageYears: activePet.age_years ?? null,
      weightKg: activePet.current_weight_kg,
      medicalConditions: activePet.medical_conditions ?? null,
    });
    const intensity = intensityForPace(summary.avgMovingSpeedKmh, profile);
    return Math.round(
      estimateActivityBurn('walk', intensity, activeMinutes, activePet.current_weight_kg),
    );
  }, [activePet, summary.avgMovingSpeedKmh, activeMinutes]);

  // Only a drive is discarded — every real walk is logged, however short.
  const isWalkLogged = verdict.verdict !== 'likely_vehicle';
  const outcomeCopy = (() => {
    if (!isWalkLogged) {
      return 'Most of this moved faster than a walk, so it wasn’t counted.';
    }
    if (verdict.verdict === 'too_short') {
      return `A short one — still logged on ${petName}’s day.`;
    }
    if (verdict.verdict === 'gps_junk') {
      return `The GPS was patchy, but the walk counts — logged for ${petName}.`;
    }
    switch (sync.outcome) {
      case 'matched':
        return `${petName}’s scheduled walk is done — logged for you.`;
      case 'logged_new':
        return `Logged as a new walk on ${petName}’s day.`;
      case 'skipped_duplicate':
        return 'This walk was already marked done.';
      default:
        return 'Saved — it will finish syncing when you’re back online.';
    }
  })();

  return (
    <View style={[styles.summaryScreen, { paddingTop: insets.top + space.xl }]}>
      <PawShower active={isWalkLogged} />

      <View style={styles.summaryHeader}>
        <BreathingPaw settled size={28} />
        <Text style={styles.summaryTitle}>
          {isWalkLogged ? `Good walk, ${petName}` : 'Walk saved'}
        </Text>
        <Text style={styles.summaryOutcome}>{outcomeCopy}</Text>
      </View>

      <View style={styles.routeCard}>
        {route.length >= 2 ? (
          <>
            <WalkMap mode="summary" path={route} style={styles.routeMap as any} />
            {showLabels && startLabel && (
              <View style={[styles.summaryPill, styles.summaryPillStart]} pointerEvents="none">
                <MaterialIcons
                  name={isLoop ? 'home' : 'place'}
                  size={11}
                  color={color.navy}
                />
                <Text style={styles.summaryPillText} numberOfLines={1}>{startLabel}</Text>
              </View>
            )}
            {showLabels && trailingLabel && (
              <View style={[styles.summaryPill, styles.summaryPillEnd]} pointerEvents="none">
                <MaterialIcons
                  name={isLoop ? 'landscape' : 'flag'}
                  size={11}
                  color={color.navy}
                />
                <Text style={styles.summaryPillText} numberOfLines={1}>{trailingLabel}</Text>
              </View>
            )}
          </>
        ) : (
          <View style={styles.routeEmpty}>
            <MaterialIcons name="satellite-alt" size={26} color={color.slateFaint} />
            <Text style={styles.routeEmptyText}>
              GPS was patchy — the route didn&rsquo;t draw itself this time.
            </Text>
          </View>
        )}
      </View>

      <View style={styles.summaryStats}>
        <View style={styles.stat}>
          <Text style={styles.statValue}>{minutes}</Text>
          <Text style={styles.statLabel}>MINUTES</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.stat}>
          <Text style={styles.statValue}>{km.toFixed(2)}</Text>
          <Text style={styles.statLabel}>KM</Text>
        </View>
        {kcal > 0 && (
          <>
            <View style={styles.statDivider} />
            <View style={styles.stat}>
              <Text style={styles.statValue}>{kcal}</Text>
              <Text style={styles.statLabel}>KCAL BURNED</Text>
            </View>
          </>
        )}
      </View>

      {isWalkLogged && lastEarnEvent && lastEarnEvent.coins > 0 && (
        <View style={styles.coinRow}>
          <MaterialIcons name="paid" size={16} color={color.alert} />
          <Text style={styles.coinRowText}>+{lastEarnEvent.coins} PawCoins</Text>
        </View>
      )}

      <View style={[styles.summaryFooter, { paddingBottom: insets.bottom + space.xl }]}>
        {canShare ? (
          <>
            <TouchableOpacity style={styles.finishBtnLight} onPress={() => setShareOpen(true)} activeOpacity={0.9}>
              <MaterialIcons name="ios-share" size={18} color={color.navy} />
              <Text style={styles.finishBtnLightText}>Share this walk</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quietBtn} onPress={onDone}>
              <Text style={styles.quietBtnText}>Done</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity style={styles.finishBtnLight} onPress={onDone} activeOpacity={0.9}>
            <Text style={styles.finishBtnLightText}>Done</Text>
          </TouchableOpacity>
        )}
      </View>

      <MomentShareModal
        visible={shareOpen}
        onClose={() => setShareOpen(false)}
        source="walk_summary"
        petName={petName}
        petGender={activePet?.gender ?? null}
        startedAt={summary.startedAt}
        route={route}
        pausePoints={summary.pausePoints ?? []}
        labels={labels}
        stats={{
          durationS: summary.durationS,
          movingTimeS: summary.movingTimeS,
          distanceM: summary.distanceM,
        }}
        sessionId={String(summary.startedAt)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // ── Live full-bleed layout ──
  liveRoot: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
  },
  headerOverlay: {
    position: 'absolute',
    left: space.xl,
    right: space.xl,
  },
  headerChip: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    gap: 2,
    ...shadow.card,
  },
  eyebrow: {
    ...type.caption,
    color: color.slateFaint,
  },
  petName: {
    ...type.heading,
    color: color.navy,
  },
  pausedStrip: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: color.yellow,
    paddingHorizontal: space.lg,
    paddingVertical: 8,
    borderRadius: radius.pill,
    ...shadow.card,
  },
  pausedStripText: {
    ...type.label,
    color: color.navy,
  },
  milestoneChip: {
    position: 'absolute',
    alignSelf: 'center',
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 6,
    paddingHorizontal: 14,
    ...shadow.card,
  },
  milestoneChipText: {
    fontFamily: font.bold,
    fontSize: 11.5,
    color: color.navy,
    letterSpacing: 0.4,
  },
  capChip: {
    position: 'absolute',
    alignSelf: 'center',
    left: space.xl,
    right: space.xl,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: space.md,
    ...shadow.card,
  },
  capChipText: {
    ...type.label,
    color: color.navy,
    textAlign: 'center',
  },

  // ── Bottom card ──
  bottomCard: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: color.surface,
    borderTopLeftRadius: radius.xxl,
    borderTopRightRadius: radius.xxl,
    paddingHorizontal: space.xxl,
    paddingTop: space.xl,
    borderTopWidth: 0.5,
    borderColor: color.hairline,
    ...shadow.raised,
  },
  statusLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginBottom: space.md,
  },
  statusLineText: {
    ...type.label,
    color: color.slateMuted,
  },
  timer: {
    fontFamily: font.display,
    fontSize: 68,
    lineHeight: 72,
    color: color.navy,
    letterSpacing: 2,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  timerLabel: {
    ...type.caption,
    color: color.slateFaint,
    textAlign: 'center',
    marginTop: 2,
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: space.lg,
    gap: space.xxl,
  },
  stat: {
    alignItems: 'center',
    gap: space.xs,
    minWidth: 96,
  },
  statDivider: {
    width: 1,
    height: 34,
    backgroundColor: color.hairline,
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 30,
    lineHeight: 32,
    color: color.navy,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    ...type.caption,
    color: color.slateFaint,
  },
  finishBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 16,
    marginTop: space.xl,
    ...shadow.card,
  },
  finishBtnText: {
    ...type.heading,
    color: color.navy,
  },
  minimizeBtn: {
    alignItems: 'center',
    paddingVertical: space.md,
  },
  minimizeBtnText: {
    ...type.label,
    color: color.slateMuted,
  },

  // ── Permission-denied / saving ──
  deniedScreen: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
    paddingHorizontal: space.xxl,
  },
  centerFill: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  savingText: {
    ...type.bodyMedium,
    color: color.slateMuted,
    marginTop: space.lg,
  },
  deniedTitle: {
    ...type.title,
    color: color.navy,
    textAlign: 'center',
    marginTop: space.xl,
  },
  deniedBody: {
    ...type.body,
    color: color.slateMuted,
    textAlign: 'center',
    marginTop: space.md,
    marginBottom: space.xxl,
  },
  primaryBtn: {
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 14,
    paddingHorizontal: space.xxxl,
  },
  primaryBtnText: {
    ...type.heading,
    color: color.navy,
  },

  // ── Summary ──
  summaryScreen: {
    flex: 1,
    backgroundColor: color.surfaceSubtle,
    paddingHorizontal: space.xxl,
  },
  summaryHeader: {
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.xxl,
  },
  summaryTitle: {
    ...type.display,
    color: color.navy,
    textAlign: 'center',
  },
  summaryOutcome: {
    ...type.body,
    color: color.slateMuted,
    textAlign: 'center',
  },
  routeCard: {
    backgroundColor: color.surface,
    borderRadius: radius.xl,
    borderWidth: 0.5,
    borderColor: color.hairline,
    overflow: 'hidden',
    marginBottom: space.xxl,
    ...shadow.card,
  },
  routeMap: {
    width: '100%',
    height: 210,
  },
  routeEmpty: {
    height: 210,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingHorizontal: space.xl,
  },
  routeEmptyText: {
    ...type.label,
    color: color.slateMuted,
    textAlign: 'center',
  },
  summaryPill: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: color.surface,
    borderWidth: 0.5,
    borderColor: color.navy,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 3,
    maxWidth: '60%',
    ...shadow.card,
  },
  summaryPillStart: {
    bottom: 10,
    left: 10,
  },
  summaryPillEnd: {
    top: 10,
    right: 10,
    borderColor: color.yellow,
    backgroundColor: '#FFFDE0',
  },
  summaryPillText: {
    ...type.label,
    color: color.navy,
    fontSize: 11,
  },
  summaryStats: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.xl,
  },
  coinRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    marginTop: space.xxl,
  },
  coinRowText: {
    ...type.label,
    color: color.navy,
  },
  summaryFooter: {
    marginTop: 'auto',
  },
  finishBtnLight: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    backgroundColor: color.yellow,
    borderRadius: radius.pill,
    paddingVertical: 16,
    ...shadow.card,
  },
  finishBtnLightText: {
    ...type.heading,
    color: color.navy,
  },
  quietBtn: {
    alignItems: 'center',
    paddingVertical: space.md,
  },
  quietBtnText: {
    ...type.label,
    color: color.slateMuted,
  },
});

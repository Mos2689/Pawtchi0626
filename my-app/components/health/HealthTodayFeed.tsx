import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import Svg from 'react-native-svg';
import Reanimated from 'react-native-reanimated';

import { color, font, radius, space, makeShadow } from '../../constants/design';
import { RingArc, ProgressBar, RING_SIZE, RING_CONFIG, PHOTO_RADIUS } from '../HealthRings';
import { entrance } from '../motionPresets';
import { MilestoneJourneyCard } from '../MilestoneJourneyCard';
import { SecondOpinionCard } from '../SecondOpinionCard';
import { WalksignCrest } from '../walksign/WalksignCrest';

import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { computeWaterTargetMl } from '../../lib/hydration';
import { getMonthlyUsage, type MonthlyUsage } from '../../lib/askVet';
import { haptic } from '../../lib/haptics';
import type { WalksignId } from '../../lib/walksign/types';

/**
 * The daily health experience — rings hero, weight journey, TODAY stats,
 * macros/treats, Second Opinion and Meals.
 *
 * This block lived on Home until the walk-first pivot; it now opens the Health
 * tab above the weight canopy.
 *
 * What it deliberately no longer carries: the profile-completion card, the
 * pending vet check-in, the broken-streak prompt and the Up next row. Every one
 * of those was a message rather than a measurement, and they all now derive
 * into the notification center (lib/notificationCenter/bannerRules.ts). What is
 * left is only the state of the day — nothing here asks for anything.
 */
export function HealthTodayFeed({ onLogWeight }: { onLogWeight?: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Fine-grained selectors: re-render only when the specific value changes, not on
  // any unrelated store mutation (pantry, isLoading, etc.).
  const activePet = useActivePetStore(s => s.activePet);
  const currentStreak = useStreakStore(s => s.currentStreak);
  const fetchStreak = useStreakStore(s => s.fetchStreak);
  const { user } = useAuth();

  // Store data
  const todayCalories = usePetContextStore(s => s.todayCalories);
  const todayWater = usePetContextStore(s => s.todayWater);
  const todayScans = usePetContextStore(s => s.todayScans);
  const calPercent = usePetContextStore(s => s.calPercent);
  const waterPercent = usePetContextStore(s => s.waterPercent);
  const baseTargetCal = activePet?.target_daily_calories || 0;
  const adjustedTarget = usePetContextStore(s => s.adjustedTarget);
  const targetCal = adjustedTarget || baseTargetCal;
  const activityCompletionRate = usePetContextStore(s => s.activityCompletionRate);
  const todayActivityMinutes = usePetContextStore(s => s.todayActivityMinutes);
  const todayActivityTargetMinutes = usePetContextStore(s => s.todayActivityTargetMinutes);
  const todayProtein = usePetContextStore(s => s.todayProtein);
  const todayCarbs = usePetContextStore(s => s.todayCarbs);
  const todayFats = usePetContextStore(s => s.todayFats);
  const treatBudget = usePetContextStore(s => s.treatBudget);
  const treatCaloriesConsumed = usePetContextStore(s => s.treatCaloriesConsumed);
  const caloriesRemaining = usePetContextStore(s => s.caloriesRemaining);
  const refreshToday = usePetContextStore(s => s.refreshToday);

  useFocusEffect(useCallback(() => {
    if (activePet?.id) refreshToday(activePet.id);
  }, [activePet?.id, refreshToday]));

  useFocusEffect(useCallback(() => {
    if (user?.id) fetchStreak(user.id);
  }, [user?.id, fetchStreak]));

  // Ask Pawtchi monthly allowance — shown quietly on the entry card.
  const [askUsage, setAskUsage] = React.useState<MonthlyUsage | null>(null);
  useFocusEffect(useCallback(() => {
    if (user?.id) getMonthlyUsage(user.id).then(setAskUsage).catch(() => {});
  }, [user?.id]));

  // The pending Second Opinion check-in is fetched by the notification center
  // now (store/useNotificationCenterStore.ts), which is the only thing that
  // renders it.

  // Computed values
  const calorieProgress = Math.min(calPercent / 100, 1);
  // Moving goal = today's scheduled minutes, so completing the plan always
  // closes the ring. 45 min is the generic-adult fallback when no plan exists
  // (and completion-rate keeps the ring meaningful for plans of untimed tasks).
  const movingTargetMin = todayActivityTargetMinutes > 0 ? todayActivityTargetMinutes : 45;
  const activityProgress = todayActivityTargetMinutes > 0
    ? Math.min(todayActivityMinutes / todayActivityTargetMinutes, 1)
    : Math.min(activityCompletionRate, 1);
  const waterProgress = Math.min(waterPercent, 1);

  // A single restrained success haptic the first time all three rings close in
  // a session — the rings already pulse visually; this is the felt "day done".
  const allRingsDone = calorieProgress >= 1 && activityProgress >= 1 && waterProgress >= 1;
  const celebratedDay = React.useRef(false);
  React.useEffect(() => {
    if (allRingsDone && !celebratedDay.current) {
      celebratedDay.current = true;
      haptic.success();
    } else if (!allRingsDone) {
      celebratedDay.current = false;
    }
  }, [allRingsDone]);

  // Format water display
  const waterDisplay = todayWater >= 1000
    ? `${(todayWater / 1000).toFixed(1)}L`
    : `${todayWater}ml`;
  const waterTarget = computeWaterTargetMl(activePet?.current_weight_kg, activePet?.diet_type);
  const waterTargetDisplay = waterTarget >= 1000
    ? `${(waterTarget / 1000).toFixed(1)}L`
    : `${waterTarget}ml`;

  return (
    <View style={[styles.feed, { paddingTop: insets.top + space.md }]}>
      {/* The profile-completion card and the pending check-in card used to open
          this feed. Both are now derived into the notification center by
          lib/notificationCenter/bannerRules.ts, so Health opens on the rings —
          the thing the tab is actually for — rather than on two asks. */}

      {/* Ring Hero - Centered, walksign emblem in the centre */}
      <Reanimated.View entering={entrance(1)} style={styles.ringsWrapper}>
        <View style={styles.ringsContainer}>
          <Svg width={RING_SIZE} height={RING_SIZE}>
            <RingArc r={RING_CONFIG[0].r} color={RING_CONFIG[0].color} strokeWidth={RING_CONFIG[0].stroke} progress={calorieProgress} />
            <RingArc r={RING_CONFIG[1].r} color={RING_CONFIG[1].color} strokeWidth={RING_CONFIG[1].stroke} progress={activityProgress} />
            <RingArc r={RING_CONFIG[2].r} color={RING_CONFIG[2].color} strokeWidth={RING_CONFIG[2].stroke} progress={waterProgress} />
          </Svg>

          <View style={styles.petPhotoContainer}>
            {activePet?.species === 'dog' && activePet?.walksign ? (
              <View style={styles.emblemCircle}>
                <WalksignCrest sign={activePet.walksign as WalksignId} size={80} />
              </View>
            ) : (
              <View style={styles.emblemCircle}>
                <MaterialIcons name="pets" size={48} color={color.slateFaint} />
              </View>
            )}
            {currentStreak > 0 && (
              <View style={styles.streakBadge}>
                <MaterialIcons
                  name="local-fire-department"
                  size={12}
                  color={currentStreak >= 7 ? '#ef4444' : currentStreak >= 3 ? '#f97316' : '#9ca3af'}
                />
                <Text style={[styles.streakBadgeText, { color: currentStreak >= 7 ? '#dc2626' : currentStreak >= 3 ? '#ea580c' : '#6b7280' }]}>
                  {currentStreak}d
                </Text>
              </View>
            )}
          </View>
        </View>
      </Reanimated.View>

      {/* ─── Weight journey — the milestone map ───
          Log weight now lives here, as the cutout badge in the card's own
          top-right corner, rather than as a separate button further down the
          feed — the number it logs is what this whole card is built from. */}
      <MilestoneJourneyCard onLogWeight={onLogWeight} />

      {/* Second Opinion — navy hero, above the daily stats */}
      <View style={styles.topActionsRow}>
        <SecondOpinionCard
          remaining={askUsage?.remaining ?? null}
          resetsAt={askUsage?.resetsAt}
          onPress={() => router.push('/ask' as any)}
        />
      </View>

      {/* ─── Today — typography on the ground, hairline-divided ─── */}
      <Reanimated.View entering={entrance(3)}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>TODAY</Text>
          <View style={styles.sectionRule} />
        </View>
        <View style={styles.statRow}>
          <View style={styles.stat}>
            <Text style={styles.statValue}>{todayCalories > 0 ? todayCalories : '0'}</Text>
            <Text style={styles.statTarget}>of {targetCal || 0} kcal</Text>
            <ProgressBar progress={calorieProgress} color={color.viz.calories} />
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue}>
              {todayActivityMinutes > 0 ? todayActivityMinutes : '0'}
              <Text style={styles.statUnit}> min</Text>
            </Text>
            <Text style={styles.statTarget}>of {movingTargetMin} min moving</Text>
            <ProgressBar progress={activityProgress} color={color.viz.move} />
          </View>
          <View style={styles.statDivider} />
          <View style={styles.stat}>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {todayWater > 0 ? waterDisplay : '0'}
            </Text>
            <Text style={styles.statTarget} numberOfLines={1}>of {waterTargetDisplay} water</Text>
            <ProgressBar progress={waterProgress} color={color.viz.hydrate} />
          </View>
        </View>

        {/* One quiet ledger line for macros — treats ride on the right as
            another stat in the same pattern. */}
        <View style={styles.macroLine}>
          <View style={[styles.macroDot, { backgroundColor: '#ec4899' }]} />
          <Text style={styles.macroText}>{todayProtein}g protein</Text>
          <View style={[styles.macroDot, { backgroundColor: color.viz.calories }]} />
          <Text style={styles.macroText}>{todayCarbs}g carbs</Text>
          <View style={[styles.macroDot, { backgroundColor: color.viz.hydrate }]} />
          <Text style={styles.macroText}>{todayFats}g fats</Text>
          {targetCal > 0 && (() => {
            const treatLeft = Math.max(0, treatBudget - treatCaloriesConsumed);
            const over = caloriesRemaining < 0;
            const warn = over || treatLeft === 0;
            return (
              <>
                <View style={styles.macroSpacer} />
                <View style={[styles.macroDot, { backgroundColor: warn ? color.error : color.navy }]} />
                <Text
                  style={[styles.macroText, styles.macroTreat, warn && styles.macroTreatWarning]}
                  numberOfLines={1}
                >
                  {over ? `${Math.abs(caloriesRemaining)} kcal over` : `${treatLeft} kcal left · treats`}
                </Text>
              </>
            );
          })()}
        </View>
      </Reanimated.View>

      {/* The broken-streak nudge lived here. It is now a notification-center
          item, built from the same currentStreak/longestStreak pair. */}

      {/* ─── Meals — editorial list, no boxes ─── */}
      <Reanimated.View entering={entrance(5)}>
        <View style={styles.sectionHead}>
          <Text style={styles.sectionLabel}>MEALS</Text>
          <View style={styles.sectionRule} />
          <Text style={styles.sectionMeta}>{todayScans.length} logged</Text>
        </View>

        {todayScans.length === 0 ? (
          <View style={styles.emptyMeals}>
            <MaterialIcons name="restaurant" size={26} color={'#d1d5db'} />
            <Text style={styles.emptyMealsText}>Nothing logged yet today</Text>
          </View>
        ) : (
          todayScans.slice(0, 3).map((scan, i, arr) => {
            const time = new Date(scan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            return (
              <TouchableOpacity
                key={scan.id}
                style={[styles.mealRow, i === arr.length - 1 && styles.mealRowLast]}
                onPress={() => router.push(`/scan/${scan.id}`)}
                activeOpacity={0.8}
              >
                {scan.image_url ? (
                  <Image source={{ uri: scan.image_url }} style={styles.mealThumb} contentFit="cover" cachePolicy="memory-disk" transition={200} />
                ) : (
                  <View style={[styles.mealThumb, styles.mealThumbEmpty]}>
                    <MaterialIcons name="restaurant" size={20} color={'#9ca3af'} />
                  </View>
                )}
                <View style={styles.mealInfo}>
                  <View style={styles.mealTitleRow}>
                    <Text style={styles.mealTitle} numberOfLines={1}>{scan.ai_identified_food || 'Unidentified Food'}</Text>
                    {scan.is_treat && (
                      <View style={styles.treatChip}>
                        <Text style={styles.treatChipText}>TREAT</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.mealMeta}>{scan.ai_estimated_calories} kcal · {time}</Text>
                  <Text style={styles.mealMacroLine}>P {scan.protein_g}g · F {scan.fat_g}g · C {scan.carbs_g}g</Text>
                </View>
                <MaterialIcons name="chevron-right" size={18} color={color.slateFaint} />
              </TouchableOpacity>
            );
          })
        )}
      </Reanimated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // One consistent vertical rhythm for every section — a single `gap` governs
  // the spacing between blocks so no section sets its own ad-hoc margins.
  // Mirrors Home's scroll container exactly, so the hierarchy is unchanged.
  feed: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingBottom: space.xxl,
    gap: space.xxl,
  },

  // Rings
  ringsWrapper: {
    alignItems: 'center',
  },
  ringsContainer: {
    width: RING_SIZE,
    height: RING_SIZE,
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
  },
  petPhotoContainer: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemCircle: {
    width: PHOTO_RADIUS * 2,
    height: PHOTO_RADIUS * 2,
    borderRadius: PHOTO_RADIUS,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    ...makeShadow(4, 20, 0.08, '#000'),
  },
  streakBadge: {
    position: 'absolute',
    bottom: 6,
    right: -4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: '#e5e7eb',
    ...makeShadow(2, 4, 0.08, '#000'),
  },
  streakBadgeText: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 11,
  },

  // ─── Editorial section heads: caption + hairline rule ───
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    marginBottom: space.lg,
  },
  sectionLabel: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 2.4,
    color: color.slateFaint,
  },
  sectionRule: {
    flex: 1,
    height: 1,
    backgroundColor: '#ece9e2',
  },
  sectionMeta: {
    fontFamily: font.bold,
    fontSize: 11,
    color: color.slateFaint,
  },

  // ─── Today — stats as typography, hairline-divided ───
  statRow: {
    flexDirection: 'row',
    gap: space.lg,
    marginBottom: space.lg,
  },
  stat: { flex: 1 },
  statDivider: {
    width: 1,
    backgroundColor: '#ece9e2',
  },
  statValue: {
    fontFamily: font.display,
    fontSize: 28,
    lineHeight: 28,
    color: color.ink,
    letterSpacing: 0.5,
  },
  statUnit: {
    fontSize: 13,
    color: color.slateFaint,
  },
  statTarget: {
    fontFamily: font.medium,
    fontSize: 10.5,
    color: color.slateMuted,
    marginTop: 3,
    marginBottom: 2,
  },
  macroLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  macroDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  macroText: {
    fontFamily: font.semibold,
    fontSize: 11.5,
    color: color.slateMuted,
    marginRight: 7,
  },
  macroSpacer: {
    flex: 1,
    minWidth: space.sm,
  },
  macroTreat: {
    marginRight: 0,
    color: color.ink,
    flexShrink: 1,
  },
  macroTreatWarning: {
    color: color.error,
  },

  // ─── Top actions row (Second Opinion) ───
  topActionsRow: {
    flexDirection: 'row',
    gap: space.md,
    alignItems: 'stretch',
  },

  // ─── Meals — editorial rows ───
  emptyMeals: {
    alignItems: 'center',
    paddingVertical: space.xxl,
    gap: 8,
  },
  emptyMealsText: {
    fontFamily: font.regular,
    fontSize: 12.5,
    color: color.slateFaint,
    textAlign: 'center',
  },
  mealRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    borderBottomWidth: 1,
    borderBottomColor: '#ece9e2',
  },
  mealRowLast: { borderBottomWidth: 0 },
  mealThumb: {
    width: 54,
    height: 54,
    borderRadius: radius.md,
    backgroundColor: color.track,
  },
  mealThumbEmpty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealInfo: { flex: 1, minWidth: 0 },
  mealTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  mealTitle: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.ink,
    flexShrink: 1,
  },
  treatChip: {
    backgroundColor: color.yellowSoft,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  treatChipText: {
    fontFamily: font.bold,
    fontSize: 8.5,
    letterSpacing: 0.8,
    color: color.navy,
  },
  mealMeta: {
    fontFamily: font.semibold,
    fontSize: 12,
    color: color.slate,
    marginTop: 2,
  },
  mealMacroLine: {
    fontFamily: font.regular,
    fontSize: 11,
    color: color.slateFaint,
    marginTop: 2,
  },
});

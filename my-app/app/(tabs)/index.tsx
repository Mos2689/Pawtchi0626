import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialCommunityIcons, MaterialIcons, Ionicons } from '@expo/vector-icons';
import Svg from 'react-native-svg';
import Reanimated, {
  useSharedValue, useAnimatedStyle, withSequence, withSpring,
} from 'react-native-reanimated';
import { color, font, radius, space, motion, makeShadow } from '../../constants/design';
import { RingArc, ProgressBar, RING_SIZE, RING_CONFIG, PHOTO_RADIUS } from '../../components/HealthRings';
import { AnimatedCounter } from '../../components/AnimatedCounter';
import { entrance } from '../../components/motionPresets';
import { PawLoader } from '../../components/loader/PawLoader';
import { ProfileCompletionCard } from '../../components/ProfileCompletionCard';

import { useActivePetStore } from '../../store/useActivePetStore';
import { usePawPrintStore } from '../../store/usePawPrintStore';
import { useStreakStore } from '../../store/useStreakStore';
import { useWalkStoryStore } from '../../store/useWalkStoryStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { computeWaterTargetMl } from '../../lib/hydration';
import { resolvePetImage } from '../../lib/petFallbackImage';
import { useAuth } from '../../providers/AuthProvider';
import { useSubscription } from '../../hooks/useSubscription';
import { NudgeCard } from '../../components/NudgeCard';
import { TrialBanner } from '../../components/TrialBanner';
import { VetTunedNutritionBanner } from '../../components/VetTunedNutritionBanner';
import { CatRefusingFoodCard } from '../../components/CatRefusingFoodCard';
import { SevereObesityVetBanner } from '../../components/SevereObesityVetBanner';
import { GrowthPhaseBanner } from '../../components/GrowthPhaseBanner';
import { MerRecalibrationBanner } from '../../components/MerRecalibrationBanner';
import { getAgeMonths } from '../../lib/lifeStage';
import { deriveGoal as deriveGoalFn } from '../../lib/healthMath';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SecondOpinionCard } from '../../components/SecondOpinionCard';
import { RunningDogIcon } from '../../components/icons/RunningDogIcon';
import { WalkPostCard } from '../../components/WalkPostCard';
import { useRecentWalks } from '../../hooks/useRecentWalks';
import { getLocalYMD } from '../../lib/dateUtils';
import { MilestoneJourneyCard } from '../../components/MilestoneJourneyCard';
import { VetCheckinNudge } from '../../components/VetCheckinNudge';
import { getMonthlyUsage, getPendingCheckin, type MonthlyUsage, type PendingCheckin } from '../../lib/askVet';
import { track } from '../../lib/analytics';
import { haptic } from '../../lib/haptics';
import { useWalkEnabled } from '../../hooks/useWalkEnabled';
import { WALK_STORY_ENABLED } from '../../constants/features';
import { armWalkStart } from '../../lib/walk/walkStartIntent';
import { WalkStoryRing } from '../../components/WalkStoryRing';
import { WalksignCrest } from '../../components/walksign/WalksignCrest';
import { WalksignMomentModal } from '../../components/walksign/WalksignMomentModal';
import { PawPrintTeaser } from '../../components/pawprints/PawPrintTeaser';
import { MilestoneCelebration } from '../../components/pawprints/MilestoneCelebration';
import { TemplateUnlockCelebration } from '../../components/moments/TemplateUnlockCelebration';
import {
  clearPendingWalksignCelebration,
  readPendingWalksignCelebration,
  type PendingWalksignCelebration,
} from '../../lib/walksign/walksignSync';
import type { WalksignId } from '../../lib/walksign/types';
import { createWalkStorySnapshot } from '../../lib/walkStorySnapshot';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../../lib/supabase';
import { useNotificationPermission } from '../../hooks/useNotificationPermission';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { NotificationBellChip } from '../../components/NotificationBellChip';
import { NotificationPrimer } from '../../components/NotificationPrimer';

/** Cooldown between value-moment asks, so a decline is never a nag. */
const PRIMER_COOLDOWN_KEY = 'notification_primer_last_shown';

/** "Yesterday" / "Monday" / "Sat 20 Jul" — the day divider label above walks
 *  from a given date when the 7-day toggle is active. */
function formatWalkDay(walkDate: Date, todayYmd: string): string {
  const walkYmd = getLocalYMD(walkDate);
  if (walkYmd === todayYmd) return 'Today';
  const y = new Date();
  y.setHours(0, 0, 0, 0);
  y.setDate(y.getDate() - 1);
  if (walkYmd === getLocalYMD(y)) return 'Yesterday';
  const daysAgo = Math.round((Date.now() - walkDate.getTime()) / (24 * 60 * 60_000));
  if (daysAgo < 7) return walkDate.toLocaleDateString([], { weekday: 'long' });
  return walkDate.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Fine-grained selectors: re-render only when the specific value changes, not on
  // any unrelated store mutation (pantry, isLoading, etc.).
  const activePet = useActivePetStore(s => s.activePet);
  const isTailoring = useActivePetStore(s => s.isTailoring);
  // Walks are dogs-only — every walk surface below hides for a cat profile.
  const walkEnabled = useWalkEnabled();
  const currentStreak = useStreakStore(s => s.currentStreak);
  const pawCoins = useStreakStore(s => s.pawCoins);
  const fetchStreak = useStreakStore(s => s.fetchStreak);

  // ── Notification reach ────────────────────────────────────────────────────
  // 148 of 161 onboarded owners have no push token, and until now none of them
  // had any route to being asked: the primer only ever mounted at the end of
  // onboarding, which they had all already passed. These two surfaces are that
  // route — a header chip while they are unreachable, and one primer shown at a
  // moment when the app has already demonstrated it is worth hearing from.
  const notifPermission = useNotificationPermission();
  const { requestPermission: requestNotificationPermission } = usePushNotifications();
  const [homePrimerVisible, setHomePrimerVisible] = React.useState(false);
  const primerConsidered = React.useRef(false);

  // Re-read on focus, not just on app foreground. Returning from the settings
  // screen after flipping the master switch is an in-app navigation, so without
  // this the chip would still claim the owner is unreachable.
  const refreshNotifPermission = notifPermission.refresh;
  useFocusEffect(
    React.useCallback(() => {
      void refreshNotifPermission();
    }, [refreshNotifPermission]),
  );
  const { user } = useAuth();
  const { isFreemiumActive, daysSinceCreation, hasFullAccess } = useSubscription();
  // Today's tracked walks — surfaced as shareable post cards under Second Opinion.
  // Fetch the widest window we support (7 days) once; the range toggle
  // slices locally so switching between Today and 7 days is instant.
  const { walks: recentWalks } = useRecentWalks(activePet?.id, 7);
  const storyTotals = usePawPrintStore(s => s.totals);
  const primeWalkStory = useWalkStoryStore(s => s.prime);
  type WalkRange = 1 | 7;
  const [walkRange, setWalkRange] = React.useState<WalkRange>(1);
  const todayYmd = React.useMemo(() => getLocalYMD(new Date()), []);
  const visibleWalks = React.useMemo(
    () =>
      walkRange === 1
        ? recentWalks.filter(w => getLocalYMD(new Date(w.started_at)) === todayYmd)
        : recentWalks,
    [recentWalks, walkRange, todayYmd],
  );
  const injectSubscriptionData = usePetContextStore(s => s.injectSubscriptionData);

  // Coin pill pulse — a one-shot scale bump whenever the balance grows, so an
  // earned reward registers on the persistent header (not only the transient toast).
  const coinPulse = useSharedValue(1);
  const prevCoins = React.useRef(pawCoins);
  React.useEffect(() => {
    if (pawCoins > prevCoins.current) {
      coinPulse.value = withSequence(
        withSpring(1.18, motion.spring.bouncy),
        withSpring(1, motion.spring.gentle),
      );
    }
    prevCoins.current = pawCoins;
  }, [pawCoins, coinPulse]);
  const coinPillStyle = useAnimatedStyle(() => ({ transform: [{ scale: coinPulse.value }] }));

  React.useEffect(() => {
    injectSubscriptionData(isFreemiumActive, daysSinceCreation);
  }, [isFreemiumActive, daysSinceCreation, injectSubscriptionData]);

  // Store data
  const todayCalories = usePetContextStore(s => s.todayCalories);
  const todayWater = usePetContextStore(s => s.todayWater);
  const todayScans = usePetContextStore(s => s.todayScans);
  const nextActivity = usePetContextStore(s => s.nextActivity);
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
  const daysSinceLastFoodLog = usePetContextStore(s => s.daysSinceLastFoodLog);
  const longestStreak = useStreakStore(s => s.longestStreak);

  useFocusEffect(useCallback(() => {
    if (activePet?.id) refreshToday(activePet.id);
  }, [activePet?.id, refreshToday]));

  useFocusEffect(useCallback(() => {
    if (user?.id) fetchStreak(user.id);
  }, [user?.id, fetchStreak]));

  // Ask Pawtchi monthly allowance — shown quietly on the home entry card.
  const [askUsage, setAskUsage] = React.useState<MonthlyUsage | null>(null);
  useFocusEffect(useCallback(() => {
    if (user?.id) getMonthlyUsage(user.id).then(setAskUsage).catch(() => {});
  }, [user?.id]));

  // Pending Second Opinion check-in — surfaces a gentle "how is {pet} doing" card.
  const [pendingCheckin, setPendingCheckin] = React.useState<PendingCheckin | null>(null);
  useFocusEffect(useCallback(() => {
    if (activePet?.id) getPendingCheckin(activePet.id).then(setPendingCheckin).catch(() => {});
  }, [activePet?.id]));

  // A Walksign confirmation/transition staged by walksignSync waits for the
  // next Home focus — the celebration lands when the user is present, not
  // mid-walk-save.
  const [walksignMoment, setWalksignMoment] = React.useState<PendingWalksignCelebration | null>(null);
  useFocusEffect(useCallback(() => {
    if (!activePet?.id) return;
    readPendingWalksignCelebration().then(pending => {
      if (pending && pending.petId === activePet.id) setWalksignMoment(pending);
    }).catch(() => {});
  }, [activePet?.id]));
  const dismissWalksignMoment = useCallback(() => {
    setWalksignMoment(null);
    clearPendingWalksignCelebration();
  }, []);

  // Walk Story ring — the Home avatar as the daily engine (dogs only, via
  // useWalkEnabled). A walk from the last 24h keeps the ring lit with a story
  // to replay; otherwise the ring becomes a calm "take a walk" nudge. Driven
  // off the recent-walks feed rather than the seen-marker, so it stays lit for
  // the full window whether or not the story has been opened.
  const storyRingEnabled = WALK_STORY_ENABLED && walkEnabled;
  const STORY_WINDOW_MS = 24 * 60 * 60 * 1000;
  const latestWalkAt = recentWalks[0]?.started_at;
  const hasFreshStory =
    storyRingEnabled &&
    !!latestWalkAt &&
    Date.now() - new Date(latestWalkAt).getTime() < STORY_WINDOW_MS;

  const onStartWalk = useCallback(() => {
    if (hasFullAccess) armWalkStart();
    router.push((hasFullAccess ? '/walk' : '/paywall') as any);
  }, [hasFullAccess, router]);

  const latestWalkId = recentWalks[0]?.id;
  const openLatestWalkStory = useCallback(() => {
    const latestWalk = recentWalks[0];
    if (!latestWalk || !activePet) return;
    const snapshot = createWalkStorySnapshot({
      walkSessionId: latestWalk.id,
      petId: activePet.id,
      petName: activePet.name,
      petGender: activePet.gender,
      breed: activePet.breed,
      ageYears: activePet.age_years,
      startedAt: latestWalk.started_at,
      durationS: latestWalk.duration_s,
      movingTimeS: latestWalk.moving_time_s,
      distanceM: latestWalk.distance_m,
      avgSpeedKmh: latestWalk.avg_speed_kmh,
      route: latestWalk.route,
      pausePoints: latestWalk.pause_points,
      sniffPoints: latestWalk.sniff_points,
      startLabel: latestWalk.start_label,
      endLabel: latestWalk.end_label,
      farthestLabel: latestWalk.farthest_label,
      weather: latestWalk.weather,
      totals: storyTotals,
    });
    if (snapshot) primeWalkStory(snapshot);
    router.push({
      pathname: '/walk-story',
      params: { id: latestWalk.id, source: 'ring' },
    });
  }, [activePet, primeWalkStory, recentWalks, router, storyTotals]);

  React.useEffect(() => {
    if (hasFreshStory) track('walk_story_ring_shown', {});
  }, [hasFreshStory, latestWalkId]);

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

  // Greeting helpers
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Morning';
    if (hour < 17) return 'Afternoon';
    return 'Evening';
  };

  const getDateString = () => {
    const d = new Date();
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${days[d.getDay()]} · ${months[d.getMonth()]} ${d.getDate()}`;
  };

  const petName = activePet?.name || 'Buddy';

  // ── The value-moment ask ──────────────────────────────────────────────────
  // Deliberately not on first launch. iOS grants exactly one permission prompt
  // per install; spending it on someone who has not yet seen the app do
  // anything is how opt-in ended up at 9%. The gate is: they have a pet, they
  // have logged at least once (so the core loop has paid off), the OS will
  // still show a prompt, and we have not asked in the last 14 days.
  React.useEffect(() => {
    if (primerConsidered.current) return;
    if (!activePet || notifPermission.status === 'loading') return;
    if (!notifPermission.canAsk || notifPermission.isGranted) return;
    // `todayCalories > 0` or an existing streak both mean they have logged.
    const hasLogged = todayCalories > 0 || currentStreak > 0;
    if (!hasLogged) return;

    primerConsidered.current = true;
    void (async () => {
      const last = await AsyncStorage.getItem(PRIMER_COOLDOWN_KEY);
      const lastAt = last ? Number(last) : 0;
      const fourteenDays = 14 * 24 * 60 * 60 * 1000;
      if (Date.now() - lastAt < fourteenDays) return;
      setHomePrimerVisible(true);
      await AsyncStorage.setItem(PRIMER_COOLDOWN_KEY, String(Date.now()));
      supabase.rpc('record_notification_permission', {
        p_status: notifPermission.status,
        p_primer_shown: true,
      }).then(() => {});
    })();
  }, [activePet, notifPermission.status, notifPermission.canAsk, notifPermission.isGranted, todayCalories, currentStreak]);

  /**
   * Routes by *why* notifications are off, because the three states need three
   * different fixes. A blocked user cannot be re-prompted by anything the app
   * renders — only the system settings app can help them.
   */
  const handleNotificationChipPress = () => {
    track('ui_button_tapped', { button: 'home_notification_chip', state: notifPermission.status });
    if (notifPermission.isBlocked) {
      // Spent OS prompt — nothing the app renders can reopen it.
      notifPermission.openSystemSettings();
    } else if (!notifPermission.isGranted && notifPermission.canAsk) {
      setHomePrimerVisible(true);
    } else {
      // Granted at the OS level but switched off inside Pawtchi.
      router.push('/notifications' as any);
    }
  };

  const handleHomePrimerAccept = async () => {
    setHomePrimerVisible(false);
    try {
      await requestNotificationPermission();
    } catch {
      // A denied prompt or a missing native module both just mean no token.
    }
    await notifPermission.refresh();
  };

  // Only surface the chip once we know the real answer — `loading` would flash
  // it on every Home mount for users who already have notifications on.
  //
  // Gated on `isReachable`, not `isGranted`: an owner can have granted at the
  // OS level and still have Pawtchi's own master switch off, in which case they
  // receive nothing and the chip is exactly what they need to see.
  const notificationsUnreachable =
    notifPermission.status !== 'loading' && !notifPermission.isReachable;

  return (
    <View style={styles.container}>
      <TrialBanner />
      <VetTunedNutritionBanner
        petId={activePet?.id ?? null}
        petName={petName}
        medicalConditions={activePet?.medical_conditions ?? null}
      />
      <SevereObesityVetBanner
        petId={activePet?.id ?? null}
        petName={petName}
        bcs={activePet?.body_condition_score ?? null}
        severeObesityVetConfirmedAt={activePet?.severe_obesity_vet_confirmed_at ?? null}
      />
      <GrowthPhaseBanner
        petId={activePet?.id ?? null}
        petName={petName}
        ageMonths={activePet ? getAgeMonths(activePet) : undefined}
        currentWeightKg={activePet?.current_weight_kg ?? null}
        targetWeightKg={activePet?.target_weight_kg ?? null}
      />
      <MerRecalibrationBanner
        petId={activePet?.id ?? null}
        petName={petName}
        observedMer={usePetContextStore(s => s.observedMer)}
      />
      <CatRefusingFoodCard
        species={activePet?.species}
        goal={deriveGoalFn(
          activePet?.current_weight_kg ?? 0,
          activePet?.target_weight_kg,
          activePet?.body_condition_score,
        )}
        todayCalories={todayCalories}
        petName={petName}
      />

      {/* One-shot Walksign confirmation / transition moment */}
      <WalksignMomentModal
        celebration={walksignMoment}
        petName={activePet?.name}
        petGender={activePet?.gender}
        onClose={dismissWalksignMoment}
      />

      {/* Paw Print milestone celebrations — queued by walk sync, one at a
          time, landing here after the walk fully wraps (never mid-walk). */}
      <MilestoneCelebration />

      {/* Earned share-card unlocks — waits for the milestone queue to clear,
          then shows the qualifying walk wearing its new template. */}
      <TemplateUnlockCelebration />

      <NotificationPrimer
        visible={homePrimerVisible}
        petName={petName}
        source="home_value_moment"
        onAccept={handleHomePrimerAccept}
        onDecline={() => setHomePrimerVisible(false)}
      />

      {/* Header - Always visible at top */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerLeft}>
          {storyRingEnabled ? (
            <WalkStoryRing
              imageUri={activePet?.current_avatar_url || resolvePetImage(activePet?.image_url, activePet?.species, 200)}
              // Lit with a story to replay when there's a walk from the last 24h;
              // otherwise a nudge that starts a walk. The avatar is the engine.
              mode={hasFreshStory ? 'story' : 'nudge'}
              onPress={hasFreshStory ? openLatestWalkStory : onStartWalk}
              petName={activePet?.name ?? null}
            />
          ) : (
            <View style={styles.avatarMini}>
              <Image
                source={{ uri: activePet?.current_avatar_url || resolvePetImage(activePet?.image_url, activePet?.species, 200) }}
                style={styles.avatarMiniImg}
                contentFit="cover"
                cachePolicy="memory-disk"
                transition={200}
              />
            </View>
          )}
          <View>
            <Text style={styles.headerTitle}>PAWTCHI</Text>
            <Text style={styles.headerDate}>{getDateString()}</Text>
          </View>
        </View>
        {/* The header slot is the chip while notifications are off, and the
            coin pill once they are on. It resolves itself rather than becoming
            permanent furniture. */}
        {notificationsUnreachable ? (
          <NotificationBellChip
            visible
            isBlocked={notifPermission.isBlocked}
            onPress={handleNotificationChipPress}
          />
        ) : (
          <Reanimated.View style={[styles.coinPill, coinPillStyle]}>
            <View style={styles.coinIcon}>
              <Text style={styles.coinIconText}>P</Text>
            </View>
            <AnimatedCounter value={pawCoins} style={styles.coinText} />
          </Reanimated.View>
        )}
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Pending Second Opinion check-in — takes priority over the generic nudge */}
        {pendingCheckin && (
          <VetCheckinNudge
            petName={petName}
            reason={pendingCheckin.reason}
            onPress={() => {
              track('vet_checkin_opened', { source: 'home_nudge' });
              router.push(`/ask?case=${pendingCheckin.questionId}&mode=checkin` as any);
            }}
          />
        )}

        {/* Nudge Card */}
        {!pendingCheckin && <NudgeCard />}

        {/* Profile completion — quiet, dismissible, deep-links to the right editor */}
        <ProfileCompletionCard />

        {/* Greeting */}
        <Reanimated.View entering={entrance(0)} style={styles.greetingRow}>
          <Text style={styles.greeting}>
            {getGreeting()}, <Text style={styles.greetingName}>{petName}</Text>
          </Text>
          {/* The Walksign crest rides beside the name — identity, not a widget. */}
          {activePet?.species === 'dog' && activePet?.walksign && (
            <View style={styles.walksignBadge}>
              <WalksignCrest sign={activePet.walksign as WalksignId} size={26} color={color.ink} />
            </View>
          )}
        </Reanimated.View>

        {/* Ring Hero - Centered */}
        <Reanimated.View entering={entrance(1)} style={styles.ringsWrapper}>
          <View style={styles.ringsContainer}>
            <Svg width={RING_SIZE} height={RING_SIZE}>
              <RingArc r={RING_CONFIG[0].r} color={RING_CONFIG[0].color} strokeWidth={RING_CONFIG[0].stroke} progress={calorieProgress} />
              <RingArc r={RING_CONFIG[1].r} color={RING_CONFIG[1].color} strokeWidth={RING_CONFIG[1].stroke} progress={activityProgress} />
              <RingArc r={RING_CONFIG[2].r} color={RING_CONFIG[2].color} strokeWidth={RING_CONFIG[2].stroke} progress={waterProgress} />
            </Svg>

            {/* Pet Photo - Centered in rings */}
            <View style={styles.petPhotoContainer}>
              <View style={styles.petPhoto}>
                <Image
                  source={{ uri: activePet?.current_avatar_url || resolvePetImage(activePet?.image_url, activePet?.species, 1000) }}
                  style={styles.petPhotoImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
                <PawLoader visible={isTailoring} message="Tailoring avatar…" />
              </View>
              {/* Streak Badge */}
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

        {/* ─── Weight journey — the milestone map, brought home ─── */}
        <MilestoneJourneyCard />

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

        {/* Streak Nudge */}
        {currentStreak === 0 && longestStreak > 0 && (
          <TouchableOpacity
            style={styles.streakNudge}
            onPress={() => router.push('/(tabs)/meal')}
            activeOpacity={0.85}
          >
            <View style={styles.streakNudgeIcon}>
              <MaterialIcons name="replay" size={20} color="#92400e" />
            </View>
            <View style={styles.streakNudgeContent}>
              <Text style={styles.streakNudgeTitle}>You had a {longestStreak}-day streak</Text>
              <Text style={styles.streakNudgeSubtitle}>Log something today to start a new one</Text>
            </View>
            <MaterialIcons name="chevron-right" size={18} color="#b45309" />
          </TouchableOpacity>
        )}

        {/* Primary actions — equal, compact cards that share one responsive row. */}
        <Reanimated.View entering={entrance(4)} style={styles.actionCardsRow}>
          {walkEnabled && (
            <TouchableOpacity
              style={styles.walkCard}
              onPress={() => { if (hasFullAccess) armWalkStart(); router.push((hasFullAccess ? '/walk' : '/paywall') as any); }}
              activeOpacity={0.85}
              hitSlop={space.xs}
              accessibilityRole="button"
              accessibilityLabel={`Walk ${petName}. Ready when you are`}
              accessibilityHint="Starts walk tracking"
            >
              <RunningDogIcon size={76} color={color.navy} />

              <View style={styles.walkContentRow}>
                <View style={styles.walkText}>
                  <Text style={styles.walkTitle}>Walk {petName}</Text>
                  <Text style={styles.walkSub} numberOfLines={1}>Ready when you are</Text>
                </View>
                <View style={styles.walkStart}>
                  <MaterialIcons name="play-arrow" size={24} color={color.yellow} />
                </View>
              </View>
            </TouchableOpacity>
          )}

          <SecondOpinionCard
            remaining={askUsage?.remaining ?? null}
            resetsAt={askUsage?.resetsAt}
            onPress={() => router.push('/ask' as any)}
          />
        </Reanimated.View>

        {/* ─── Up next — flat editorial row, in column with TODAY / MEALS ─── */}
        {nextActivity && (
          <Reanimated.View entering={entrance(4)}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>UP NEXT</Text>
              <View style={styles.sectionRule} />
              <Text style={styles.sectionMeta}>
                {nextActivity.scheduled_time ? nextActivity.scheduled_time.slice(0, 5) : ''}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.upNextRow}
              onPress={() => router.push('/(tabs)/activity')}
              activeOpacity={0.8}
            >
              <View style={styles.upNextIcon}>
                <MaterialIcons
                  name={
                    nextActivity.activity_type === 'walk' ? 'directions-walk'
                      : nextActivity.activity_type === 'play' ? 'sports-baseball'
                        : nextActivity.activity_type === 'water' ? 'water-drop'
                          : nextActivity.activity_type === 'training' ? 'school'
                            : nextActivity.activity_type === 'grooming' ? 'content-cut'
                              : 'star'
                  }
                  size={20}
                  color={nextActivity.activity_type === 'water' ? '#60a5fa' : color.yellow}
                />
              </View>
              <View style={styles.upNextText}>
                <Text style={styles.upNextTitle}>{nextActivity.title}</Text>
                <Text style={styles.upNextMeta}>
                  {(() => {
                    const parts = [
                      nextActivity.duration_minutes ? `${nextActivity.duration_minutes} min` : null,
                      nextActivity.intensity || null,
                    ].filter(Boolean);
                    if (parts.length > 0) return parts.join(' · ');
                    if (nextActivity.notes) return nextActivity.notes;
                    switch (nextActivity.activity_type) {
                      case 'water': return 'Hydration break';
                      case 'meal':
                      case 'dinner':
                      case 'breakfast':
                      case 'lunch': return 'Mealtime';
                      case 'grooming': return 'Grooming';
                      case 'training': return 'Training session';
                      case 'walk': return 'Time to move';
                      case 'play': return 'Playtime';
                      default: return 'Tap to start';
                    }
                  })()}
                </Text>
              </View>
              {walkEnabled && nextActivity.activity_type === 'walk' ? (
                <TouchableOpacity
                  style={styles.upNextTrackBtn}
                  onPress={() => { if (hasFullAccess) armWalkStart(); router.push((hasFullAccess ? '/walk' : '/paywall') as any); }}
                  activeOpacity={0.85}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                >
                  <MaterialIcons name="play-arrow" size={16} color={color.navy} />
                  <Text style={styles.upNextTrackBtnText}>Track</Text>
                </TouchableOpacity>
              ) : (
                <MaterialIcons name="chevron-right" size={18} color={color.creamDim} />
              )}
            </TouchableOpacity>
          </Reanimated.View>
        )}

        {/* ─── Tracked walks — shareable post cards, Today by default with a
            small toggle to widen to the last 7 days. Section stays visible
            whenever the 7-day window has walks so the toggle is reachable
            even on days with no fresh walk yet. ─── */}
        {walkEnabled && activePet && recentWalks.length > 0 && (
          <Reanimated.View entering={entrance(4.5)}>
            <View style={styles.sectionHead}>
              <Text style={styles.sectionLabel}>
                {walkRange === 1 ? "TODAY'S WALKS" : 'LAST 7 DAYS'}
              </Text>
              <View style={styles.sectionRule} />
              <View style={styles.rangeToggle}>
                <TouchableOpacity
                  onPress={() => setWalkRange(1)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  style={[styles.rangePill, walkRange === 1 && styles.rangePillActive]}
                >
                  <Text
                    style={[styles.rangePillText, walkRange === 1 && styles.rangePillTextActive]}
                  >
                    Today
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => setWalkRange(7)}
                  hitSlop={{ top: 8, bottom: 8, left: 6, right: 6 }}
                  style={[styles.rangePill, walkRange === 7 && styles.rangePillActive]}
                >
                  <Text
                    style={[styles.rangePillText, walkRange === 7 && styles.rangePillTextActive]}
                  >
                    7 days
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
            {visibleWalks.length === 0 ? (
              // Range set to Today but the day has no walks yet — surface a
              // gentle nudge instead of hiding the toggle.
              <TouchableOpacity
                style={styles.walkEmpty}
                activeOpacity={0.85}
                onPress={() => setWalkRange(7)}
              >
                <MaterialCommunityIcons name="paw-outline" size={16} color={color.slateFaint} />
                <Text style={styles.walkEmptyText}>
                  No walks logged today — see the last 7 days
                </Text>
              </TouchableOpacity>
            ) : (
              (() => {
                let lastYmd: string | null = null;
                return visibleWalks.map((walk, i) => {
                  const walkYmd = getLocalYMD(new Date(walk.started_at));
                  const showDivider = walkRange === 7 && walkYmd !== lastYmd;
                  lastYmd = walkYmd;
                  return (
                    <React.Fragment key={walk.id}>
                      {showDivider && (
                        <Text style={styles.walkDayDivider}>
                          {formatWalkDay(new Date(walk.started_at), todayYmd)}
                        </Text>
                      )}
                      <WalkPostCard walk={walk} pet={activePet} index={i} />
                    </React.Fragment>
                  );
                });
              })()
            )}
          </Reanimated.View>
        )}

        {/* ─── Paw Prints — gallery teaser (self-hiding until ≥2 walks) ─── */}
        {walkEnabled && activePet && (
          <Reanimated.View entering={entrance(4.7)} style={{ marginBottom: space.lg }}>
            <PawPrintTeaser />
          </Reanimated.View>
        )}

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

        {/* Invite a friend — quiet, pet-voiced. Sits at the bottom of the feed. */}
        <TouchableOpacity
          style={styles.inviteRow}
          onPress={() => router.push('/invite' as any)}
          activeOpacity={0.8}
        >
          <View style={styles.inviteIcon}>
            <MaterialIcons name="group-add" size={18} color={color.navy} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.inviteTitle}>A friend for {petName}</Text>
            <Text style={styles.inviteSub}>Pawtchi is better shared</Text>
          </View>
          <MaterialIcons name="chevron-right" size={18} color={color.slateFaint} />
        </TouchableOpacity>
      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },

  // Primary actions
  actionCardsRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: space.md,
    width: '100%',
  },

  // Header
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    zIndex: 100,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatarMini: {
    width: 40,
    height: 40,
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 2.5,
    borderColor: '#F7F602',
  },
  avatarMiniImg: {
    width: '100%',
    height: '100%',
  },
  headerTitle: {
    fontFamily: 'BebasNeue_400Regular',
    fontSize: 20,
    letterSpacing: 2.5,
    color: '#0f172a',
  },
  headerDate: {
    fontFamily: 'Montserrat_400Regular',
    fontSize: 11,
    color: '#94a3b8',
    marginTop: 2,
  },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  coinIcon: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#F7F602',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coinIconText: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 11,
    color: '#041015',
  },
  coinText: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 14,
    color: '#041015',
  },

  // Scroll Content
  // One consistent vertical rhythm for every top-level section — a single
  // `gap` governs the spacing between blocks so no section sets its own
  // ad-hoc marginTop/marginBottom (those only create drift). Intra-section
  // spacing (label → content) still lives inside each block.
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: space.md,
    paddingBottom: 120,
    gap: space.xxl,
  },

  // Greeting
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  greeting: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 26,
    color: '#475569',
    letterSpacing: -0.5,
  },
  walksignBadge: {
    marginTop: 2,
  },
  greetingName: {
    fontFamily: 'Montserrat_800ExtraBold',
    color: '#0f172a',
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
  petPhoto: {
    width: PHOTO_RADIUS * 2,
    height: PHOTO_RADIUS * 2,
    borderRadius: PHOTO_RADIUS,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    overflow: 'hidden',
    ...makeShadow(4, 20, 0.12, '#000'),
  },
  petPhotoImg: {
    width: '100%',
    height: '100%',
  },
  tailoringOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tailoringText: {
    color: '#F7F602',
    fontWeight: 'bold',
    fontSize: 9,
    letterSpacing: 1,
    marginTop: 6,
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

  // ─── Walk range toggle (Today / 7 days) ───
  rangeToggle: {
    flexDirection: 'row',
    backgroundColor: color.track,
    borderRadius: radius.pill,
    padding: 2,
  },
  rangePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
  },
  rangePillActive: {
    backgroundColor: color.surface,
  },
  rangePillText: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 0.4,
    color: color.slateMuted,
  },
  rangePillTextActive: {
    color: color.ink,
  },
  walkDayDivider: {
    fontFamily: font.semibold,
    fontSize: 11,
    letterSpacing: 1.8,
    color: color.slateFaint,
    textTransform: 'uppercase',
    marginTop: space.sm,
    marginBottom: space.sm,
  },
  walkEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    paddingVertical: space.lg,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: color.hairline,
    borderStyle: 'dashed',
    marginBottom: space.lg,
  },
  walkEmptyText: {
    fontFamily: font.medium,
    fontSize: 12.5,
    color: color.slateMuted,
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

  // ─── Invite — quiet end-of-feed row ───
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: '#ece9e2',
  },
  inviteIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: color.yellow,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteTitle: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.ink,
  },
  inviteSub: {
    fontFamily: font.regular,
    fontSize: 12,
    color: color.slateMuted,
    marginTop: 1,
  },
  // ─── Treats — quiet ledger strip; red only when earned ───
  // ─── Walk button — white card, navy foreground, prominent play ───
  walkCard: {
    flex: 1,
    justifyContent: 'space-between',
    gap: space.xs,
    backgroundColor: color.surface,
    borderRadius: radius.lg,
    borderWidth: 0.5,
    borderColor: color.hairline,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    ...makeShadow(2, 8, 0.08, '#000'),
  },
  walkContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  walkText: {
    flex: 1,
    minWidth: 0,
  },
  walkTitle: {
    fontFamily: font.bold,
    fontSize: 14,
    color: color.navy,
    letterSpacing: -0.3,
  },
  walkSub: {
    fontFamily: font.medium,
    fontSize: 11,
    color: color.slateMuted,
    marginTop: 1,
  },
  walkStart: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 36,
    height: 36,
    backgroundColor: color.navy,
    borderRadius: radius.pill,
  },

  // ─── Streak nudge — soft, calm prompt ───
  streakNudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#fef3c7',
  },
  streakNudgeIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(146, 64, 14, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakNudgeContent: {
    flex: 1,
  },
  streakNudgeTitle: {
    fontFamily: font.bold,
    fontSize: 15,
    color: '#92400e',
    letterSpacing: -0.2,
  },
  streakNudgeSubtitle: {
    fontFamily: font.medium,
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
  },

  // ─── Up next — the dark navy moment ───
  upNextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: color.navy,
  },
  upNextIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  upNextText: { flex: 1, minWidth: 0 },
  upNextTitle: {
    fontFamily: font.bold,
    fontSize: 15,
    color: color.cream,
    letterSpacing: -0.2,
  },
  upNextMeta: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.creamDim,
    marginTop: 2,
  },
  // One-tap tracked walk — the yellow marks the one thing that matters here.
  upNextTrackBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: color.yellow,
    borderRadius: 999,
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 12,
  },
  upNextTrackBtnText: {
    fontFamily: font.bold,
    fontSize: 12.5,
    color: color.navy,
    letterSpacing: -0.1,
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

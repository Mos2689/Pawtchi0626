import React, { useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import Svg from 'react-native-svg';
import Reanimated, { FadeInDown } from 'react-native-reanimated';
import { color, font, radius, shadow, space } from '../../constants/design';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RingArc, ProgressBar, RING_SIZE, RING_CONFIG, PHOTO_RADIUS } from '../../components/HealthRings';
import { ProfileCompletionCard } from '../../components/ProfileCompletionCard';
import { PREVIEW_SEEN_KEY } from '../preview-home';

import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import { useSubscription } from '../../hooks/useSubscription';
import { NudgeCard } from '../../components/NudgeCard';
import { TrialBanner } from '../../components/TrialBanner';
import { PawtchiButton } from '../../components/PawtchiButton';
import { SecondOpinionCard } from '../../components/SecondOpinionCard';
import { VetCheckinNudge } from '../../components/VetCheckinNudge';
import { getMonthlyUsage, getPendingCheckin, type MonthlyUsage, type PendingCheckin } from '../../lib/askVet';
import { track } from '../../lib/analytics';

export default function HomeScreen() {
  const router = useRouter();
  const scrollY = React.useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  // Fine-grained selectors: re-render only when the specific value changes, not on
  // any unrelated store mutation (pantry, isLoading, etc.).
  const activePet = useActivePetStore(s => s.activePet);
  const isTailoring = useActivePetStore(s => s.isTailoring);
  const currentStreak = useStreakStore(s => s.currentStreak);
  const pawCoins = useStreakStore(s => s.pawCoins);
  const fetchStreak = useStreakStore(s => s.fetchStreak);
  const { user } = useAuth();
  const { expoPushToken } = usePushNotifications();
  const { isFreemiumActive, daysSinceCreation } = useSubscription();
  const injectSubscriptionData = usePetContextStore(s => s.injectSubscriptionData);

  // Sync push token silently
  React.useEffect(() => {
    if (user?.id && expoPushToken) {
      supabase.rpc('register_push_token', { push_token: expoPushToken })
        .then(({ error }) => {
          if (error) console.error("Failed to sync push token:", error.message);
        });
    }
  }, [user?.id, expoPushToken]);

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
  const todayProtein = usePetContextStore(s => s.todayProtein);
  const todayCarbs = usePetContextStore(s => s.todayCarbs);
  const todayFats = usePetContextStore(s => s.todayFats);
  const treatBudget = usePetContextStore(s => s.treatBudget);
  const treatsConsumed = usePetContextStore(s => s.treatsConsumed);
  const treatCaloriesConsumed = usePetContextStore(s => s.treatCaloriesConsumed);
  const caloriesRemaining = usePetContextStore(s => s.caloriesRemaining);
  const refreshToday = usePetContextStore(s => s.refreshToday);
  const daysSinceLastFoodLog = usePetContextStore(s => s.daysSinceLastFoodLog);
  const longestStreak = useStreakStore(s => s.longestStreak);

  // Brand-new user with no real data yet — surface the future-state preview entry.
  const isLowData = daysSinceLastFoodLog === null && todayScans.length === 0;

  // The preview is a one-time view: once seen (or closed), it never resurfaces.
  // Default `true` keeps the card hidden on first render so it never flashes.
  const [previewSeen, setPreviewSeen] = React.useState(true);
  React.useEffect(() => {
    AsyncStorage.getItem(PREVIEW_SEEN_KEY)
      .then((v) => setPreviewSeen(v === 'true'))
      .catch(() => {});
  }, []);

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

  // Computed values
  const calorieProgress = Math.min(calPercent / 100, 1);
  const activityProgress = Math.min(activityCompletionRate, 1);
  const waterProgress = Math.min(waterPercent, 1);

  // Format water display
  const waterDisplay = todayWater >= 1000
    ? `${(todayWater / 1000).toFixed(1)}L`
    : `${todayWater}ml`;
  const waterTarget = activePet?.current_weight_kg
    ? Math.round(activePet.current_weight_kg * 50)
    : 0;
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

  return (
    <View style={styles.container}>
      <TrialBanner />

      {/* Header - Always visible at top */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarMini}>
            <Image
              source={{ uri: activePet?.current_avatar_url || activePet?.image_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=200' }}
              style={styles.avatarMiniImg}
              contentFit="cover"
              cachePolicy="memory-disk"
              transition={200}
            />
          </View>
          <View>
            <Text style={styles.headerTitle}>PAWTCHI</Text>
            <Text style={styles.headerDate}>{getDateString()}</Text>
          </View>
        </View>
        <View style={styles.coinPill}>
          <View style={styles.coinIcon}>
            <Text style={styles.coinIconText}>P</Text>
          </View>
          <Text style={styles.coinText}>{pawCoins.toLocaleString()}</Text>
        </View>
      </View>

      <Animated.ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
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

        {/* Future-state preview re-entry — only before it's been seen, and only while the user has no real data yet */}
        {isLowData && !previewSeen && (
          <TouchableOpacity
            style={styles.previewCard}
            onPress={() => router.push('/preview-home' as any)}
            activeOpacity={0.9}
          >
            <View style={styles.previewIcon}>
              <MaterialIcons name="auto-awesome" size={22} color="#07202A" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.previewTitle}>See where you and {petName} are headed</Text>
              <Text style={styles.previewSub}>A preview of your home as {petName}&apos;s story builds.</Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#cbd5e1" />
          </TouchableOpacity>
        )}

        {/* Greeting */}
        <Text style={styles.greeting}>
          {getGreeting()}, <Text style={styles.greetingName}>{petName}</Text>
        </Text>

        {/* Ring Hero - Centered */}
        <View style={styles.ringsWrapper}>
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
                  source={{ uri: activePet?.current_avatar_url || activePet?.image_url || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop' }}
                  style={styles.petPhotoImg}
                  contentFit="cover"
                  cachePolicy="memory-disk"
                  transition={200}
                />
                {isTailoring && (
                  <View style={styles.tailoringOverlay}>
                    <ActivityIndicator size="large" color="#F7F602" />
                    <Text style={styles.tailoringText}>Tailoring...</Text>
                  </View>
                )}
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
        </View>

        {/* ─── Second Opinion — flagship membership-crest moment ─── */}
        <Reanimated.View entering={FadeInDown.duration(420)}>
          <SecondOpinionCard
            remaining={askUsage?.remaining ?? null}
            resetsAt={askUsage?.resetsAt}
            onPress={() => router.push('/ask' as any)}
          />
        </Reanimated.View>

        {/* ─── Today — typography on the ground, hairline-divided ─── */}
        <Reanimated.View entering={FadeInDown.duration(420)}>
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
              <Text style={styles.statTarget}>of 45 min moving</Text>
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

          {/* One quiet ledger line for macros */}
          <View style={styles.macroLine}>
            <View style={[styles.macroDot, { backgroundColor: '#ec4899' }]} />
            <Text style={styles.macroText}>{todayProtein}g protein</Text>
            <View style={[styles.macroDot, { backgroundColor: color.viz.calories }]} />
            <Text style={styles.macroText}>{todayCarbs}g carbs</Text>
            <View style={[styles.macroDot, { backgroundColor: color.viz.hydrate }]} />
            <Text style={styles.macroText}>{todayFats}g fats</Text>
          </View>
        </Reanimated.View>

        {/* Treat Banner */}
        {targetCal > 0 && (() => {
          const overLimit = caloriesRemaining < 0;
          const treatBudgetLeft = Math.max(0, treatBudget - treatCaloriesConsumed);
          const treatWarning = overLimit || treatBudgetLeft === 0;
          return (
            <TouchableOpacity
              style={[styles.treatBanner, treatWarning && styles.treatBannerWarning]}
              onPress={() => router.push('/(tabs)/meal')}
              activeOpacity={0.8}
            >
              <View style={styles.treatIcon}>
                <MaterialIcons name="pets" size={20} color={treatWarning ? '#ef4444' : '#a3a3a3'} />
              </View>
              <View style={styles.treatContent}>
                <Text style={[styles.treatTitle, treatWarning && styles.treatTitleWarning]}>
                  {overLimit ? 'Treat limit reached' : treatsConsumed > 0 ? `${treatsConsumed} treat${treatsConsumed !== 1 ? 's' : ''} enjoyed` : 'Treat Intake'}
                </Text>
                <Text style={[styles.treatSubtitle, treatWarning && styles.treatSubtitleWarning]}>
                  {overLimit
                    ? `${Math.abs(caloriesRemaining)} kcal over daily budget`
                    : `${treatBudgetLeft} kcal left for treats`}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={treatWarning ? '#ef4444' : '#16a34a'} />
            </TouchableOpacity>
          );
        })()}

        {/* Streak Nudge */}
        {currentStreak === 0 && longestStreak > 0 && (
          <TouchableOpacity
            style={styles.streakNudge}
            onPress={() => router.push('/(tabs)/meal')}
            activeOpacity={0.85}
          >
            <View style={styles.streakNudgeIcon}>
              <MaterialIcons name="replay" size={22} color="#553e00" />
            </View>
            <View style={styles.streakNudgeContent}>
              <Text style={styles.streakNudgeTitle}>You had a {longestStreak}-day streak</Text>
              <Text style={styles.streakNudgeSubtitle}>Log something today to start a new one</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#b45309" />
          </TouchableOpacity>
        )}

        {/* ─── Up next — the deliberate dark moment on the feed ─── */}
        {nextActivity && (
          <Reanimated.View entering={FadeInDown.duration(420).delay(60)}>
            <TouchableOpacity
              style={styles.upNext}
              onPress={() => router.push('/(tabs)/activity')}
              activeOpacity={0.92}
            >
              <View style={styles.upNextHead}>
                <Text style={styles.upNextEyebrow}>UP NEXT</Text>
                <Text style={styles.upNextTime}>
                  {nextActivity.scheduled_time ? nextActivity.scheduled_time.slice(0, 5) : ''}
                </Text>
              </View>
              <View style={styles.upNextBody}>
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
                    size={22}
                    color={nextActivity.activity_type === 'water' ? '#60a5fa' : color.yellow}
                  />
                </View>
                <View style={styles.upNextText}>
                  <Text style={styles.upNextTitle}>{nextActivity.title}</Text>
                  <Text style={styles.upNextMeta}>
                    {[
                      nextActivity.duration_minutes ? `${nextActivity.duration_minutes} min` : null,
                      nextActivity.intensity || null,
                    ].filter(Boolean).join(' · ')}
                  </Text>
                </View>
                <View style={styles.upNextPlay}>
                  <MaterialIcons name="play-arrow" size={18} color={color.navy} />
                </View>
              </View>
            </TouchableOpacity>
          </Reanimated.View>
        )}

        {/* Primary CTA */}
        <PawtchiButton
          title="Log meal or activity"
          iconName="add"
          onPress={() => router.push('/(tabs)/meal')}
          style={{ marginBottom: 24 }}
        />

        {/* ─── Meals — editorial list, no boxes ─── */}
        <Reanimated.View entering={FadeInDown.duration(420).delay(120)}>
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
  scrollContent: {
    paddingHorizontal: 20,
    paddingBottom: 120,
  },

  // Greeting
  greeting: {
    fontFamily: 'Montserrat_700Bold',
    fontSize: 26,
    color: '#475569',
    marginTop: 16,
    marginBottom: 24,
    letterSpacing: -0.5,
  },
  greetingName: {
    fontFamily: 'Montserrat_800ExtraBold',
    color: '#0f172a',
  },

  // Rings
  ringsWrapper: {
    alignItems: 'center',
    marginBottom: 24,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 10,
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
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
    marginTop: space.sm,
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
    marginBottom: space.xl,
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

  // ─── Invite — quiet end-of-feed row ───
  inviteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.lg,
    borderTopWidth: 1,
    borderTopColor: '#ece9e2',
    marginTop: space.sm,
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
  previewCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#07202A',
    borderRadius: 20,
    padding: 18,
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 20,
    elevation: 8,
  },
  previewIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: '#F7F602',
    alignItems: 'center',
    justifyContent: 'center',
  },
  previewTitle: {
    fontFamily: 'Montserrat_800ExtraBold',
    fontSize: 15,
    color: '#FFFFFF',
    marginBottom: 2,
  },
  previewSub: {
    fontFamily: 'Montserrat_500Medium',
    fontSize: 12,
    color: '#94a3b8',
    lineHeight: 17,
  },
  // ─── Treats — quiet ledger strip; red only when earned ───
  treatBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.md,
    paddingHorizontal: 2,
    borderTopWidth: 1,
    borderTopColor: '#ece9e2',
    marginBottom: space.lg,
  },
  treatBannerWarning: {
    backgroundColor: color.errorSoft,
    borderTopWidth: 0,
    borderRadius: radius.lg,
    paddingHorizontal: space.lg,
  },
  treatIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: color.track,
    justifyContent: 'center',
    alignItems: 'center',
  },
  treatContent: {
    flex: 1,
  },
  treatTitle: {
    fontFamily: font.bold,
    fontSize: 13.5,
    color: color.ink,
  },
  treatTitleWarning: {
    color: color.error,
  },
  treatSubtitle: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: color.slateMuted,
    marginTop: 1,
  },
  treatSubtitleWarning: {
    color: color.error,
  },

  // ─── Streak nudge — soft, calm prompt ───
  streakNudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    backgroundColor: '#fef3c7',
    borderRadius: radius.lg,
    padding: space.lg,
    marginBottom: space.lg,
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
    fontSize: 13.5,
    color: '#92400e',
  },
  streakNudgeSubtitle: {
    fontFamily: font.medium,
    fontSize: 11.5,
    color: '#b45309',
    marginTop: 1,
  },

  // ─── Up next — the dark navy moment ───
  upNext: {
    backgroundColor: color.navy,
    borderRadius: 28,
    padding: space.xxl,
    marginBottom: space.xl,
    ...shadow.raised,
  },
  upNextHead: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.lg,
  },
  upNextEyebrow: {
    fontFamily: font.semibold,
    fontSize: 10.5,
    letterSpacing: 2.4,
    color: color.yellow,
  },
  upNextTime: {
    fontFamily: font.bold,
    fontSize: 12,
    color: color.creamDim,
  },
  upNextBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
  },
  upNextIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.lg,
    backgroundColor: color.navyRaised,
    borderWidth: 1,
    borderColor: color.hairlineOnNavy,
    justifyContent: 'center',
    alignItems: 'center',
  },
  upNextText: { flex: 1, minWidth: 0 },
  upNextTitle: {
    fontFamily: font.bold,
    fontSize: 16,
    color: color.cream,
    letterSpacing: -0.2,
  },
  upNextMeta: {
    fontFamily: font.medium,
    fontSize: 12,
    color: color.creamDim,
    marginTop: 4,
  },
  upNextPlay: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: color.yellow,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // ─── Meals — editorial rows ───
  emptyMeals: {
    alignItems: 'center',
    paddingVertical: space.xxl,
    gap: 8,
    marginBottom: space.lg,
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
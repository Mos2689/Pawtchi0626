import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Svg, { Circle } from 'react-native-svg';

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

// Apple-Health-style concentric rings around pet photo
// Rings ARE the stats — calories (orange outer), activity (yellow mid), water (blue inner)

const RING_SIZE = 280;
const cx = RING_SIZE / 2;
const cy = RING_SIZE / 2;
const PHOTO_RADIUS = 82;

const RING_CONFIG = [
  { r: 130, color: '#f97316', stroke: 14 }, // outer - calories
  { r: 108, color: '#FFFC00', stroke: 13 }, // mid - move
  { r: 86,  color: '#3091F9', stroke: 12 }, // inner - hydrate
];

interface RingArcProps {
  r: number;
  color: string;
  strokeWidth: number;
  progress: number; // 0-1
}

function RingArc({ r, color, strokeWidth, progress }: RingArcProps) {
  const circumference = 2 * Math.PI * r;
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const filledLength = circumference * clampedProgress;

  return (
    <>
      {/* Track (background) */}
      <Circle
        cx={cx} cy={cy} r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeOpacity={0.18}
        fill="none"
      />
      {/* Progress arc */}
      <Circle
        cx={cx} cy={cy} r={r}
        stroke={color}
        strokeWidth={strokeWidth}
        fill="none"
        strokeLinecap="round"
        strokeDasharray={`${filledLength} ${circumference}`}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
    </>
  );
}

// Progress bar component for legend cards
function ProgressBar({ progress, color }: { progress: number; color: string }) {
  return (
    <View style={progressStyles.track}>
      <View style={[progressStyles.fill, { width: `${Math.min(progress * 100, 100)}%`, backgroundColor: color }]} />
    </View>
  );
}

const progressStyles = StyleSheet.create({
  track: {
    width: '100%',
    height: 4,
    backgroundColor: '#f1f5f9',
    borderRadius: 2,
    marginTop: 8,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 2,
  },
});

export default function HomeScreen() {
  const router = useRouter();
  const scrollY = React.useRef(new Animated.Value(0)).current;
  const insets = useSafeAreaInsets();
  const { activePet, isTailoring } = useActivePetStore();
  const { currentStreak, pawCoins, fetchStreak } = useStreakStore();
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
  const longestStreak = useStreakStore(s => s.longestStreak);

  useFocusEffect(useCallback(() => {
    if (activePet?.id) refreshToday(activePet.id);
  }, [activePet?.id, refreshToday]));

  useFocusEffect(useCallback(() => {
    if (user?.id) fetchStreak(user.id);
  }, [user?.id, fetchStreak]));

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
        {/* Nudge Card */}
        <NudgeCard />

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
                />
                {isTailoring && (
                  <View style={styles.tailoringOverlay}>
                    <ActivityIndicator size="large" color="#FFFC00" />
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

        {/* Legend Cards */}
        <View style={styles.legendRow}>
          {/* Calories */}
          <View style={styles.legendCard}>
            <View style={styles.legendHeader}>
              <View style={[styles.legendIcon, { backgroundColor: '#f97316' }]}>
                <MaterialIcons name="local-fire-department" size={10} color="#FFFFFF" />
              </View>
              <Text style={styles.legendLabel}>Calories</Text>
            </View>
            <View style={styles.legendValueRow}>
              <Text style={styles.legendValue}>
                {todayCalories > 0 ? todayCalories : '0'}
              </Text>
              <Text style={styles.legendSub}>/ {targetCal || 0} kcal</Text>
            </View>
            <ProgressBar progress={calorieProgress} color="#f97316" />
          </View>

          {/* Move */}
          <View style={styles.legendCard}>
            <View style={styles.legendHeader}>
              <View style={[styles.legendIcon, { backgroundColor: '#FFFC00' }]}>
                <MaterialIcons name="directions-walk" size={10} color="#1A1A1A" />
              </View>
              <Text style={styles.legendLabel}>Move</Text>
            </View>
            <View style={styles.legendValueRow}>
              <Text style={styles.legendValue}>
                {todayActivityMinutes > 0 ? todayActivityMinutes : '0'}
              </Text>
              <Text style={styles.legendSub}>/ 45 min</Text>
            </View>
            <ProgressBar progress={activityProgress} color="#FFFC00" />
          </View>

          {/* Hydrate */}
          <View style={styles.legendCard}>
            <View style={styles.legendHeader}>
              <View style={[styles.legendIcon, { backgroundColor: '#3091F9' }]}>
                <MaterialIcons name="water-drop" size={10} color="#FFFFFF" />
              </View>
              <Text style={styles.legendLabel}>Hydrate</Text>
            </View>
            <View style={styles.legendValueRow}>
              <Text style={styles.legendValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                {todayWater > 0 ? waterDisplay : '0'}
              </Text>
              <Text style={styles.legendSub} numberOfLines={1}>/ {waterTargetDisplay}</Text>
            </View>
            <ProgressBar progress={waterProgress} color="#3091F9" />
          </View>
        </View>

        {/* Macros Row */}
        <View style={styles.macrosRow}>
          <View style={styles.macroCard}>
            <View style={styles.macroLeft}>
              <View style={[styles.macroDot, { backgroundColor: '#ec4899' }]} />
              <Text style={styles.macroLabel}>Protein</Text>
            </View>
            <Text style={styles.macroValue}>{todayProtein}g</Text>
          </View>
          <View style={styles.macroCard}>
            <View style={styles.macroLeft}>
              <View style={[styles.macroDot, { backgroundColor: '#f97316' }]} />
              <Text style={styles.macroLabel}>Carbs</Text>
            </View>
            <Text style={styles.macroValue}>{todayCarbs}g</Text>
          </View>
          <View style={styles.macroCard}>
            <View style={styles.macroLeft}>
              <View style={[styles.macroDot, { backgroundColor: '#3091F9' }]} />
              <Text style={styles.macroLabel}>Fats</Text>
            </View>
            <Text style={styles.macroValue}>{todayFats}g</Text>
          </View>
        </View>

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
              <Text style={styles.streakNudgeTitle}>You had a {longestStreak}-day streak!</Text>
              <Text style={styles.streakNudgeSubtitle}>Log something today to start a new one!</Text>
            </View>
            <MaterialIcons name="chevron-right" size={20} color="#b45309" />
          </TouchableOpacity>
        )}

        {/* Suggested Activity */}
        {nextActivity && (
          <TouchableOpacity
            style={styles.suggestedCard}
            onPress={() => router.push('/(tabs)/activity')}
            activeOpacity={0.9}
          >
            <LinearGradient colors={['#0f172a', '#1e293b']} style={styles.suggestedGradient}>
              <View style={styles.suggestedTop}>
                <View style={styles.suggestedBadge}>
                  <MaterialIcons name="sports" size={11} color="#fac129" />
                  <Text style={styles.suggestedBadgeText}>Suggested</Text>
                </View>
                <Text style={styles.suggestedTime}>
                  {nextActivity.scheduled_time ? nextActivity.scheduled_time.slice(0, 5) : ''}
                </Text>
              </View>
              <View style={styles.suggestedBody}>
                <View style={styles.suggestedIconBg}>
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
                    color={nextActivity.activity_type === 'water' ? '#60a5fa' : '#FFFC00'}
                  />
                </View>
                <View style={styles.suggestedTextContainer}>
                  <Text style={styles.suggestedTitle}>{nextActivity.title}</Text>
                  <View style={styles.suggestedMeta}>
                    {nextActivity.duration_minutes && (
                      <View style={styles.suggestedMetaItem}>
                        <MaterialIcons name="timer" size={11} color="#94a3b8" />
                        <Text style={styles.suggestedMetaText}>{nextActivity.duration_minutes} min</Text>
                      </View>
                    )}
                    {nextActivity.intensity && (
                      <View style={styles.suggestedMetaItem}>
                        <MaterialIcons name="speed" size={11} color="#94a3b8" />
                        <Text style={styles.suggestedMetaText}>{nextActivity.intensity}</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.suggestedPlayBtn}>
                  <MaterialIcons name="play-arrow" size={18} color="#1A1A1A" />
                </View>
              </View>
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Primary CTA */}
        <PawtchiButton
          title="Log meal or activity"
          iconName="add"
          onPress={() => router.push('/(tabs)/meal')}
          style={{ marginBottom: 24 }}
        />

        {/* Today's Meals */}
        <View style={styles.mealsSection}>
          <View style={styles.mealsHeader}>
            <Text style={styles.mealsTitle}>Today&apos;s Meals</Text>
            <Text style={styles.mealsCount}>{todayScans.length} logged</Text>
          </View>

          {todayScans.length === 0 ? (
            <View style={styles.emptyMeals}>
              <MaterialIcons name="no-food" size={32} color="#d1d5db" />
              <Text style={styles.emptyMealsText}>No meals{"\n"}logged yet.</Text>
            </View>
          ) : (
            todayScans.slice(0, 3).map((scan) => {
              const time = new Date(scan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
              return (
                <TouchableOpacity
                  key={scan.id}
                  style={styles.mealCard}
                  onPress={() => router.push(`/scan/${scan.id}`)}
                  activeOpacity={0.9}
                >
                  <View style={styles.mealImageContainer}>
                    {scan.image_url ? (
                      <Image source={{ uri: scan.image_url }} style={styles.mealImage} />
                    ) : (
                      <View style={styles.mealImagePlaceholder}>
                        <MaterialIcons name="restaurant" size={24} color="#9ca3af" />
                      </View>
                    )}
                  </View>
                  <View style={styles.mealContent}>
                    <View style={styles.mealHeaderRow}>
                      <Text style={styles.mealTitle} numberOfLines={2}>{scan.ai_identified_food || 'Unidentified Food'}</Text>
                      <View style={styles.mealPill}>
                        <Text style={styles.mealPillText}>{scan.is_treat ? 'Treat' : 'Meal'}</Text>
                      </View>
                    </View>
                    <Text style={styles.mealDesc}>{scan.ai_estimated_calories} kcal</Text>
                    <View style={styles.mealMetaRow}>
                      <Text style={styles.mealTime}>{time}</Text>
                      <View style={styles.mealMacros}>
                        <View style={styles.mealMacroPill}>
                          <View style={[styles.mealMacroDot, { backgroundColor: '#ec4899' }]} />
                          <Text style={styles.mealMacroText}>P: {scan.protein_g}g</Text>
                        </View>
                        <View style={styles.mealMacroPill}>
                          <View style={[styles.mealMacroDot, { backgroundColor: '#f97316' }]} />
                          <Text style={styles.mealMacroText}>F: {scan.fat_g}g</Text>
                        </View>
                        <View style={styles.mealMacroPill}>
                          <View style={[styles.mealMacroDot, { backgroundColor: '#3091F9' }]} />
                          <Text style={styles.mealMacroText}>C: {scan.carbs_g}g</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })
          )}
        </View>

        {/* Invite a friend — quiet, pet-voiced. Sits at the bottom of the feed. */}
        <TouchableOpacity
          style={styles.inviteCard}
          onPress={() => router.push('/invite' as any)}
          activeOpacity={0.85}
        >
          <View style={styles.inviteIcon}>
            <MaterialIcons name="group-add" size={22} color="#1a1a00" />
          </View>
          <View style={styles.inviteContent}>
            <Text style={styles.inviteTitle}>A friend for {petName}</Text>
            <Text style={styles.inviteSub}>Pawtchi is better shared</Text>
          </View>
          <MaterialIcons name="chevron-right" size={24} color="#cbd5e1" />
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
    borderColor: '#FFFC00',
  },
  avatarMiniImg: {
    width: '100%',
    height: '100%',
  },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 20,
    letterSpacing: -0.5,
    color: '#041015',
  },
  headerDate: {
    fontFamily: 'Plus Jakarta Sans',
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
    backgroundColor: '#FFFC00',
    justifyContent: 'center',
    alignItems: 'center',
  },
  coinIconText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 11,
    color: '#041015',
  },
  coinText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 28,
    color: '#2e2f2d',
    marginTop: 16,
    marginBottom: 24,
    letterSpacing: -0.5,
  },
  greetingName: {
    fontWeight: '900',
    color: '#041015',
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
    color: '#FFFC00',
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
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 11,
  },

  // Legend Row
  legendRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 20,
  },
  legendCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
    minHeight: 100,
  },
  legendHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  legendIcon: {
    width: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
  },
  legendLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 9,
    color: '#94a3b8',
    letterSpacing: 0.5,
  },
  legendValueRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 2,
    marginBottom: 4,
    flexWrap: 'wrap',
  },
  legendValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 20,
    color: '#041015',
    letterSpacing: -0.5,
  },
  legendSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 10,
    color: '#94a3b8',
    flexShrink: 1,
  },

  // Macros Row
  macrosRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
  },
  macroCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  macroLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  macroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  macroLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    color: '#64748b',
  },
  macroValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 16,
    color: '#041015',
  },

  // Treat Banner
  inviteCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fffef5',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#f5f1c2',
    marginBottom: 16,
  },
  inviteIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFC00',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inviteContent: {
    flex: 1,
  },
  inviteTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 15,
    color: '#0f172a',
  },
  inviteSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 13,
    color: '#64748b',
    marginTop: 2,
  },
  treatBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 16,
  },
  treatBannerWarning: {
    borderColor: '#fca5a5',
    backgroundColor: '#fef2f2',
  },
  treatIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#f3f4f6',
    justifyContent: 'center',
    alignItems: 'center',
  },
  treatContent: {
    flex: 1,
  },
  treatTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 14,
    color: '#16a34a',
  },
  treatTitleWarning: {
    color: '#ef4444',
  },
  treatSubtitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 12,
    color: '#15803d',
    marginTop: 2,
  },
  treatSubtitleWarning: {
    color: '#ef4444',
  },

  // Streak Nudge
  streakNudge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#fef3c7',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: '#fde68a',
    marginBottom: 16,
  },
  streakNudgeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#fac129',
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakNudgeContent: {
    flex: 1,
  },
  streakNudgeTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 14,
    color: '#92400e',
  },
  streakNudgeSubtitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 12,
    color: '#b45309',
    marginTop: 2,
  },

  // Suggested Activity
  suggestedCard: {
    borderRadius: 22,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  suggestedGradient: {
    padding: 20,
  },
  suggestedTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  suggestedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(250,193,41,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 16,
  },
  suggestedBadgeText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 9,
    letterSpacing: 1,
    color: '#fac129',
  },
  suggestedTime: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    color: '#94a3b8',
  },
  suggestedBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  suggestedIconBg: {
    width: 50,
    height: 50,
    borderRadius: 16,
    backgroundColor: 'rgba(255,252,0,0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  suggestedTextContainer: {
    flex: 1,
  },
  suggestedTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 16,
    color: '#FFFFFF',
    marginBottom: 6,
  },
  suggestedMeta: {
    flexDirection: 'row',
    gap: 14,
  },
  suggestedMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  suggestedMetaText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 11,
    color: '#94a3b8',
  },
  suggestedPlayBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#FFFC00',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Primary CTA
  primaryBtn: {
    borderRadius: 32,
    overflow: 'hidden',
    marginBottom: 28,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 16,
    elevation: 6,
  },
  primaryBtnGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    gap: 10,
  },
  primaryBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 17,
    color: '#1A1A1A',
  },

  // Meals Section
  mealsSection: {
    marginBottom: 20,
  },
  mealsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  mealsTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 20,
    color: '#041015',
  },
  mealsCount: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    color: '#94a3b8',
  },
  emptyMeals: {
    alignItems: 'center',
    paddingVertical: 36,
    backgroundColor: '#f9fafb',
    borderRadius: 18,
    gap: 10,
  },
  emptyMealsText: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },
  mealCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 14,
    borderWidth: 1,
    borderColor: '#f1f5f9',
  },
  mealImageContainer: {
    width: '22%',
    aspectRatio: 1,
    backgroundColor: '#f3f4f6',
  },
  mealImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  mealImagePlaceholder: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  mealPill: {
    backgroundColor: '#FFFC00',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    marginLeft: 8,
  },
  mealPillText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 10,
    color: '#041015',
    textTransform: 'uppercase',
    letterSpacing: -0.2,
  },
  mealContent: {
    flex: 1,
    padding: 14,
    justifyContent: 'center',
  },
  mealHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 4,
  },
  mealTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 15,
    color: '#041015',
    flex: 1,
    marginRight: 8,
  },
  mealTime: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 11,
    color: '#94a3b8',
    marginRight: 8,
  },
  mealDesc: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 13,
    color: '#64748b',
    marginBottom: 8,
  },
  mealMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  mealMacros: {
    flexDirection: 'row',
    gap: 6,
  },
  mealMacroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f9fafb',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  mealMacroDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  mealMacroText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 10,
    color: '#64748b',
  },
});
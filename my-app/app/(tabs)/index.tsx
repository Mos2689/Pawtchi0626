import React, { useCallback } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ActivityIndicator, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons, Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import { usePushNotifications } from '../../hooks/usePushNotifications';
import CircularProgress from '../../components/CircularProgress';
import { LiquidFillCard } from '../../components/LiquidFillCard';
import { NudgeCard } from '../../components/NudgeCard';
import { TrialBanner } from '../../components/TrialBanner';
import { contextualizeCalories, contextualizeWater } from '../../lib/contextualizer';
import { Hotspot } from '../../components/walkthrough/Hotspot';

// Screen 8: Home Dashboard
export default function HomeScreen() {
  const router = useRouter();
  const scrollY = React.useRef(new Animated.Value(0)).current;

  const insets = useSafeAreaInsets();
  const { activePet, isTailoring } = useActivePetStore();
  const { currentStreak, longestStreak, pawCoins, fetchStreak } = useStreakStore();
  const { user } = useAuth();
  const { expoPushToken } = usePushNotifications();

  // Sync push token silently
  React.useEffect(() => {
    if (user?.id && expoPushToken) {
      supabase.from('push_tokens').upsert({
        user_id: user.id,
        token: expoPushToken
      }, { onConflict: 'token' }).then(({ error }) => {
        if (error) console.error("Failed to sync push token:", error.message);
      });
    }
  }, [user?.id, expoPushToken]);

  const todayCalories = usePetContextStore(s => s.todayCalories);
  const todayWater = usePetContextStore(s => s.todayWater);
  const todayScans = usePetContextStore(s => s.todayScans);
  const nextActivity = usePetContextStore(s => s.nextActivity);
  const calPercent = usePetContextStore(s => s.calPercent);
  const waterPercent = usePetContextStore(s => s.waterPercent);
  const caloriesRemaining = usePetContextStore(s => s.caloriesRemaining);
  const activityCompletionRate = usePetContextStore(s => s.activityCompletionRate);
  const todayActivityMinutes = usePetContextStore(s => s.todayActivityMinutes);
  const todayProtein = usePetContextStore(s => s.todayProtein);
  const todayCarbs = usePetContextStore(s => s.todayCarbs);
  const todayFats = usePetContextStore(s => s.todayFats);
  const treatBudget = usePetContextStore(s => s.treatBudget);
  const treatsConsumed = usePetContextStore(s => s.treatsConsumed);
  const treatCaloriesConsumed = usePetContextStore(s => s.treatCaloriesConsumed);
  const adjustedTarget = usePetContextStore(s => s.adjustedTarget);
  const adjustmentReason = usePetContextStore(s => s.adjustmentReason);
  const refreshToday = usePetContextStore(s => s.refreshToday);

  const isProfileComplete = !!(
    activePet?.gender &&
    activePet?.body_condition_score &&
    activePet?.allergies &&
    activePet?.diet_type &&
    activePet.diet_type.length > 0 &&
    activePet?.medical_conditions
  );

  const baseTargetCal = activePet?.target_daily_calories || 0;
  const targetCal = adjustedTarget || baseTargetCal; // dynamic target (may differ from base)
  const exercisePercent = activityCompletionRate; // 0–1 based on completed/total activities today

  useFocusEffect(
    useCallback(() => {
      if (activePet?.id) refreshToday(activePet.id);
    }, [activePet?.id, refreshToday])
  );

  // Refresh streak data when screen focuses
  useFocusEffect(
    useCallback(() => {
      if (user?.id) fetchStreak(user.id);
    }, [user?.id, fetchStreak])
  );

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>

      {/* Trial Countdown Banner */}
      <TrialBanner />

      {/* Dynamic Top Header */}
      <Animated.View style={[styles.header, {
        paddingTop: insets.top + 12, // Reduced padding
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        borderBottomWidth: 1,
        borderBottomColor: 'rgba(229, 231, 235, 0.5)', // Subtle shadow line
        opacity: scrollY.interpolate({
          inputRange: [50, 100],
          outputRange: [0, 1],
          extrapolate: 'clamp',
        }),
        transform: [{
          translateY: scrollY.interpolate({
            inputRange: [50, 100],
            outputRange: [-20, 0],
            extrapolate: 'clamp',
          })
        }]
      }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatarMini, { borderColor: '#e5e7eb' }]}>
            <Image
              source={{ uri: activePet?.current_avatar_url || activePet?.image_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=400' }}
              style={styles.avatarMiniImg}
            />
          </View>
          <Text style={[styles.headerTitle, { color: '#2e2f2d' }]}>PAWTCHI</Text>
          {/* DEV: Reset Pet Data Button */}
          <TouchableOpacity
            onPress={async () => {
              if (activePet?.id) {
                await supabase.from('pets').delete().eq('id', activePet.id);
                useActivePetStore.getState().clearPet();
                router.replace('/onboarding/species');
              }
            }}
            style={{ marginLeft: 8, padding: 4, backgroundColor: '#fee2e2', borderRadius: 8 }}
          >
            <MaterialIcons name="delete-outline" size={16} color="#ef4444" />
          </TouchableOpacity>
        </View>
        <View style={[styles.coinPill, { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }]}>
          <MaterialIcons name="generating-tokens" size={20} color="#fac129" />
          <Text style={[styles.coinText, { color: '#2e2f2d' }]}>{pawCoins.toLocaleString()} PawCoins</Text>
        </View>
      </Animated.View>

      <Animated.ScrollView
        contentContainerStyle={[styles.scrollContent, { paddingTop: insets.top + (activePet ? 60 : 20) }]}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: true }
        )}
        scrollEventThrottle={16}
      >

        {/* Contextual Nudge Card */}
        <NudgeCard
          isProfileComplete={isProfileComplete}
          onProfilePress={() => router.push('/medical')}
        />

        {/* Greeting Section */}
        <View style={styles.greetingSection}>
          <Text style={[styles.greetingTitle, { color: '#2e2f2d' }]}>
            {(() => {
              const hour = new Date().getHours();
              if (hour < 12) return 'Morning';
              if (hour < 17) return 'Afternoon';
              return 'Evening';
            })()}, <Text style={[styles.greetingTarget, { textDecorationColor: '#FFFC00' }]}>{activePet?.name || 'Buddy'}</Text>!
          </Text>
          <Text style={[styles.greetingSub, { color: '#5c5b5b' }]}>
            Ready for your {(() => {
              const hour = new Date().getHours();
              if (hour < 12) return 'morning golden-hour';
              if (hour < 17) return 'afternoon';
              return 'evening';
            })()} walk?
          </Text>
        </View>

        {/* Kinetic Dashboard Layout */}
        <View style={styles.avatarSection}>
          {/* Background Ambient Glow */}
          <View style={[styles.ambientGlow, { backgroundColor: activePet?.equipped_items?.includes('wearable_bg') ? '#f59e0b' : 'rgba(255,252,0,0.1)' }]} />

          {/* Main Avatar */}
          <View style={[styles.mainAvatarContainer, { shadowColor: '#000', shadowOffset: { width: 0, height: 40 }, shadowOpacity: 0.05, shadowRadius: 80, elevation: 12 }]}>
            <View style={[styles.avatarRing, { borderColor: '#FFFC00' }]}>
              <Image
                source={{ uri: activePet?.current_avatar_url || activePet?.image_url || 'https://images.unsplash.com/photo-1583337130417-3346a1be7dee?q=80&w=1000&auto=format&fit=crop' }}
                style={styles.mainAvatarImg}
              />

              {/* Tailoring Loading State overlay */}
              {isTailoring && (
                <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' }]}>
                  <ActivityIndicator size="large" color="#FFFC00" />
                  <Text style={{ color: '#FFFC00', fontWeight: 'bold', marginTop: 8, fontSize: 12, letterSpacing: 1 }}>
                    TAILORING...
                  </Text>
                </View>
              )}
            </View>

            {/* Streak Ring Badge */}
            <View style={[styles.statusBadge, { backgroundColor: '#FFFFFF', borderWidth: 2, borderColor: currentStreak >= 7 ? '#ef4444' : currentStreak >= 3 ? '#f97316' : '#e5e7eb' }]}>
              <CircularProgress
                size={40}
                strokeWidth={4}
                progress={Math.min(currentStreak / 7, 1)}
                color={currentStreak >= 7 ? '#ef4444' : currentStreak >= 3 ? '#f97316' : '#d1d5db'}
                trackColor={currentStreak >= 1 ? '#fef2f2' : '#f3f4f6'}
              >
                <MaterialIcons
                  name="local-fire-department"
                  size={16}
                  color={currentStreak >= 7 ? '#ef4444' : currentStreak >= 3 ? '#f97316' : '#9ca3af'}
                />
              </CircularProgress>
              <Text style={[styles.statusBadgeText, { color: currentStreak >= 7 ? '#dc2626' : currentStreak >= 3 ? '#ea580c' : '#6b7280', fontSize: 10 }]}>
                {currentStreak > 0 ? `${currentStreak}D` : '0D'}
              </Text>
            </View>
          </View>
        </View>
        
        {/* True Masonry Bento Grid */}
        <View style={{ flexDirection: 'row', paddingHorizontal: 20, gap: 16, marginBottom: 16 }}>
          {/* Left Column: Nutrition Bento */}
          <Hotspot 
            stepKey="home_calories" 
            title="Nutrition Dashboard" 
            description="Track your pet's daily calorie intake here. Overfeeding or underfeeding warnings will flag automatically!" 
            style={{ flex: 1.15 }}
          >
            <View style={[styles.nutritionBento, { marginHorizontal: 0, marginTop: 0, marginBottom: 0 }]}>
            <View style={{ position: 'relative' }}>
              <View style={[styles.caloriesFlareContainer, { position: 'absolute', right: 0, top: 0 }]}>
                <LinearGradient
                  colors={['#FFFC00', '#fac129']}
                  style={styles.caloriesFlare}
                />
              </View>

              <View style={{ marginBottom: 4, zIndex: 10 }}>
                <Text style={[styles.caloriesLabel, { color: '#5b5c5a' }]}>CALORIES</Text>
              </View>

              <View style={{ marginTop: -4 }}>
                <Text style={[styles.caloriesValue, { color: '#2e2f2d' }]}>{todayCalories}</Text>
                <Text style={[styles.caloriesSub, { color: '#5b5c5a', fontSize: 12, marginTop: -2 }]}>/ {targetCal} kcal</Text>
              </View>
              {todayCalories > 0 && (
                <Text style={[styles.caloriesSub, { color: '#94a3b8', fontSize: 11, marginTop: 6 }]}>
                  {contextualizeCalories(todayCalories)}
                </Text>
              )}
              {adjustmentReason && (
                <Text style={[styles.caloriesSub, {
                  fontSize: 10,
                  marginTop: 3,
                  color: adjustmentReason.includes('Trending up') || adjustmentReason.includes('dipping') ? '#f59e0b' : '#16a34a',
                  fontWeight: '600',
                }]}>
                  {adjustmentReason}
                </Text>
              )}
              {targetCal > 0 && (
                <View style={[styles.progressBarBg, { marginTop: 12 }]}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(calPercent, 100)}%`, backgroundColor: calPercent > 90 ? '#ef4444' : '#FFFC00' }]} />
                </View>
              )}
            </View>

            <View style={{ height: 1, backgroundColor: '#e5e7eb', marginVertical: 14 }} />

            <View style={[styles.nutritionMacroRow, { flexDirection: 'column', alignItems: 'flex-start', gap: 12, paddingTop: 0 }]}>
              <View style={[styles.nutritionMacroItem, { flexDirection: 'row', width: '100%', justifyContent: 'space-between' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.nutritionMacroDot, { backgroundColor: '#ef4444', marginBottom: 0 }]} />
                  <Text style={styles.nutritionMacroLabel}>Protein</Text>
                </View>
                <Text style={styles.nutritionMacroVal}>{todayProtein}<Text style={styles.nutritionMacroUnit}>g</Text></Text>
              </View>
              <View style={[styles.nutritionMacroItem, { flexDirection: 'row', width: '100%', justifyContent: 'space-between' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.nutritionMacroDot, { backgroundColor: '#f59e0b', marginBottom: 0 }]} />
                  <Text style={styles.nutritionMacroLabel}>Carbs</Text>
                </View>
                <Text style={styles.nutritionMacroVal}>{todayCarbs}<Text style={styles.nutritionMacroUnit}>g</Text></Text>
              </View>
              <View style={[styles.nutritionMacroItem, { flexDirection: 'row', width: '100%', justifyContent: 'space-between' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <View style={[styles.nutritionMacroDot, { backgroundColor: '#3091F9', marginBottom: 0 }]} />
                  <Text style={styles.nutritionMacroLabel}>Fats</Text>
                </View>
                <Text style={styles.nutritionMacroVal}>{todayFats}<Text style={styles.nutritionMacroUnit}>g</Text></Text>
              </View>
            </View>
          </View>
          </Hotspot>

          {/* Right Column: Square Ring Cards */}
          <View style={{ flex: 1, gap: 16 }}>
            {/* Exercise Fill Card */}
            {/* Exercise Fill Card */}
            <Hotspot 
              stepKey="home_exercise" 
              title="Daily Activity" 
              description="Monitor active minutes and steps here. Closing this ring means a healthy pet!"
              style={{ flex: 1 }}
              position="top-right"
            >
              <LiquidFillCard
                progress={exercisePercent}
                fillColor="#FFFC00"
                backgroundColor="#f1f5f9"
              >
                <View style={{ backgroundColor: 'rgba(255,255,255,0.7)', padding: 12, borderRadius: 30 }}>
                  <MaterialIcons name="directions-run" size={24} color="#2e2f2d" />
                </View>
                <Text style={[styles.ringLabel, { color: '#2e2f2d', marginTop: 12, fontWeight: '800' }]}>{todayActivityMinutes > 0 ? `${todayActivityMinutes} MIN` : 'EXERCISE'}</Text>
              </LiquidFillCard>
            </Hotspot>

            {/* Water Fill Card */}
            <LiquidFillCard
              progress={waterPercent}
              fillColor="#3091F9"
              backgroundColor="#f1f5f9"
            >
              <View style={{ backgroundColor: 'rgba(255,255,255,0.7)', padding: 12, borderRadius: 30 }}>
                <MaterialIcons name="water-drop" size={24} color={waterPercent > 0.5 ? '#1e40af' : '#3091F9'} />
              </View>
              <Text style={[styles.ringLabel, { color: waterPercent > 0.5 ? '#ffffff' : '#2e2f2d', marginTop: 12, fontWeight: '800' }]}>{todayWater > 0 ? `${todayWater}ml` : 'WATER'}</Text>
              {todayWater > 0 && activePet?.current_weight_kg && (
                <Text style={[styles.ringLabel, { color: waterPercent > 0.5 ? 'rgba(255,255,255,0.8)' : '#64748b', fontSize: 10, marginTop: 2 }]}>
                  {contextualizeWater(todayWater, activePet.current_weight_kg)}
                </Text>
              )}
            </LiquidFillCard>
          </View>
        </View>

        {/* Full-width Treat Banner */}
        {targetCal > 0 && (() => {
          const overLimit = caloriesRemaining < 0;
          const treatBudgetLeft = Math.max(0, treatBudget - treatCaloriesConsumed);
          const treatWarning = overLimit || treatBudgetLeft === 0;
          return (
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/meal')}
              activeOpacity={0.8}
              style={{
                marginHorizontal: 20,
                marginBottom: 16,
                backgroundColor: treatWarning ? '#fef2f2' : '#f0fdf4',
                borderRadius: 20,
                padding: 16,
                flexDirection: 'row', alignItems: 'center', gap: 12,
                borderWidth: 1, borderColor: treatWarning ? '#fecaca' : '#bbf7d0',
                shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
              }}
            >
              <Text style={{ fontSize: 24 }}>{treatWarning ? '⚠️' : '🦴'}</Text>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: treatWarning ? '#dc2626' : '#16a34a' }}>
                  {overLimit ? 'Treat limit reached' : treatsConsumed > 0 ? `${treatsConsumed} treat${treatsConsumed !== 1 ? 's' : ''} enjoyed` : 'Treat budget'}
                </Text>
                <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '500', fontSize: 11, color: treatWarning ? '#ef4444' : '#86efac', marginTop: 2 }}>
                  {overLimit ? `${Math.abs(caloriesRemaining)} kcal over daily budget` : `${treatBudgetLeft} kcal left for treats`}
                </Text>
              </View>
              <MaterialIcons name="chevron-right" size={20} color={treatWarning ? '#fca5a5' : '#86efac'} />
            </TouchableOpacity>
          );
        })()}

        {/* Streak Break Encouragement — Loss Aversion Nudge */}
        {currentStreak === 0 && longestStreak > 0 && (
          <TouchableOpacity
            style={{
              marginHorizontal: 20, marginTop: 16,
              backgroundColor: '#fef3c7', borderRadius: 20,
              padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16,
              borderWidth: 1, borderColor: '#fde68a',
            }}
            onPress={() => router.push('/(tabs)/meal')}
            activeOpacity={0.85}
          >
            <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: '#fac129', justifyContent: 'center', alignItems: 'center' }}>
              <MaterialIcons name="replay" size={28} color="#553e00" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 15, color: '#92400e', marginBottom: 4 }}>
                You had a {longestStreak}-day streak! 💪
              </Text>
              <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '500', fontSize: 13, color: '#b45309' }}>
                Log something today to start a new one!
              </Text>
            </View>
            <MaterialIcons name="chevron-right" size={24} color="#b45309" />
          </TouchableOpacity>
        )}

        {/* Suggested for Today Widget */}
        {nextActivity && (
          <TouchableOpacity
            style={styles.suggestedCard}
            onPress={() => router.push('/(tabs)/activity')}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={['#0f172a', '#1e293b']}
              style={styles.suggestedGradient}
            >
              <View style={styles.suggestedTop}>
                <View style={styles.suggestedBadge}>
                  <MaterialIcons name="auto-awesome" size={14} color="#fac129" />
                  <Text style={styles.suggestedBadgeText}>SUGGESTED FOR TODAY</Text>
                </View>
                <Text style={styles.suggestedTime}>
                  {nextActivity.scheduled_time ? nextActivity.scheduled_time.slice(0, 5) : ''}
                </Text>
              </View>
              <View style={styles.suggestedBody}>
                <View style={[styles.suggestedIconBg, {
                  backgroundColor: nextActivity.activity_type === 'walk' ? 'rgba(255,252,0,0.15)'
                    : nextActivity.activity_type === 'play' ? 'rgba(254,248,195,0.2)'
                      : nextActivity.activity_type === 'water' ? 'rgba(59,130,246,0.15)'
                        : 'rgba(255,255,255,0.1)'
                }]}>
                  <MaterialIcons
                    name={
                      nextActivity.activity_type === 'walk' ? 'directions-walk'
                        : nextActivity.activity_type === 'play' ? 'sports-baseball'
                          : nextActivity.activity_type === 'water' ? 'water-drop'
                            : nextActivity.activity_type === 'training' ? 'school'
                              : nextActivity.activity_type === 'grooming' ? 'content-cut'
                                : 'star'
                    }
                    size={28}
                    color={nextActivity.activity_type === 'water' ? '#60a5fa' : '#FFFC00'}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.suggestedTitle}>{nextActivity.title}</Text>
                  <View style={styles.suggestedMeta}>
                    {!!nextActivity.duration_minutes && (
                      <View style={styles.suggestedMetaItem}>
                        <MaterialIcons name="timer" size={14} color="#94a3b8" />
                        <Text style={styles.suggestedMetaText}>{nextActivity.duration_minutes} min</Text>
                      </View>
                    )}
                    {!!nextActivity.intensity && (
                      <View style={styles.suggestedMetaItem}>
                        <MaterialIcons name="speed" size={14} color="#94a3b8" />
                        <Text style={styles.suggestedMetaText}>{nextActivity.intensity}</Text>
                      </View>
                    )}
                    {!!nextActivity.distance_km && (
                      <View style={styles.suggestedMetaItem}>
                        <MaterialIcons name="straighten" size={14} color="#94a3b8" />
                        <Text style={styles.suggestedMetaText}>{nextActivity.distance_km} km</Text>
                      </View>
                    )}
                  </View>
                </View>
                <View style={styles.suggestedStartBtn}>
                  <MaterialIcons name="play-arrow" size={24} color="#1A1A1A" />
                </View>
              </View>
              {!!nextActivity.notes && (
                <Text style={styles.suggestedNote} numberOfLines={1}>{nextActivity.notes}</Text>
              )}
            </LinearGradient>
          </TouchableOpacity>
        )}

        {/* Primary Action */}
        <Hotspot 
          stepKey="log_action" 
          title="Log Your First Meal" 
          description="Everything your pet eats should go here. It will automatically update the calories tracking!"
          style={{ marginHorizontal: 20 }}
          position="top-right"
        >
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: isProfileComplete ? '#FFFC00' : '#e5e7eb', marginHorizontal: 0 }]}
            onPress={() => {
              if (!isProfileComplete) {
                router.push('/medical');
              } else {
                router.push('/(tabs)/meal');
              }
            }}
            activeOpacity={0.9}
          >
            <Ionicons name="add" size={24} color={isProfileComplete ? '#1A1A1A' : '#9ca3af'} />
            <Text style={[styles.primaryBtnText, { color: isProfileComplete ? '#1A1A1A' : '#9ca3af' }]}>
              {isProfileComplete ? 'Log Meal or Activity' : 'Complete Profile First'}
            </Text>
          </TouchableOpacity>
        </Hotspot>

        {/* Today's Food Log — LIVE */}
        <View style={styles.checklistSection}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={[styles.checklistTitle, { color: '#2e2f2d', marginBottom: 0 }]}>Today&apos;s Meals</Text>
            <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#94a3b8' }}>{todayScans.length} logged</Text>
          </View>
          <View style={{ paddingHorizontal: 24, paddingBottom: 24, gap: 24 }}>
            {todayScans.length === 0 ? (
              <View style={[styles.taskCard, { width: '100%', backgroundColor: '#f9fafb', borderColor: '#e5e7eb', flexDirection: 'column', paddingVertical: 40 }]}>
                <View style={{ alignItems: 'center', gap: 12, width: '100%' }}>
                  <MaterialIcons name="no-food" size={40} color="#d1d5db" />
                  <Text style={[styles.taskSub, { color: '#94a3b8', textAlign: 'center', fontSize: 13 }]}>No meals{"\n"}logged yet.</Text>
                </View>
              </View>
            ) : (
              todayScans.map((scan) => {
                const time = new Date(scan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <TouchableOpacity
                    key={scan.id}
                    activeOpacity={0.9}
                    onPress={() => router.push(`/scan/${scan.id}`)}
                    style={styles.feedCard}
                  >
                    <View style={styles.feedImageContainer}>
                      {scan.image_url ? (
                        <Image source={{ uri: scan.image_url }} style={styles.feedImage} />
                      ) : (
                        <View style={{ flex: 1, backgroundColor: '#e5e7eb', justifyContent: 'center', alignItems: 'center' }}>
                          <MaterialIcons name="restaurant" size={48} color="#9ca3af" />
                        </View>
                      )}
                      <View style={styles.feedMealPill}>
                        <Text style={styles.feedMealPillText}>{scan.is_treat ? 'Treat' : 'Meal'}</Text>
                      </View>
                    </View>
                    <View style={styles.feedContent}>
                      <View style={styles.feedHeaderRow}>
                        <Text style={styles.feedTitle} numberOfLines={2}>{scan.ai_identified_food || 'Unidentified Food'}</Text>
                        <Text style={styles.feedTime}>{time}</Text>
                      </View>
                      <Text style={styles.feedDesc} numberOfLines={2}>{scan.ai_estimated_calories} kcal • Extracted from {scan.is_user_confirmed ? 'verified log' : 'camera scan.'}</Text>
                      <View style={styles.feedMacroContainer}>
                        <View style={styles.feedMacroPill}>
                          <View style={[styles.feedMacroDot, { backgroundColor: '#ef4444' }]} />
                          <Text style={styles.feedMacroText}>PRO: {scan.protein_g}g</Text>
                        </View>
                        <View style={styles.feedMacroPill}>
                          <View style={[styles.feedMacroDot, { backgroundColor: '#f59e0b' }]} />
                          <Text style={styles.feedMacroText}>FAT: {scan.fat_g}g</Text>
                        </View>
                        <View style={styles.feedMacroPill}>
                          <View style={[styles.feedMacroDot, { backgroundColor: '#3b82f6' }]} />
                          <Text style={styles.feedMacroText}>CARB: {scan.carbs_g}g</Text>
                        </View>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>

      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingBottom: 16,
    backgroundColor: 'rgba(255,255,255,0.8)',
    zIndex: 50,
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
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f9fafb',
  },
  avatarMiniImg: {
    width: '100%',
    height: '100%',
  },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontStyle: 'italic',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  coinPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  coinText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 100, // accommodate tab bar
  },
  greetingSection: {
    marginBottom: 48,
  },
  greetingTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 48,
    lineHeight: 56,
    letterSpacing: -1,
  },
  greetingTarget: {
    textDecorationLine: 'underline',
  },
  greetingSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 18,
    marginTop: 8,
  },
  avatarSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    marginBottom: 24,
    position: 'relative',
  },
  ambientGlow: {
    position: 'absolute',
    width: 256,
    height: 256,
    borderRadius: 128,
  },
  mainAvatarContainer: {
    width: 288,
    height: 288,
    backgroundColor: '#FFFFFF',
    borderRadius: 144,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    zIndex: 10,
  },
  avatarRing: {
    width: '100%',
    height: '100%',
    borderRadius: 144,
    overflow: 'hidden',
    borderWidth: 8,
  },
  mainAvatarImg: {
    width: '100%',
    height: '100%',
  },
  statusBadge: {
    position: 'absolute',
    bottom: -8,
    right: 32,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  statusBadgeText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
  },
  ringCardBase: {
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    justifyContent: 'center',
  },

  floatingRingRight: {
    position: 'absolute',
    top: 16,
    right: 0,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 20,
  },
  floatingRingLeft: {
    position: 'absolute',
    bottom: 16,
    left: 0,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderRadius: 16,
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
    zIndex: 20,
  },
  ringContainer: {
    width: 64,
    height: 64,
    justifyContent: 'center',
    alignItems: 'center',
  },
  ringBase: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 6,
  },
  ringProgress: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 6,
  },
  ringIcon: {
    position: 'absolute',
  },
  ringLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 10,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  bentoGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 12,
  },
  treatPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
    marginBottom: 16,
  },
  treatPillText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 13,
  },
  caloriesCard: {
    flex: 1,
    aspectRatio: 1,
    padding: 24,
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  caloriesLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  caloriesValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 32,
    marginTop: 8,
  },
  caloriesSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 14,
    opacity: 0.7,
  },
  caloriesFlareContainer: {
    position: 'absolute',
    right: -24,
    bottom: -24,
    opacity: 0.1,
  },
  caloriesFlare: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  caloriesIcon: {
    position: 'absolute',
    bottom: 16,
    right: 16,
  },
  rewardCard: {
    flex: 1,
    aspectRatio: 1,
    padding: 24,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 10,
  },
  rewardValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 20,
    textAlign: 'center',
    lineHeight: 24,
  },
  rewardSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
    letterSpacing: -0.5,
    marginTop: 8,
    textTransform: 'uppercase',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
    paddingVertical: 24,
    borderRadius: 40,
    gap: 16,
    shadowColor: '#FFFC00',
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.3,
    shadowRadius: 40,
    elevation: 8,
    marginBottom: 32,
  },
  primaryBtnText: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 20,
  },
  checklistSection: {
    marginBottom: 16,
  },
  checklistTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 24,
    marginBottom: 24,
  },
  checklistItemContainer: {
    gap: 16,
  },
  taskCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 20,
    borderRadius: 16,
    borderWidth: 1,
  },
  taskCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  taskIconBg: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  taskTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 16,
  },
  taskSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
  },
  uncheckCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  progressBarBg: {
    width: '100%',
    height: 6,
    backgroundColor: '#e5e7eb',
    borderRadius: 3,
    marginTop: 10,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  // Suggested for Today Widget
  suggestedCard: {
    marginBottom: 32, borderRadius: 24, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15, shadowRadius: 24, elevation: 8,
  },
  suggestedGradient: {
    padding: 24, borderRadius: 24,
  },
  suggestedTop: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20,
  },
  suggestedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(250,193,41,0.12)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20,
  },
  suggestedBadgeText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 11, letterSpacing: 1.5, color: '#fac129',
  },
  suggestedTime: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#94a3b8',
  },
  suggestedBody: {
    flexDirection: 'row', alignItems: 'center', gap: 16,
  },
  suggestedIconBg: {
    width: 56, height: 56, borderRadius: 20, justifyContent: 'center', alignItems: 'center',
  },
  suggestedTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 18, color: '#FFFFFF', marginBottom: 6,
  },
  suggestedMeta: {
    flexDirection: 'row', gap: 16,
  },
  suggestedMetaItem: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
  },
  suggestedMetaText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 12, color: '#94a3b8',
  },
  suggestedStartBtn: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: '#FFFC00',
    justifyContent: 'center', alignItems: 'center',
  },
  suggestedNote: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 13, color: '#64748b', marginTop: 16,
    fontStyle: 'italic',
  },
  macroRow: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 20,
    marginTop: 16,
  },
  macroCard: {
    flex: 1,
    backgroundColor: '#f9fafb',
    borderRadius: 20,
    padding: 16,
    alignItems: 'center',
    borderWidth: 1.5,
  },
  macroValue: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 22,
    color: '#2e2f2d',
    marginBottom: 4,
  },
  macroUnit: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 14,
    color: '#94a3b8',
  },
  macroLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 12,
    color: '#5c5b5b',
    marginBottom: 8,
  },
  macroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  nutritionBento: {
    marginHorizontal: 20,
    marginTop: 16,
    marginBottom: 16,
    backgroundColor: '#f9fafb',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    padding: 20,
    overflow: 'hidden',
  },
  nutritionCalRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    position: 'relative',
  },
  nutritionMacroRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingTop: 12,
  },
  nutritionMacroItem: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  nutritionMacroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  nutritionMacroVal: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 20,
    color: '#2e2f2d',
  },
  nutritionMacroUnit: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 13,
    color: '#94a3b8',
  },
  nutritionMacroLabel: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 11,
    color: '#5c5b5b',
    letterSpacing: 0.5,
  },
  nutritionMacroDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#e5e7eb',
  },
  streakCard: {
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  streakIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.06)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  streakTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 17,
    marginBottom: 2,
  },
  streakSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 12,
    letterSpacing: 0.5,
  },
  feedCard: {
    backgroundColor: '#041015',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 8,
  },
  feedImageContainer: {
    width: '100%',
    height: 192,
    position: 'relative',
    backgroundColor: '#333333',
  },
  feedImage: {
    width: '100%',
    height: '100%',
    resizeMode: 'cover',
  },
  feedMealPill: {
    position: 'absolute',
    top: 16,
    left: 16,
    backgroundColor: '#FFFC00',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  feedMealPillText: {
    color: '#041015',
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '900',
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: -0.2,
  },
  feedContent: {
    padding: 24,
  },
  feedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 8,
  },
  feedTitle: {
    color: '#FFFFFF',
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 20,
    flex: 1,
    marginRight: 16,
  },
  feedTime: {
    color: 'rgba(255,255,255,0.4)',
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '600',
    fontSize: 14,
  },
  feedDesc: {
    color: 'rgba(255,255,255,0.6)',
    fontFamily: 'Plus Jakarta Sans',
    fontSize: 14,
    marginBottom: 20,
    lineHeight: 20,
  },
  feedMacroContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  feedMacroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 8,
  },
  feedMacroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  feedMacroText: {
    color: '#FFFFFF',
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 12,
  },
});

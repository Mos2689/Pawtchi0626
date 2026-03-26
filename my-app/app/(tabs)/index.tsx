import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { useAuth } from '../../providers/AuthProvider';
import { supabase } from '../../lib/supabase';
import CircularProgress from '../../components/CircularProgress';

interface FoodScan {
  id: string;
  ai_identified_food: string;
  ai_estimated_calories: number;
  ai_confidence_score: number;
  created_at: string;
}

// Screen 8: Home Dashboard
export default function HomeScreen() {
  const router = useRouter();

  const insets = useSafeAreaInsets();
  const { activePet, isTailoring } = useActivePetStore();
  const { currentStreak, longestStreak, pawCoins, fetchStreak } = useStreakStore();
  const { user } = useAuth();

  const [todayCalories, setTodayCalories] = useState(0);
  const [todayWater, setTodayWater] = useState(0);
  const [todayWalks, setTodayWalks] = useState(0);
  const [todayScans, setTodayScans] = useState<FoodScan[]>([]);
  const [nextActivity, setNextActivity] = useState<any>(null);

  const isProfileComplete = !!(
    activePet?.body_condition_score && 
    activePet?.diet_type && 
    activePet.diet_type.length > 0
  );

  const targetCal = activePet?.target_daily_calories || 0;
  const calPercent = targetCal > 0 ? Math.min(Math.round((todayCalories / targetCal) * 100), 100) : 0;

  // Real targets dynamically calculated
  const targetWater = (activePet?.current_weight_kg || 15) * 50; 
  const waterPercent = targetWater > 0 ? Math.min(todayWater / targetWater, 1) : 0;
  
  const targetWalks = 2; // Default to 2 walks a day
  const walksPercent = targetWalks > 0 ? Math.min(todayWalks / targetWalks, 1) : 0;

  useFocusEffect(
    useCallback(() => {
      if (!activePet?.id) return;
      const getLocalYMD = (d: Date) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      };
      const today = getLocalYMD(new Date());

      // Fetch today's calorie total
      supabase
        .from('daily_logs')
        .select('*')
        .eq('pet_id', activePet.id)
        .eq('log_date', today)
        .single()
        .then(({ data }) => {
          setTodayCalories(data?.calories_consumed || 0);
          setTodayWater(data?.water_ml || 0);
          setTodayWalks(data?.walks_count || 0);
        });

      // Fetch today's food scans
      supabase
        .from('food_scans')
        .select('*')
        .eq('pet_id', activePet.id)
        .gte('created_at', `${today}T00:00:00`)
        .order('created_at', { ascending: false })
        .limit(5)
        .then(({ data }) => {
          setTodayScans((data as FoodScan[]) || []);
        });

      // Fetch the next pending activity for today
      supabase
        .from('activities')
        .select('*')
        .eq('pet_id', activePet.id)
        .eq('scheduled_date', today)
        .eq('status', 'pending')
        .order('scheduled_time', { ascending: true })
        .limit(1)
        .single()
        .then(({ data }) => {
          setNextActivity(data || null);
        });
    }, [activePet?.id])
  );

  // Refresh streak data when screen focuses
  useFocusEffect(
    useCallback(() => {
      if (user?.id) fetchStreak(user.id);
    }, [user?.id, fetchStreak])
  );

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>
      
      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
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
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        
        {/* Nudge if incomplete */}
        {!isProfileComplete && (
          <TouchableOpacity 
            style={[styles.premiumNudge, { marginBottom: 32 }]}
            onPress={() => router.push('/medical')}
            activeOpacity={0.9}
          >
            <LinearGradient
              colors={['#0f172a', '#1e293b']}
              style={styles.nudgeGradient}
            >
              <View style={styles.nudgeLeft}>
                <MaterialIcons name="health-and-safety" size={32} color="#FFFC00" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.nudgeTitle}>Clinical Profile Setup</Text>
                  <Text style={styles.nudgeSub}>Gemini AI needs this data to start.</Text>
                </View>
              </View>
              <MaterialIcons name="arrow-forward-ios" size={16} color="#94a3b8" />
            </LinearGradient>
          </TouchableOpacity>
        )}

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
            
            {/* Status Badge */}
            <View style={[styles.statusBadge, { backgroundColor: '#fac129' }]}>
               <MaterialIcons name="bolt" size={18} color="#3d2b00" />
               <Text style={[styles.statusBadgeText, { color: '#3d2b00' }]}>
                 {activePet?.activity_level ? activePet.activity_level.toUpperCase().replace('_', ' ') : 'ENERGETIC'}
               </Text>
            </View>
          </View>

          {/* Floating Progress Rings */}
          {/* Exercise Ring */}
          <View style={[styles.floatingRingRight, { borderColor: '#e5e7eb', backgroundColor: '#FFFFFF' }]}>
             <CircularProgress
               size={64}
               strokeWidth={6}
               progress={walksPercent}
               color="#FFFC00"
               trackColor="#f3f4f6"
             >
               <MaterialIcons name="directions-run" size={24} color="#2e2f2d" />
             </CircularProgress>
             <Text style={[styles.ringLabel, { color: '#5c5b5b', marginTop: 4 }]}>{todayWalks > 0 ? `${todayWalks} WALKS` : 'EXERCISE'}</Text>
          </View>
          
          {/* Water Ring */}
          <View style={[styles.floatingRingLeft, { borderColor: '#e5e7eb', backgroundColor: '#FFFFFF' }]}>
             <CircularProgress
               size={64}
               strokeWidth={6}
               progress={waterPercent}
               color="#3091F9"
               trackColor="#f3f4f6"
             >
               <MaterialIcons name="water-drop" size={24} color="#3091F9" />
             </CircularProgress>
             <Text style={[styles.ringLabel, { color: '#5c5b5b', marginTop: 4 }]}>{todayWater > 0 ? `${todayWater}ml` : 'WATER'}</Text>
          </View>

        </View>

        {/* Bento Grid Stats */}
        <View style={styles.bentoGrid}>
          {/* Calories Card — LIVE */}
          <View style={[styles.caloriesCard, { backgroundColor: '#f9fafb', borderColor: '#e5e7eb' }]}>
            <View>
              <Text style={[styles.caloriesLabel, { color: '#5b5c5a' }]}>CALORIES</Text>
              <Text style={[styles.caloriesValue, { color: '#2e2f2d' }]}>{todayCalories}</Text>
              <Text style={[styles.caloriesSub, { color: '#5b5c5a' }]}>/ {targetCal} kcal</Text>
              {targetCal > 0 && (
                <View style={styles.progressBarBg}>
                  <View style={[styles.progressBarFill, { width: `${calPercent}%`, backgroundColor: calPercent > 90 ? '#ef4444' : '#FFFC00' }]} />
                </View>
              )}
            </View>
            <View style={styles.caloriesFlareContainer}>
               <LinearGradient
                 colors={['#FFFC00', '#fac129']}
                 style={styles.caloriesFlare}
               />
            </View>
            <MaterialIcons name="restaurant" size={36} color="rgba(91,92,90,0.2)" style={styles.caloriesIcon} />
          </View>
          
          {/* Reward Card — Live Streak */}
          <View style={[styles.rewardCard, { backgroundColor: currentStreak >= 7 ? '#fac129' : currentStreak >= 3 ? '#fef3c7' : '#f3f4f6' }]}>
            <MaterialIcons 
              name={currentStreak >= 7 ? 'local-fire-department' : currentStreak >= 3 ? 'workspace-premium' : 'emoji-events'} 
              size={48} 
              color={currentStreak >= 7 ? '#553e00' : currentStreak >= 3 ? '#92400e' : '#6b7280'} 
              style={{ marginBottom: 16 }} 
            />
            <Text style={[styles.rewardValue, { color: currentStreak >= 3 ? '#553e00' : '#374151' }]}>
              {currentStreak > 0 ? `${currentStreak} Day Streak!` : 'Start a Streak!'}
            </Text>
            <Text style={[styles.rewardSub, { color: currentStreak >= 3 ? 'rgba(85,62,0,0.7)' : '#9ca3af' }]}>
              {currentStreak >= 30 ? 'LEGENDARY 🏆' : currentStreak >= 14 ? 'UNSTOPPABLE 🔥🔥🔥' : currentStreak >= 7 ? 'ON FIRE 🔥🔥' : currentStreak >= 3 ? 'BUILDING MOMENTUM 🔥' : 'LOG DAILY TO BUILD'}
            </Text>
          </View>
        </View>

        {/* Streak Break Encouragement — Loss Aversion Nudge */}
        {currentStreak === 0 && longestStreak > 0 && (
          <TouchableOpacity 
            style={{
              marginHorizontal: 20, marginTop: 16,
              backgroundColor: '#fef3c7', borderRadius: 20,
              padding: 20, flexDirection: 'row', alignItems: 'center', gap: 16,
              borderWidth: 1, borderColor: '#fde68a',
            }}
            onPress={() => router.push('/(tabs)/log')}
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
        <TouchableOpacity 
          style={[styles.primaryBtn, { backgroundColor: isProfileComplete ? '#FFFC00' : '#e5e7eb' }]}
          onPress={() => {
            if (!isProfileComplete) {
              router.push('/medical');
            } else {
              router.push('/(tabs)/log');
            }
          }}
          activeOpacity={0.9}
        >
          <MaterialIcons name={isProfileComplete ? "add-circle" : "lock"} size={32} color={isProfileComplete ? "#000000" : "#9ca3af"} />
          <Text style={[styles.primaryBtnText, { color: isProfileComplete ? '#000000' : '#9ca3af', fontSize: isProfileComplete ? 20 : 16 }]}>
            {isProfileComplete ? "LOG ACTIVITY" : "COMPLETE PROFILE TO UNLOCK"}
          </Text>
        </TouchableOpacity>

        {/* Today's Food Log — LIVE */}
        <View style={styles.checklistSection}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <Text style={[styles.checklistTitle, { color: '#2e2f2d', marginBottom: 0 }]}>Today&apos;s Meals</Text>
            <Text style={{ fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#94a3b8' }}>{todayScans.length} logged</Text>
          </View>
          <View style={styles.checklistItemContainer}>
            {todayScans.length === 0 ? (
              <View style={[styles.taskCard, { backgroundColor: '#f9fafb', borderColor: '#e5e7eb', justifyContent: 'center', paddingVertical: 32 }]}>
                <View style={{ alignItems: 'center', gap: 8 }}>
                  <MaterialIcons name="no-food" size={32} color="#d1d5db" />
                  <Text style={[styles.taskSub, { color: '#94a3b8', textAlign: 'center' }]}>No meals logged yet today.{"\n"}Scan a food label to get started!</Text>
                </View>
              </View>
            ) : (
              todayScans.map((scan) => {
                const time = new Date(scan.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                return (
                  <View key={scan.id} style={[styles.taskCard, { backgroundColor: '#FFFFFF', borderColor: '#e5e7eb' }]}>
                    <View style={styles.taskCardLeft}>
                      <View style={[styles.taskIconBg, { backgroundColor: '#FFF9DB' }]}>
                        <MaterialIcons name="restaurant" size={22} color="#605e00" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.taskTitle, { color: '#2e2f2d' }]} numberOfLines={1}>{scan.ai_identified_food || 'Food'}</Text>
                        <Text style={[styles.taskSub, { color: '#5c5b5b' }]}>{time} • {scan.ai_estimated_calories} kcal</Text>
                      </View>
                    </View>
                    <View style={[styles.checkCircle, { backgroundColor: '#FFFC00' }]}>
                      <MaterialIcons name="check" size={16} color="#000000" />
                    </View>
                  </View>
                );
              })
            )}
          </View>
        </View>

      </ScrollView>
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
  premiumNudge: {
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 8,
  },
  nudgeGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 24,
    borderRadius: 24,
  },
  nudgeLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    flex: 1,
    paddingRight: 16,
  },
  nudgeTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '800',
    fontSize: 18,
    color: '#FFFC00',
    marginBottom: 2,
  },
  nudgeSub: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '500',
    fontSize: 13,
    color: '#94a3b8',
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
    marginBottom: 16,
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
});

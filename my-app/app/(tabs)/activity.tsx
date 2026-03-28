import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { contextualizeWalk } from '../../lib/contextualizer';
import { useAuth } from '../../providers/AuthProvider';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

// Activity Type Definitions
const ACTIVITY_TYPES = [
  { id: 'walk', label: 'Walk', icon: 'directions-walk', color: '#FFFC00' },
  { id: 'play', label: 'Play', icon: 'sports-baseball', color: '#fef8c3' },
  { id: 'water', label: 'Water', icon: 'water-drop', color: '#cde0ea' },
  { id: 'medicine', label: 'Medicine', icon: 'healing', color: '#fca5a5' },
  { id: 'grooming', label: 'Grooming', icon: 'content-cut', color: '#dcfce3' },
  { id: 'training', label: 'Training', icon: 'school', color: '#e0e7ff' },
  { id: 'vet_visit', label: 'Vet Visit', icon: 'local-hospital', color: '#fee2e2' },
  { id: 'other', label: 'Other', icon: 'star', color: '#f3f4f6' },
];

export default function ActivityScreen() {
  const insets = useSafeAreaInsets();
  const { activePet } = useActivePetStore();
  const { awardCoins } = useStreakStore();
  const { user } = useAuth();

  const [currentDate, setCurrentDate] = useState(new Date());
  const [activities, setActivities] = useState<any[]>([]);
  const [foodScans, setFoodScans] = useState<any[]>([]);
  const [dailyLog, setDailyLog] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [weeklyStats, setWeeklyStats] = useState<{ completed: number; skipped: number; total: number } | null>(null);
  const [showAdjustBanner, setShowAdjustBanner] = useState(false);
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustDismissed, setAdjustDismissed] = useState(false);

  // Smart Completion state
  const [confirmingTaskId, setConfirmingTaskId] = useState<string | null>(null);
  const [confirmingDuration, setConfirmingDuration] = useState(0);

  // Modal state
  const [isModalVisible, setIsModalVisible] = useState(false);
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form state
  const [formTitle, setFormTitle] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [formDuration, setFormDuration] = useState(15);
  const [formDistance, setFormDistance] = useState('');
  const [formWater, setFormWater] = useState(250);
  const [formIntensity, setFormIntensity] = useState<'low' | 'moderate' | 'high'>('moderate');

  const getLocalYMD = (d: Date) => {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const dateStr = getLocalYMD(currentDate);

  const fetchData = useCallback(async () => {
    if (!activePet) return;
    setIsLoading(true);

    const startOfDay = new Date(currentDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(currentDate);
    endOfDay.setHours(23, 59, 59, 999);

    try {
      // Fetch daily log
      const { data: logData } = await supabase
        .from('daily_logs')
        .select('*')
        .eq('pet_id', activePet.id)
        .eq('log_date', dateStr)
        .single();
      setDailyLog(logData || null);

      // Fetch food scans
      const { data: scansData } = await supabase
        .from('food_scans')
        .select('*')
        .eq('pet_id', activePet.id)
        .gte('created_at', startOfDay.toISOString())
        .lte('created_at', endOfDay.toISOString())
        .order('created_at', { ascending: false });
      setFoodScans(scansData || []);

      // Fetch activities (now includes scheduled ones)
      const { data: actsData } = await supabase
        .from('activities')
        .select('*')
        .eq('pet_id', activePet.id)
        .eq('scheduled_date', dateStr)
        .order('scheduled_time', { ascending: true });
      setActivities(actsData || []);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [activePet, currentDate, dateStr]);

  // Check last 7 days completion rate for auto-adjustment
  const fetchWeeklyStats = useCallback(async () => {
    if (!activePet) return;
    const today = new Date();
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    try {
      const { data } = await supabase
        .from('activities')
        .select('status')
        .eq('pet_id', activePet.id)
        .eq('is_ai_generated', true)
        .gte('scheduled_date', getLocalYMD(sevenDaysAgo))
        .lt('scheduled_date', getLocalYMD(today));

      if (data && data.length > 0) {
        const completed = data.filter(a => a.status === 'completed').length;
        const skipped = data.filter(a => a.status === 'skipped').length;
        setWeeklyStats({ completed, skipped, total: data.length });
        const completionRate = completed / data.length;
        if (completionRate < 0.5 && skipped > 2 && !adjustDismissed) {
          setShowAdjustBanner(true);
        }
      }
    } catch (e) {
      console.error('Weekly stats error:', e);
    }
  }, [activePet, adjustDismissed]);

  useFocusEffect(
    useCallback(() => {
      fetchData();
      fetchWeeklyStats();
    }, [fetchData, fetchWeeklyStats])
  );

  // Merge food scans + activities into timeline, sorted by time
  const timeline = useMemo(() => {
    const merged = [
      ...foodScans.map(s => ({ ...s, _feedType: 'food' })),
      ...activities.map(a => ({ ...a, _feedType: 'activity' }))
    ];
    return merged.sort((a, b) => {
      const timeA = a.scheduled_time || new Date(a.created_at).toTimeString().slice(0, 8);
      const timeB = b.scheduled_time || new Date(b.created_at).toTimeString().slice(0, 8);
      return timeA.localeCompare(timeB);
    });
  }, [foodScans, activities]);

  const changeDate = (days: number) => {
    const newDate = new Date(currentDate);
    newDate.setDate(newDate.getDate() + days);
    setCurrentDate(newDate);
  };

  const isToday = new Date().toDateString() === currentDate.toDateString();

  const TIME_BASED_TYPES = ['walk', 'play', 'training'];

  // Handle tap on the check circle
  const handleCheckTap = (item: any) => {
    if (TIME_BASED_TYPES.includes(item.activity_type)) {
      // Show inline duration confirmation
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setConfirmingTaskId(item.id);
      setConfirmingDuration(item.duration_minutes || 15);
    } else {
      // Instant completion for non-time tasks
      confirmCompletion(item, null);
    }
  };

  // Confirm completion (with optional duration override)
  const confirmCompletion = async (item: any, durationOverride: number | null) => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const updatePayload: any = { status: 'completed' };
      if (durationOverride !== null) {
        updatePayload.duration_minutes = durationOverride;
      }

      const { error } = await supabase
        .from('activities')
        .update(updatePayload)
        .eq('id', item.id);
      if (error) throw error;

      // Update daily_logs for water and walk
      if (item.activity_type === 'water' || item.activity_type === 'walk') {
        const { data: existingLog } = await supabase
          .from('daily_logs')
          .select('*')
          .eq('pet_id', activePet!.id)
          .eq('log_date', dateStr) // Use viewed date instead of fixed Today
          .single();

        if (existingLog) {
          const updates: any = { updated_at: new Date().toISOString() };
          if (item.activity_type === 'water' && item.water_ml) {
            updates.water_ml = (existingLog.water_ml || 0) + item.water_ml;
          }
          if (item.activity_type === 'walk') {
            updates.walks_count = (existingLog.walks_count || 0) + 1;
          }
          await supabase.from('daily_logs').update(updates).eq('id', existingLog.id);

          // Update context store incrementally
          if (item.activity_type === 'water' && item.water_ml) {
            usePetContextStore.getState().updateWater((existingLog.water_ml || 0) + item.water_ml);
          }
          if (item.activity_type === 'walk') {
            usePetContextStore.getState().updateWalks((existingLog.walks_count || 0) + 1);
          }
        } else {
          const inserts: any = { pet_id: activePet!.id, log_date: dateStr }; // Use viewed date
          if (item.activity_type === 'water') inserts.water_ml = item.water_ml || 0;
          if (item.activity_type === 'walk') inserts.walks_count = 1;
          await supabase.from('daily_logs').insert(inserts);

          // Update context store for new log
          if (item.activity_type === 'water' && item.water_ml) {
            usePetContextStore.getState().updateWater(item.water_ml);
          }
          if (item.activity_type === 'walk') {
            usePetContextStore.getState().updateWalks(1);
          }
        }
      }

      setConfirmingTaskId(null);
      fetchData();

      // Award coins for activity completion
      if (user?.id) {
        awardCoins(user.id, 'activity_complete', item.id);
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    }
  };

  // Generate AI Schedule
  const generateSchedule = async () => {
    if (!activePet) return;
    setIsGenerating(true);

    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          petProfile: activePet,
          daysToGenerate: 7,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Schedule generation failed.');

      Alert.alert(
        'Schedule Created! 🎉',
        `${data.activities_created} activities planned across ${data.days_generated} days.\n\nNavigate forward to see your schedule!`,
        [{ text: 'Awesome!', onPress: () => fetchData() }]
      );
    } catch (e: any) {
      Alert.alert('Generation Failed', e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-Adjustment: delete future pending + regenerate with performance context
  const adjustSchedule = async () => {
    if (!activePet) return;
    setIsAdjusting(true);

    try {
      // Delete all future pending AI-generated activities
      const todayStr = getLocalYMD(new Date());
      await supabase
        .from('activities')
        .delete()
        .eq('pet_id', activePet.id)
        .eq('is_ai_generated', true)
        .eq('status', 'pending')
        .gt('scheduled_date', todayStr);

      // Build performance context from weekly stats + context store
      const contextStore = usePetContextStore.getState();
      const completionRate = weeklyStats && weeklyStats.total > 0
        ? weeklyStats.completed / weeklyStats.total
        : 1;
      const skippedCount = weeklyStats?.skipped ?? 0;

      // Fetch average completed duration from last 7 days
      const sevenAgo = new Date();
      sevenAgo.setDate(sevenAgo.getDate() - 7);
      const { data: completedActs } = await supabase
        .from('activities')
        .select('duration_minutes')
        .eq('pet_id', activePet.id)
        .eq('status', 'completed')
        .in('activity_type', ['walk', 'play', 'training'])
        .gte('scheduled_date', getLocalYMD(sevenAgo))
        .lte('scheduled_date', todayStr);

      const durations = (completedActs || [])
        .map((a: any) => a.duration_minutes)
        .filter((d: number | null) => d !== null && d > 0);
      const avgCompletedDurationMins = durations.length > 0
        ? Math.round(durations.reduce((s: number, d: number) => s + d, 0) / durations.length)
        : null;

      // Fatigue detection: more skipped than completed AND meaningful sample size
      const fatigueDetected = weeklyStats
        ? weeklyStats.skipped > weeklyStats.completed && weeklyStats.total >= 5
        : false;

      const performanceContext = {
        lastWeekCompletionRate: completionRate,
        lastWeekSkippedCount: skippedCount,
        avgCompletedDurationMins,
        todayCalPercent: contextStore.calPercent,
        weightTrendDirection: contextStore.weightTrend?.direction ?? null,
        fatigueDetected,
      };

      // Regenerate with performance-aware context
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/generate-schedule`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          petProfile: activePet,
          daysToGenerate: 7,
          performanceContext,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Adjustment failed.');

      setShowAdjustBanner(false);
      setAdjustDismissed(true);

      const adjustMsg = fatigueDetected
        ? 'A gentler, enrichment-focused plan has been created. Small steps count!'
        : `A lighter, more achievable plan has been generated across ${data.days_generated} days.`;

      Alert.alert(
        'Schedule Adjusted! ✨',
        adjustMsg,
        [{ text: 'Thank you!', onPress: () => fetchData() }]
      );
    } catch (e: any) {
      Alert.alert('Adjustment Failed', e.message);
    } finally {
      setIsAdjusting(false);
    }
  };

  const handleLogActivity = async () => {
    if (!activePet || !selectedType) return;
    setIsSubmitting(true);

    let titleToSave = formTitle.trim();
    if (!titleToSave) {
      const typeDef = ACTIVITY_TYPES.find(t => t.id === selectedType);
      titleToSave = typeDef ? typeDef.label : 'Activity';
    }

    try {
      const actPayload: any = {
        pet_id: activePet.id,
        activity_type: selectedType,
        title: titleToSave,
        notes: formNotes || null,
        status: 'completed',
        scheduled_date: getLocalYMD(new Date()),
        scheduled_time: new Date().toTimeString().slice(0, 8),
        is_ai_generated: false,
        created_at: new Date().toISOString(),
      };

      if (['walk', 'play', 'training'].includes(selectedType)) {
        actPayload.duration_minutes = formDuration;
        actPayload.intensity = formIntensity;
      }
      if (selectedType === 'walk' && formDistance) {
        actPayload.distance_km = parseFloat(formDistance);
      }
      if (selectedType === 'water') {
        actPayload.water_ml = formWater;
      }

      const { error } = await supabase.from('activities').insert(actPayload);
      if (error) throw error;

      // Update daily_logs
      if (selectedType === 'water' || selectedType === 'walk') {
        const { data: existingLog } = await supabase
          .from('daily_logs')
          .select('*')
          .eq('pet_id', activePet.id)
          .eq('log_date', dateStr) // Use viewed date instead of fixed Today
          .single();

        if (existingLog) {
          const updates: any = { updated_at: new Date().toISOString() };
          if (selectedType === 'water') {
            updates.water_ml = (existingLog.water_ml || 0) + formWater;
          }
          if (selectedType === 'walk') {
            updates.walks_count = (existingLog.walks_count || 0) + 1;
          }
          await supabase.from('daily_logs').update(updates).eq('id', existingLog.id);
        } else {
          const inserts: any = { pet_id: activePet.id, log_date: dateStr }; // Use viewed date
          if (selectedType === 'water') inserts.water_ml = formWater;
          if (selectedType === 'walk') inserts.walks_count = 1;
          await supabase.from('daily_logs').insert(inserts);
        }
      }

      setIsModalVisible(false);
      resetForm();
      fetchData();

      // Award coins for logged activity
      if (user?.id) {
        awardCoins(user.id, 'activity_complete');
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetForm = () => {
    setSelectedType(null);
    setFormTitle('');
    setFormNotes('');
    setFormDuration(15);
    setFormDistance('');
    setFormWater(250);
    setFormIntensity('moderate');
  };

  // Hero Stats
  const heroCalories = dailyLog?.calories_consumed || 0;
  const targetCalories = activePet?.target_daily_calories || 0;

  const heroWater = dailyLog?.water_ml || 0;
  const targetWater = Math.round((activePet?.current_weight_kg || 10) * 50);

  const heroPlay = activities
    .filter(a => ['walk', 'play', 'training'].includes(a.activity_type) && a.status === 'completed')
    .reduce((sum, a) => sum + (a.duration_minutes || 0), 0);

  // Calculate target play based on generated activities (or fallback to 30)
  const targetPlay = activities
    .filter(a => ['walk', 'play', 'training'].includes(a.activity_type))
    .reduce((sum, a) => sum + (a.duration_minutes || 0), 0) || 30;

  const completedCount = activities.filter(a => a.status === 'completed').length;
  const pendingCount = activities.filter(a => a.status === 'pending').length;
  const totalScheduled = completedCount + pendingCount;
  const completionPct = totalScheduled > 0 ? Math.round((completedCount / totalScheduled) * 100) : 0;

  let heroMessage = "No Plan Yet";
  if (totalScheduled > 0 && completionPct === 0) heroMessage = "Let\u2019s Get Started!";
  if (completionPct > 0 && completionPct < 50) heroMessage = "Good Progress";
  if (completionPct >= 50 && completionPct < 100) heroMessage = "Almost There!";
  if (completionPct === 100 && totalScheduled > 0) heroMessage = "All Done! \uD83C\uDF89";
  if (totalScheduled === 0 && heroPlay > 0) heroMessage = "Active Day!";

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>

      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <View style={[styles.avatarMini, { backgroundColor: '#FFFC00' }]}>
            <Image
              source={{ uri: activePet?.current_avatar_url || activePet?.image_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=200' }}
              style={styles.avatarMiniImg}
            />
          </View>
          <Text style={[styles.headerTitle, { color: '#1A1A1A' }]}>PAWTCHI</Text>
        </View>
        <TouchableOpacity style={styles.bellBtn}>
          <MaterialIcons name="notifications" size={28} color="#1A1A1A" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Daily Summary Hero */}
        <View style={[styles.heroSection, { backgroundColor: '#FFFC00' }]}>
          <View style={[styles.heroBlobRight, { backgroundColor: 'rgba(255,255,255,0.2)' }]} />
          <View style={[styles.heroBlobLeft, { backgroundColor: 'rgba(0,0,0,0.1)' }]} />

          <View style={{ zIndex: 10 }}>
            <Text style={[styles.heroSubtitle, { color: '#1A1A1A', opacity: 0.8 }]}>TODAY&apos;S PULSE</Text>
            <Text style={[styles.heroTitle, { color: '#1A1A1A' }]}>{heroMessage}</Text>

            {/* Completion Progress */}
            {totalScheduled > 0 && (
              <View style={styles.completionBar}>
                <View style={styles.completionBarBg}>
                  <View style={[styles.completionBarFill, { width: `${completionPct}%` }]} />
                </View>
                <Text style={styles.completionText}>{completedCount}/{totalScheduled} tasks</Text>
              </View>
            )}

            <View style={styles.statsGrid}>
              {/* Food Card */}
              <View style={styles.statCard}>
                <MaterialIcons name="restaurant" size={20} color="#1A1A1A" style={{ opacity: 0.6 }} />
                <Text style={styles.statValue}>{heroCalories}</Text>
                <Text style={styles.statUnit}>/ {targetCalories} kcal</Text>
                <Text style={styles.statLabel}>FOOD</Text>
              </View>

              {/* Water Card */}
              <View style={styles.statCard}>
                <MaterialIcons name="water-drop" size={20} color="#1A1A1A" style={{ opacity: 0.6 }} />
                <Text style={styles.statValue}>{heroWater}</Text>
                <Text style={styles.statUnit}>/ {targetWater} ml</Text>
                <Text style={styles.statLabel}>WATER</Text>
              </View>

              {/* Play Card */}
              <View style={styles.statCard}>
                <MaterialIcons name="directions-run" size={20} color="#1A1A1A" style={{ opacity: 0.6 }} />
                <Text style={styles.statValue}>{heroPlay}</Text>
                <Text style={styles.statUnit}>/ {targetPlay} min</Text>
                <Text style={styles.statLabel}>PLAY</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Auto-Adjustment Banner */}
        {showAdjustBanner && isToday && (
          <View style={styles.adjustBanner}>
            <View style={styles.adjustBannerTop}>
              <MaterialIcons name="self-improvement" size={28} color="#92400e" />
              <View style={{ flex: 1 }}>
                <Text style={styles.adjustBannerTitle}>Busy week?</Text>
                <Text style={styles.adjustBannerDesc}>
                  {weeklyStats && weeklyStats.skipped > weeklyStats.completed
                    ? `I noticed most tasks were skipped this week. Let me create a gentler plan with enrichment activities your pet will love.`
                    : `I noticed some tasks were missed. Want me to build a lighter, more achievable plan based on what's been working?`
                  }
                </Text>
              </View>
            </View>
            <View style={styles.adjustBannerActions}>
              <TouchableOpacity
                style={[styles.adjustBtnYes, isAdjusting && { opacity: 0.7 }]}
                onPress={adjustSchedule}
                disabled={isAdjusting}
              >
                {isAdjusting
                  ? <ActivityIndicator color="#1A1A1A" size="small" />
                  : <Text style={styles.adjustBtnYesText}>Yes, adjust my plan</Text>
                }
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.adjustBtnNo}
                onPress={() => { setShowAdjustBanner(false); setAdjustDismissed(true); }}
              >
                <Text style={styles.adjustBtnNoText}>I&apos;m good</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Date Navigator */}
        <View style={[styles.dateNav, { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' }]}>
          <TouchableOpacity style={styles.dateBtn} onPress={() => changeDate(-1)}>
            <MaterialIcons name="chevron-left" size={24} color="#1A1A1A" />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.dateText, { color: '#1A1A1A' }]}>
              {currentDate.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
            </Text>
            {isToday && <Text style={[styles.todayText, { color: '#515d64' }]}>TODAY</Text>}
          </View>
          <TouchableOpacity style={styles.dateBtn} onPress={() => changeDate(1)}>
            <MaterialIcons name="chevron-right" size={24} color="#1A1A1A" />
          </TouchableOpacity>
        </View>

        {/* Activity Feed */}
        <View style={styles.feedSection}>
          <View style={styles.feedHeader}>
            <Text style={[styles.feedTitle, { color: '#1A1A1A' }]}>Timeline</Text>
            {pendingCount > 0 && (
              <View style={[styles.pendingBadge, { backgroundColor: '#FEF3C7' }]}>
                <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
              </View>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#FFFC00" />
          ) : timeline.length === 0 ? (
            <View style={styles.emptyState}>
              <MaterialIcons name="auto-awesome" size={48} color="#FFFC00" style={{ marginBottom: 16 }} />
              <Text style={styles.emptyTitle}>No Schedule Yet</Text>
              <Text style={styles.emptyDesc}>
                Let our AI coach plan your pet&apos;s week!{"\n"}
                Walks, water, play, and grooming — all tailored to {activePet?.name || 'your pet'}&apos;s profile.
              </Text>
              <TouchableOpacity
                style={[styles.generateBtn, isGenerating && { opacity: 0.7 }]}
                onPress={generateSchedule}
                disabled={isGenerating}
                activeOpacity={0.9}
              >
                <LinearGradient colors={['#FFFC00', '#fac129']} style={styles.generateGradient}>
                  {isGenerating ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                      <ActivityIndicator color="#1A1A1A" />
                      <Text style={styles.generateText}>Generating Schedule...</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <MaterialIcons name="auto-awesome" size={20} color="#1A1A1A" />
                      <Text style={styles.generateText}>GENERATE 7-DAY PLAN</Text>
                    </View>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.timelineList}>
              {timeline.map((item) => {
                const isFood = item._feedType === 'food';
                const isPending = item.status === 'pending';
                const isCompleted = item.status === 'completed';
                const isSkipped = item.status === 'skipped';
                const timeStr = item.scheduled_time
                  ? item.scheduled_time.slice(0, 5)
                  : new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

                if (isFood) {
                  return (
                    <View key={`food-${item.id}`} style={[styles.timelineCard, { borderLeftColor: '#f3f4f6' }]}>
                      <View style={styles.cardHeader}>
                        <View style={[styles.timelineIconBg, { backgroundColor: '#f3f4f6' }]}>
                          <MaterialIcons name="restaurant" size={24} color="#1A1A1A" />
                        </View>
                        <View style={[styles.timeTag, { backgroundColor: '#F3F4F6' }]}>
                          <Text style={[styles.timeText, { color: '#515d64' }]}>{timeStr}</Text>
                        </View>
                      </View>
                      <Text style={[styles.cardTitle, { color: '#1A1A1A' }]}>{item.ai_identified_food || 'Food'}</Text>
                      <View style={[styles.pillBadge, { backgroundColor: '#F3F4F6' }]}>
                        <Text style={[styles.pillBadgeText, { color: '#1A1A1A' }]}>{item.ai_estimated_calories} kcal</Text>
                      </View>
                    </View>
                  );
                }

                // Normal Activity
                const typeDef = ACTIVITY_TYPES.find(t => t.id === item.activity_type) || ACTIVITY_TYPES[0];
                return (
                  <View
                    key={`act-${item.id}`}
                    style={[
                      styles.timelineCard,
                      { borderLeftColor: isSkipped ? '#e5e7eb' : typeDef.color },
                      isSkipped && { opacity: 0.5 },
                    ]}
                  >
                    <View style={styles.cardHeader}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                        {/* Status Checkmark */}
                        {isPending ? (
                          <TouchableOpacity
                            style={styles.checkCircleEmpty}
                            onPress={() => handleCheckTap(item)}
                            activeOpacity={0.7}
                          >
                            <View style={styles.checkCircleInner} />
                          </TouchableOpacity>
                        ) : (
                          <View style={[
                            styles.checkCircleFilled,
                            { backgroundColor: isCompleted ? '#FFFC00' : '#e5e7eb' }
                          ]}>
                            <MaterialIcons
                              name={isCompleted ? "check" : "close"}
                              size={16}
                              color={isCompleted ? "#1A1A1A" : "#9ca3af"}
                            />
                          </View>
                        )}
                        <View style={[styles.timelineIconBg, { backgroundColor: typeDef.color }]}>
                          <MaterialIcons name={typeDef.icon as any} size={24} color="#1A1A1A" />
                        </View>
                      </View>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        {item.is_ai_generated && (
                          <View style={[styles.aiBadge]}>
                            <MaterialIcons name="auto-awesome" size={12} color="#fac129" />
                          </View>
                        )}
                        <View style={[styles.timeTag, { backgroundColor: '#F3F4F6' }]}>
                          <Text style={[styles.timeText, { color: '#515d64' }]}>{timeStr}</Text>
                        </View>
                      </View>
                    </View>
                    <Text style={[styles.cardTitle, { color: '#1A1A1A', marginLeft: isPending || isCompleted || isSkipped ? 44 : 0 }]}>{item.title}</Text>
                    {!!item.notes && <Text style={[styles.cardDesc, { color: '#515d64', marginLeft: isPending || isCompleted || isSkipped ? 44 : 0 }]}>{item.notes}</Text>}

                    <View style={[styles.cardTagsRow, { marginLeft: isPending || isCompleted || isSkipped ? 44 : 0 }]}>
                      {!!item.duration_minutes && (
                        <View style={styles.iconTag}>
                          <MaterialIcons name="timer" size={14} color="#E6E300" />
                          <Text style={[styles.iconTagText, { color: '#1A1A1A' }]}>{item.duration_minutes} mins</Text>
                        </View>
                      )}
                      {!!item.distance_km && (
                        <View style={styles.iconTag}>
                          <MaterialIcons name="straighten" size={14} color="#E6E300" />
                          <Text style={[styles.iconTagText, { color: '#1A1A1A' }]}>{item.distance_km} km</Text>
                        </View>
                      )}
                      {!item.distance_km && !!item.duration_minutes && ['walk', 'play'].includes(item.activity_type) && activePet?.current_weight_kg && (
                        <View style={styles.iconTag}>
                          <MaterialIcons name="straighten" size={14} color="#94a3b8" />
                          <Text style={[styles.iconTagText, { color: '#94a3b8' }]}>
                            {contextualizeWalk(item.duration_minutes, activePet.current_weight_kg)}
                          </Text>
                        </View>
                      )}
                      {!!item.water_ml && (
                        <View style={styles.iconTag}>
                          <MaterialIcons name="water-drop" size={14} color="#3b82f6" />
                          <Text style={[styles.iconTagText, { color: '#1A1A1A' }]}>{item.water_ml} ml</Text>
                        </View>
                      )}
                      {!!item.intensity && (
                        <View style={[styles.outlinePill, { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB', marginLeft: 'auto' }]}>
                          <Text style={[styles.outlinePillText, { color: '#1A1A1A' }]}>{item.intensity.toUpperCase()}</Text>
                        </View>
                      )}
                    </View>

                    {/* Smart Completion Inline UI */}
                    {confirmingTaskId === item.id && (
                      <View style={[styles.smartConfirm, { marginLeft: 44 }]}>
                        <Text style={styles.smartConfirmLabel}>How long did you go?</Text>
                        <View style={styles.smartConfirmRow}>
                          {[5, 10, 15, 20, 30, 45, 60].map(mins => {
                            const isScheduled = mins === (item.duration_minutes || 15);
                            const isSelected = mins === confirmingDuration;
                            return (
                              <TouchableOpacity
                                key={mins}
                                style={[
                                  styles.smartChip,
                                  isSelected && styles.smartChipActive,
                                  isScheduled && !isSelected && styles.smartChipScheduled,
                                ]}
                                onPress={() => setConfirmingDuration(mins)}
                              >
                                <Text style={[
                                  styles.smartChipText,
                                  isSelected && styles.smartChipTextActive,
                                ]}>{mins}m</Text>
                                {isScheduled && !isSelected && (
                                  <Text style={styles.smartChipHint}>✓</Text>
                                )}
                              </TouchableOpacity>
                            );
                          })}
                        </View>
                        <View style={styles.smartConfirmActions}>
                          <TouchableOpacity
                            style={styles.smartDoneBtn}
                            onPress={() => confirmCompletion(item, confirmingDuration)}
                          >
                            <MaterialIcons name="check" size={18} color="#1A1A1A" />
                            <Text style={styles.smartDoneBtnText}>Done</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.smartCancelBtn}
                            onPress={() => setConfirmingTaskId(null)}
                          >
                            <Text style={styles.smartCancelBtnText}>Cancel</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                  </View>
                );
              })}
            </View>
          )}
        </View>
      </ScrollView>

      {/* FAB */}
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: '#FFFC00', bottom: insets.bottom + 90 }]}
        activeOpacity={0.9}
        onPress={() => setIsModalVisible(true)}
      >
        <View style={styles.fabInner}>
          <MaterialIcons name="add" size={32} color="#1A1A1A" />
        </View>
      </TouchableOpacity>

      {/* LOG ACTIVITY MODAL / BOTTOM SHEET */}
      <Modal
        visible={isModalVisible}
        transparent={true}
        animationType="slide"
        onRequestClose={() => { setIsModalVisible(false); resetForm(); }}
      >
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{selectedType ? 'Log Details' : 'What did you do?'}</Text>
                <TouchableOpacity onPress={() => { setIsModalVisible(false); resetForm(); }}>
                  <MaterialIcons name="close" size={28} color="#1A1A1A" />
                </TouchableOpacity>
              </View>

              {!selectedType ? (
                <View style={styles.typeGrid}>
                  {ACTIVITY_TYPES.map(type => (
                    <TouchableOpacity
                      key={type.id}
                      style={[styles.typeBtn, { backgroundColor: type.color }]}
                      onPress={() => setSelectedType(type.id)}
                    >
                      <MaterialIcons name={type.icon as any} size={32} color="#1A1A1A" />
                      <Text style={styles.typeLabel}>{type.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              ) : (
                <ScrollView showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>

                  {['medicine', 'vet_visit', 'grooming', 'other'].includes(selectedType) && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Title</Text>
                      <TextInput
                        style={styles.input}
                        value={formTitle}
                        onChangeText={setFormTitle}
                        placeholder={ACTIVITY_TYPES.find(t => t.id === selectedType)?.label}
                      />
                    </View>
                  )}

                  {['walk', 'play', 'training'].includes(selectedType) && (
                    <View style={styles.inputGroup}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 }}>
                        <Text style={styles.inputLabel}>Duration</Text>
                        <Text style={styles.inputLabel}>{formDuration} mins</Text>
                      </View>
                      <Slider
                        style={{ width: '100%', height: 40 }}
                        minimumValue={5}
                        maximumValue={120}
                        step={5}
                        value={formDuration}
                        onValueChange={setFormDuration}
                        minimumTrackTintColor="#FFFC00"
                        maximumTrackTintColor="#f3f4f6"
                        thumbTintColor="#1A1A1A"
                      />
                    </View>
                  )}

                  {selectedType === 'walk' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Distance (km) - Optional</Text>
                      <TextInput
                        style={styles.input}
                        value={formDistance}
                        onChangeText={setFormDistance}
                        keyboardType="decimal-pad"
                        placeholder="e.g. 2.5"
                      />
                    </View>
                  )}

                  {selectedType === 'water' && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Water Amount (ml)</Text>
                      <View style={styles.presetRow}>
                        {[100, 250, 500, 1000].map(amt => (
                          <TouchableOpacity
                            key={amt}
                            style={[styles.presetBtn, formWater === amt && styles.presetBtnActive]}
                            onPress={() => setFormWater(amt)}
                          >
                            <Text style={[styles.presetBtnText, formWater === amt && { color: '#1A1A1A' }]}>{amt}ml</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  {['walk', 'play', 'training'].includes(selectedType) && (
                    <View style={styles.inputGroup}>
                      <Text style={styles.inputLabel}>Intensity</Text>
                      <View style={styles.presetRow}>
                        {(['low', 'moderate', 'high'] as const).map(lvl => (
                          <TouchableOpacity
                            key={lvl}
                            style={[styles.presetBtn, formIntensity === lvl && styles.presetBtnActive]}
                            onPress={() => setFormIntensity(lvl)}
                          >
                            <Text style={[styles.presetBtnText, formIntensity === lvl && { color: '#1A1A1A' }]}>{lvl.toUpperCase()}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}

                  <View style={styles.inputGroup}>
                    <Text style={styles.inputLabel}>Notes</Text>
                    <TextInput
                      style={[styles.input, { height: 80, textAlignVertical: 'top' }]}
                      value={formNotes}
                      onChangeText={setFormNotes}
                      placeholder="Add any details..."
                      multiline
                    />
                  </View>

                  <TouchableOpacity
                    style={[styles.submitBtn, isSubmitting && { opacity: 0.7 }]}
                    onPress={handleLogActivity}
                    disabled={isSubmitting}
                  >
                    <LinearGradient colors={['#FFFC00', '#fac129']} style={styles.submitGradient}>
                      {isSubmitting ? <ActivityIndicator color="#1A1A1A" /> : <Text style={styles.submitText}>SAVE ACTIVITY</Text>}
                    </LinearGradient>
                  </TouchableOpacity>

                  <TouchableOpacity style={styles.cancelBtn} onPress={resetForm} disabled={isSubmitting}>
                    <Text style={styles.cancelText}>Back</Text>
                  </TouchableOpacity>

                </ScrollView>
              )}

            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

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
    backgroundColor: '#FFFFFF',
    zIndex: 50,
    borderBottomWidth: 1,
    borderBottomColor: '#F9FAFB',
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
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarMiniImg: { width: '100%', height: '100%' },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans',
    fontWeight: '700',
    fontSize: 24,
    letterSpacing: -0.5,
  },
  bellBtn: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 160,
  },
  heroSection: {
    padding: 32,
    borderRadius: 24,
    overflow: 'hidden',
    marginBottom: 24,
  },
  heroBlobRight: {
    position: 'absolute', top: -40, right: -40,
    width: 160, height: 160, borderRadius: 80,
  },
  heroBlobLeft: {
    position: 'absolute', bottom: -40, left: -40,
    width: 128, height: 128, borderRadius: 64,
  },
  heroSubtitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12,
    letterSpacing: 2, marginBottom: 4,
  },
  heroTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 32,
    letterSpacing: -1, marginBottom: 16,
  },
  completionBar: {
    marginBottom: 24,
    gap: 6,
  },
  completionBarBg: {
    height: 8,
    backgroundColor: 'rgba(0,0,0,0.1)',
    borderRadius: 4,
    overflow: 'hidden',
  },
  completionBarFill: {
    height: '100%',
    backgroundColor: '#1A1A1A',
    borderRadius: 4,
  },
  completionText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12,
    color: '#1A1A1A', opacity: 0.7,
  },
  statsGrid: { flexDirection: 'row', gap: 16 },
  statCard: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 16, padding: 16, alignItems: 'center',
  },
  statValue: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 22, marginTop: 8,
    color: '#1A1A1A',
  },
  statUnit: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 10, fontWeight: '700',
    color: '#1A1A1A', opacity: 0.5, marginTop: -2,
  },
  statLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 9,
    letterSpacing: 1.5, marginTop: 8, color: '#1A1A1A', opacity: 0.4,
  },
  dateNav: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 8, borderRadius: 40, borderWidth: 1, marginBottom: 32,
  },
  dateBtn: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: 'transparent', alignItems: 'center', justifyContent: 'center',
  },
  dateText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 16 },
  todayText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 10, letterSpacing: 1 },
  feedSection: { marginBottom: 32 },
  feedHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 8, marginBottom: 24,
  },
  feedTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 24, letterSpacing: -0.5,
  },
  pendingBadge: {
    paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16,
  },
  pendingBadgeText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12, color: '#92400e',
  },
  emptyState: {
    alignItems: 'center', padding: 40, backgroundColor: '#F9FAFB', borderRadius: 24,
  },
  emptyTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 18,
    color: '#1A1A1A', marginBottom: 8,
  },
  emptyDesc: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 14, color: '#6b7280',
    textAlign: 'center', lineHeight: 20, marginBottom: 24,
  },
  generateBtn: {
    borderRadius: 32, overflow: 'hidden', width: '100%',
  },
  generateGradient: {
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
  },
  generateText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 16, color: '#1A1A1A',
  },
  timelineList: { gap: 16 },
  timelineCard: {
    backgroundColor: '#FFFFFF', padding: 24, borderRadius: 24,
    borderWidth: 1, borderColor: '#E5E7EB', borderLeftWidth: 8,
  },
  cardHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12,
  },
  timelineIconBg: {
    width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center',
  },
  timeTag: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16 },
  timeText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 10, letterSpacing: 1 },
  cardTitle: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 18, marginBottom: 8 },
  cardDesc: { fontFamily: 'Plus Jakarta Sans', fontSize: 14, lineHeight: 20, marginBottom: 16 },
  cardTagsRow: { flexDirection: 'row', gap: 16 },
  iconTag: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  iconTagText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12 },
  pillBadge: { alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16 },
  pillBadgeText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12 },
  outlinePill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16, borderWidth: 1 },
  outlinePillText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 10, letterSpacing: 1 },
  checkCircleEmpty: {
    width: 32, height: 32, borderRadius: 16,
    borderWidth: 3, borderColor: '#d1d5db',
    justifyContent: 'center', alignItems: 'center',
  },
  checkCircleInner: {
    width: 12, height: 12, borderRadius: 6, backgroundColor: '#e5e7eb',
  },
  checkCircleFilled: {
    width: 32, height: 32, borderRadius: 16,
    justifyContent: 'center', alignItems: 'center',
  },
  aiBadge: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: '#FEF3C7', justifyContent: 'center', alignItems: 'center',
  },
  fab: {
    position: 'absolute', right: 24,
    shadowColor: '#000', shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.2, shadowRadius: 20, elevation: 10, borderRadius: 32,
  },
  fabInner: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 4, borderColor: '#FFFFFF',
  },
  // Modal Styles
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' },
  modalContent: {
    backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32,
    padding: 24, paddingBottom: Platform.OS === 'ios' ? 40 : 24, maxHeight: '90%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24,
  },
  modalTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 24, color: '#1A1A1A',
  },
  typeGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 16, justifyContent: 'space-between',
  },
  typeBtn: {
    width: '47%', aspectRatio: 1, borderRadius: 24,
    justifyContent: 'center', alignItems: 'center', gap: 12,
  },
  typeLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 16, color: '#1A1A1A',
  },
  inputGroup: { marginBottom: 20 },
  inputLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#515d64', marginBottom: 8,
  },
  input: {
    backgroundColor: '#F3F4F6', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 14,
    fontFamily: 'Plus Jakarta Sans', fontSize: 16, color: '#1A1A1A',
  },
  presetRow: { flexDirection: 'row', gap: 8 },
  presetBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 12,
    backgroundColor: '#F3F4F6', alignItems: 'center',
  },
  presetBtnActive: { backgroundColor: '#FFFC00' },
  presetBtnText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 12, color: '#6b7280',
  },
  submitBtn: { marginTop: 8, borderRadius: 32, overflow: 'hidden' },
  submitGradient: { paddingVertical: 16, alignItems: 'center' },
  submitText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 16, color: '#1A1A1A' },
  cancelBtn: { paddingVertical: 16, alignItems: 'center', marginTop: 8 },
  cancelText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 16, color: '#6b7280' },
  // Auto-Adjustment Banner
  adjustBanner: {
    backgroundColor: '#FFFBEB', borderRadius: 24, padding: 24, marginBottom: 24,
    borderWidth: 1, borderColor: '#FDE68A',
  },
  adjustBannerTop: {
    flexDirection: 'row', gap: 16, alignItems: 'flex-start', marginBottom: 20,
  },
  adjustBannerTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 18, color: '#92400e', marginBottom: 4,
  },
  adjustBannerDesc: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 14, lineHeight: 20, color: '#78350f',
  },
  adjustBannerActions: {
    flexDirection: 'row', gap: 12,
  },
  adjustBtnYes: {
    flex: 1, backgroundColor: '#FFFC00', borderRadius: 16, paddingVertical: 14, alignItems: 'center',
  },
  adjustBtnYesText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 14, color: '#1A1A1A',
  },
  adjustBtnNo: {
    flex: 1, backgroundColor: '#FEF3C7', borderRadius: 16, paddingVertical: 14, alignItems: 'center',
  },
  adjustBtnNoText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#92400e',
  },
  // Smart Completion
  smartConfirm: {
    marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: '#F3F4F6',
  },
  smartConfirmLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#515d64', marginBottom: 12,
  },
  smartConfirmRow: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16,
  },
  smartChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
    backgroundColor: '#F3F4F6', alignItems: 'center',
  },
  smartChipActive: {
    backgroundColor: '#FFFC00',
  },
  smartChipScheduled: {
    borderWidth: 2, borderColor: '#d1d5db',
  },
  smartChipText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#6b7280',
  },
  smartChipTextActive: {
    color: '#1A1A1A',
  },
  smartChipHint: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 10, color: '#9ca3af', marginTop: 2,
  },
  smartConfirmActions: {
    flexDirection: 'row', gap: 12,
  },
  smartDoneBtn: {
    flex: 1, flexDirection: 'row', gap: 6, backgroundColor: '#FFFC00', borderRadius: 14,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  smartDoneBtnText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 14, color: '#1A1A1A',
  },
  smartCancelBtn: {
    paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14,
    backgroundColor: '#F3F4F6', alignItems: 'center', justifyContent: 'center',
  },
  smartCancelBtnText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#6b7280',
  },
});

import React, { useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert, KeyboardAvoidingView, Platform, TouchableWithoutFeedback, Keyboard } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useRouter } from 'expo-router';
import { MaterialIcons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '../../lib/supabase';
import { useActivePetStore } from '../../store/useActivePetStore';
import { useStreakStore } from '../../store/useStreakStore';
import { usePetContextStore } from '../../store/usePetContextStore';
import { contextualizeWalk } from '../../lib/contextualizer';
import { regenerateSchedule } from '../../lib/scheduleAdjuster';
import { useAuth } from '../../providers/AuthProvider';
import { useSubscription } from '../../hooks/useSubscription';
import Slider from '@react-native-community/slider';
import * as Haptics from 'expo-haptics';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const RING_CIRCUMFERENCE = 2 * Math.PI * 28; // r=28

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
  const router = useRouter();
  const { activePet } = useActivePetStore();
  const { awardCoins } = useStreakStore();
  const { user } = useAuth();
  const { hasFullAccess } = useSubscription();

  const checkAccess = () => {
    if (!hasFullAccess) {
      router.push('/paywall' as any);
      return false;
    }
    return true;
  };

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
    if (!checkAccess()) return;
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

      // Optimistic update — instantly mark completed in local state (no reload flash)
      setActivities(prev =>
        prev.map(a =>
          a.id === item.id
            ? { ...a, status: 'completed', ...(durationOverride !== null ? { duration_minutes: durationOverride } : {}) }
            : a
        )
      );

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
    if (!activePet || !checkAccess()) return;
    setIsGenerating(true);

    try {
      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(`${supabaseUrl}/functions/v1/generate-schedule`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          petProfile: activePet,
          daysToGenerate: 7,
        }),
      });

      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Schedule generation failed.');

      Alert.alert(
        'Schedule Created! 🎉',
        `${data.activities_created} activities planned across ${data.days_generated} days — starting today! Let's get moving!`,
        [{ text: 'Awesome!', onPress: () => fetchData() }]
      );
    } catch (e: any) {
      let msg = e?.message || 'Schedule generation failed.';

      // Surface common Supabase Edge Function errors with actionable guidance
      if (msg.includes('is not configured') || msg.includes('not found') || msg.includes('function not found')) {
        msg = `Edge function not deployed or missing environment variables. Deploy with: npx supabase functions deploy generate-schedule`;
      } else if (msg.includes('GEMINI_API_KEY')) {
        msg = `AI API key not configured. Set GEMINI_API_KEY in Supabase Edge Function settings.`;
      }

      Alert.alert('Generation Failed', msg);
    } finally {
      setIsGenerating(false);
    }
  };

  // Auto-Adjustment: delegate to shared scheduleAdjuster lib
  const adjustSchedule = async () => {
    if (!activePet || !checkAccess()) return;
    setIsAdjusting(true);

    try {
      const contextStore = usePetContextStore.getState();
      const result = await regenerateSchedule({
        pet: activePet,
        weeklyStats,
        todayCalPercent: contextStore.calPercent,
        weightTrendDirection: contextStore.weightTrend?.direction ?? null,
      });

      if (!result.success) throw new Error(result.error || 'Adjustment failed.');

      setShowAdjustBanner(false);
      setAdjustDismissed(true);

      const adjustMsg = result.fatigueDetected
        ? 'A gentler, enrichment-focused plan has been created. Small steps count!'
        : `A lighter, more achievable plan has been generated across ${result.days_generated} days.`;

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
    if (!activePet || !selectedType || !checkAccess()) return;
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

      // Optimistic update — append new activity to local state (no reload flash)
      setActivities(prev => [...prev, { ...actPayload, id: `temp-${Date.now()}` }].sort((a, b) =>
        (a.scheduled_time || '').localeCompare(b.scheduled_time || '')
      ));

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

  // Date slider: 5 days centered around today
  const weekDates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 5 }, (_, i) => {
      const d = new Date(today);
      d.setDate(today.getDate() + i - 1);
      return d;
    });
  }, []);

  const calPct = Math.min(1, targetCalories > 0 ? heroCalories / targetCalories : 0);
  const waterPct = Math.min(1, targetWater > 0 ? heroWater / targetWater : 0);
  const playPct = Math.min(1, targetPlay > 0 ? heroPlay / targetPlay : 0);

  return (
    <View style={[styles.container, { backgroundColor: '#FFFFFF' }]}>

      {/* Top Header */}
      <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerLeft}>
          <View style={styles.avatarMini}>
            <Image
              source={{ uri: activePet?.current_avatar_url || activePet?.image_url || 'https://images.unsplash.com/photo-1543466835-00a7907e9de1?q=80&w=200' }}
              style={styles.avatarMiniImg}
            />
          </View>
          <Text style={styles.headerTitle}>Pawtchi</Text>
        </View>
        <TouchableOpacity style={styles.bellBtn} onPress={() => router.push('/(tabs)/profile' as any)}>
          <MaterialIcons name="settings" size={24} color="#243036" />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* Progress Section */}
        <View style={styles.progressSection}>
          <Text style={styles.progressSubtitle}>DAILY PULSE</Text>
          <Text style={styles.progressTitle}>Today&apos;s Progress</Text>

          {/* Date Slider */}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dateSlider}>
            {weekDates.map((date, idx) => {
              const isSelected = getLocalYMD(date) === dateStr;
              const isFuture = date.setHours(0, 0, 0, 0) > new Date().setHours(0, 0, 0, 0);
              return (
                <TouchableOpacity
                  key={idx}
                  style={[
                    styles.datePill,
                    isSelected && styles.datePillActive,
                    isFuture && !isSelected && { opacity: 0.6 },
                  ]}
                  onPress={() => setCurrentDate(new Date(date))}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.datePillDay, isSelected && styles.datePillDayActive]}>
                    {DAY_NAMES[date.getDay()]}
                  </Text>
                  <Text style={[styles.datePillDate, isSelected && styles.datePillDateActive]}>
                    {date.getDate()} {MONTH_NAMES[date.getMonth()]}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>

          {/* Completion Badge */}
          {totalScheduled > 0 && (
            <View style={styles.completionBadge}>
              <Text style={styles.completionBadgeText}>{completionPct}% Total</Text>
            </View>
          )}

          {/* Stats Grid with SVG Rings */}
          <View style={styles.statsGrid}>
            {/* Calories Ring */}
            <View style={[styles.ringCard, { backgroundColor: '#f8fafc' }]}>
              <View style={styles.ringContainer}>
                <Svg width={64} height={64} style={{ transform: [{ rotate: '-90deg' }] }}>
                  <Circle cx={32} cy={32} r={28} stroke="#e2e8f0" strokeWidth={6} fill="transparent" />
                  <Circle cx={32} cy={32} r={28} stroke="#041015" strokeWidth={6} fill="transparent"
                    strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={RING_CIRCUMFERENCE * (1 - calPct)} strokeLinecap="round" />
                </Svg>
                <MaterialIcons name="local-fire-department" size={22} color="#041015" style={styles.ringIcon} />
              </View>
              <Text style={styles.ringValue}>{heroCalories}</Text>
              <Text style={styles.ringLabel}>kcal</Text>
            </View>

            {/* Water Ring */}
            <View style={[styles.ringCard, { backgroundColor: '#041015' }]}>
              <View style={styles.ringContainer}>
                <Svg width={64} height={64} style={{ transform: [{ rotate: '-90deg' }] }}>
                  <Circle cx={32} cy={32} r={28} stroke="#1e293b" strokeWidth={6} fill="transparent" />
                  <Circle cx={32} cy={32} r={28} stroke="#FFFC00" strokeWidth={6} fill="transparent"
                    strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={RING_CIRCUMFERENCE * (1 - waterPct)} strokeLinecap="round" />
                </Svg>
                <MaterialIcons name="water-drop" size={22} color="#FFFC00" style={styles.ringIcon} />
              </View>
              <Text style={[styles.ringValue, { color: '#FFFFFF' }]}>{(heroWater / 1000).toFixed(1)}</Text>
              <Text style={[styles.ringLabel, { color: '#94a3b8' }]}>Liters</Text>
            </View>

            {/* Play Ring */}
            <View style={[styles.ringCard, { backgroundColor: '#f8fafc' }]}>
              <View style={styles.ringContainer}>
                <Svg width={64} height={64} style={{ transform: [{ rotate: '-90deg' }] }}>
                  <Circle cx={32} cy={32} r={28} stroke="#e2e8f0" strokeWidth={6} fill="transparent" />
                  <Circle cx={32} cy={32} r={28} stroke="#041015" strokeWidth={6} fill="transparent"
                    strokeDasharray={RING_CIRCUMFERENCE} strokeDashoffset={RING_CIRCUMFERENCE * (1 - playPct)} strokeLinecap="round" />
                </Svg>
                <MaterialIcons name="sports-tennis" size={22} color="#041015" style={styles.ringIcon} />
              </View>
              <Text style={styles.ringValue}>{heroPlay}</Text>
              <Text style={styles.ringLabel}>Mins</Text>
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

        {/* Activity Feed */}
        <View style={styles.feedSection}>
          <View style={styles.feedHeader}>
            <Text style={styles.feedTitle}>Timeline</Text>
            {pendingCount > 0 && (
              <View style={[styles.pendingBadge, { backgroundColor: '#FEF3C7' }]}>
                <Text style={styles.pendingBadgeText}>{pendingCount} pending</Text>
              </View>
            )}
          </View>

          {isLoading ? (
            <ActivityIndicator style={{ marginTop: 40 }} size="large" color="#FFFC00" />
          ) : activities.length === 0 ? (
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
              {timeline.map((item, idx) => {
                const isFood = item._feedType === 'food';
                const isPending = item.status === 'pending';
                const isCompleted = item.status === 'completed';
                const isSkipped = item.status === 'skipped';
                const timeStr = item.scheduled_time
                  ? item.scheduled_time.slice(0, 5)
                  : new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                const isLastItem = idx === timeline.length - 1;

                if (isFood) {
                  return (
                    <View key={`food-${item.id}`} style={styles.tlItem}>
                      {/* Timeline dot */}
                      <View style={styles.tlDotCol}>
                        <View style={[styles.tlDot, styles.tlDotCompleted]}>
                          <MaterialIcons name="check" size={12} color="#041015" />
                        </View>
                        {!isLastItem && <View style={styles.tlLine} />}
                      </View>
                      {/* Card */}
                      <View style={styles.tlCard}>
                        <Text style={styles.tlTime}>{timeStr}</Text>
                        <Text style={styles.tlTitle}>{item.ai_identified_food || 'Food'}</Text>
                        <Text style={styles.tlDesc}>{item.ai_estimated_calories} calories logged</Text>
                        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                          <View style={styles.tlBadge}>
                            <Text style={styles.tlBadgeText}>{item.ai_estimated_calories} KCAL</Text>
                          </View>
                        </View>
                        <View style={styles.tlWatermark}>
                          <MaterialIcons name="restaurant" size={100} color="rgba(255,255,255,0.06)" />
                        </View>
                      </View>
                    </View>
                  );
                }

                const typeDef = ACTIVITY_TYPES.find(t => t.id === item.activity_type) || ACTIVITY_TYPES[0];
                const metricLabel = item.water_ml ? `${item.water_ml} ML` : item.duration_minutes ? `${item.duration_minutes} MIN` : null;

                return (
                  <View key={`act-${item.id}`} style={[styles.tlItem, isSkipped && { opacity: 0.4 }]}>
                    {/* Timeline dot — visual indicator only */}
                    <View style={styles.tlDotCol}>
                      {isPending ? (
                        <View style={[styles.tlDot, styles.tlDotPending]}>
                          <View style={styles.tlDotPendingInner} />
                        </View>
                      ) : (
                        <View style={[styles.tlDot, isCompleted ? styles.tlDotCompleted : styles.tlDotSkipped]}>
                          <MaterialIcons name={isCompleted ? "check" : "close"} size={12} color={isCompleted ? "#041015" : "#9ca3af"} />
                        </View>
                      )}
                      {!isLastItem && <View style={styles.tlLine} />}
                    </View>

                    {/* Card */}
                    <View style={[styles.tlCard, isSkipped && { borderStyle: 'dashed' as any, borderWidth: 2, borderColor: '#e2e8f0', backgroundColor: 'transparent' }]}>
                      <View style={{ position: 'relative', zIndex: 10 }}>
                        <Text style={[styles.tlTime, isSkipped && { color: '#94a3b8' }]}>{timeStr}</Text>
                        <Text style={[styles.tlTitle, isSkipped && { color: '#94a3b8' }]}>{item.title}</Text>
                        {!!item.notes && <Text style={styles.tlDesc}>{item.notes}</Text>}

                        {/* Tags row */}
                        <View style={styles.tlTagsRow}>
                          {!!item.duration_minutes && !item.distance_km && ['walk', 'play'].includes(item.activity_type) && activePet?.current_weight_kg && (
                            <Text style={styles.tlDescSmall}>{contextualizeWalk(item.duration_minutes, activePet.current_weight_kg)}</Text>
                          )}
                          {!!item.distance_km && (
                            <Text style={styles.tlDescSmall}>{item.distance_km} km</Text>
                          )}
                          <View style={{ flex: 1 }} />
                          {metricLabel && (
                            <View style={styles.tlBadge}>
                              <Text style={styles.tlBadgeText}>{metricLabel}</Text>
                            </View>
                          )}
                        </View>

                        {/* Mark as Done CTA — only on pending items, before confirmation */}
                        {isPending && confirmingTaskId !== item.id && (
                          <TouchableOpacity
                            style={styles.markDoneBtn}
                            onPress={() => handleCheckTap(item)}
                            activeOpacity={0.85}
                          >
                            <MaterialIcons name="check-circle-outline" size={18} color="#041015" />
                            <Text style={styles.markDoneBtnText}>Mark as Done</Text>
                          </TouchableOpacity>
                        )}
                      </View>

                      {/* Watermark icon */}
                      {!isSkipped && (
                        <View style={styles.tlWatermark}>
                          <MaterialIcons name={typeDef.icon as any} size={100} color="rgba(255,255,255,0.06)" />
                        </View>
                      )}

                      {/* Smart Completion Inline UI */}
                      {confirmingTaskId === item.id && (
                        <View style={styles.smartConfirm}>
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
                                  <Text style={[styles.smartChipText, isSelected && styles.smartChipTextActive]}>{mins}m</Text>
                                  {isScheduled && !isSelected && <Text style={styles.smartChipHint}>✓</Text>}
                                </TouchableOpacity>
                              );
                            })}
                          </View>
                          <View style={styles.smartConfirmActions}>
                            <TouchableOpacity style={styles.smartDoneBtn} onPress={() => confirmCompletion(item, confirmingDuration)}>
                              <MaterialIcons name="check" size={18} color="#1A1A1A" />
                              <Text style={styles.smartDoneBtnText}>Done</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.smartCancelBtn} onPress={() => setConfirmingTaskId(null)}>
                              <Text style={styles.smartCancelBtnText}>Cancel</Text>
                            </TouchableOpacity>
                          </View>
                        </View>
                      )}
                    </View>
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
                <View style={styles.bentoGrid}>
                  {/* Hero Card: Walk */}
                  <TouchableOpacity
                    style={[styles.bentoHero, { backgroundColor: ACTIVITY_TYPES.find(t => t.id === 'walk')?.color }]}
                    onPress={() => setSelectedType('walk')}
                    activeOpacity={0.9}
                  >
                    <View style={styles.heroOverlay}>
                      <MaterialIcons name="directions-walk" size={56} color="#1A1A1A" />
                      <Text style={styles.heroLabel}>Walk</Text>
                      <View style={{ position: 'absolute', right: 24, top: 24, backgroundColor: 'rgba(255,255,255,0.4)', borderRadius: 20, padding: 4 }}>
                        <MaterialIcons name="chevron-right" size={24} color="#1A1A1A" />
                      </View>
                    </View>
                  </TouchableOpacity>

                  {/* Secondary Row: Play & Water */}
                  <View style={styles.bentoRow}>
                    <TouchableOpacity
                      style={[styles.bentoSquare, { backgroundColor: ACTIVITY_TYPES.find(t => t.id === 'play')?.color }]}
                      onPress={() => setSelectedType('play')}
                      activeOpacity={0.9}
                    >
                      <MaterialIcons name="sports-baseball" size={36} color="#1A1A1A" />
                      <Text style={styles.bentoLabel}>Play</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.bentoSquare, { backgroundColor: ACTIVITY_TYPES.find(t => t.id === 'water')?.color }]}
                      onPress={() => setSelectedType('water')}
                      activeOpacity={0.9}
                    >
                      <MaterialIcons name="water-drop" size={36} color="#1A1A1A" />
                      <Text style={styles.bentoLabel}>Water</Text>
                    </TouchableOpacity>
                  </View>

                  {/* Tertiary Scroll Row: Care & Health */}
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.bentoTagsScroll}>
                    {ACTIVITY_TYPES.filter(t => !['walk', 'play', 'water'].includes(t.id)).map(type => (
                      <TouchableOpacity
                        key={type.id}
                        style={[styles.bentoTag, { backgroundColor: type.color }]}
                        onPress={() => setSelectedType(type.id)}
                        activeOpacity={0.8}
                      >
                        <View style={styles.bentoTagIconBox}>
                          <MaterialIcons name={type.icon as any} size={18} color="#1A1A1A" />
                        </View>
                        <Text style={styles.bentoTagLabel}>{type.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
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
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 24, paddingBottom: 16, backgroundColor: '#FFFFFF',
    zIndex: 50, borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatarMini: {
    width: 44, height: 44, borderRadius: 22, overflow: 'hidden',
    borderWidth: 2.5, borderColor: '#FFFC00',
  },
  avatarMiniImg: { width: '100%', height: '100%' },
  headerTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 22,
    letterSpacing: -0.5, color: '#243036',
  },
  bellBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'flex-end' },
  scrollContent: { flexGrow: 1, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 160 },

  // Progress Section
  progressSection: { marginBottom: 28 },
  progressSubtitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 11,
    letterSpacing: 2, color: '#94a3b8', marginBottom: 4,
  },
  progressTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 26,
    letterSpacing: -0.5, color: '#0f172a', marginBottom: 20,
  },

  // Date Slider
  dateSlider: { gap: 10, paddingVertical: 4, marginBottom: 20 },
  datePill: {
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 16,
    backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0', alignItems: 'center',
  },
  datePillActive: {
    backgroundColor: '#FFFC00', borderColor: '#FFFC00',
    shadowColor: '#FFFC00', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  datePillDay: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 11,
    letterSpacing: 1, color: '#94a3b8', marginBottom: 2,
  },
  datePillDayActive: { color: '#0f172a' },
  datePillDate: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 13, color: '#475569',
  },
  datePillDateActive: { color: '#0f172a' },

  // Completion Badge
  completionBadge: {
    alignSelf: 'flex-start', backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0',
    paddingHorizontal: 16, paddingVertical: 6, borderRadius: 20, marginBottom: 20,
  },
  completionBadgeText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 13, color: '#16a34a',
  },

  // Stats Grid & Rings
  statsGrid: { flexDirection: 'row', gap: 12 },
  ringCard: {
    flex: 1, borderRadius: 20, padding: 16, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04, shadowRadius: 8, elevation: 2,
  },
  ringContainer: {
    width: 64, height: 64, justifyContent: 'center', alignItems: 'center', marginBottom: 10,
  },
  ringIcon: { position: 'absolute' },
  ringValue: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 18, color: '#0f172a',
  },
  ringLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '600', fontSize: 11, color: '#94a3b8', marginTop: 2,
  },

  // Feed Section
  feedSection: { marginTop: 32, marginBottom: 32 },
  feedHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24,
  },
  feedTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 22, letterSpacing: -0.5, color: '#0f172a',
  },
  pendingBadge: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16 },
  pendingBadgeText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 12, color: '#92400e',
  },

  // Empty State
  emptyState: {
    alignItems: 'center', padding: 40, backgroundColor: '#f8fafc', borderRadius: 24,
    borderWidth: 1, borderColor: '#e2e8f0',
  },
  emptyTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 18, color: '#1A1A1A', marginBottom: 8,
  },
  emptyDesc: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 14, color: '#6b7280',
    textAlign: 'center', lineHeight: 20, marginBottom: 24,
  },
  generateBtn: { borderRadius: 32, overflow: 'hidden', width: '100%' },
  generateGradient: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  generateText: { fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 16, color: '#1A1A1A' },

  // Timeline Items
  timelineList: { gap: 0 },
  tlItem: { flexDirection: 'row', gap: 16 },
  tlDotCol: { alignItems: 'center', width: 28 },
  tlDot: {
    width: 28, height: 28, borderRadius: 14, justifyContent: 'center', alignItems: 'center',
    borderWidth: 2, borderColor: '#e2e8f0', backgroundColor: '#FFFFFF',
  },
  tlDotCompleted: {
    backgroundColor: '#FFFC00', borderColor: '#FFFC00',
  },
  tlDotPending: {
    backgroundColor: '#FFFC00', borderColor: '#FFFC00',
    shadowColor: '#FFFC00', shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6, shadowRadius: 6, elevation: 4,
  },
  tlDotPendingInner: {
    width: 8, height: 8, borderRadius: 4, backgroundColor: '#041015',
  },
  tlDotSkipped: {
    backgroundColor: '#f1f5f9', borderColor: '#e2e8f0',
  },
  tlLine: {
    width: 2, flex: 1, backgroundColor: '#e2e8f0', marginVertical: 4,
  },
  tlCard: {
    flex: 1, backgroundColor: '#041015', borderRadius: 20, padding: 20,
    marginBottom: 16, overflow: 'hidden', position: 'relative',
  },
  tlTime: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 11,
    letterSpacing: 1.5, color: '#FFFC00', marginBottom: 6,
  },
  tlTitle: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 17,
    color: '#FFFFFF', marginBottom: 4,
  },
  tlDesc: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 13, color: '#94a3b8',
    lineHeight: 18, marginBottom: 12,
  },
  tlDescSmall: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 12, color: '#64748b',
  },
  tlTagsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4,
  },
  tlBadge: {
    backgroundColor: 'rgba(255,252,0,0.15)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: 12,
  },
  tlBadgeText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 11,
    letterSpacing: 1, color: '#FFFC00',
  },
  tlWatermark: {
    position: 'absolute', bottom: -10, right: -10,
  },

  // Mark as Done CTA
  markDoneBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, marginTop: 16,
    backgroundColor: '#FFFC00', borderRadius: 14,
    paddingVertical: 12, paddingHorizontal: 20,
    shadowColor: '#FFFC00', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3, shadowRadius: 8, elevation: 4,
  },
  markDoneBtnText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 14,
    color: '#041015', letterSpacing: 0.3,
  },

  // FAB
  fab: {
    position: 'absolute', right: 24,
    shadowColor: '#FFFC00', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 16, elevation: 10, borderRadius: 32,
  },
  fabInner: {
    width: 64, height: 64, borderRadius: 32,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 4, borderColor: '#FFFFFF',
  },

  // Modal
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
  bentoGrid: { gap: 16 },
  bentoHero: {
    width: '100%', height: 130, borderRadius: 32, overflow: 'hidden',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.1, shadowRadius: 10, elevation: 5,
  },
  heroOverlay: {
    flex: 1, padding: 24, justifyContent: 'flex-end', alignItems: 'flex-start',
  },
  heroLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 28, color: '#1A1A1A', marginTop: 8,
  },
  bentoRow: { flexDirection: 'row', gap: 16 },
  bentoSquare: {
    flex: 1, height: 120, borderRadius: 32, padding: 24, justifyContent: 'flex-end', alignItems: 'flex-start',
    shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 4,
  },
  bentoLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '800', fontSize: 18, color: '#1A1A1A', marginTop: 12,
  },
  bentoTagsScroll: { gap: 12, paddingVertical: 8, paddingHorizontal: 4 },
  bentoTag: {
    flexDirection: 'row', alignItems: 'center', padding: 8, paddingRight: 18, borderRadius: 100, gap: 10,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  bentoTagIconBox: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.4)', justifyContent: 'center', alignItems: 'center',
  },
  bentoTagLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 15, color: '#1A1A1A',
  },
  inputGroup: { marginBottom: 20 },
  inputLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#515d64', marginBottom: 8,
  },
  input: {
    backgroundColor: '#F8FAFC', borderRadius: 20, paddingHorizontal: 18, paddingVertical: 16,
    fontFamily: 'Plus Jakarta Sans', fontSize: 16, color: '#1A1A1A',
    borderWidth: 1, borderColor: '#e2e8f0', shadowColor: '#000', shadowOpacity: 0.03, shadowOffset: { width: 0, height: 2 }, shadowRadius: 4, elevation: 1,
  },
  presetRow: { flexDirection: 'row', gap: 8, backgroundColor: '#f1f5f9', padding: 6, borderRadius: 20 },
  presetBtn: {
    flex: 1, paddingVertical: 12, borderRadius: 14, alignItems: 'center', justifyContent: 'center',
  },
  presetBtnActive: {
    backgroundColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.08, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 2,
  },
  presetBtnText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#64748b',
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
  adjustBannerActions: { flexDirection: 'row', gap: 12 },
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
    marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
    position: 'relative', zIndex: 20,
  },
  smartConfirmLabel: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#94a3b8', marginBottom: 12,
  },
  smartConfirmRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  smartChip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center',
  },
  smartChipActive: { backgroundColor: '#FFFC00' },
  smartChipScheduled: { borderWidth: 2, borderColor: 'rgba(255,255,255,0.2)' },
  smartChipText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 13, color: '#94a3b8',
  },
  smartChipTextActive: { color: '#1A1A1A' },
  smartChipHint: {
    fontFamily: 'Plus Jakarta Sans', fontSize: 10, color: '#64748b', marginTop: 2,
  },
  smartConfirmActions: { flexDirection: 'row', gap: 12 },
  smartDoneBtn: {
    flex: 1, flexDirection: 'row', gap: 6, backgroundColor: '#FFFC00', borderRadius: 14,
    paddingVertical: 12, alignItems: 'center', justifyContent: 'center',
  },
  smartDoneBtnText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '900', fontSize: 14, color: '#1A1A1A',
  },
  smartCancelBtn: {
    paddingVertical: 12, paddingHorizontal: 20, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center',
  },
  smartCancelBtnText: {
    fontFamily: 'Plus Jakarta Sans', fontWeight: '700', fontSize: 14, color: '#94a3b8',
  },
});

